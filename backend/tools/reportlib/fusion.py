"""Sensor-fusion section of the accuracy report: the DEPLOYED fraud model (photo + motion consistency + environment consistency)
evaluated on the trail simulator (fusion/simulate.py). EVERYTHING computed from the simulator is SYNTHETIC: it measures how the
model behaves in the authors' simulated world, not how often real spoofers are caught or real workers wrongly flagged. The REAL
part reads recorded traces from Sensor-fusion/samples/ when they exist.
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from . import fraud, stats

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from fusion import config as C  # noqa: E402
from fusion import consistency, simulate  # noqa: E402

FEATURES = ["photo_quality_score", "motion_score", "ambient_score", "motion_known", "env_known"]
BARS = {"photo_quality_score": "photo_quality", "motion_score": "motion_consistency", "motion_known": "motion_consistency",
        "ambient_score": "ambient_fingerprint", "env_known": "ambient_fingerprint"}
DECISION = 0.5
GROUP_LABELS = {"genuine": "genuine", "hard_genuine": "hard genuine (false-positive traps)", "fraud": "fraud", "fraud_hard": "hard fraud (replayed motion / wrong network only)", "ambiguous": "ambiguous (label rests on the photo assumption)"}

LEAKAGE = [
    "The simulator and the detectors were written by the same people. The gait frequency (1.8 Hz), the hand-tremor size, the GPS error model (AR(1) noise, accuracy 1-2x sigma), the share of carrier gateways that resolve far away and the whole scenario list are assumptions, not measurements.",
    "The scores are produced by the REAL engines from simulated raw streams (the simulator holds no thresholds or weights), but a detector that is right about the simulated world can still be wrong about real phones.",
    "Training rows and the 'in distribution' test rows come from the same simulator and seed. The different-seed set only changes the random draws; the shifted-world set changes the world (noisier GPS, weaker steps, more tremor, lower sensor rate, more far carrier gateways).",
    "Fraud labels are by scenario: a 'fraud' row is fraud because the simulator made it a spoof. Real spoofing apps, real emulators and real fraud patterns are unknown.",
    "The rule 'with the same weak evidence a poor photo tips a case to review' (the `ambiguous` pair) is an ASSUMPTION encoded in the labels, as in the old generator; it was not learned from reviewed cases.",
    "Replayed real accelerometer data on a frozen mock location is, by construction, invisible to the motion rules; only the 'too perfect GPS' sign and the network can see it. The `fraud_hard` group shows how often that is enough.",
    "The IP-context rows are simulated; the real DB-IP databases were not used for any number here.",
]


def _model():
    import classifier

    return classifier.model if "motion_known" in classifier.MODEL_FEATURES else None


def _p(model, df):
    return model.predict_proba(df[FEATURES])[:, 1]


def _scenario_rows(df, p):
    rows = []
    for (name, grp, truth), g in df.assign(p=p).groupby(["scenario", "group", "is_fraud"]):
        wrong = int(((g["p"] > DECISION) != (truth == 1)).sum())
        rows.append({"scenario": name, "group": grp, "truth": "fraud" if truth else "genuine", "n": len(g), "wrong": wrong, "error": stats.rate(wrong, len(g)),
                     "mean_motion": float(g["motion_score"].mean()), "mean_env": float(g["ambient_score"].mean())})
    return rows


def _groups(df, p):
    out = {}
    flagged = p > DECISION
    for grp, g in df.assign(f=flagged).groupby("group"):
        truth = int(g["is_fraud"].iloc[0])
        k = int(g["f"].sum())
        out[grp] = {"n": len(g), "truth": "fraud" if truth else "genuine",
                    ("recall" if truth else "false_flag"): stats.rate(k, len(g))}
    return out


def _strata(df, p):
    rows = []
    d = df.assign(f=p > DECISION)
    for (mk, ek), g in d.groupby(["motion_known", "env_known"]):
        gen, fr = g[g.is_fraud == 0], g[g.is_fraud == 1]
        rows.append({"motion_known": bool(mk), "env_known": bool(ek), "n": len(g),
                     "false_flag": stats.rate(int(gen.f.sum()), len(gen)), "recall": stats.rate(int(fr.f.sum()), len(fr))})
    return rows


def _fit(df, feats, seed=42):
    from sklearn.ensemble import GradientBoostingClassifier

    return GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=seed).fit(df[feats], df["is_fraud"])


def _ablation(train, test, n_boot, seed):
    drops = {"all inputs": [], "without motion (motion_score, motion_known)": ["motion_score", "motion_known"],
             "without environment (ambient_score, env_known)": ["ambient_score", "env_known"], "without photo quality": ["photo_quality_score"]}
    rows = []
    for name, drop in drops.items():
        feats = [f for f in FEATURES if f not in drop]
        m = _fit(train, feats)
        p = m.predict_proba(test[feats])[:, 1]
        y = test["is_fraud"].values
        auc, lo, hi = stats.bootstrap_auc(p[y == 1], p[y == 0], n_boot=n_boot, seed=seed)
        c = stats.confusion(y == 1, p > DECISION)
        rows.append({"variant": name, "auc": {"value": auc, "lo": lo, "hi": hi}, "recall": c["recall"], "false_flag": c["false_positive_rate"]})
    return rows


def _shap_stability(train, test, seeds=3):
    import shap
    from sklearn.model_selection import train_test_split

    order = ["photo_quality", "motion_consistency", "ambient_fingerprint"]
    shares = []
    for s in range(seeds):
        tr, _ = train_test_split(train, test_size=0.2, stratify=train["is_fraud"], random_state=s)
        m = _fit(tr, FEATURES, seed=s)
        v = np.abs(shap.Explainer(m, tr[FEATURES].sample(n=min(100, len(tr)), random_state=s))(test[FEATURES].head(300)).values).mean(axis=0)
        fold = dict.fromkeys(order, 0.0)
        for f, x in zip(FEATURES, v):
            fold[BARS[f]] += float(x)
        t = sum(fold.values()) or 1.0
        shares.append([fold[k] / t for k in order])
    arr = np.array(shares)
    return {"seeds": seeds, "bars": order, "share_mean": arr.mean(axis=0).tolist(), "share_min": arr.min(axis=0).tolist(), "share_max": arr.max(axis=0).tolist(),
            "same_rank_in_all_seeds": len({tuple(np.argsort(-r)) for r in arr}) == 1}


def _jump_sensitivity(seed):
    """How the 'GPS jump' rule's speed ceiling changes what is caught vs what is wrongly accused (feature level, no model)."""
    wanted = {"f_teleport_still": 60, "g_walk_hand": 60, "h_tunnel_dropout": 40, "h_smooth_highway": 40, "h_indoor_drift": 40}
    scen = [(n, b, l, g, wanted[n]) for n, b, l, g, _ in simulate.SCENARIOS if n in wanted]
    old = (C.GEO["jumpSpeedMs"], C.GEO["jumpDistanceM"])
    rows = []
    try:
        C.GEO["jumpDistanceM"] = 1e12  # isolate the speed ceiling from the distance rule
        for v in (10, 25, 55, 120, 300):
            C.GEO["jumpSpeedMs"] = v
            d = simulate.generate(seed=seed + 11, scenarios=scen)
            r = {"jumpSpeedMs": v, "deployed": v == old[0]}
            for n in wanted:
                g = d[d.scenario == n]
                r[n] = stats.rate(int(g["flags"].fillna("").str.contains("gps_jump").sum()), len(g))
            rows.append(r)
    finally:
        C.GEO["jumpSpeedMs"], C.GEO["jumpDistanceM"] = old
    return rows


