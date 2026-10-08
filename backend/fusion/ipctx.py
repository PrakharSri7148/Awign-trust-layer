"""IP context for the environment signal: where does the network the request came from sit (country, region, ASN)?

Optional. With no database the provider is a NullProvider and the IP components of the environment score are 'unknown'.
The data is the free DB-IP "lite" city + ASN databases (MaxMind .mmdb format, CC BY 4.0, https://db-ip.com, attribution
required); fetch them with `python tools/fetch_geoip.py`. They are read with the small `maxminddb` package.

IP geolocation is COARSE: mobile carriers often resolve to a gateway hundreds of km away, VPNs and corporate networks
resolve to somewhere else on purpose. The environment rules (environment.py) are therefore lenient and weighted low.
"""
import ipaddress
import logging
import os
import re
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger("trust_layer.ipctx")
STALE_DAYS = 45  # DB-IP publishes monthly; older than this and `status()["stale"]` is true
CREDIT = "IP Geolocation by DB-IP"
CREDIT_URL = "https://db-ip.com"

DEFAULT_DIR = Path(__file__).resolve().parents[1] / "data" / "geoip"


@dataclass
class IpContext:
    ip: str
    private: bool = False
    country: Optional[str] = None
    region: Optional[str] = None
    city: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    asn: Optional[int] = None
    org: Optional[str] = None

    def as_dict(self):
        return asdict(self)


class NullProvider:
    name = "none"

    def lookup(self, ip):
        return None


def _name(d):
    return ((d or {}).get("names") or {}).get("en")


def _normalize(ip):
    """-> an ipaddress object with IPv4-mapped IPv6 (::ffff:a.b.c.d) turned into the IPv4 address, or None for garbage."""
    try:
        addr = ipaddress.ip_address(str(ip).strip().strip("[]"))
    except ValueError:
        return None
    mapped = getattr(addr, "ipv4_mapped", None)
    return mapped or addr


def _open(path):
    """A reader, or None when the file is missing or corrupt (one bad file must not take the other one down)."""
    try:
        import maxminddb

        return maxminddb.open_database(str(path))
    except Exception as exc:
        log.warning("IP database %s could not be opened (%s); that part of the network check is unavailable", Path(path).name, exc)
        return None


class DbIpProvider:
    """Reads dbip-city-lite and dbip-asn-lite (.mmdb). `city` and `asn` are readers with .get(ip) -> dict|None (a fake can
    be injected in tests)."""
    name = "dbip-lite"

    def __init__(self, city=None, asn=None, files=None):
        self.city, self.asn = city, asn
        self.files = files or {}

    @classmethod
    def from_dir(cls, folder):
        folder = Path(folder)
        city = sorted(folder.glob("dbip-city-lite-*.mmdb"))
        asn = sorted(folder.glob("dbip-asn-lite-*.mmdb"))
        if not city and not asn:
            return None
        c = _open(city[-1]) if city else None
        a = _open(asn[-1]) if asn else None
        if c is None and a is None:
            return None
        files = {}
        if c is not None:
            files["city"] = city[-1]
        if a is not None:
            files["asn"] = asn[-1]
        return cls(c, a, files)

    def lookup(self, ip):
        addr = _normalize(ip)
        if addr is None:
            return None
        text = str(addr)
        # not globally routable (private, loopback, link-local, reserved, carrier-grade NAT 100.64/10, documentation ranges): the
        # server sees an internal address, which says nothing about where the phone is (never 'far').
        if not addr.is_global:
            return IpContext(ip=text, private=True)
        ctx = IpContext(ip=text)
        try:
            rec = self.city.get(text) if self.city else None
            if rec:
                loc = rec.get("location") or {}
                ctx.country = (rec.get("country") or {}).get("iso_code")
                subs = rec.get("subdivisions") or []
                ctx.region = _name(subs[0]) if subs else None
                ctx.city = _name(rec.get("city"))
                ctx.lat, ctx.lng = loc.get("latitude"), loc.get("longitude")
        except Exception:
            ctx.country = ctx.region = ctx.city = ctx.lat = ctx.lng = None  # a bad city record: keep whatever the ASN file says
        try:
            arec = self.asn.get(text) if self.asn else None
            if arec:
                ctx.asn = arec.get("autonomous_system_number")
                ctx.org = arec.get("autonomous_system_organization")
        except Exception:
            ctx.asn = ctx.org = None
        return ctx

    def status(self):
        if not hasattr(self, "_info"):  # reading the build time opens the file: do it once
            self._info = {kind: _file_info(path) for kind, path in self.files.items()}
        files = self._info
        newest = max((f["date"] for f in files.values() if f["date"]), default=None)
        age = None if newest is None else (date.today() - date.fromisoformat(newest)).days
        return {"provider": self.name, "installed": True, "files": files, "date": newest, "age_days": age,
                "stale": age is not None and age > STALE_DAYS, "has_city": self.city is not None, "has_asn": self.asn is not None,
                "credit": CREDIT, "credit_url": CREDIT_URL}


def _file_info(path):
    """File name, size and the data date: the build time inside the .mmdb when readable, else the month in the file name."""
    path = Path(path)
    d = None
    try:
        import maxminddb

        with maxminddb.open_database(str(path)) as r:
            d = datetime.fromtimestamp(r.metadata().build_epoch, tz=timezone.utc).date().isoformat()
    except Exception:
        m = re.search(r"(\d{4})-(\d{2})", path.name)
        d = f"{m.group(1)}-{m.group(2)}-01" if m else None
    try:
        size = path.stat().st_size
    except OSError:
        size = None
    return {"name": path.name, "bytes": size, "date": d}


