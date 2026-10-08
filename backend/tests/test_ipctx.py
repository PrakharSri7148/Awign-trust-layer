"""E2: the IP provider against odd inputs, corrupt files, one-database-only records, status and the start-up warning (fakes and temp
files only; the REAL DB-IP files are exercised in test_ipctx_real.py)."""
import logging
import os
import time
from datetime import date, timedelta
from pathlib import Path

import pytest

from fusion import ipctx
from tools import fetch_geoip


class Reader:
    def __init__(self, data=None, boom=False):
        self.data, self.boom = data or {}, boom

    def get(self, ip):
        if self.boom:
            raise ValueError("corrupt record")
        return self.data.get(ip)


CITY = {"8.8.8.8": {"country": {"iso_code": "US"}, "subdivisions": [{"names": {"en": "California"}}], "city": {"names": {"en": "Mountain View"}},
                    "location": {"latitude": 37.4, "longitude": -122.1}},
        "9.9.9.9": {"country": {"iso_code": "US"}, "location": {"latitude": 37.8, "longitude": -122.2}}}
ASN = {"8.8.8.8": {"autonomous_system_number": 15169, "autonomous_system_organization": "Google LLC"},
       "1.2.3.4": {"autonomous_system_number": 64500, "autonomous_system_organization": "Only In ASN"}}


def prov(**kw):
    return ipctx.DbIpProvider(Reader(CITY), Reader(ASN), **kw)


@pytest.mark.parametrize("ip", ["10.0.0.1", "127.0.0.1", "192.168.1.5", "172.16.3.4", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1",
                                "::ffff:10.0.0.1", "::ffff:127.0.0.1", "203.0.113.9", "198.51.100.1"])
def test_internal_and_non_routable_addresses_are_private_never_far(ip):
    c = prov().lookup(ip)
    assert c is not None and c.private is True and c.country is None and c.lat is None


@pytest.mark.parametrize("ip", ["", None, "not-an-ip", "999.1.1.1", "1.2.3", "8.8.8.8/32", "   ", "8.8.8.8, 1.1.1.1"])
def test_garbage_addresses_give_none_not_an_error(ip):
    assert prov().lookup(ip) is None


def test_ipv4_mapped_and_bracketed_ipv6_resolve_like_the_ipv4_address():
    a = prov().lookup("8.8.8.8")
    for form in ("::ffff:8.8.8.8", "[::ffff:8.8.8.8]", " 8.8.8.8 "):
        c = prov().lookup(form)
        assert (c.ip, c.country, c.asn) == ("8.8.8.8", "US", 15169) == (a.ip, a.country, a.asn)


def test_a_record_in_only_one_database_keeps_what_there_is():
    only_city = prov().lookup("9.9.9.9")
    assert only_city.country == "US" and only_city.asn is None and only_city.org is None
    only_asn = prov().lookup("1.2.3.4")
    assert only_asn.country is None and only_asn.lat is None and only_asn.asn == 64500 and only_asn.org == "Only In ASN"
    assert prov().lookup("5.5.5.5").country is None  # in neither


def test_a_failing_city_reader_still_returns_the_asn_and_a_failing_asn_reader_still_returns_the_city():
    c = ipctx.DbIpProvider(Reader(boom=True), Reader(ASN)).lookup("8.8.8.8")
    assert c.asn == 15169 and c.country is None
    c = ipctx.DbIpProvider(Reader(CITY), Reader(boom=True)).lookup("8.8.8.8")
    assert c.country == "US" and c.asn is None
    assert ipctx.DbIpProvider(Reader(boom=True), Reader(boom=True)).lookup("8.8.8.8").country is None


def write_garbage(folder, name):
    (folder / name).write_bytes(b"this is not a maxmind database" * 100)


def test_a_corrupt_file_never_raises_and_the_provider_falls_back_to_none(tmp_path):
    write_garbage(tmp_path, "dbip-city-lite-2026-10.mmdb")
    write_garbage(tmp_path, "dbip-asn-lite-2026-10.mmdb")
    assert ipctx.DbIpProvider.from_dir(tmp_path) is None
    os.environ["GEOIP_DIR"] = str(tmp_path)
    try:
        ipctx.set_provider(None)
        assert isinstance(ipctx.get_provider(), ipctx.NullProvider)
        st = ipctx.status()
        assert st["installed"] is False and st["provider"] == "none"
        assert ipctx.get_provider().lookup("8.8.8.8") is None
    finally:
        del os.environ["GEOIP_DIR"]
        ipctx.set_provider(None)


