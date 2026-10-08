"""IP context for the environment signal: where does the network the request came from sit (country, region, ASN)?

Optional. With no database the provider is a NullProvider and the IP components of the environment score are 'unknown'.
The data is the free DB-IP "lite" city + ASN databases (MaxMind .mmdb format, CC BY 4.0, https://db-ip.com, attribution
required); fetch them with `python tools/fetch_geoip.py`. They are read with the small `maxminddb` package.

IP geolocation is COARSE: mobile carriers often resolve to a gateway hundreds of km away, VPNs and corporate networks
resolve to somewhere else on purpose. The environment rules (environment.py) are therefore lenient and weighted low.
"""
import ipaddress
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

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


class DbIpProvider:
    """Reads dbip-city-lite and dbip-asn-lite (.mmdb). `city` and `asn` are readers with .get(ip) -> dict|None (a fake can
    be injected in tests)."""
    name = "dbip-lite"

    def __init__(self, city=None, asn=None):
        self.city, self.asn = city, asn

    @classmethod
    def from_dir(cls, folder):
        import maxminddb

        folder = Path(folder)
        city = sorted(folder.glob("dbip-city-lite-*.mmdb"))
        asn = sorted(folder.glob("dbip-asn-lite-*.mmdb"))
        if not city and not asn:
            return None
        return cls(maxminddb.open_database(str(city[-1])) if city else None, maxminddb.open_database(str(asn[-1])) if asn else None)

    def lookup(self, ip):
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return None
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return IpContext(ip=ip, private=True)
        ctx = IpContext(ip=ip)
        try:
            rec = self.city.get(ip) if self.city else None
            if rec:
                loc = rec.get("location") or {}
                ctx.country = (rec.get("country") or {}).get("iso_code")
                subs = rec.get("subdivisions") or []
                ctx.region = _name(subs[0]) if subs else None
                ctx.city = _name(rec.get("city"))
                ctx.lat, ctx.lng = loc.get("latitude"), loc.get("longitude")
            arec = self.asn.get(ip) if self.asn else None
            if arec:
                ctx.asn = arec.get("autonomous_system_number")
                ctx.org = arec.get("autonomous_system_organization")
        except Exception:
            return None  # a corrupt database must never break a submission
        return ctx


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


def set_provider(p):
    """Tests and deployments can install their own provider (None = re-detect)."""
    global _provider
    _provider = p


def client_ip(request):
    """The caller's IP. Only trusts a proxy header you name in TRUSTED_PROXY_HEADER (e.g. 'x-forwarded-for'); otherwise the
    socket address. A header nobody configured is never believed (anyone can send one)."""
    header = os.environ.get("TRUSTED_PROXY_HEADER", "").strip().lower()
    if header:
        v = request.headers.get(header, "")
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else None
