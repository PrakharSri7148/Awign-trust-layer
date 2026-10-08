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
                with opener(url, timeout=300) as r, open(tmp, "wb") as out:
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


def main(argv=None):
    from fusion.ipctx import DEFAULT_DIR

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=str(DEFAULT_DIR))
    ap.add_argument("--month", default=None, help="YYYY-MM (default: this month, then last month)")
    a = ap.parse_args(argv)
    got = fetch(a.dir, a.month)
    for kind, p in got.items():
        print(f"{kind}: {p} ({p.stat().st_size / 1e6:.1f} MB)")
    print("IP Geolocation by DB-IP (https://db-ip.com), CC BY 4.0: credit them wherever this data is shown. Restart the backend to use it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
