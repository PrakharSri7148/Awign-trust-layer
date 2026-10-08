"""LEGACY fraud-classifier section of the accuracy report (the 3-input v1 model, fraud_classifier_v1.pkl, kept for rollback;
the deployed sensor-fusion model is evaluated in fusion.py). EVERYTHING here is SYNTHETIC: the model was trained on
generated rows and there are no real reviewed submissions to test it on."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from . import stats

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

import generate_synthetic_data as gen  # noqa: E402

FEATURES = ["photo_quality_score", "motion_score", "ambient_score"]
DECISION = 0.5  # main.py: flagged when fraud_probability > 0.5

# The held-out generators: a different seed, 2x the rows, and (for "shifted") a different world.
HELDOUT = {
    "different_seed": dict(seed=1234, n_per_case=300),
    "shifted_parameters": dict(seed=4321, n_per_case=300, sd_scale=1.5, mean_shift=0.05, photo_shift=-0.05),
}

# The Phase 5 probe grid (progress.md): name, features, what a sensible model should say.
PROBES = [
    ("all good", (0.9, 0.75, 0.85), "accepted"),
    ("honest bad photo", (0.15, 0.75, 0.85), "accepted"),
    ("spoofed GPS, good photo", (0.9, 0.10, 0.60), "flagged"),
    ("bad photo + suspicious", (0.15, 0.30, 0.40), "flagged"),
    ("ambiguous signals + bad photo", (0.15, 0.45, 0.55), "flagged"),
    ("ambiguous signals + good photo", (0.9, 0.45, 0.55), "accepted"),
]

LEAKAGE = [
    "Training rows and every 'test' set below come from the SAME hand-written generator (generate_synthetic_data.py). "
    "The score distributions, the class overlap and the labels are all assumptions chosen by the authors, not measurements.",
    "Therefore high accuracy here shows only that gradient boosting can learn the generator's rules. It says nothing about how "
    "often real fraud is caught or how often honest workers are flagged.",
    "The rule 'a poor photo tips AMBIGUOUS submissions towards review' is encoded in the labels. The photo-quality feature "
    "only matters because the generator says so; it was not learned from real reviewed cases.",
    "motion_score and ambient_score are produced by the generator too: their real-world distributions (and how a real GPS "
    "spoofer looks) are unknown.",
]


def _metrics(y, p, n_boot, seed):
    y, p = np.asarray(y), np.asarray(p)
    auc, lo, hi = stats.bootstrap_auc(p[y == 1], p[y == 0], n_boot=n_boot, seed=seed)
    rel, ece = stats.reliability(y, p)
    c = stats.confusion(y == 1, p > DECISION)
    return {"n": int(len(y)), "n_fraud": int(y.sum()), "confusion": c, "auc": {"value": auc, "lo": lo, "hi": hi},
            "brier": stats.brier(y, p), "ece": ece, "reliability": rel}


def _mean_abs_shap(model, X_background, X_eval):
    import shap

    ex = shap.Explainer(model, X_background)
    v = np.abs(ex(X_eval).values).mean(axis=0)
    return v / v.sum()


def run(n_boot=1000, seed=0, shap_seeds=5):
    import joblib
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.model_selection import train_test_split

    model = joblib.load(BACKEND / "fraud_classifier_v1.pkl")
    out = {"label": "SYNTHETIC", "model": type(model).__name__ + " (LEGACY v1, 3 inputs; not the deployed model)", "features": FEATURES, "decision_threshold": DECISION,
           "leakage": LEAKAGE}

    df = pd.read_csv(gen.OUT_PATH)
    _, X_te, _, y_te = train_test_split(df[FEATURES], df["is_fraud"], test_size=0.2, stratify=df["is_fraud"], random_state=42)
    evals = {"in_distribution_test_split": _metrics(y_te.values, model.predict_proba(X_te)[:, 1], n_boot, seed)}
    evals["in_distribution_test_split"]["description"] = "20% split of the training CSV, same generator and seed (train_classifier.py)"
    held = {}
    for name, kw in HELDOUT.items():
        d = gen.generate(**kw)
        held[name] = d
        evals[name] = _metrics(d["is_fraud"].values, model.predict_proba(d[FEATURES])[:, 1], n_boot, seed)
        evals[name]["description"] = "generator with " + ", ".join(f"{k}={v}" for k, v in kw.items())
    out["evaluations"] = evals

    # Per generator case (each case regenerated alone, since generate() shuffles its rows): which groups are wrong?
    per_case = {}
    for name, kw in HELDOUT.items():
        rows_ = []
        for case in gen.CASES:
            sub = gen.generate(**{**kw, "cases": [case]})
            p = model.predict_proba(sub[FEATURES])[:, 1]
            wrong = int(((p > DECISION) != (sub["is_fraud"].values == 1)).sum())
            rows_.append({"case": case[0], "is_fraud": int(case[5]), "n": len(sub), "wrong": wrong, "error_rate": stats.rate(wrong, len(sub))})
        per_case[name] = rows_
    out["per_case_errors"] = per_case

    # SHAP stability: retrain with different seeds/splits, normalise mean |SHAP|, compare.
    rows = []
    for s in range(shap_seeds):
        Xtr, Xte, ytr, _ = train_test_split(df[FEATURES], df["is_fraud"], test_size=0.2, stratify=df["is_fraud"], random_state=s)
        m = GradientBoostingClassifier(n_estimators=50, max_depth=3, random_state=s).fit(Xtr, ytr)
        rows.append(_mean_abs_shap(m, shap_sample(Xtr, 100, s), Xte))
    arr = np.array(rows)
    deployed = _mean_abs_shap(model, df[FEATURES].sample(n=50, random_state=0), X_te)
    out["shap_stability"] = {
        "seeds": shap_seeds, "features": FEATURES,
        "share_mean": arr.mean(axis=0).tolist(), "share_sd": arr.std(axis=0).tolist(),
        "share_min": arr.min(axis=0).tolist(), "share_max": arr.max(axis=0).tolist(),
        "rank_orders": ["  >  ".join(np.array(FEATURES)[np.argsort(-r)]) for r in arr],
        "deployed_share": deployed.tolist(),
        "same_rank_in_all_seeds": len({tuple(np.argsort(-r)) for r in arr}) == 1,
    }

    probes = []
    for name, feats, expect in PROBES:
        pr = float(model.predict_proba(pd.DataFrame([dict(zip(FEATURES, feats))])[FEATURES])[0, 1])
        got = "flagged" if pr > DECISION else "accepted"
        probes.append({"name": name, "features": dict(zip(FEATURES, feats)), "p_fraud": pr, "expected": expect, "got": got, "ok": got == expect})
    out["probes"] = probes

    # Sensitivity 1: world where photo quality carries NO information (borderline-bad-photo rows are genuine).
    alt = [(n, ph, bad, m, a, 0 if n == "borderline_bad_photo" else f) for n, ph, bad, m, a, f in gen.CASES]
    sub = gen.generate(seed=99, n_per_case=300, cases=[c for c in alt if c[0] == "borderline_bad_photo"])
    p = model.predict_proba(sub[FEATURES])[:, 1]
    flagged = int((p > DECISION).sum())
    # Sensitivity 2: permute the photo feature on the shifted held-out set (permutation importance).
    d = held["shifted_parameters"]
    rng = np.random.default_rng(seed)
    base = stats.roc_auc(model.predict_proba(d[FEATURES])[:, 1][d.is_fraud == 1], model.predict_proba(d[FEATURES])[:, 1][d.is_fraud == 0])
    perm = {}
    for f in FEATURES:
        dd = d[FEATURES].copy()
        dd[f] = rng.permutation(dd[f].values)
        q = model.predict_proba(dd)[:, 1]
        perm[f] = {"auc": stats.roc_auc(q[d.is_fraud.values == 1], q[d.is_fraud.values == 0]), "auc_drop": base - stats.roc_auc(q[d.is_fraud.values == 1], q[d.is_fraud.values == 0])}
    out["sensitivity"] = {
        "photo_uninformative_world": {
            "description": "If the 'poor photo => fraud' assumption is wrong and those ambiguous rows are actually genuine "
                           "(same generator rows as 'borderline_bad_photo', relabelled), the deployed model still flags:",
            "flagged": stats.rate(flagged, len(sub)),
        },
        "permutation_importance_shifted_set": {"base_auc": base, "by_feature": perm},
    }
    return out


def shap_sample(X, n, seed):
    return X.sample(n=min(n, len(X)), random_state=seed)
