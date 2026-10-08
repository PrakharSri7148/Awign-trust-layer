"""E4: the site location API (the dashboard's Site location panel uses exactly this): validation, the change log, forgetting the learned
network only when asked, the dashboard token, history preserved, and the no-site behaviour."""
import json
import sqlite3

import pytest
from sqlalchemy import create_engine
from sqlmodel import Session, select

import db
from models import SiteChange, SiteNetworkProfile
from fusion import ipctx

from . import imgs
from .conftest import submit

HOME = {"lat": 12.9259481, "lng": 77.6722586, "radius_m": 100, "country": "IN", "label": "Home (test)"}
VENUE = {"lat": 13.0827, "lng": 80.2707, "radius_m": 120, "country": "IN", "label": "Hackathon venue"}  # a test value, ~290 km from HOME


def learn(client, site_id, n=3):
    with Session(db.engine) as s:
        for kind, key in (("link", "4g|2|<150"), ("asn", "AS24309")):
            s.add(SiteNetworkProfile(site_id=site_id, kind=kind, key=key, count=n))
        s.commit()


def profile_rows(site_id):
    with Session(db.engine) as s:
        return len(s.exec(select(SiteNetworkProfile).where(SiteNetworkProfile.site_id == site_id)).all())


def test_first_save_creates_the_site_and_the_first_log_line(client):
    r = client.put("/sites/site_demo_1", json=HOME)
    assert r.status_code == 200
    j = r.json()
    assert (j["lat"], j["lng"], j["radius_m"], j["country"], j["label"]) == (12.9259481, 77.6722586, 100, "IN", "Home (test)")
    assert j["moved_m"] is None and j["network_reset"] is False
    log = client.get("/sites/site_demo_1/changes").json()
    assert len(log) == 1 and log[0]["kind"] == "create" and log[0]["old"] is None and log[0]["new"]["lat"] == 12.9259481 and log[0]["moved_m"] is None


def test_moving_the_site_logs_old_and_new_values_and_the_distance(client):
    client.put("/sites/site_demo_1", json=HOME)
    r = client.put("/sites/site_demo_1", json=VENUE).json()
    assert 280_000 < r["moved_m"] < 300_000
    log = client.get("/sites/site_demo_1/changes").json()
    assert [c["kind"] for c in log] == ["update", "create"]  # newest first
    assert log[0]["old"]["lat"] == 12.9259481 and log[0]["new"]["label"] == "Hackathon venue" and abs(log[0]["moved_m"] - r["moved_m"]) <= 1
    assert log[0]["network_reset"] is False


def test_the_learned_network_survives_a_move_unless_asked_to_forget(client):
    client.put("/sites/site_demo_1", json=HOME)
    learn(client, "site_demo_1")
    r = client.put("/sites/site_demo_1", json=VENUE).json()
    assert r["network_reset"] is False and r["profile_rows_cleared"] == 0 and profile_rows("site_demo_1") == 2
    r = client.put("/sites/site_demo_1", json={**HOME, "reset_network": True}).json()
    assert r["network_reset"] is True and r["profile_rows_cleared"] == 2 and profile_rows("site_demo_1") == 0
    last = client.get("/sites/site_demo_1/changes").json()[0]
    assert last["network_reset"] is True and last["profile_rows_cleared"] == 2


def test_other_sites_keep_their_learned_network(client):
    client.put("/sites/a", json=HOME)
    client.put("/sites/b", json=HOME)
    learn(client, "a")
    learn(client, "b")
    client.put("/sites/a", json={**VENUE, "reset_network": True})
    assert profile_rows("a") == 0 and profile_rows("b") == 2


def test_saving_the_same_values_again_writes_no_log_line(client):
    client.put("/sites/s", json=HOME)
    client.put("/sites/s", json=HOME)
    assert len(client.get("/sites/s/changes").json()) == 1


def test_the_reset_endpoint_still_clears_everything(client):
    client.put("/sites/s", json=HOME)
    learn(client, "s")
    r = client.post("/sites/s/reset-fingerprint").json()
    assert r == {"site_id": "s", "deleted": True, "profile_rows": 2} and profile_rows("s") == 0


@pytest.mark.parametrize("patch,message", [
    ({"lat": 91}, "lat/lng out of range"), ({"lat": -90.5}, "lat/lng out of range"), ({"lng": 181}, "lat/lng out of range"),
    ({"radius_m": 4}, "radius_m must be between 5 and 5000"), ({"radius_m": 5001}, "radius_m must be between 5 and 5000"),
    ({"country": "IND"}, "country must be a two-letter ISO code"), ({"country": "1A"}, "country must be a two-letter ISO code"),
    ({"country": "I"}, "country must be a two-letter ISO code"), ({"label": "x" * 81}, "label must be at most 80 characters"),
])
def test_the_backend_validation_messages(client, patch, message):
    r = client.put("/sites/s", json={**HOME, **patch})
    assert r.status_code == 422 and r.json()["detail"] == message
    assert client.get("/sites/s").status_code == 404 and client.get("/sites/s/changes").json() == []  # nothing was saved or logged


