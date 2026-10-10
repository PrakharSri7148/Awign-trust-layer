"""Retention for location data: remove the stored GPS trail points AND the shortened IP address / city of submissions older than N days;
KEEP the scores, flags and the motion/activity summary.

    cd backend && .venv/bin/python tools/purge_trails.py [--days N] [--apply]

N defaults to TRAIL_RETENTION_DAYS, else 30 (a DEFAULT: how long to keep a worker's location history is the deployment owner's
decision, see Sensor-fusion/iteration-1.md D7). Without --apply it is a dry run. What a purge removes from `fusion_report`: the
downsampled trail points (`trail.points`: latitude/longitude), the start/end coordinates of any GPS jump, and the shortened IP address
and city (`ip.ip`, `ip.city`; the consent text promises a shortened address for the same retention period). What it keeps:
the sub-scores, flags, the per-window speed-vs-activity table (no coordinates), the IP's country, provider (ASN) and region, the trail hash (so
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
    """-> (report, number of coordinates removed, number of IP fields removed: the shortened address and the city)"""
    n = 0
    n_ip = 0
    ip = report.get("ip")
    if isinstance(ip, dict):
        for k in ("ip", "city"):
            if ip.get(k) is not None:
                ip[k] = None
                n_ip += 1
        for k in ("lat", "lng"):  # the network's approximate coordinates go with the city they were derived from
            if ip.get(k) is not None:
                ip[k] = None
                n_ip += 1
        if n_ip:
            ip["purged"] = True
    if report.get("position"):  # the worker's last fix is a trail point too
        report["position"] = None
        n += 1
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
    return report, n, n_ip


def purge(session, days, apply=False, now=None):
    """-> {'submissions': n, 'points': n, 'ip_fields': n, 'applied': bool}"""
    from sqlmodel import select

    from models import Submission

    cutoff = _naive(now or datetime.now(timezone.utc)) - timedelta(days=days)
    subs = pts = ips = 0
    for r in session.exec(select(Submission).where(Submission.fusion_version >= 1)).all():
        if _naive(r.timestamp) >= cutoff:
            continue
        rep = json.loads(r.fusion_report or "{}")
        if (rep.get("trail") or {}).get("purged"):
            continue
        rep, n, n_ip = _strip(rep)
        if n or n_ip:
            subs += 1
            pts += n
            ips += n_ip
            if apply:
                r.fusion_report = json.dumps(rep)
                session.add(r)
    if apply:
        session.commit()
    return {"submissions": subs, "points": pts, "ip_fields": ips, "applied": apply}


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
    print(f"{'REMOVED' if r['applied'] else 'would remove'} {r['points']} coordinate(s) and {r['ip_fields']} shortened-IP/city field(s) from {r['submissions']} submission(s) older than {days} days; scores and flags are kept."
          + ("" if r["applied"] else " Dry run: add --apply to remove."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
