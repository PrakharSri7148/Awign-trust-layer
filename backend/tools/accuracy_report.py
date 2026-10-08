"""ML model accuracy report: reproducible, seeded, no network.

    cd client && npm run report                 # edge-validator/reports/accuracy-report.md + .json
    backend/.venv/bin/python backend/tools/accuracy_report.py --help

Covers the fraud classifier, each photo-quality check as a classifier, the face detector, and
(once samples exist) liveness. Every number is labelled REAL or SYNTHETIC. See
edge-validator/iteration-3.md section 3 for the spec. Same inputs give the same numbers; latency
is machine-dependent and kept in its own section.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from tools.reportlib import fraud, fusion, inventory, liveness_eval, photochecks, render, reviews  # noqa: E402

SAMPLES = ROOT / "edge-validator" / "samples"
OUT = ROOT / "edge-validator" / "reports"


def _describe(path):
    return inventory.describe(path)


def build_inventory(records, workers, trusted):
    excluded = inventory.resolve_exclusions(records)
    if workers > 1 and len(records) > 16:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            ds = list(ex.map(_describe, [r["path"] for r in records], chunksize=8))
    else:
        ds = [_describe(r["path"]) for r in records]
    descs = {(r["folder"], r["name"]): d for r, d in zip(records, ds)}
    dup = inventory.find_duplicates(records)
    near = inventory.near_duplicates([(r["folder"], r["name"], descs[(r["folder"], r["name"])]["dhash"]) for r in records if descs[(r["folder"], r["name"])]])
    by_folder = {}
    for (folder, _n), why in excluded.items():
        by_folder.setdefault(folder, {}).setdefault(why.split(" of ")[0].split(":")[0], 0)
        by_folder[folder][why.split(" of ")[0].split(":")[0]] += 1
    return {
        "folders": inventory.folder_summary(records, descs, excluded, trusted),
        "duplicates": {k: v for k, v in dup.items() if not k.startswith("_")},
        "n_excluded": len(excluded), "excluded_by_folder": {k: ", ".join(f"{n} {w}" for w, n in v.items()) for k, v in by_folder.items()},
        "excluded_files": {f"{f}/{n}": why for (f, n), why in sorted(excluded.items())},
        "near_duplicates": {"bits": inventory.NEAR_BITS, "pairs": len(near), "examples": near[:3], "all": [list(p) for p in near]},
        "total_files": len(records),
    }, excluded


def thresholds_stamp():
    """Short hash of thresholds.json: every report says which thresholds produced it (see edge-validator/thresholds-changelog.md)."""
    import hashlib

    from photo_quality import config

    return hashlib.sha256(Path(config._PATH).read_bytes()).hexdigest()[:12]


def run(samples, workers, n_boot, seed, trusted, skip_parity=False, skip_fraud=False, db=None, fusion_scale=1.0, fusion_samples=None):
    records = inventory.scan(samples)
    inv, excluded = build_inventory(records, workers, trusted)
    keep = [r for r in records if (r["folder"], r["name"]) not in excluded and inventory.role_of(r["folder"], trusted)[0] not in ("unknown", "bonafide", "attack")]
    live_folders = {}
    for r in records:
        if (r["folder"], r["name"]) not in excluded and inventory.role_of(r["folder"])[0] in ("bonafide", "attack"):
            live_folders.setdefault(r["folder"], []).append(Path(r["path"]))

    results = {}
    for folder in dict.fromkeys(r["folder"] for r in keep):
        paths = [r["path"] for r in keep if r["folder"] == folder]
        results[("REAL", folder)] = photochecks.analyze_folder(paths, face=folder in photochecks.FACE_FOLDERS, workers=workers)
    skipped = [(f, x["name"], x["error"]) for (_p, f), rows in results.items() for x in rows if x["error"]]

    synth_counts = {}
    good_paths = sorted(r["path"] for r in keep if r["folder"] == "good")
    if good_paths:
        with tempfile.TemporaryDirectory(prefix="report-synth-") as tmp:
            sets, sources = photochecks.make_synthetic(good_paths, tmp)
            for kind, paths in sets.items():
                results[("SYNTHETIC", kind)] = photochecks.analyze_folder(paths, workers=workers)
                synth_counts[kind] = len(paths)
    inv["synthetic"] = {"n": photochecks.SYNTH_N, "counts": synth_counts}

    checks = [photochecks.evaluate(c, results, trusted, n_boot=n_boot, seed=seed) for c in photochecks.CLASSIFIERS]
    all_ms = [x["ms"] for rows in results.values() for x in rows if x["ms"] is not None]
    data = {
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": seed, "n_boot": n_boot,
                 "thresholds_sha256": thresholds_stamp(),
                 "samples": str(samples), "trusted_folders": sorted(trusted), "skipped_undecodable": skipped},
        "inventory": inv,
        "checks": checks,
        "cross_matrix": photochecks.cross_matrix(results),
        "face": photochecks.face_section(results),
        "liveness": {**liveness_eval.evaluate_real(live_folders, n_boot=n_boot, seed=seed), "synthetic_smoke": liveness_eval.synthetic_smoke(good_paths) if good_paths else None},
        "latency": photochecks.latency(good_paths) if good_paths else {"n_photos": 0, "median_megapixels": 0, "stages": {}},
        "e2e_latency": {"n": len(all_ms), "p50_ms": float(np.percentile(all_ms, 50)), "p95_ms": float(np.percentile(all_ms, 95))} if all_ms else None,
        "fraud": None if skip_fraud else fraud.run(n_boot=n_boot, seed=seed),
        "fusion": {"skipped": "skipped (--skip-fraud)"} if skip_fraud else fusion.run(n_boot=n_boot, seed=seed, scale=fusion_scale, samples_dir=fusion_samples),
        "parity": None if skip_parity or not good_paths else parity(good_paths[0]),
        "reviews": reviews.evaluate(*reviews.load(db), n_boot=min(n_boot, 500), seed=seed),
    }
    if skip_fraud:
        data["fraud"] = {"model": "skipped", "features": [], "decision_threshold": 0.5, "evaluations": {}, "leakage": [], "per_case_errors": {}, "probes": [],
                         "shap_stability": {"seeds": 0, "features": [], "share_mean": [], "share_sd": [], "share_min": [], "share_max": [], "deployed_share": [], "same_rank_in_all_seeds": True},
                         "sensitivity": {}}
    return data


def parity(photo):
    node = shutil.which("node")
    script = ROOT / "client" / "tools" / "parity.mjs"
    if not node or not script.exists() or not (ROOT / "client" / "node_modules").exists():
        return None
    try:
        r = subprocess.run([node, str(script), photo], cwd=ROOT / "client", capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired:
        return None
    lines = [ln for ln in r.stdout.splitlines() if ln.strip() and not ln.startswith("source")]
    return {"photo": Path(photo).name, "text": "\n".join(lines), "ok": r.returncode == 0}


def strip_volatile(data):
    """What must be identical between two runs on the same inputs."""
    d = json.loads(json.dumps(data, default=float))
    for k in ("meta", "latency", "e2e_latency", "parity"):
        d.pop(k, None)
    return d


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--samples", type=Path, default=SAMPLES)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--n-boot", type=int, default=1000, help="bootstrap resamples for AUC intervals")
    ap.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    ap.add_argument("--trust-folder", default="", help="comma list of 'observation' folders to treat as real positives (e.g. overexposed,glare)")
    ap.add_argument("--skip-parity", action="store_true", help="do not run the JS-vs-Python parity tool")
    ap.add_argument("--skip-fraud", action="store_true", help="skip the fraud-model sections (legacy v1 and sensor fusion)")
    ap.add_argument("--fusion-scale", type=float, default=1.0, help="size of the simulated evaluation sets for the sensor-fusion section (1.0 = about 2,150 rows each)")
    ap.add_argument("--fusion-samples", type=Path, default=ROOT / "Sensor-fusion" / "samples", help="recorded sensor-fusion traces (REAL), see Sensor-fusion/samples/README.md")
    ap.add_argument("--db", type=Path, default=Path(os.environ.get("TRUST_LAYER_DB", ROOT / "backend" / "trust_layer.db")),
                    help="app database to read reviewed cases from (opened READ-ONLY; default: TRUST_LAYER_DB or backend/trust_layer.db)")
    args = ap.parse_args(argv)
    if not args.samples.exists():
        print(f"No samples folder at {args.samples}")
        return 1
    trusted = {x for x in args.trust_folder.split(",") if x}
    data = run(args.samples, args.workers, args.n_boot, args.seed, trusted, args.skip_parity, args.skip_fraud, db=args.db, fusion_scale=args.fusion_scale, fusion_samples=args.fusion_samples)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "accuracy-report.json").write_text(json.dumps(data, indent=1, default=float) + "\n")
    (args.out / "accuracy-report.md").write_text(render.render(data))
    print(f"Wrote {args.out / 'accuracy-report.md'} and accuracy-report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
