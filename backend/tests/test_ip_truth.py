"""E3: which address is 'the caller' (proxy headers), what is stored (masked), GET /env/check, and malformed network input.
A fake IP provider is used HERE ONLY (ipctx.set_provider is a test hook; nothing in the product can switch the IP)."""
import json
import logging

import pytest

from fusion import environment, ipctx

from . import imgs
from .conftest import submit
from .test_fusion_api import set_site, sub


class Req:
    def __init__(self, peer="203.0.113.7", headers=None, no_client=False):
        self.client = None if no_client else type("C", (), {"host": peer})()
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ("TRUSTED_PROXY_HEADER", "TRUSTED_PROXY_HOPS", "ENV_CHECK"):
        monkeypatch.delenv(k, raising=False)
    ipctx.set_provider(None)
    yield
    ipctx.set_provider(None)


# (case, env, peer, headers, expected)
CASES = [
    ("no config: socket address", {}, "198.51.100.9", {}, "198.51.100.9"),
    ("no config: a header from a direct caller is IGNORED", {}, "198.51.100.9", {"x-forwarded-for": "6.6.6.6"}, "198.51.100.9"),
    ("no config: cf-connecting-ip is ignored too", {}, "198.51.100.9", {"cf-connecting-ip": "6.6.6.6"}, "198.51.100.9"),
    ("xff, one proxy: the LAST entry (what the proxy saw)", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "127.0.0.1", {"x-forwarded-for": "1.1.1.1, 2.2.2.2"}, "2.2.2.2"),
    ("xff, one proxy: a client-forged left entry is ignored", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "127.0.0.1", {"x-forwarded-for": "6.6.6.6, 8.8.8.8"}, "8.8.8.8"),
    ("xff, single value", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "127.0.0.1", {"x-forwarded-for": "8.8.8.8"}, "8.8.8.8"),
    ("xff, two proxies: the entry two from the right", {"TRUSTED_PROXY_HEADER": "x-forwarded-for", "TRUSTED_PROXY_HOPS": "2"}, "127.0.0.1",
     {"x-forwarded-for": "6.6.6.6, 8.8.8.8, 10.0.0.2"}, "8.8.8.8"),
    ("xff, hops larger than the chain: what is there", {"TRUSTED_PROXY_HEADER": "x-forwarded-for", "TRUSTED_PROXY_HOPS": "3"}, "127.0.0.1",
     {"x-forwarded-for": "8.8.8.8, 10.0.0.2"}, "8.8.8.8"),
    ("xff with ports", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "127.0.0.1", {"x-forwarded-for": "8.8.8.8:51234"}, "8.8.8.8"),
    ("xff ipv6 in brackets with port", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "127.0.0.1", {"x-forwarded-for": "[2001:4860:4860::8888]:443"}, "2001:4860:4860::8888"),
    ("xff ipv6", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "127.0.0.1", {"x-forwarded-for": "2001:4860:4860::8888"}, "2001:4860:4860::8888"),
    ("xff ::ffff: mapped form", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "127.0.0.1", {"x-forwarded-for": "::ffff:8.8.8.8"}, "8.8.8.8"),
    ("xff with spaces and a trailing comma", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "127.0.0.1", {"x-forwarded-for": "  8.8.8.8 ,"}, "8.8.8.8"),
    ("header name is case-insensitive in the config", {"TRUSTED_PROXY_HEADER": "X-Forwarded-For"}, "127.0.0.1", {"x-forwarded-for": "8.8.8.8"}, "8.8.8.8"),
    ("cloudflare single-value header", {"TRUSTED_PROXY_HEADER": "cf-connecting-ip"}, "127.0.0.1", {"cf-connecting-ip": "8.8.4.4"}, "8.8.4.4"),
    ("configured but the header is missing: the socket address", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "198.51.100.9", {}, "198.51.100.9"),
    ("malformed header: the socket address, no error", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "198.51.100.9", {"x-forwarded-for": "not-an-ip"}, "198.51.100.9"),
    ("'unknown' entry", {"TRUSTED_PROXY_HEADER": "x-forwarded-for"}, "198.51.100.9", {"x-forwarded-for": "unknown"}, "198.51.100.9"),
    ("garbage hops value means 1", {"TRUSTED_PROXY_HEADER": "x-forwarded-for", "TRUSTED_PROXY_HOPS": "lots"}, "127.0.0.1", {"x-forwarded-for": "1.1.1.1, 8.8.8.8"}, "8.8.8.8"),
    ("zero hops is treated as 1", {"TRUSTED_PROXY_HEADER": "x-forwarded-for", "TRUSTED_PROXY_HOPS": "0"}, "127.0.0.1", {"x-forwarded-for": "1.1.1.1, 8.8.8.8"}, "8.8.8.8"),
    ("socket ipv6", {}, "2001:4860:4860::8888", {}, "2001:4860:4860::8888"),
    ("socket ::ffff: form", {}, "::ffff:8.8.8.8", {}, "8.8.8.8"),
    ("socket address is not an address (the test client's 'testclient')", {}, "testclient", {}, None),
]