@pytest.mark.parametrize("raw", ['{"lat": NaN, "lng": 1, "radius_m": 50}', '{"lat": 1, "lng": Infinity, "radius_m": 50}', '{"lat": 1, "lng": 1, "radius_m": NaN}'])
def test_non_finite_numbers_are_refused_not_stored(client, raw):
    r = client.put("/sites/s", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert client.get("/sites/s").status_code == 404


def test_country_is_normalised_and_optional(client):
    assert client.put("/sites/s", json={**HOME, "country": " in "}).json()["country"] == "IN"
    assert client.put("/sites/s", json={**HOME, "country": ""}).json()["country"] is None
    assert client.put("/sites/s", json={**HOME, "country": None, "label": "  "}).json()["label"] is None


def test_every_site_endpoint_needs_the_dashboard_token(client, monkeypatch):
    monkeypatch.setenv("DASHBOARD_TOKEN", "sekret")
    for method, path, kw in (("get", "/sites", {}), ("get", "/sites/s", {}), ("put", "/sites/s", {"json": HOME}), ("get", "/sites/s/changes", {}),
                             ("post", "/sites/s/reset-fingerprint", {})):
        assert getattr(client, method)(path, **kw).status_code == 401, path
        assert getattr(client, method)(path, headers={"Authorization": "Bearer wrong"}, **kw).status_code == 401, path
    ok = client.put("/sites/s", json=HOME, headers={"Authorization": "Bearer sekret"})
    assert ok.status_code == 200
    assert client.get("/sites/s/changes", headers={"Authorization": "Bearer sekret"}).status_code == 200
    assert client.get("/sites/s/changes").status_code == 401  # nothing about the log leaks without it


def test_old_submissions_keep_the_site_they_were_scored_with(client):
    client.put("/sites/s1", json={**HOME, "radius_m": 100})
    first = submit(client, imgs.good(seed=1)).json()
    client.put("/sites/s1", json=VENUE)
    again = client.get(f"/submissions/{first['id']}").json()
    assert again["fusion"]["site"] == {"lat": 12.9259481, "lng": 77.6722586, "radius_m": 100.0}
    second = submit(client, imgs.good(seed=2), worker="w2").json()
    assert second["fusion"]["site"]["lat"] == 13.0827


def test_the_change_log_limit_is_bounded(client):
    client.put("/sites/s", json=HOME)
    for i in range(5):
        client.put("/sites/s", json={**HOME, "radius_m": 100 + i + 1})
    assert len(client.get("/sites/s/changes?limit=3").json()) == 3
    assert len(client.get("/sites/s/changes?limit=-5").json()) == 1
    assert len(client.get("/sites/s/changes?limit=100000").json()) == 6


# ---------------------------------------------------------------- no site registered

class Fixed:
    name = "fixed-test-provider"

    def __init__(self, **kw):
        self.kw = kw

    def lookup(self, ip):
        return ipctx.IpContext(ip=ip, **self.kw)


def post_from(client, ip_header, **extra):
    return client.post("/submissions", headers={"X-Forwarded-For": ip_header},
                       data={"payload": json.dumps({"worker_id": "w1", "task_id": "t1", "site_id": "nosite", "photo_quality_pass": True,
                                                    "gps": {"lat": 12.9, "lng": 77.6}, **extra})},
                       files={"photo": ("p.jpg", imgs.good(seed=3), "image/jpeg")}).json()


def test_the_case_file_says_when_no_site_is_registered(client):
    r = submit(client, imgs.good(seed=1), site="nosite").json()
    assert r["fusion"]["site"] is None
    assert any("No site is registered for this task" in n for n in r["fusion"]["notes"])


def test_without_a_site_the_ip_is_compared_with_the_phones_own_gps_at_a_low_weight(client, monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    ipctx.set_provider(Fixed(country="IN", region="Maharashtra", lat=19.07, lng=72.87, asn=55836, org="Reliance Jio"))  # ~850 km from the GPS point
    try:
        r = post_from(client, "49.0.0.1")
    finally:
        ipctx.set_provider(None)
    env = r["fusion"]["environment"]
    assert "ip_far_from_gps" in r["fusion"]["flags"]
    assert env["penalties"] == {"ipFarGps": 0.15} and env["score"] == 0.85 and env["known"] is True
    comp = next(c for c in env["components"] if c["id"] == "ip_vs_gps")
    assert "no site registered" in comp["detail"]
    assert r["status"] == "accepted"  # low weight: a far carrier gateway never flags by itself
    assert any("only" in n and "No site is registered" in n for n in r["fusion"]["notes"])


def test_without_a_site_a_near_ip_is_a_match_and_no_ip_is_unknown(client, monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    ipctx.set_provider(Fixed(country="IN", lat=12.95, lng=77.62, asn=24309, org="Atria"))
    try:
        near = post_from(client, "49.0.0.1")
    finally:
        ipctx.set_provider(None)
    assert near["fusion"]["environment"]["penalties"] == {} and near["fusion"]["environment"]["known"] is True
    assert next(c for c in near["fusion"]["environment"]["components"] if c["id"] == "ip_vs_gps")["status"] == "near"
    none = submit(client, imgs.good(seed=9), site="nosite", worker="w9").json()  # the test client has no usable address
    assert none["fusion"]["environment"]["known"] is False and none["fusion"]["environment"]["score"] == 0.5


def test_with_a_site_the_gps_fallback_is_not_used(client, monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    client.put("/sites/nosite", json=HOME)
    ipctx.set_provider(Fixed(country="IN", lat=19.07, lng=72.87, asn=55836, org="Reliance Jio"))
    try:
        r = post_from(client, "49.0.0.1")
    finally:
        ipctx.set_provider(None)
    assert "ip_far_from_gps" not in r["fusion"]["flags"] and "ip_region_mismatch" in r["fusion"]["flags"]


# ---------------------------------------------------------------- old databases

def test_an_old_database_without_the_change_log_gets_it_additively(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE site (site_id VARCHAR NOT NULL, lat FLOAT NOT NULL, lng FLOAT NOT NULL, radius_m FLOAT NOT NULL, country VARCHAR, label VARCHAR, PRIMARY KEY (site_id))")
    con.execute("INSERT INTO site VALUES ('site_demo_1', 12.9259481, 77.6722586, 100.0, 'IN', 'Home (test)')")
    con.commit()
    con.close()
    monkeypatch.setattr(db, "engine", create_engine(f"sqlite:///{path}"))
    db.init_db()
    db.init_db()
    con = sqlite3.connect(path)
    assert con.execute("SELECT lat, label FROM site").fetchone() == (12.9259481, "Home (test)")  # the registered site is untouched
    assert {r[1] for r in con.execute("PRAGMA table_info(sitechange)")} >= {"site_id", "changed_at", "old_lat", "new_lat", "moved_m", "network_reset"}
    assert con.execute("SELECT COUNT(*) FROM sitechange").fetchone() == (0,)


# ---------------------------------------------------------------- the stored fingerprint is visible (E4 addition)

def test_the_learned_network_is_listed_exactly_as_stored(client):
    client.put("/sites/s", json=HOME)
    assert client.get("/sites/s/profile").json() == {
        "site_id": "s", "visits": 0, "needed": 3, "known": False, "kinds": {}, "rows": 0,
        "rule": "A visit teaches this only if it was accepted and the phone's movement matched the GPS trail (consistency >= 0.8)."}
    learn(client, "s", n=4)
    j = client.get("/sites/s/profile").json()
    assert j["visits"] == 4 and j["known"] is True and j["rows"] == 2
    assert [(r["key"], r["count"]) for r in j["kinds"]["link"]] == [("4g|2|<150", 4)]
    assert [(r["key"], r["count"]) for r in j["kinds"]["asn"]] == [("AS24309", 4)]
    assert all(r["last_seen"].endswith("Z") for r in j["kinds"]["link"])


def test_the_profile_view_holds_no_ip_address_and_shortens_radio_hashes(client):
    client.put("/sites/s", json=HOME)
    with Session(db.engine) as s:
        s.add(SiteNetworkProfile(site_id="s", kind="wifi", key="a" * 64, count=3))
        s.commit()
    text = json.dumps(client.get("/sites/s/profile").json(), ensure_ascii=False)
    assert "a" * 64 not in text and ("a" * 10 + "…") in text


def test_the_profile_needs_the_dashboard_token_and_is_per_site(client, monkeypatch):
    client.put("/sites/a", json=HOME)
    learn(client, "a")
    assert client.get("/sites/b/profile").json()["rows"] == 0
    monkeypatch.setenv("DASHBOARD_TOKEN", "sekret")
    assert client.get("/sites/a/profile").status_code == 401
    assert client.get("/sites/a/profile", headers={"Authorization": "Bearer sekret"}).json()["rows"] == 2
