"""Turn reviewed cases into a labelled dataset for evaluating / retraining the fraud classifier.

    cd backend && .venv/bin/python tools/reviewed_dataset.py [--db PATH] [--out reviewed.csv]

Reads the app database READ-ONLY and writes one row per reviewed submission: id, the model's fraud_probability, the
photo verdict, the flags and the reviewer's label (fraud = 1 when the decision was reject or needs_retake, 0 when approve).
It REFUSES to produce a training set until there are at least 200 reviewed cases with 50+ in each class (the same
guard as the accuracy report); below that the classifier stays labelled SYNTHETIC. It does not retrain anything by itself:
retraining is `train.sh` after you point `generate_synthetic_data` / the training script at the exported file, and the new
model must be compared with the old one on a held-out split of THESE labels first.
Liveness / spoof flags are NOT used as features: they stay policy (iteration-4.md section 2.2.4).
"""
import argparse
import csv
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from tools.reportlib import reviews  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", type=Path, default=Path(os.environ.get("TRUST_LAYER_DB", ROOT / "backend" / "trust_layer.db")))
    ap.add_argument("--out", type=Path, default=Path("reviewed.csv"))
    a = ap.parse_args(argv)
    rows, err = reviews.load(a.db)
    if err or not rows:
        print(f"nothing to export: {err or 'no reviews recorded yet'}")
        return 1
    pos = sum(r["decision"] in reviews.UPHELD for r in rows)
    neg = len(rows) - pos
    print(f"{len(rows)} reviewed cases: {pos} upheld (fraud=1), {neg} approved (fraud=0)")
    if len(rows) < reviews.MIN_LABELS or pos < reviews.MIN_PER_CLASS or neg < reviews.MIN_PER_CLASS:
        print(f"NOT ENOUGH to train or evaluate a classifier: need >= {reviews.MIN_LABELS} cases and >= {reviews.MIN_PER_CLASS} per class. Keep reviewing.")
        return 2
    with open(a.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["submission_id", "fraud_probability", "photo_verdict", "flags", "reviewer", "label_fraud"])
        for r in rows:
            w.writerow([r["id"], r["fraud_probability"], r["photo_verdict"], "|".join(r["flags"]), r["reviewer"], int(r["decision"] in reviews.UPHELD)])
    print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
