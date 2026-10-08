"""Offline experiments behind the Phase 8a focus diagnosis (edge-validator/progress.md).

    cd backend && .venv/bin/python tools/focus_experiments.py sigma [--n 106]

sigma: REAL sharp photos (samples/good) blurred by a known Gaussian of sigma s px at the 1280 px analysis size
(SYNTHETIC softness) -> where do the check's fail / warn lines sit in "how soft is this picture" terms, and where
do the REAL blurry / shaky photos (samples/blurry, samples/shaky, labelled by their folder) land on the same scale?
This tells you what level of softness is blocked; it does not tell you what a worker would call acceptable.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from photo_quality.checks.blur import blur_metrics  # noqa: E402
from photo_quality.config import THRESHOLDS  # noqa: E402
from photo_quality.frame import build_frame  # noqa: E402

SAMPLES = ROOT / "edge-validator" / "samples"
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".avif"}


def folder_scores(name):
    out = []
    for f in sorted((SAMPLES / name).iterdir()):
        if f.suffix.lower() not in EXTS:
            continue
        try:
            s = blur_metrics(build_frame(f.read_bytes()).gray)["score"]
        except Exception:
            continue
        if s is not None:
            out.append(s)
    return np.array(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["sigma"])
    ap.add_argument("--n", type=int, default=106)
    a = ap.parse_args()
    fail, warn = THRESHOLDS["blur"]["failBelow"], THRESHOLDS["blur"]["warnBelow"]
    files = [f for f in sorted((SAMPLES / "good").iterdir()) if f.suffix.lower() in EXTS][: a.n]
    grays = [build_frame(f.read_bytes()).gray for f in files]
    print(f"{len(grays)} REAL sharp photos (samples/good), Gaussian softness added at the 1280 px analysis size (SYNTHETIC):")
    print("  sigma px | score p5   p50   p95 | below warn | below fail (BLOCK)")
    rows = {}
    for s in [0, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0]:
        sc = np.array([blur_metrics(gaussian_filter(g, s) if s else g)["score"] or 0.0 for g in grays])
        rows[s] = sc
        print(f"  {s:8.2f} | {np.percentile(sc, 5):.3f} {np.percentile(sc, 50):.3f} {np.percentile(sc, 95):.3f} | {np.mean(sc < warn) * 100:5.0f}%     | {np.mean(sc < fail) * 100:5.0f}%")
    print(f"\nthe photo-level lines are fail < {fail} (block), warn < {warn}. On the median photo the block line is crossed at about sigma = "
          f"{np.interp(fail, [np.median(rows[s]) for s in rows][::-1], list(rows)[::-1]):.2f} px and the warn line at {np.interp(warn, [np.median(rows[s]) for s in rows][::-1], list(rows)[::-1]):.2f} px.")
    for name in ("blurry", "shaky"):
        sc = folder_scores(name)
        eq = [float(np.interp(v, [np.median(rows[s]) for s in rows][::-1], list(rows)[::-1])) for v in sc]
        print(f"REAL {name}: n={len(sc)}  score p10/p50/p90 = {np.percentile(sc, 10):.3f}/{np.percentile(sc, 50):.3f}/{np.percentile(sc, 90):.3f}  "
              f"= Gaussian sigma about {np.percentile(eq, 10):.1f}/{np.percentile(eq, 50):.1f}/{np.percentile(eq, 90):.1f} px on the median-photo scale")


if __name__ == "__main__":
    main()