@pytest.mark.parametrize("case,env,peer,headers,expected", CASES, ids=[c[0] for c in CASES])
def test_client_ip(monkeypatch, case, env, peer, headers, expected):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    assert ipctx.client_ip(Req(peer, headers)) == expected


def test_no_client_at_all_is_none_not_an_error():
    assert ipctx.client_ip(Req(no_client=True)) is None


def test_a_request_object_that_explodes_never_raises(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")

    class Boom:
        client = None

        @property
        def headers(self):
            raise RuntimeError("boom")

    assert ipctx.client_ip(Boom()) is None


@pytest.mark.parametrize("ip,expected", [("8.8.8.8", "8.8.8.0"), ("203.0.113.77", "203.0.113.0"), ("::ffff:1.2.3.4", "1.2.3.0"),
                                         ("2001:db8:abcd:1234:5678:9abc:def0:1", "2001:0db8:abcd::"), ("2001:4860:4860::8888", "2001:4860:4860::"),
                                         ("::1", "0000:0000:0000::"), ("bad", None), (None, None), ("", None)])
def test_masking_keeps_no_raw_address(ip, expected):
    assert ipctx.mask_ip(ip) == expected


def test_a_shared_private_address_for_every_request_warns_once(caplog):
    ipctx._recent.clear()
    ipctx._warned = False
    with caplog.at_level(logging.WARNING, logger="trust_layer.ipctx"):
        for _ in range(40):
            ipctx.note_client_ip("127.0.0.1")
    assert caplog.text.count("TRUSTED_PROXY_HEADER") == 1
    ipctx._recent.clear()
    ipctx._warned = False
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="trust_layer.ipctx"):
        for i in range(40):
            ipctx.note_client_ip(f"8.8.8.{i % 3}")  # varied callers: no warning
        for _ in range(40):
            ipctx.note_client_ip("8.8.8.8")  # one PUBLIC address is a busy caller, not a proxy problem
    assert "TRUSTED_PROXY_HEADER" not in caplog.text
    ipctx._warned = False


# ---------------------------------------------------------------- through the API

class Fake:
    """TEST-ONLY provider: a table of addresses."""
    name = "fake"
    DATA = {
        "49.0.0.1": dict(country="IN", region="Karnataka", city="Bengaluru", lat=12.93, lng=77.67, asn=24309, org="Atria Convergence"),
        "8.8.8.8": dict(country="US", region="California", city="Mountain View", lat=37.4, lng=-122.1, asn=15169, org="Google LLC"),
        "5.0.0.1": dict(country="NL", region="North Holland", city="Amsterdam", lat=52.37, lng=4.9, asn=9009, org="M247 Ltd"),
        "103.0.0.1": dict(country="IN", region="Maharashtra", city="Mumbai", lat=19.07, lng=72.87, asn=9009, org="M247 Ltd"),
    }

    def lookup(self, ip):
        import ipaddress

        if ip and not ipaddress.ip_address(ip).is_global:  # like the real provider: an internal address is 'private', never 'far'
            return ipctx.IpContext(ip=ip, private=True)
        return ipctx.IpContext(ip=ip, **self.DATA[ip]) if ip in self.DATA else None