def test_one_corrupt_file_does_not_take_the_good_one_down(tmp_path):
    real = Path(ipctx.DEFAULT_DIR).glob("dbip-asn-lite-*.mmdb")
    real = next(real, None)
    if real is None:
        pytest.skip("needs the real DB-IP ASN file in backend/data/geoip (run tools/fetch_geoip.py)")
    (tmp_path / real.name).write_bytes(real.read_bytes())
    write_garbage(tmp_path, "dbip-city-lite-2026-10.mmdb")
    p = ipctx.DbIpProvider.from_dir(tmp_path)
    assert p is not None and p.city is None and p.asn is not None
    assert p.lookup("8.8.8.8").asn == 15169
    assert p.status()["has_city"] is False and p.status()["has_asn"] is True


def test_no_files_means_no_provider(tmp_path):
    assert ipctx.DbIpProvider.from_dir(tmp_path) is None


def test_status_reports_dates_age_and_staleness(tmp_path):
    old = tmp_path / "dbip-city-lite-2026-01.mmdb"
    old.write_bytes(b"x")  # unreadable as a database: the date falls back to the month in the file name
    p = ipctx.DbIpProvider(Reader(), Reader(), files={"city": old})
    st = p.status()
    assert st["files"]["city"]["date"] == "2026-01-01" and st["installed"] is True
    assert st["age_days"] == (date.today() - date(2026, 1, 1)).days
    assert st["stale"] == (st["age_days"] > ipctx.STALE_DAYS)
    assert st["credit"] == "IP Geolocation by DB-IP" and st["credit_url"] == "https://db-ip.com"


def test_warns_loudly_when_no_database_is_installed(tmp_path, caplog):
    os.environ["GEOIP_DIR"] = str(tmp_path)
    try:
        ipctx.set_provider(None)
        with caplog.at_level(logging.WARNING, logger="trust_layer.ipctx"):
            st = ipctx.warn_if_unavailable()
        assert st["installed"] is False
        assert "No IP database installed" in caplog.text and "fetch_geoip.py" in caplog.text
    finally:
        del os.environ["GEOIP_DIR"]
        ipctx.set_provider(None)


def test_warns_when_the_database_is_stale(caplog):
    class Stale:
        name = "x"

        def lookup(self, ip):
            return None

        def status(self):
            return {"provider": "x", "installed": True, "stale": True, "age_days": 99, "date": "2026-01-01"}

    ipctx.set_provider(Stale())
    try:
        with caplog.at_level(logging.WARNING, logger="trust_layer.ipctx"):
            ipctx.warn_if_unavailable()
        assert "99 days old" in caplog.text
    finally:
        ipctx.set_provider(None)


def test_health_carries_the_ip_database_status(client):
    ipctx.set_provider(prov(files={}))
    try:
        j = client.get("/health").json()
        assert j["status"] == "ok" and j["ip_database"]["provider"] == "dbip-lite" and j["ip_database"]["installed"] is True
    finally:
        ipctx.set_provider(None)


def test_health_still_answers_with_no_database(client, tmp_path):
    os.environ["GEOIP_DIR"] = str(tmp_path)
    try:
        ipctx.set_provider(None)
        j = client.get("/health").json()
        assert j["status"] == "ok" and j["ip_database"]["installed"] is False
    finally:
        del os.environ["GEOIP_DIR"]
        ipctx.set_provider(None)


# ---------------------------------------------------------------- fetch_geoip --check

def test_check_is_fresh_missing_or_stale(tmp_path, capsys, monkeypatch):
    assert fetch_geoip.check(tmp_path) == 1 and "NO IP database" in capsys.readouterr().out
    month = (date.today() - timedelta(days=120)).strftime("%Y-%m")
    for kind in ("city", "asn"):
        (tmp_path / f"dbip-{kind}-lite-{month}.mmdb").write_bytes(b"x")
    # unreadable files do not count as a database at all
    assert fetch_geoip.check(tmp_path) == 1

    class P:
        def __init__(self, age, files):
            self.age, self.f = age, files

        def status(self):
            return {"files": {k: {"name": k, "bytes": 1e6, "date": "2026-01-01"} for k in self.f}, "age_days": self.age, "stale": self.age > 45,
                    "credit": "IP Geolocation by DB-IP", "credit_url": "https://db-ip.com"}

    for age, files, code, word in ((10, ("city", "asn"), 0, "OK"), (60, ("city", "asn"), 1, "days old"), (10, ("city",), 1, "missing asn")):
        monkeypatch.setattr(ipctx.DbIpProvider, "from_dir", classmethod(lambda cls, folder, a=age, f=files: P(a, f)))
        assert fetch_geoip.check(tmp_path) == code and word in capsys.readouterr().out
