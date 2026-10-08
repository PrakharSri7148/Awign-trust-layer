"""Photo-quality checks evaluated as classifiers: 'does this photo have issue X?' (check flagged = yes)."""
import sys
import tempfile
import time
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from photo_quality import analyze_image, config  # noqa: E402
from photo_quality.config import task_config  # noqa: E402
from photo_quality.frame import ImageDecodeError  # noqa: E402

from . import inventory, stats  # noqa: E402

FACE_FOLDERS = {"face_not_visible", "good_selfies"}
SYNTH_KINDS = ["lens_covered", "noisy_compressed", "overexposed", "glare"]
SYNTH_N = 40
CAP = 25  # error rows listed per class in the Markdown (the JSON keeps all)
T = config.THRESHOLDS

# One entry per classifier. `metric` is the check's own `value`; `lower_is_worse` says which way the issue goes.
CLASSIFIERS = [
    dict(id="blur", check="blur", title="Blur", metric="edge-steepness score (higher = sharper)", lower_is_worse=True, real=["blurry"], synthetic=[],
         deployed=[("warn below", T["blur"]["warnBelow"]), ("fail below (blocks)", T["blur"]["failBelow"])]),
    dict(id="shake", check="shake", title="Shake (motion blur)", metric="orientation anisotropy (higher = more directional blur)", lower_is_worse=False, real=["shaky"], synthetic=[],
         deployed=[("warn at", T["shake"]["warnAniso"]), ("fail at (flag only)", T["shake"]["failAniso"])]),
    dict(id="exposure_dark", check="exposure", title="Exposure: too dark", metric="mean luma 0-255 (lower = darker)", lower_is_worse=True, real=["dark"], synthetic=[],
         deployed=[("warn below", T["exposure"]["darkMeanWarn"]), ("fail below (blocks)", T["exposure"]["darkMeanFail"])]),
    dict(id="exposure_over", check="exposure", title="Exposure: over-exposed", metric="mean luma 0-255 (higher = brighter)", lower_is_worse=False, real=["overexposed"], synthetic=["overexposed"],
         deployed=[("warn above", T["exposure"]["overMeanWarn"]), ("fail above (blocks)", T["exposure"]["overMeanFail"])]),
    dict(id="resolution", check="resolution", title="Resolution", metric="megapixels (lower = smaller)", lower_is_worse=True, real=["low_resolution"], synthetic=[],
         deployed=[("warn below", T["resolution"]["warnMegapixels"])]),
    dict(id="obstruction", check="obstruction", title="Lens obstruction", metric="covered share of the frame", lower_is_worse=False, real=["lens_covered"], synthetic=["lens_covered"],
         deployed=[("warn at", T["obstruction"]["warnArea"]), ("fail at (blocks)", T["obstruction"]["failArea"])]),
    dict(id="glare", check="glare", title="Glare", metric="blown-out share of the frame", lower_is_worse=False, real=["glare"], synthetic=["glare"],
         deployed=[("warn at", T["glare"]["warnArea"]), ("fail at (flag only)", T["glare"]["failArea"])]),
    dict(id="noise", check="noise", title="Noise / compression", metric="the check's own 0-1 score (lower = noisier or more blocky; combines sigma and JPEG blockiness, so sigma alone cannot rank the recompressed photos)",
         metric_key="score", lower_is_worse=True, real=["noisy_compressed"], synthetic=["noisy_compressed"], deployed=[]),
]

_FLAGGED = ("warn", "fail")


def _analyze(job):
    path, face = job
    p = Path(path)
    t0 = time.perf_counter()
    try:
        rep = analyze_image(p.read_bytes(), f"image/{p.suffix[1:].lower()}", task_config("task_selfie_checkin") if face else task_config("task_demo_1"))
        return {"name": p.name, "report": rep, "ms": (time.perf_counter() - t0) * 1000, "error": None}
    except ImageDecodeError as exc:
        return {"name": p.name, "report": None, "ms": None, "error": str(exc)}


def analyze_folder(paths, face=False, workers=1):
    jobs = [(str(p), face) for p in paths]
    if workers > 1 and len(jobs) > 8 and not face:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            return list(ex.map(_analyze, jobs, chunksize=4))
    return [_analyze(j) for j in jobs]


