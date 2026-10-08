"""Download the free DB-IP "lite" city + ASN databases that fusion/ipctx.py reads.

    cd backend && .venv/bin/python tools/fetch_geoip.py [--dir backend/data/geoip] [--month 2026-10]

Source: https://db-ip.com/db/lite.php  (free, no account; licence CC BY 4.0: you must credit DB-IP, e.g. "IP Geolocation by
DB-IP" with a link, wherever the data is shown to people). The files are updated monthly: run this monthly. This month's file
is tried first, then last month's. The databases are big (about 130 MB unpacked for the city file) and are NOT committed
(backend/data/geoip is gitignored). Without them the IP part of the environment signal is simply 'unknown'.
Restart the backend afterwards (the provider is detected once at start-up).
"""
import argparse
import gzip
import shutil
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
KINDS = ("city", "asn")
URL = "https://download.db-ip.com/free/dbip-{kind}-lite-{month}.mmdb.gz"
# DB-IP answers HTTP 403 to urllib's default "Python-urllib/3.x" agent (curl works): send a browser-like one.
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 trust-layer-fetch-geoip",
           "Accept": "*/*"}


def months(start=None):
    d = start or date.today()
    prev = date(d.year - 1, 12, 1) if d.month == 1 else date(d.year, d.month - 1, 1)
    return [f"{d.year}-{d.month:02d}", f"{prev.year}-{prev.month:02d}"]


def fetch(folder, month=None, opener=urllib.request.urlopen):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    got = {}
    for kind in KINDS:
        last = None
        for m in ([month] if month else months()):
            url = URL.format(kind=kind, month=m)
            tmp = folder / f".{kind}-{m}.part"
            try:
                with opener(urllib.request.Request(url, headers=HEADERS), timeout=300) as r, open(tmp, "wb") as out:
                    shutil.copyfileobj(r, out)
                dest = folder / f"dbip-{kind}-lite-{m}.mmdb"
                with gzip.open(tmp, "rb") as src, open(dest, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                got[kind] = dest
                break
            except (urllib.error.URLError, OSError) as exc:
                last = exc
            finally:
                tmp.unlink(missing_ok=True)
        if kind not in got:
            raise RuntimeError(f"could not download the {kind} database: {last}")
    for old in folder.glob("dbip-*-lite-*.mmdb"):  # keep only the newest of each kind
        for kind in KINDS:
            if old.name.startswith(f"dbip-{kind}-lite-") and old != got[kind]:
                old.unlink()
    return got


def check(folder):
    """-> exit code: 0 fresh, 1 missing / unreadable / older than ipctx.STALE_DAYS days. Prints what it found."""
    from fusion import ipctx

    prov = ipctx.DbIpProvider.from_dir(folder)
    if prov is None:
        print(f"NO IP database in {folder}: the network check runs without country / provider / VPN. Run: .venv/bin/python tools/fetch_geoip.py")
        return 1
    st = prov.status()
    for kind in KINDS:
        info = st["files"].get(kind)
        print(f"{kind}: {info['name']} ({info['bytes'] / 1e6:.1f} MB, data from {info['date']})" if info else f"{kind}: MISSING")
    missing = [k for k in KINDS if k not in st["files"]]
    if missing:
        print(f"WARNING: missing {', '.join(missing)}: run .venv/bin/python tools/fetch_geoip.py")
    if st["stale"]:
        print(f"WARNING: the data is {st['age_days']} days old (limit {ipctx.STALE_DAYS}): run .venv/bin/python tools/fetch_geoip.py and restart the backend")
    else:
        print(f"OK: data is {st['age_days']} days old.")
    print(f"{st['credit']} ({st['credit_url']}), CC BY 4.0: credit them wherever this data is shown.")
    return 1 if (missing or st["stale"]) else 0


def main(argv=None):
    from fusion.ipctx import DEFAULT_DIR

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=str(DEFAULT_DIR))
    ap.add_argument("--month", default=None, help="YYYY-MM (default: this month, then last month)")
    ap.add_argument("--check", action="store_true", help="download nothing: report the installed files and exit 1 if missing or older than 45 days")
    a = ap.parse_args(argv)
    if a.check:
        return check(a.dir)
    got = fetch(a.dir, a.month)
    for kind, p in got.items():
        print(f"{kind}: {p} ({p.stat().st_size / 1e6:.1f} MB)")
    print("IP Geolocation by DB-IP (https://db-ip.com), CC BY 4.0: credit them wherever this data is shown. Restart the backend to use it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