# ---------------------------------------------------------------- REAL traces

GENUINE_FOLDERS = ("walk_to_site", "drive_then_walk", "stationary_at_site", "indoor_poor_gps")
SPOOF_FOLDERS = ("spoof_teleport", "spoof_mock_android", "spoof_static_home")


def real_traces(samples_dir, seed=0):
    """Recorded traces in <samples>/<scenario>/*.json (the `?record=1` export: {"trail": {...}, "site": {...}?}). A trace is
    'flagged' when its motion consistency is known and below 0.6. Counts and intervals only: nothing here is a claim of accuracy
    until there are enough traces per class (small samples are marked)."""
    root = Path(samples_dir) if samples_dir else None
    out = {"label": "REAL", "evaluated": False, "folders": {}, "note": ""}
    if root is None or not root.exists():
        out["note"] = "No Sensor-fusion/samples folder: no real trace has been evaluated."
        return out
    site_default = None
    if (root / "site.json").exists():
        try:
            site_default = json.loads((root / "site.json").read_text())
        except ValueError:
            pass
    for folder in GENUINE_FOLDERS + SPOOF_FOLDERS:
        files = sorted((root / folder).glob("*.json")) if (root / folder).is_dir() else []
        if not files:
            continue
        rows = []
        for f in files:
            try:
                doc = json.loads(f.read_text())
            except ValueError:
                rows.append({"file": f.name, "error": "not JSON"})
                continue
            trail = doc.get("trail", doc)
            from fusion import trail as trail_mod

            parsed, bad = trail_mod.parse(trail)
            if parsed is None:
                rows.append({"file": f.name, "error": "invalid trail: " + ",".join(bad)})
                continue
            r = consistency.evaluate(parsed, doc.get("site") or site_default, None)
            rows.append({"file": f.name, "score": r["motion_consistency"], "known": r["motion_known"], "flags": r["flags"],
                         "flagged": bool(r["motion_known"] and r["motion_consistency"] < 0.6)})
        ok = [r for r in rows if "error" not in r]
        known = [r for r in ok if r["known"]]
        out["folders"][folder] = {"role": "genuine" if folder in GENUINE_FOLDERS else "spoof", "files": len(files), "evaluable": len(ok), "known": len(known),
                                  "flagged": stats.rate(sum(r["flagged"] for r in known), len(known)), "rows": rows}
    gen = [f for f, v in out["folders"].items() if v["role"] == "genuine"]
    spo = [f for f, v in out["folders"].items() if v["role"] == "spoof"]
    if out["folders"]:
        out["evaluated"] = True
        k = sum(out["folders"][f]["flagged"]["k"] for f in gen)
        n = sum(out["folders"][f]["flagged"]["n"] for f in gen)
        ks = sum(out["folders"][f]["flagged"]["k"] for f in spo)
        ns = sum(out["folders"][f]["flagged"]["n"] for f in spo)
        out["false_flag"] = stats.rate(k, n) if gen else None
        out["recall"] = stats.rate(ks, ns) if spo else None
        out["small_sample"] = n < stats.SMALL_N or ns < stats.SMALL_N
        out["note"] = "Motion consistency only (no classifier, no photo, no network). Traces are labelled by their folder; the labelling was not audited."
    else:
        out["note"] = "No traces found in any scenario folder: no real trace has been evaluated."
    return out