_provider = None


def get_provider():
    """The configured provider (cached): GEOIP_DIR (default backend/data/geoip) if it holds the DB-IP files, else none."""
    global _provider
    if _provider is None:
        try:
            _provider = DbIpProvider.from_dir(os.environ.get("GEOIP_DIR", DEFAULT_DIR)) or NullProvider()
        except Exception:
            _provider = NullProvider()
    return _provider


def status():
    """What the server knows about its IP database: provider, files, data date, age, stale (> 45 days). Shown in /health and the dashboard."""
    p = get_provider()
    if hasattr(p, "status"):
        return p.status()
    return {"provider": getattr(p, "name", "none"), "installed": False, "files": {}, "date": None, "age_days": None, "stale": False,
            "has_city": False, "has_asn": False, "credit": CREDIT, "credit_url": CREDIT_URL}


def warn_if_unavailable():
    """Called once at start-up: say it loudly when the IP part of the environment check cannot work."""
    st = status()
    if not st["installed"]:
        log.warning("No IP database installed: the network-vs-area check runs without country / provider / VPN (run: cd backend && "
                    ".venv/bin/python tools/fetch_geoip.py, then restart)")
    elif st["stale"]:
        log.warning("IP database is %s days old (data from %s); refresh it: cd backend && .venv/bin/python tools/fetch_geoip.py", st["age_days"], st["date"])
    return st


def set_provider(p):
    """TEST HOOK: install a fake provider (None = re-detect from GEOIP_DIR). Nothing in the product calls it. With PUBLIC_MODE=1 it REFUSES
    anything but None, so a fake network can never be loaded into a public server (the demo is real)."""
    global _provider
    if p is not None and os.environ.get("PUBLIC_MODE", "").strip() == "1":
        raise RuntimeError("the test IP provider cannot be loaded when PUBLIC_MODE=1")
    _provider = p


def _parse_forwarded(entry):
    """One entry of a forwarding header -> an ipaddress object or None. Accepts 'ip', 'ip:port', '[v6]', '[v6]:port', '::ffff:a.b.c.d'."""
    e = (entry or "").strip().strip('"')
    if not e or e.lower() == "unknown":
        return None
    if e.startswith("["):  # [v6] or [v6]:port
        e = e[1:].split("]", 1)[0]
    elif e.count(":") == 1:  # v4:port
        e = e.split(":", 1)[0]
    return _normalize(e)


def proxy_settings():
    """(header name or None, hops >= 1) from TRUSTED_PROXY_HEADER / TRUSTED_PROXY_HOPS."""
    header = os.environ.get("TRUSTED_PROXY_HEADER", "").strip().lower() or None
    try:
        hops = max(1, int(os.environ.get("TRUSTED_PROXY_HOPS", "1")))
    except ValueError:
        hops = 1
    return header, hops


def client_ip(request):
    """The caller's IP as a string, or None. A proxy header is believed ONLY when you named it in TRUSTED_PROXY_HEADER (anyone can send
    one, so a header from a direct caller, with nothing configured, is ignored). With 'x-forwarded-for' each proxy appends the address
    it received the request from, so only the entries the trusted proxies wrote are reliable: the one TRUSTED_PROXY_HOPS from the RIGHT
    (default 1 = the last entry) is the client; anything the client put to the left of it is ignored. Single-value headers such as
    'cf-connecting-ip' or 'x-real-ip' are used as they are. A malformed header falls back to the socket address; never raises."""
    peer = None
    try:
        peer = getattr(getattr(request, "client", None), "host", None)
        header, hops = proxy_settings()
        if header:
            raw = request.headers.get(header, "")
            if raw:
                parts = [x for x in raw.split(",") if x.strip()]
                if header == "x-forwarded-for" and len(parts) >= hops:
                    parts = [parts[-hops]]
                elif header == "x-forwarded-for":
                    parts = parts[:1]  # fewer entries than configured proxies: the request did not pass them all; take what is there
                ip = _parse_forwarded(parts[0]) if parts else None
                if ip is not None:
                    return str(ip)
    except Exception:
        pass
    ip = _normalize(peer) if peer else None
    return str(ip) if ip is not None else None


_recent = []
_warned = False


def note_client_ip(ip, *, window=30):
    """Warn ONCE if the last `window` requests all came from the same non-routable address (a reverse proxy in front of the server that
    is not trusted: every visitor looks like the proxy and every IP check is 'unavailable')."""
    global _warned
    if _warned:
        return
    _recent.append(ip)
    del _recent[:-window]
    if len(_recent) == window and len(set(_recent)) == 1 and _recent[0] is not None:
        addr = _normalize(_recent[0])
        if addr is not None and not addr.is_global:
            _warned = True
            log.warning("All the last %d requests came from %s: if a proxy or tunnel is in front of this server, set TRUSTED_PROXY_HEADER "
                        "(x-forwarded-for, cf-connecting-ip, ...) and TRUSTED_PROXY_HOPS, or every IP check is 'unavailable'", window, _recent[0])


def mask_ip(ip):
    """What may be stored: IPv4 last octet zeroed, IPv6 last 80 bits zeroed (only the /48 is kept). None for anything unparsable."""
    addr = _normalize(ip) if ip else None
    if addr is None:
        return None
    if addr.version == 4:
        return ".".join(str(addr).split(".")[:3] + ["0"])
    kept = addr.exploded.split(":")[:3]
    return ":".join(kept) + "::"
