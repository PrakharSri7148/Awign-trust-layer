"""E2: the reader on the REAL DB-IP lite files (REAL data, no fakes). Skipped with a message when they are not installed
(run: cd backend && .venv/bin/python tools/fetch_geoip.py). These checks pin SHAPES and well-known anchors, not exact coordinates,
because the monthly files change."""
import pytest

from fusion import ipctx

real = ipctx.DbIpProvider.from_dir(ipctx.DEFAULT_DIR)
pytestmark = pytest.mark.skipif(real is None or real.city is None or real.asn is None,
                                reason="real DB-IP files not installed in backend/data/geoip: run tools/fetch_geoip.py")

# (ip, country, an expected word in the provider name or None). Public anchors: DNS resolvers, root servers, RIPE, an Indian ISP.
ANCHORS = [
    ("8.8.8.8", "US", "google"),
    ("9.9.9.9", "US", "quad9"),
    ("208.67.222.222", "US", "opendns"),
    ("192.5.5.241", "US", "internet systems consortium"),
    ("193.0.14.129", "NL", "ripe"),
    ("202.12.27.33", "JP", "wide"),
    ("106.51.0.1", "IN", "atria"),       # a Bengaluru broadband provider
    ("117.206.0.1", "IN", "bharat sanchar"),
    ("14.139.60.1", "IN", "national knowledge"),
    ("2a00:1450:4001::1", None, "google"),  # an IPv6 address: provider is certain, the country of anycast space is not
]


@pytest.mark.parametrize("ip,country,provider", ANCHORS)
def test_well_known_addresses_resolve_to_the_right_provider_and_country(ip, country, provider):
    c = real.lookup(ip)
    assert c is not None and c.private is False
    assert provider in (c.org or "").lower(), c
    if country:
        assert c.country == country, c
    assert c.lat is not None and c.lng is not None and -90 <= c.lat <= 90 and -180 <= c.lng <= 180


def test_record_shapes_are_what_the_environment_rules_read():
    c = real.lookup("8.8.8.8")
    assert isinstance(c.asn, int) and isinstance(c.org, str) and isinstance(c.country, str) and len(c.country) == 2
    assert isinstance(c.region, str) and isinstance(c.city, str)


def test_ipv6_and_mapped_forms_work_on_the_real_files():
    assert real.lookup("2606:4700:4700::1111").asn == 13335
    assert real.lookup("::ffff:8.8.8.8").asn == 15169


def test_an_address_present_in_the_city_database_only_keeps_its_location():
    c = real.lookup("49.44.0.1")  # found in the real files on 2026-10-08 with a city but no ASN record
    if c.asn is not None:
        pytest.skip("this address now has an ASN record in the installed file")
    assert c.country == "IN" and c.lat is not None and c.org is None


def test_internal_addresses_are_private_on_the_real_provider():
    for ip in ("127.0.0.1", "10.1.2.3", "192.168.0.9", "100.64.0.1", "::1"):
        assert real.lookup(ip).private is True


def test_status_of_the_real_files():
    st = real.status()
    assert st["installed"] and st["has_city"] and st["has_asn"] and st["date"] and st["age_days"] >= 0


def test_the_environment_rules_on_real_lookups():
    """A real Bengaluru broadband address near the demo site is 'near'; a real Google address is the wrong country AND flagged hosting."""
    from fusion import environment

    site = {"lat": 12.9259481, "lng": 77.6722586, "radius_m": 100, "country": "IN"}
    home = environment.evaluate(site=site, network_info=None, profile={}, ip=real.lookup("106.51.0.1").as_dict(), tz_offset_min=330)
    assert "ip_country_mismatch" not in home["flags"] and any(c["id"] == "ip_location" and c["status"] == "near" for c in home["components"])
    far = environment.evaluate(site=site, network_info=None, profile={}, ip=real.lookup("8.8.8.8").as_dict(), tz_offset_min=330)
    assert "ip_country_mismatch" in far["flags"] and far["environment_consistency"] < 0.35