def run(n_boot=1000, seed=0, scale=1.0, samples_dir=None):
    import generate_fusion_data as gfd
    from sklearn.model_selection import train_test_split
    import train_classifier as tc

    model = _model()
    if model is None:
        return {"skipped": "the deployed model is the legacy 3-feature model: no sensor-fusion model to evaluate"}
    train = pd.read_csv(gfd.OUT_PATH)
    _, idx_te = train_test_split(np.arange(len(train)), test_size=0.2, stratify=train["is_fraud"], random_state=42)
    sets = {
        "in_distribution_test_split": (train.iloc[idx_te].reset_index(drop=True), "20% split of the training data (same simulator, same seed; train_classifier.py)"),
        "different_seed": (simulate.generate(seed=1234, n_scale=scale), "same simulated world, new random draws (seed 1234)"),
        "shifted_world": (simulate.generate(seed=4321, n_scale=scale, params=simulate.SHIFTED), "a different world: " + ", ".join(f"{k}={v}" for k, v in simulate.SHIFTED.__dict__.items() if getattr(simulate.DEFAULT, k) != v)),
    }
    out = {"label": "SYNTHETIC", "model": type(model).__name__, "features": FEATURES, "decision_threshold": DECISION, "leakage": LEAKAGE, "scale": scale,
           "config_sha256": hashlib.sha256(Path(C.PATH).read_bytes()).hexdigest()[:12], "evaluations": {}, "by_scenario": {}, "groups": {}, "strata": {}}
    for name, (df, desc) in sets.items():
        p = _p(model, df)
        out["evaluations"][name] = {**fraud._metrics(df["is_fraud"].values, p, n_boot, seed), "description": desc}
        out["by_scenario"][name] = _scenario_rows(df, p)
        out["groups"][name] = _groups(df, p)
        out["strata"][name] = _strata(df, p)
    shifted = sets["shifted_world"][0]
    out["ablation"] = _ablation(train, shifted, n_boot, seed)
    p = _p(model, shifted)
    y = shifted["is_fraud"].values
    base = stats.roc_auc(p[y == 1], p[y == 0])
    rng = np.random.default_rng(seed)
    perm = {}
    for f in FEATURES:
        d = shifted[FEATURES].copy()
        d[f] = rng.permutation(d[f].values)
        q = model.predict_proba(d)[:, 1]
        perm[f] = {"auc_drop": base - stats.roc_auc(q[y == 1], q[y == 0])}
    out["permutation"] = {"base_auc": base, "by_feature": perm}
    out["shap_stability"] = _shap_stability(train, shifted)
    probes = []
    for name, feats, expect in tc.PROBES:
        pr = float(model.predict_proba(pd.DataFrame([dict(zip(FEATURES, feats))])[FEATURES])[0, 1])
        got = "flagged" if pr > DECISION else "accepted"
        probes.append({"name": name, "features": dict(zip(FEATURES, feats)), "p_fraud": pr, "expected": expect, "got": got, "ok": got == expect})
    out["probes"] = probes
    out["jump_sensitivity"] = _jump_sensitivity(seed)
    out["real"] = real_traces(samples_dir, seed)
    return out
