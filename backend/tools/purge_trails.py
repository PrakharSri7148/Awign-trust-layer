"""Retention for location data: remove the stored GPS trail points of submissions older than N days; KEEP the scores, flags and
the motion/activity summary.

    cd backend && .venv/bin/python tools/purge_trails.py [--days N] [--apply]

N defaults to TRAIL_RETENTION_DAYS, else 30 (a DEFAULT: how long to keep a worker's location history is the deployment owner's
decision, see Sensor-fusion/iteration-1.md D7). Without --apply it is a dry run. What a purge removes from `fusion_report`: the
downsampled trail points (`trail.points`: latitude/longitude) and the start/end coordinates of any GPS jump. What it keeps:
the sub-scores, flags, the per-window speed-vs-activity table (no coordinates), the masked IP summary, the trail hash (so
replay detection keeps working). Uses TRUST_LAYER_DB like the app.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEFAULT_DAYS = 30


def _naive(dt):
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def _strip(report):
    """-> (report, number of coordinates removed)"""
    n = 0
    trail = report.get("trail") or {}
    if trail.get("points"):
        n += len(trail["points"])
        trail["points"] = []
    for j in ((report.get("motion") or {}).get("evidence") or {}).get("jumps") or []:
        for k in ("from", "to"):
            if j.pop(k, None) is not None:
                n += 1
    if trail or n:
        trail["purged"] = True
        report["trail"] = trail
    return report, n


def purge(session, days, apply=False, now=None):
    """-> {'submissions': n, 'points': n, 'applied': bool}"""
    from sqlmodel import select

    from models import Submission

    cutoff = _naive(now or datetime.now(timezone.utc)) - timedelta(days=days)
    subs = pts = 0
    for r in session.exec(select(Submission).where(Submission.fusion_version >= 1)).all():
        if _naive(r.timestamp) >= cutoff:
            continue
        rep = json.loads(r.fusion_report or "{}")
        if (rep.get("trail") or {}).get("purged"):
            continue
        rep, n = _strip(rep)
        if n:
            subs += 1
            pts += n
            if apply:
                r.fusion_report = json.dumps(rep)
                session.add(r)
    if apply:
        session.commit()
    return {"submissions": subs, "points": pts, "applied": apply}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=None)
    ap.add_argument("--apply", action="store_true", help="really remove (default: dry run)")
    a = ap.parse_args(argv)
    env = os.environ.get("TRAIL_RETENTION_DAYS")
    days = a.days if a.days is not None else (int(env) if env else DEFAULT_DAYS)
    if a.days is None and not env:
        print(f"TRAIL_RETENTION_DAYS is not set: using the default of {DEFAULT_DAYS} days (your decision to change).")
    from sqlmodel import Session

    import db

    with Session(db.engine) as s:
        r = purge(s, days, a.apply)
    print(f"{'REMOVED' if r['applied'] else 'would remove'} {r['points']} coordinate(s) from {r['submissions']} submission(s) older than {days} days; scores and flags are kept."
          + ("" if r["applied"] else " Dry run: add --apply to remove."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
