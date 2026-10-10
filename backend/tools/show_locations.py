"""Print the GPS points saved with each submission as a plain table, plus where the network (IP address / VPN) resolves to.

    python3 tools/show_locations.py                 # data/demo.db, newest 10 submissions
    python3 tools/show_locations.py --db trust_layer.db --limit 25
    python3 tools/show_locations.py --id 31 --all   # every saved point of one submission

Reads `fusion_report` -> trail.points; each point is [seconds_since_start, lat, lng, accuracy_m], and `ip` (country, city, approximate
lat/lng of the network; only submissions made after that was added have the coordinates). Read-only.
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
IST = timedelta(hours=5, minutes=30)  # timestamps are stored in UTC; shown in IST


def pt(p):
    return f"lat {p[1]:.6f}, lng {p[2]:.6f}" + ("" if p[3] is None else f"  (±{p[3]:.0f} m)") if p else "-"


def fill_net(ip):
    """Older submissions kept the city but not the coordinates. Their shortened address (last part zeroed) is still stored, so look it up in
    the installed IP database again. -> (ip dict, True when the coordinates came from that fresh lookup)."""
    if not ip or ip.get("private") or (ip.get("lat") is not None and ip.get("lng") is not None) or not ip.get("ip"):
        return ip, False
    try:
        sys.path.insert(0, str(BACKEND))
        from fusion import ipctx

        ctx = ipctx.get_provider().lookup(ip["ip"])
    except Exception:
        return ip, False
    if ctx is None or ctx.lat is None or ctx.lng is None:
        return ip, False
    return {**ip, "lat": round(ctx.lat, 2), "lng": round(ctx.lng, 2)}, True


def net_fmt(ip):
    return f"lat {ip['lat']:.2f}, lng {ip['lng']:.2f}" if ip and ip.get("lat") is not None and ip.get("lng") is not None else "- (not stored for this submission)"


def net_place(ip):
    """'Ashburn, Virginia, US · DigitalOcean', or '' when the submission has no usable network location."""
    if not ip or ip.get("private"):
        return ""
    where = ", ".join(x for x in (ip.get("city"), ip.get("region"), ip.get("country")) if x)
    return f"{where}{' · ' + ip['org'] if ip.get('org') else ''}" if where or ip.get("org") else ""


def use_backend_python():
    """The IP database needs the `maxminddb` package, which lives in the backend's virtual environment: switch to it when this Python lacks it."""
    try:
        import maxminddb  # noqa: F401
    except ImportError:
        venv = BACKEND / ".venv" / "bin" / "python"
        if venv.exists() and Path(sys.executable).resolve() != venv.resolve() and not os.environ.get("SHOW_LOCATIONS_REEXEC"):
            os.environ["SHOW_LOCATIONS_REEXEC"] = "1"
            os.execv(str(venv), [str(venv), *sys.argv])


def main():
    use_backend_python()
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/demo.db", help="path relative to backend/ (default data/demo.db, which the running app writes to; the older one is trust_layer.db)")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--id", type=int, help="only this submission id")
    ap.add_argument("--all", action="store_true", help="list every saved point, not just first and last")
    a = ap.parse_args()

    db = Path(a.db) if Path(a.db).is_absolute() else BACKEND / a.db
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    q = "select id, timestamp, worker_id, site_id, fusion_report from submission where fusion_version>=1"
    args = []
    if a.id is not None:
        q += " and id=?"
        args.append(a.id)
    q += " order by id desc limit ?"
    args.append(a.limit)

    for id_, ts, worker, site, rep in con.execute(q, args):
        r = json.loads(rep or "{}")
        pts = (r.get("trail") or {}).get("points") or []
        ip, looked_up = fill_net(r.get("ip") or {})
        when = (datetime.fromisoformat(str(ts)[:19]) + IST).strftime("%Y-%m-%d %H:%M:%S")
        print(f"Submission #{id_}   {when} IST   {worker}   site {site}   ({r.get('source', '-')}, {len(pts)} GPS points)")
        print(f"  Phone at start   : {pt(pts[0] if pts else None)}")
        print(f"  Phone at submit  : {pt(pts[-1] if pts else None)}")
        print(f"  VPN / network    : {net_fmt(ip)}")
        print(f"  Network place    : {net_place(ip) or '-'}")
        if a.all:
            print("  All GPS points   :")
            for p in pts:
                acc = "?" if p[3] is None else f"{p[3]:.1f} m"
                print(f"    t={p[0]:>7.1f}s  lat={p[1]:.6f}  lng={p[2]:.6f}  accuracy={acc}")
        print()


if __name__ == "__main__":
    main()
