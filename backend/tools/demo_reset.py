"""Start a demo clean: remove the submissions made for one site (and what hangs off them), so every rehearsal begins from the same state.

    cd backend && .venv/bin/python tools/demo_reset.py [--site site_demo_1] [--apply] [--photos] [--forget-site]

A DRY RUN unless --apply (it prints what it would remove). Removes: the site's submissions, their reviews, the visit sessions used for
them, the learned network profile and the old fingerprint of the site. Keeps the registered site location unless --forget-site, and keeps
other sites untouched. --photos also deletes the stored photo files of those submissions (when no other submission uses them).
Uses TRUST_LAYER_DB like the app: point it at the database you are demoing with, and nowhere else.

P5 additions: --apply FIRST makes a timestamped backup of the database (sqlite online backup) and of the photo folder under <database folder>/backups/
(skip with --no-backup), so a reset is reversible: copy the backup file back over the database. --all-sites resets every site at once (the registered
site locations are kept). With PUBLIC_MODE=1 it refuses to run while the server is in use (a visit or submission in the last 2 minutes) unless --force.
"""
import argparse
import shutil
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def reset(session, site_id, apply=False, photos=False, forget_site=False):
    """-> counts of what was (or would be) removed."""
    from sqlmodel import select

    from models import Review, Site, SiteFingerprint, SiteNetworkProfile, Submission, Visit

    subs = session.exec(select(Submission).where(Submission.site_id == site_id)).all()
    ids = {s.id for s in subs}
    reviews = [r for r in session.exec(select(Review)).all() if r.submission_id in ids]
    visits = session.exec(select(Visit).where(Visit.site_id == site_id)).all()
    profile = session.exec(select(SiteNetworkProfile).where(SiteNetworkProfile.site_id == site_id)).all()
    fp = session.get(SiteFingerprint, site_id)
    site = session.get(Site, site_id) if forget_site else None
    keep_paths = {s.photo_path for s in session.exec(select(Submission)).all() if s.photo_path and s.id not in ids}
    files = {s.photo_path for s in subs if s.photo_path} - keep_paths if photos else set()
    out = {"submissions": len(subs), "reviews": len(reviews), "visits": len(visits), "network_profile_rows": len(profile),
           "fingerprint": int(fp is not None), "site_location": int(site is not None), "photo_files": len(files), "applied": apply}
    if apply:
        for row in [*reviews, *subs, *visits, *profile, *([fp] if fp else []), *([site] if site else [])]:
            session.delete(row)
        session.commit()
        for f in files:
            Path(f).unlink(missing_ok=True)
    return out


ACTIVE_WINDOW_S = 120


def backup(db_path, photo_dir=None, now=None):
    """-> (database backup path, photo backup path or None). The database is copied with sqlite's online backup (safe while the server runs)."""
    db_path = Path(db_path)
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M%S")
    folder = db_path.parent / "backups"
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{db_path.stem}-{stamp}{db_path.suffix}"
    src, dst = sqlite3.connect(str(db_path)), sqlite3.connect(str(dest))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    photos = None
    if photo_dir and Path(photo_dir).is_dir():
        photos = folder / f"photos-{stamp}"
        shutil.copytree(photo_dir, photos)
    return dest, photos


def recently_used(session, now=None, window_s=ACTIVE_WINDOW_S):
    """True when a visit or a submission was made in the last `window_s` seconds (the server is probably in use)."""
    from sqlmodel import select

    from models import Submission, Visit

    cutoff = (now or datetime.now(timezone.utc)).replace(tzinfo=None) - timedelta(seconds=window_s)
    last_v = session.exec(select(Visit.started_at).order_by(Visit.started_at.desc())).first()
    last_s = session.exec(select(Submission.timestamp).order_by(Submission.timestamp.desc())).first()
    return any(t is not None and t.replace(tzinfo=None) >= cutoff for t in (last_v, last_s))


def site_ids(session):
    from sqlmodel import select

    from models import Site, Submission, Visit

    ids = {r for r in session.exec(select(Site.site_id)).all()} | {r for r in session.exec(select(Submission.site_id)).all()} | {r for r in session.exec(select(Visit.site_id)).all()}
    return sorted(ids)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default="site_demo_1")
    ap.add_argument("--apply", action="store_true", help="really remove (default: dry run)")
    ap.add_argument("--photos", action="store_true")
    ap.add_argument("--forget-site", action="store_true")
    ap.add_argument("--all-sites", action="store_true", help="reset every site (the registered locations are kept)")
    ap.add_argument("--no-backup", action="store_true", help="with --apply: do not make the backup first")
    ap.add_argument("--force", action="store_true", help="in public mode, reset even though the server was used in the last 2 minutes")
    a = ap.parse_args(argv)
    import os

    from sqlmodel import Session

    import db

    with Session(db.engine) as s:
        if a.apply and os.environ.get("PUBLIC_MODE", "").strip() == "1" and not a.force and recently_used(s):
            print(f"REFUSED: a visit or submission was made in the last {ACTIVE_WINDOW_S} s and PUBLIC_MODE=1 is set: the server is in use. Wait, or add --force.")
            return 3
        if a.apply and not a.no_backup:
            import photo_service

            dest, photos = backup(db.DB_PATH, photo_service.UPLOAD_DIR)
            print(f"Backup: {dest}" + (f" and {photos}" if photos else "") + "  (to undo: stop the server and copy the database backup back over the database)")
        targets = site_ids(s) if a.all_sites else [a.site]
        total = {"submissions": 0, "reviews": 0, "visits": 0, "network_profile_rows": 0, "photo_files": 0}
        for sid in targets:
            r = reset(s, sid, a.apply, a.photos, a.forget_site)
            for k in total:
                total[k] += r[k]
    verb = "REMOVED" if a.apply else "would remove"
    print(f"{verb} for {', '.join(targets) or 'no site'} in {db.DB_PATH}: {total['submissions']} submissions, {total['reviews']} reviews, {total['visits']} visits, "
          f"{total['network_profile_rows']} network-profile rows, {total['photo_files']} photo files; registered sites kept{' EXCEPT the named one' if a.forget_site else ''}."
          + ("" if a.apply else " Dry run: add --apply."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