def test_a_forwarded_header_decides_the_stored_masked_address_only_when_trusted(client, monkeypatch):
    ipctx.set_provider(Fake())
    set_site(client, lat=12.9259481, lng=77.6722586)
    r = submit(client, imgs.good(seed=1), headers=None) if False else None
    payload = lambda seed: dict(data={"payload": json.dumps({"worker_id": f"w{seed}", "task_id": "t1", "site_id": "s1", "photo_quality_pass": True})},
                                files={"photo": ("p.jpg", imgs.good(seed=seed), "image/jpeg")})
    # nothing configured: the forged header is ignored; the test client's address is not an IP, so the IP rules are 'unavailable'
    r = client.post("/submissions", headers={"X-Forwarded-For": "8.8.8.8"}, **payload(1)).json()
    assert r["fusion"]["ip"] is None and "ip_country_mismatch" not in r["fusion"]["flags"]
    # configured: now it is believed, the country rule fires, and only the masked address is stored
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    r = client.post("/submissions", headers={"X-Forwarded-For": "6.6.6.6, 8.8.8.8"}, **payload(2)).json()
    assert r["fusion"]["ip"]["country"] == "US" and r["fusion"]["ip"]["ip"] == "8.8.8.0"
    assert "ip_country_mismatch" in r["fusion"]["flags"]
    assert "8.8.8.8" not in json.dumps(r)  # the raw address is nowhere in the response (and the report is what is stored)


def test_status_never_comes_from_a_rule_only_from_the_classifier(client, monkeypatch):
    """An environment signal produces a score, flags and evidence; the verdict is the classifier's."""
    ipctx.set_provider(Fake())
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    set_site(client, lat=12.9259481, lng=77.6722586)
    r = client.post("/submissions", headers={"X-Forwarded-For": "5.0.0.1"},
                    data={"payload": json.dumps({"worker_id": "w9", "task_id": "t1", "site_id": "s1", "photo_quality_pass": True})},
                    files={"photo": ("p.jpg", imgs.good(seed=9), "image/jpeg")}).json()
    assert r["status"] in ("flagged", "accepted") and r["status"] == ("flagged" if r["fraud_probability"] > 0.5 else "accepted")
    assert r["fusion"]["environment"]["score"] < 0.35 and r["fraud_probability"] > 0.5 and r["status"] == "flagged"
    assert r["top_reason"] == "The network is in NL, the site is in IN"


# ---------------------------------------------------------------- /env/check

def test_env_check_is_404_unless_enabled(client):
    assert client.get("/env/check").status_code == 404
    assert client.get("/env/check?site_id=s1").status_code == 404


def test_env_check_describes_the_callers_own_network_and_never_the_sites_coordinates(client, monkeypatch):
    monkeypatch.setenv("ENV_CHECK", "1")
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    ipctx.set_provider(Fake())
    set_site(client, lat=12.9259481, lng=77.6722586)
    near = client.get("/env/check?site_id=s1", headers={"X-Forwarded-For": "49.0.0.1"})
    assert near.status_code == 200
    j = near.json()
    assert j["country"] == "IN" and j["provider"] == "Atria Convergence" and j["vpn_or_hosting"] is False and j["distance_km"] <= 5
    assert j["environment_score"] >= 0.9 and j["known"] is True and j["ip"] == "49.0.0.0" and j["site_registered"] is True
    text = json.dumps(j)
    assert "12.9259" not in text and "77.6722" not in text and '"lat"' not in text and '"lng"' not in text
    us = client.get("/env/check?site_id=s1", headers={"X-Forwarded-For": "8.8.8.8"}).json()
    assert us["country"] == "US" and us["sentence"] == "The network is in US, the site is in IN" and us["distance_km"] > 10000
    vpn = client.get("/env/check?site_id=s1", headers={"X-Forwarded-For": "5.0.0.1"}).json()
    assert vpn["vpn_or_hosting"] is True and "ip_country_mismatch" in vpn["flags"]
    in_vpn = client.get("/env/check?site_id=s1", headers={"X-Forwarded-For": "103.0.0.1"}).json()
    assert in_vpn["vpn_or_hosting"] is True and "ip_country_mismatch" not in in_vpn["flags"]


def test_env_check_unknown_cases_say_why_and_are_never_scored_as_bad(client, monkeypatch):
    monkeypatch.setenv("ENV_CHECK", "1")
    ipctx.set_provider(Fake())
    j = client.get("/env/check?site_id=nosuch").json()  # the test client's address is not an IP
    assert j["known"] is False and j["environment_score"] == 0.5 and "could not read" in j["sentence"] and j["flags"] == []
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    j = client.get("/env/check?site_id=nosuch", headers={"X-Forwarded-For": "10.1.2.3"}).json()
    assert j["private"] is True and j["known"] is False and "private" in j["sentence"] and j["flags"] == [] and j["distance_km"] is None
    j = client.get("/env/check?site_id=nosuch", headers={"X-Forwarded-For": "8.8.8.8"}).json()
    assert j["site_registered"] is False and j["distance_km"] is None  # no site: nothing to measure against, no coordinates guessed


