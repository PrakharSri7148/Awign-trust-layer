"""REAL labels from the reviewer workflow (the dashboard's approve / reject / needs-retake decisions).

Reads the app database READ-ONLY (never writes) and answers: how often was each flag upheld by a human, and, once there are
enough labelled cases, does the fraud model agree with the reviewers? A flag is "upheld" when the reviewer rejected the
submission or asked for a retake; "overturned" when they approved it. Labels are only as good as the reviewers: the report
lists who reviewed how many. Nothing here is synthetic.
"""
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

from . import stats

# Below this the fraud model is NOT evaluated or retrained on reviewed data (a classifier needs both classes in numbers).
MIN_LABELS = 200
MIN_PER_CLASS = 50
UPHELD = {"reject", "needs_retake"}


def load(db_path):
    """-> (rows, error). rows: one dict per reviewed submission (latest review wins)."""
    p = Path(db_path) if db_path else None
    if p is None or not p.is_file():
        return [], f"no database at {p}" if p else "no database given"
    con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    try:
        has = con.execute("select name from sqlite_master where type='table' and name='review'").fetchone()
        if not has:
            return [], "the database has no review table yet (no review has ever been recorded)"
        q = """select s.id, s.status, s.fraud_probability, s.photo_verdict, s.quality_flags, s.task_id,
                      r.decision, r.reviewer, r.created_at
               from submission s join review r on r.submission_id = s.id
               where r.id = (select max(id) from review where submission_id = s.id) order by s.id"""
        rows = [{"id": i, "status": st, "fraud_probability": fp, "photo_verdict": v, "flags": json.loads(fl or "[]"), "task": t,
                 "decision": d, "reviewer": rv, "at": at} for i, st, fp, v, fl, t, d, rv, at in con.execute(q)]
        return rows, None
    finally:
        con.close()


def evaluate(rows, error=None, n_boot=200, seed=0):
    if error or not rows:
        return {"evaluated": False, "reason": error or "no reviews recorded yet", "n": 0, "min_labels": MIN_LABELS, "min_per_class": MIN_PER_CLASS}
    n = len(rows)
    dec = Counter(r["decision"] for r in rows)
    by_flag = defaultdict(lambda: [0, 0])  # flag -> [reviewed, upheld]
    for r in rows:
        keys = list(r["flags"]) + (["<fraud model flagged>"] if r["status"] == "flagged" else []) + (["<photo blocked>"] if r["photo_verdict"] == "block" else [])
        for k in dict.fromkeys(keys):
            by_flag[k][0] += 1
            by_flag[k][1] += r["decision"] in UPHELD
    flag_rows = sorted(({"flag": k, "reviewed": a, "upheld": rate_k(b, a)} for k, (a, b) in by_flag.items()), key=lambda x: (-x["reviewed"], x["flag"]))
    reviewers = Counter(r["reviewer"] for r in rows)
    pos = [r for r in rows if r["decision"] in UPHELD]
    neg = [r for r in rows if r["decision"] == "approve"]
    out = {"evaluated": True, "n": n, "decisions": dict(dec), "upheld_overall": rate_k(len(pos), n), "by_flag": flag_rows,
           "reviewers": dict(reviewers.most_common()), "min_labels": MIN_LABELS, "min_per_class": MIN_PER_CLASS}
    if n >= MIN_LABELS and len(pos) >= MIN_PER_CLASS and len(neg) >= MIN_PER_CLASS:
        a, lo, hi = stats.bootstrap_auc([r["fraud_probability"] for r in pos], [r["fraud_probability"] for r in neg], n_boot=n_boot, seed=seed)
        out["fraud_model_vs_reviewers"] = {"auc": {"value": a, "lo": lo, "hi": hi}, "positives": len(pos), "negatives": len(neg),
                                           "note": "reviewer 'reject'/'needs_retake' = positive. Cases enter review because they were flagged, so this is biased towards the model's own flags."}
    else:
        out["fraud_model_vs_reviewers"] = None
    return out


def rate_k(k, n):
    return stats.rate(k, n)
