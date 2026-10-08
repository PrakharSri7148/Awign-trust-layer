"""Retention: delete stored photos (and the liveness signal timelines) older than N days; KEEP the verdicts and flags.

    cd backend && .venv/bin/python tools/purge_photos.py [--days N] [--apply]

N defaults to PHOTO_RETENTION_DAYS. If neither is set nothing is purged: how long to keep faces is the deployment owner's
decision (iteration-4.md section 5); this tool only makes the decision executable. Without --apply it is a dry run that lists what
WOULD be deleted. What a purge removes: the photo file under PHOTO_DIR, `photo_path` (set to NULL), and the signal timeline /
nonce evidence inside `photo_report.evidence.liveness`. What it keeps: verdict, flags, scores, the per-check report, the review
decisions, the hashes (so duplicate detection keeps working). A photo shared by several submissions (same bytes) is deleted
only when every submission using it is old enough. Uses TRUST_LAYER_DB / PHOTO_DIR like the app.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _naive(dt):
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def purge(session, days, apply=False, now=None):
    """-> {'submissions': n, 'files': n, 'bytes': n, 'applied': bool}"""
    from sqlmodel import select

    from models import Submission

    now = _naive(now or datetime.now(timezone.utc))
    cutoff = now - timedelta(days=days)
    rows = session.exec(select(Submission).where(Submission.photo_path.is_not(None))).all()
    old = [r for r in rows if _naive(r.timestamp) < cutoff]
    keep_paths = {r.photo_path for r in rows if _naive(r.timestamp) >= cutoff}
    files = {r.photo_path for r in old} - keep_paths
    size = sum(Path(f).stat().st_size for f in files if Path(f).is_file())
    if apply:
        for f in files:
            Path(f).unlink(missing_ok=True)
        for r in old:
            r.photo_path = None
            rep = json.loads(r.photo_report or "{}")
            live = ((rep.get("evidence") or {}).get("liveness"))
            if isinstance(live, dict):
                live.pop("evidence", None)  # the signal timeline + nonce
                live["purged"] = True
            r.photo_report = json.dumps(rep)
            session.add(r)
        session.commit()
    return {"submissions": len(old), "files": len(files), "bytes": size, "applied": apply}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=None)
    ap.add_argument("--apply", action="store_true", help="really delete (default: dry run)")
    a = ap.parse_args(argv)
    days = a.days if a.days is not None else (int(os.environ["PHOTO_RETENTION_DAYS"]) if os.environ.get("PHOTO_RETENTION_DAYS") else None)
    if days is None:
        print("No retention period set (PHOTO_RETENTION_DAYS or --days): nothing purged. Photos are kept forever until you decide.")
        return 0
    from sqlmodel import Session

    import db

    with Session(db.engine) as s:
        r = purge(s, days, a.apply)
    print(f"{'DELETED' if r['applied'] else 'would delete'} {r['files']} photo file(s) ({r['bytes'] / 1e6:.1f} MB) for {r['submissions']} submission(s) older than {days} days; verdicts and flags are kept."
          + ("" if r["applied"] else " Dry run: add --apply to delete."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