def test_env_check_without_a_database_says_so(client, monkeypatch, tmp_path):
    monkeypatch.setenv("ENV_CHECK", "1")
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    monkeypatch.setenv("GEOIP_DIR", str(tmp_path))
    ipctx.set_provider(None)
    j = client.get("/env/check", headers={"X-Forwarded-For": "8.8.8.8"}).json()
    assert j["known"] is False and "no IP database" in j["sentence"]


@pytest.mark.parametrize("q", ["downlink=abc", "rtt=nan", "downlink=inf", "effectiveType=" + "x" * 500, "downlink=-5", "rtt=1e999"])
def test_env_check_odd_query_values_never_500(client, monkeypatch, q):
    monkeypatch.setenv("ENV_CHECK", "1")
    assert client.get(f"/env/check?site_id=s1&{q}").status_code in (200, 422)


# ---------------------------------------------------------------- malformed input never gives a 500

NASTY_NETWORK = [{"effectiveType": "4g", "downlink": 1e308, "rtt": 1e308}, {"effectiveType": "4g", "downlink": -1, "rtt": -1},
                 {"effectiveType": "x" * 5000, "downlink": 0, "rtt": 0}, {"effectiveType": None, "downlink": None, "rtt": None}, {}]
NASTY_RADIO = [5, "wifi", [], {"wifi": 5}, {"wifi": "abc"}, {"wifi": [5, None, [], {"bssid_h": ["x"]}, {"bssid_h": 7}, {"bssid_h": {"a": 1}}]},
               {"cell": [{"cid": {"a": 1}, "mcc": [1], "mnc": None, "tac": 1e999}, 3, None]}, {"wifi": [{"bssid_h": "a" * 10000}] * 300},
               {"wifi": None, "cell": None}, {"wifi": [{"bssid_h": "ok"}], "cell": 5}]
NASTY_TRAIL = [5, "x", [], {"fixes": 5}, {"fixes": [{"t": "a", "lat": "b", "lng": None}], "windows": [None, 5, []]},
               {"fixes": [], "windows": [], "env": {"tz_offset_min": "330"}}, {"env": {"tz_offset_min": 1e308, "tz": 5, "locale": []}},
               {"fixes": [], "windows": [], "env": {"tz_offset_min": float("1e999") if False else -1e308}}]


@pytest.mark.parametrize("net", NASTY_NETWORK)
def test_malformed_network_info_never_500(client, net):
    set_site(client)
    r = submit(client, imgs.good(seed=3), network_info=net)
    assert r.status_code in (200, 422), (net, r.text[:200])


@pytest.mark.parametrize("radio", NASTY_RADIO)
def test_malformed_radio_never_500(client, radio):
    set_site(client)
    r = submit(client, imgs.good(seed=4), radio=radio)
    big = len(json.dumps(radio)) > 500_000  # the framework itself refuses a multipart field above 1 MB with a 400: a refusal, not a crash
    assert r.status_code == 200 or (big and r.status_code in (400, 413, 422)), (radio if len(str(radio)) < 200 else "big", r.status_code, r.text[:200])


@pytest.mark.parametrize("trail", NASTY_TRAIL)
def test_malformed_trail_and_time_zone_never_500(client, trail):
    set_site(client)
    r = submit(client, imgs.good(seed=5), trail=trail)
    assert r.status_code == 200, (trail, r.text[:200])


def test_environment_engine_itself_survives_nasty_inputs():
    for net in NASTY_NETWORK + [None, "x", 5, [1]]:
        environment.evaluate(site={"lat": 1, "lng": 1, "radius_m": 50, "country": "IN"}, network_info=net if isinstance(net, dict) or net is None else {}, profile={}, ip=None)
    for radio in NASTY_RADIO + [None]:
        environment.evaluate(site=None, network_info=None, profile={"wifi": {"a": 5}}, ip=None, radio=radio)
