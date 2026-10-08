"""Sensor fusion through the API: visits, trails, sites, the learned network profile, replay protection, legacy clients."""
import json
import time

import pytest
from sqlmodel import Session, select

from fusion import ipctx, pipeline

from . import imgs
from .conftest import submit
from .fusion_fixtures import SITE, genuine_walk, teleport_still


def now_ms():
    return time.time() * 1000.0


def live(trail, ended_ago_s=5.0):
    """The same trail with its clock moved so it ends `ended_ago_s` before now (the server checks times against ITS clock)."""
    last = max([f["t"] for f in trail["fixes"]] + [w["t1"] for w in trail["windows"]])
    d = now_ms() - ended_ago_s * 1000.0 - last
    out = json.loads(json.dumps(trail))
    for f in out["fixes"]:
        f["t"] += d
    for w in out["windows"]:
        w["t0"] += d
        w["t1"] += d
    out["started_at"] = min(f["t"] for f in out["fixes"])
    out["ended_at"] = last + d
    return out


def set_site(client, site_id="s1", **kw):
    body = {"lat": SITE["lat"], "lng": SITE["lng"], "radius_m": 60, "country": "IN", **kw}
    r = client.put(f"/sites/{site_id}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def open_visit(client, monkeypatch, worker="w1", task="t1", site="s1", started_ago_s=400):
    """A visit that began `started_ago_s` ago (so a recorded trail fits inside it)."""
    real = pipeline._utcnow
    from datetime import timedelta
    with monkeypatch.context() as m:
        m.setattr(pipeline, "_utcnow", lambda: real() - timedelta(seconds=started_ago_s))
        r = client.post("/visits", json={"worker_id": worker, "task_id": task, "site_id": site})
    assert r.status_code == 200, r.text
    return r.json()["visit_id"]


def sub(client, trail=None, *, seed=1, visit=None, **kw):
    extra = dict(kw)
    if trail is not None:
        extra["trail"] = trail
    if visit:
        extra["visit_id"] = visit
    r = submit(client, imgs.good(seed=seed), **extra)
    assert r.status_code == 200, r.text
    return r.json()


def flags(body):
    return set(body["quality_flags"])


# ---------------------------------------------------------------- the headline scenarios

def test_a_genuine_walk_in_is_accepted_and_scored_as_consistent(client, monkeypatch):
    set_site(client)
    v = open_visit(client, monkeypatch)
    b = sub(client, live(genuine_walk()), visit=v)
    assert b["status"] == "accepted" and b["fusion_version"] == 1 and b["motion_known"] is True
    assert b["motion_score"] >= 0.9 and not (flags(b) & {"gps_jump_flat_motion", "flat_motion_while_moving", "trail_replayed", "trail_invalid", "visit_unverified"})
    assert b["fusion"]["motion"]["evidence"]["rhythm_share"] > 0.5 and len(b["fusion"]["trail"]["points"]) > 10


def test_a_gps_teleport_with_a_still_phone_is_flagged_even_with_a_perfect_photo(client, monkeypatch):
    set_site(client)
    v = open_visit(client, monkeypatch)
    b = sub(client, live(teleport_still()), visit=v)
    assert b["status"] == "flagged" and b["fraud_probability"] > 0.75
    assert "gps_jump_flat_motion" in flags(b) and b["needs_review"] is True
    assert "jumped" in b["top_reason"] and "still" in b["top_reason"] and "location change" not in b["top_reason"]
    assert b["feature_importances"]["motion_consistency"] > 0.5


def test_the_same_jump_with_walking_across_it_is_not_called_flat(client, monkeypatch):
    set_site(client)
    v = open_visit(client, monkeypatch)
    b = sub(client, live(teleport_still("walk")), visit=v)
    assert "gps_jump_flat_motion" not in flags(b) and "gps_jump_with_motion" in flags(b)


def test_a_bad_photo_alone_is_still_not_fraud_with_a_good_trail(client, monkeypatch):
    set_site(client)
    v = open_visit(client, monkeypatch)
    r = submit(client, imgs.blurry(seed=3), trail=live(genuine_walk()), visit_id=v)
    assert r.status_code == 200 and r.json()["status"] == "accepted"


# ---------------------------------------------------------------- unknown is not suspicious

def test_a_legacy_client_without_a_trail_is_unknown_not_flagged(client):
    b = sub(client)  # only the old single GPS point and the 3 s motion sample
    assert b["motion_known"] is False and b["env_known"] is False and b["status"] == "accepted"
    assert "fusion_insufficient_evidence" in flags(b) and b["needs_review"] is False
    assert b["motion_score"] == 0.5


def test_a_legacy_gps_point_is_still_checked_against_a_registered_site(client):
    set_site(client, lat=13.5, lng=77.6)  # the site is far from the legacy point (12.9, 77.6)
    b = sub(client)
    assert b["motion_known"] is True and "gps_outside_site" in flags(b)
    assert "fusion_insufficient_evidence" in flags(b) and b["fusion"]["motion"]["sensor_used"] is False  # GPS-only: the phone's movement was not compared


def test_a_required_task_without_evidence_goes_to_review_never_blocks(client, monkeypatch):
    from fusion import config as C
    monkeypatch.setitem(C.POLICY["tasks"], "t1", "required")
    b = sub(client)
    assert "fusion_required_missing" in flags(b) and b["needs_review"] is True and b["photo_verdict"] != "block"


# ---------------------------------------------------------------- abuse and malformed input

@pytest.mark.parametrize("bad", ["not a dict", {"fixes": "no"}, {"fixes": [{}] * 241}, [1, 2]])
def test_a_malformed_trail_is_a_flag_not_a_500(client, bad):
    b = sub(client, bad)
    assert "trail_invalid" in flags(b) and b["motion_known"] is False


def test_the_same_visit_cannot_carry_two_submissions(client, monkeypatch):
    set_site(client)
    v = open_visit(client, monkeypatch)
    sub(client, live(genuine_walk()), visit=v, seed=1)
    second = sub(client, live(genuine_walk(), 4.0), visit=v, seed=2)
    assert "trail_replayed" in flags(second) and second["motion_known"] in (True, False)


def test_a_recorded_trail_replayed_under_a_new_visit_is_caught(client, monkeypatch):
    """Record a genuine trail, then submit it again later under a fresh visit: it began before that visit existed."""
    set_site(client)
    old = live(genuine_walk(), ended_ago_s=2000.0)
    v = open_visit(client, monkeypatch, started_ago_s=60)
    b = sub(client, old, visit=v)
    assert "trail_replayed" in flags(b)


def test_the_exact_same_trail_twice_is_a_replay_even_without_a_visit(client):
    t = live(genuine_walk())
    first = sub(client, t, seed=1)
    second = sub(client, t, seed=2, worker="w2")
    assert "trail_replayed" not in flags(first) and "visit_unverified" in flags(first)
    assert "trail_replayed" in flags(second)


def test_a_visit_for_another_worker_is_unverified(client, monkeypatch):
    v = open_visit(client, monkeypatch, worker="someone-else")
    b = sub(client, live(genuine_walk()), visit=v)
    assert "visit_unverified" in flags(b)


def test_a_trail_from_the_future_is_invalid(client, monkeypatch):
    set_site(client)
    v = open_visit(client, monkeypatch)
    b = sub(client, live(genuine_walk(), ended_ago_s=-3600.0), visit=v)
    assert "trail_invalid" in flags(b)


# ---------------------------------------------------------------- the site profile and the environment

def trusted_visit(client, monkeypatch, i, net, site="s1"):
    """An accepted visit whose movement WAS verified against the GPS trail (what E5 requires before a visit may teach the site's network)."""
    w = f"w{i}"
    v = open_visit(client, monkeypatch, worker=w, site=site)
    return sub(client, live(genuine_walk(seed=i + 1)), visit=v, seed=100 + i, worker=w, network_info=net, site=site)


def test_the_network_profile_is_learned_from_accepted_visits_only(client, monkeypatch):
    from models import SiteNetworkProfile
    import db

    net = {"effectiveType": "4g", "downlink": 10, "rtt": 40}
    for i in range(3):
        b = trusted_visit(client, monkeypatch, i, net)
        assert b["status"] == "accepted" and b["env_known"] is False  # cold start: unknown, not a trusted baseline
    with Session(db.engine) as s:
        rows = s.exec(select(SiteNetworkProfile)).all()
    assert any(r.kind == "link" and r.count == 3 for r in rows)
    same = trusted_visit(client, monkeypatch, 9, net)
    assert same["env_known"] is True and same["ambient_score"] == 1.0 and "network_unseen_at_site" not in flags(same)
    other = trusted_visit(client, monkeypatch, 10, {"effectiveType": "3g", "downlink": 1.2, "rtt": 300})
    assert "network_unseen_at_site" in flags(other) and other["ambient_score"] < 1.0


def test_a_flagged_submission_does_not_teach_the_profile_but_a_reviewer_approval_does(client, monkeypatch):
    from models import SiteNetworkProfile
    import db

    set_site(client)
    v = open_visit(client, monkeypatch)
    b = sub(client, live(teleport_still()), visit=v, network_info={"effectiveType": "4g", "downlink": 10, "rtt": 40})
    assert b["status"] == "flagged"
    with Session(db.engine) as s:
        assert s.exec(select(SiteNetworkProfile)).all() == []
    r = client.post(f"/submissions/{b['id']}/review", json={"reviewer": "alice", "decision": "approve", "reason": ""})
    assert r.status_code == 200
    with Session(db.engine) as s:
        assert [x.kind for x in s.exec(select(SiteNetworkProfile)).all()] == ["link"]


def test_reset_fingerprint_clears_the_learned_profile(client, monkeypatch):
    net = {"effectiveType": "4g", "downlink": 10, "rtt": 40}
    for i in range(3):
        trusted_visit(client, monkeypatch, 30 + i, net)
    r = client.post("/sites/s1/reset-fingerprint")
    assert r.status_code == 200 and r.json()["deleted"] is True and r.json()["profile_rows"] >= 1
    assert trusted_visit(client, monkeypatch, 40, net)["env_known"] is False


class FarProvider:
    name = "fake"

    def lookup(self, ip):
        return ipctx.IpContext(ip="49.0.0.1", country="IN", lat=19.07, lng=72.87, asn=55836, org="Reliance Jio")


class HostingProvider(FarProvider):
    def lookup(self, ip):
        return ipctx.IpContext(ip="5.0.0.1", country="NL", lat=52.3, lng=4.9, asn=9009, org="M247 Ltd")


def test_ip_context_feeds_the_environment_signal(client, monkeypatch):
    set_site(client)
    monkeypatch.setattr(ipctx, "client_ip", lambda request: "49.0.0.1")  # the test client's own peer name is not an address
    ipctx.set_provider(FarProvider())
    try:
        b = sub(client)
        assert b["env_known"] is True and "ip_region_mismatch" in flags(b) and b["ambient_score"] < 1.0
        assert b["fusion"]["ip"]["provider"] == "fake" and b["fusion"]["ip"]["ip"] in (None, "49.0.0.0")
    finally:
        ipctx.set_provider(None)


def test_a_foreign_hosting_network_is_flagged_for_review(client, monkeypatch):
    set_site(client)
    monkeypatch.setattr(ipctx, "client_ip", lambda request: "5.0.0.1")
    ipctx.set_provider(HostingProvider())
    try:
        b = sub(client, seed=50)
        assert {"ip_country_mismatch", "anonymizing_network"} <= flags(b) and b["needs_review"] is True
    finally:
        ipctx.set_provider(None)


# ---------------------------------------------------------------- sites and visits endpoints

def test_site_endpoints_validate_and_round_trip(client):
    assert client.get("/sites/nope").status_code == 404
    assert client.put("/sites/s1", json={"lat": 95, "lng": 0}).status_code == 422
    assert client.put("/sites/s1", json={"lat": 1, "lng": 1, "radius_m": 1}).status_code == 422
    assert client.put("/sites/s1", json={"lat": 1, "lng": 1, "country": "India"}).status_code == 422
    ok = set_site(client, label="Shop 1", country="in")
    assert ok["country"] == "IN" and client.get("/sites/s1").json()["label"] == "Shop 1"
    assert [s["site_id"] for s in client.get("/sites").json()] == ["s1"]


def test_site_endpoints_need_the_dashboard_token_but_visits_do_not(client, monkeypatch):
    monkeypatch.setenv("DASHBOARD_TOKEN", "secret")
    assert client.get("/sites").status_code == 401 and client.put("/sites/s1", json={"lat": 1, "lng": 1}).status_code == 401
    assert client.get("/sites", headers={"Authorization": "Bearer secret"}).status_code == 200
    assert client.post("/visits", json={"worker_id": "w", "task_id": "t", "site_id": "s"}).status_code == 200


def test_a_visit_returns_the_servers_clock_and_the_recording_limits(client):
    r = client.post("/visits", json={"worker_id": "w", "task_id": "t", "site_id": "s"}).json()
    assert abs(r["server_time_ms"] - now_ms()) < 5000 and r["max_trail_s"] == 600 and r["window_s"] == 5 and r["visit_id"]


def test_detail_has_the_fusion_report_and_the_list_does_not(client, monkeypatch):
    set_site(client)
    v = open_visit(client, monkeypatch)
    b = sub(client, live(genuine_walk()), visit=v)
    assert "fusion" in client.get(f"/submissions/{b['id']}").json()
    assert all("fusion" not in row for row in client.get("/submissions").json())
    assert all("trail_sha256" not in row and "fusion_report" not in row for row in client.get("/submissions").json())


def test_an_honest_retry_after_a_lost_response_is_not_a_replay(client, monkeypatch):
    """Field workers on bad networks re-send. The same worker + task + site + photo, with the same visit and trail, is a retry."""
    from models import SiteNetworkProfile
    import db

    set_site(client)
    v = open_visit(client, monkeypatch)
    t = live(genuine_walk())
    first = sub(client, t, visit=v, seed=7, network_info={"effectiveType": "4g", "downlink": 10, "rtt": 40})
    again = sub(client, t, visit=v, seed=7, network_info={"effectiveType": "4g", "downlink": 10, "rtt": 40})
    assert "trail_replayed" not in flags(first) and "trail_replayed" not in flags(again)
    assert again["motion_score"] == first["motion_score"] and again["status"] == "accepted" and again["motion_known"] is True
    with Session(db.engine) as s:  # the retry did not teach the network profile a second time
        assert [r.count for r in s.exec(select(SiteNetworkProfile)).all() if r.kind == "link"] == [1]
    # ...but another photo on the same visit, or another worker on the same trail, still is a replay
    other_photo = sub(client, t, visit=v, seed=8)
    other_worker = sub(client, t, seed=9, worker="w2")
    assert "trail_replayed" in flags(other_photo) and "trail_replayed" in flags(other_worker)