def make_synthetic(good_paths, workdir, n=SYNTH_N):
    """Seeded degradations of good photos (calibrate.synthesize). -> {folder: [path]}, {synthetic file: source file}"""
    from tools import calibrate

    calibrate.synthesize([Path(p) for p in good_paths], set(SYNTH_KINDS), Path(workdir), n=n)
    picks = list(good_paths)[:: max(1, len(good_paths) // n)][:n]
    sources = {f"synthetic_{i:03d}.jpg": Path(p).name for i, p in enumerate(picks)}
    out = {k: sorted(str(f) for f in (Path(workdir) / k).iterdir()) for k in SYNTH_KINDS if (Path(workdir) / k).exists()}
    return out, sources


def _metric(row, check, key="value"):
    c = (row["report"] or {}).get("checks", {}).get(check)
    return None if not c or c.get(key) is None else float(c[key])


def _status(row, check):
    return ((row["report"] or {}).get("checks", {}).get(check) or {}).get("status")


def _err(row, check, key="value", extra=None):
    c = row["report"]["checks"][check]
    return {"file": row["name"], "value": c.get(key), "status": c["status"], "hint": c.get("hint"), **(extra or {})}


def _group(errors):
    g = Counter((e["hint"] or ("check could not judge this photo (skip)" if e["status"] == "skip" else "check passed it")).split(".")[0][:80] for e in errors)
    return [{"cause": k, "n": v} for k, v in g.most_common()]


def evaluate(c, results, trusted=(), n_boot=1000, seed=0):
    """-> {'REAL': table|None, 'SYNTHETIC': table|None, 'unavailable_real': reason}"""
    neg = [r for r in results.get(("REAL", "good"), []) if r["report"]]
    out = {"id": c["id"], "title": c["title"], "check": c["check"], "metric": c["metric"], "lower_is_worse": c["lower_is_worse"],
           "deployed": c["deployed"], "tables": {}, "notes": []}
    for prov in ("REAL", "SYNTHETIC"):
        folders = [f for f in c["real" if prov == "REAL" else "synthetic"]
                   if prov == "SYNTHETIC" or inventory.role_of(f, trusted)[0] == "positive"]
        pos = [r for f in folders for r in results.get((prov, f), []) if r["report"]]
        if prov == "REAL" and not pos:
            why = [f"{f}: {inventory.role_of(f, trusted)[1]}" if inventory.role_of(f, trusted)[0] != "positive" else f"{f}: no usable files (empty, or every file excluded as a duplicate)"
                   for f in c["real"]] or ["no real folder maps to this check"]
            out["notes"].append("No REAL positives for this check. " + "; ".join(why))
            continue
        if not pos:
            continue
        out["tables"][prov] = _table(c, pos, neg, folders, n_boot, seed)
    return out


def _table(c, pos, neg, folders, n_boot, seed):
    ch = c["check"]
    key = c.get("metric_key", "value")
    pm = [(r, _metric(r, ch, key)) for r in pos]
    nm = [(r, _metric(r, ch, key)) for r in neg]
    pv = np.array([v for _r, v in pm if v is not None])
    nv = np.array([v for _r, v in nm if v is not None])
    sign = -1.0 if c["lower_is_worse"] else 1.0
    auc, lo, hi = stats.bootstrap_auc(sign * pv, sign * nv, n_boot=n_boot, seed=seed)
    y = np.array([True] * len(pos) + [False] * len(neg))
    flagged = np.array([_status(r, ch) in _FLAGGED for r in pos + neg])
    failed = np.array([_status(r, ch) == "fail" for r in pos + neg])
    allv = np.concatenate([pv, nv])
    grid = {round(float(np.quantile(allv, q)), 4) for q in np.linspace(0.04, 0.96, 12)} | {float(v) for _l, v in c["deployed"]}
    sw = stats.sweep(pv, nv, sorted(grid), higher_is_positive=not c["lower_is_worse"])
    deployed_vals = {float(v): label for label, v in c["deployed"]}
    for row in sw:
        row["deployed"] = deployed_vals.get(row["t"])
    fn = [_err(r, ch, key) for r in pos if _status(r, ch) not in _FLAGGED]
    fp = [_err(r, ch, key) for r in neg if _status(r, ch) in _FLAGGED]
    fp_block = [_err(r, ch, key) for r in neg if _status(r, ch) == "fail"]
    return {
        "folders": folders, "n_pos": len(pos), "n_neg": len(neg),
        "flagged_level": stats.confusion(y, flagged), "fail_level": stats.confusion(y, failed),
        "auc": {"value": auc, "lo": lo, "hi": hi}, "sweep": sw,
        "metric_summary": {"pos_median": float(np.median(pv)), "neg_median": float(np.median(nv)),
                           "pos_p5_p95": [float(np.percentile(pv, 5)), float(np.percentile(pv, 95))],
                           "neg_p5_p95": [float(np.percentile(nv, 5)), float(np.percentile(nv, 95))]},
        "n_pos_skipped": sum(_status(r, ch) == "skip" for r in pos), "n_neg_skipped": sum(_status(r, ch) == "skip" for r in neg),
        "false_negatives": fn, "false_positives": fp, "false_blocks": fp_block,
        "fn_causes": _group(fn), "fp_causes": _group(fp),
    }


def cross_matrix(results):
    """Per folder: how its photos fare overall and which checks flag them (warn or fail)."""
    out = []
    for (prov, folder), rows in results.items():
        rows = [r for r in rows if r["report"]]
        if not rows:
            continue
        v = Counter(r["report"]["verdict"] for r in rows)
        per = {}
        for cid in config.CHECK_IDS:
            seen = [r for r in rows if cid in r["report"]["checks"] and r["report"]["checks"][cid]["status"] != "skip"]
            if seen:
                per[cid] = stats.rate(sum(r["report"]["checks"][cid]["status"] in _FLAGGED for r in seen), len(seen))
        out.append({"provenance": prov, "folder": folder, "n": len(rows), "verdicts": {k: v.get(k, 0) for k in ("pass", "warn", "block")}, "flagged_by": per})
    return out


def latency(good_paths, n=30):
    """Per-stage wall time (ms) on this machine, single process, n evenly spaced good photos."""
    from photo_quality.checks import CHECKS
    from photo_quality.frame import build_frame

    picks = list(good_paths)[:: max(1, len(good_paths) // n)][:n]
    per = defaultdict(list)
    mps = []
    for p in picks:
        data = Path(p).read_bytes()
        t = time.perf_counter()
        frame = build_frame(data)
        per["decode + frame"].append((time.perf_counter() - t) * 1000)
        mps.append(frame.native_width * frame.native_height / 1e6)
        ctx = {"task": {**config.DEFAULT_TASK}, "results": {}}
        tot = per["decode + frame"][-1]
        for cid, fn in CHECKS.items():
            t = time.perf_counter()
            ctx["results"][cid] = fn(frame, ctx)
            ms = (time.perf_counter() - t) * 1000
            per[cid].append(ms)
            tot += ms
        per["end to end (7 checks)"].append(tot)
    pct = lambda a, q: float(np.percentile(a, q))  # noqa: E731
    return {"n_photos": len(picks), "median_megapixels": float(np.median(mps)),
            "stages": {k: {"p50_ms": pct(v, 50), "p95_ms": pct(v, 95)} for k, v in per.items()}}


def face_section(results):
    """The server-side face detector on the face folders (the browser landmarker is not evaluated here)."""
    out = {"label": "REAL", "folders": {}}
    for (prov, folder), rows in results.items():
        if folder not in FACE_FOLDERS or prov != "REAL":
            continue
        rows = [r for r in rows if r["report"]]
        st, found = Counter(), 0
        unavailable = 0
        for r in rows:
            f = r["report"]["checks"].get("face", {})
            st[f.get("status")] += 1
            if f.get("status") == "skip":
                unavailable += 1
            elif (f.get("details") or {}).get("count", 0) > 0:
                found += 1
        out["folders"][folder] = {"n": len(rows), "statuses": dict(st), "detector_found_a_face": found, "detector_unavailable": unavailable,
                                  "flagged": stats.rate(st.get("warn", 0) + st.get("fail", 0), len(rows)),
                                  "errors": [{"file": r["name"], "status": r["report"]["checks"]["face"]["status"], "hint": r["report"]["checks"]["face"].get("hint")} for r in rows if "face" in r["report"]["checks"]]}
    return out
