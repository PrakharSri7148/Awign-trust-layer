"""Read-only: how ready is each site for the 'unseen network' demo? Prints, per site, its registered location, how many trusted visits its learned network
rests on, and what is stored. Never writes (the database is opened read-only).

    cd backend && TRUST_LAYER_DB=<the demo database> .venv/bin/python tools/seed_check.py

A visit teaches the network only if it was accepted AND the phone's movement was compared with the GPS trail with a consistency of at least
environment.learnMinMotion (fusion.json). The demo needs profileMin (3) such visits at the site before 'new network' checks can say anything.
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def check(db_path):
    from fusion import config as C

    need, min_motion = C.ENVIRONMENT["profileMin"], C.ENVIRONMENT["learnMinMotion"]
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        sites = {r[0]: r for r in con.execute("select site_id, lat, lng, radius_m, country, label from site")}
        prof = {}
        for sid, kind, key, count in con.execute("select site_id, kind, key, count from sitenetworkprofile order by site_id, kind, count desc"):
            prof.setdefault(sid, []).append((kind, key, count))
        trusted = {}
        for sid, status, rep in con.execute("select site_id, status, fusion_report from submission"):
            try:
                r = json.loads(rep or "{}")
            except ValueError:
                continue
            m = r.get("motion") or {}
            if status == "accepted" and m.get("sensor_used") and m.get("known") and (m.get("score") or 0) >= min_motion:
                trusted[sid] = trusted.get(sid, 0) + 1
        all_ids = sorted(set(sites) | set(prof) | set(trusted))
    finally:
        con.close()
    out = []
    for sid in all_ids:
        learned = max([sum(c for k, _, c in v if k == kind) for v in [prof.get(sid, [])] for kind in ("link", "asn", "wifi", "cell")] or [0])
        out.append({"site_id": sid, "registered": sid in sites, "country": (sites.get(sid) or [None] * 5)[4], "trusted_visits": trusted.get(sid, 0),
                    "learned_from": learned, "needed": need, "ready": learned >= need, "profile": prof.get(sid, [])})
    return out


def main(argv=None):
    db = os.environ.get("TRUST_LAYER_DB") or str(Path(__file__).resolve().parents[1] / "trust_layer.db")
    if not Path(db).is_file():
        print(f"no database at {db}")
        return 1
    rows = check(db)
    print(f"Database: {db}\n")
    if not rows:
        print("No site and no visit yet.")
        return 0
    for r in rows:
        print(f"{r['site_id']}: {'registered' if r['registered'] else 'NOT registered'}"
              + (f", country {r['country']}" if r["registered"] and r["country"] else (", NO country (the foreign-country check is off)" if r["registered"] else ""))
              + f" | trusted visits {r['trusted_visits']} | learned from {r['learned_from']} of {r['needed']} needed"
              + (" -> READY for the 'unseen network' demo" if r["ready"] else " -> NOT ready: record more genuine visits on the phone with the recording on"))
        for kind, key, count in r["profile"]:
            print(f"     {kind:5} {key}  x{count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
