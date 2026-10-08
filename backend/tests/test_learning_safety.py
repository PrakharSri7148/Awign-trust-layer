"""E5: only a TRUSTED visit teaches the site's network profile (accepted AND its movement was compared with the GPS trail with a
consistency of at least learnMinMotion). A spoofer who is accepted anyway must not make their own network 'normal' for the site."""
import pytest
from sqlmodel import Session, select

import db
from fusion import config as C, pipeline
from models import SiteNetworkProfile

from .fusion_fixtures import genuine_walk, teleport_still
from .test_fusion_api import live, open_visit, set_site, sub, trusted_visit

NET = {"effectiveType": "4g", "downlink": 10, "rtt": 40}


def rows():
    with Session(db.engine) as s:
        return s.exec(select(SiteNetworkProfile)).all()


@pytest.mark.parametrize("accepted,known,used,score,teach", [
    (True, True, True, 0.97, True), (True, True, True, 0.80, True),
    (True, True, True, 0.79, False), (True, True, True, 0.27, False),
    (True, True, False, 0.97, False),   # GPS-only evidence: the phone's movement was never compared with it
    (True, False, False, 0.5, False),   # no motion evidence at all
    (False, True, True, 0.97, False),   # flagged: never
])
def test_learning_decision_table(accepted, known, used, score, teach):
    assert pipeline.learning_decision(accepted, known, used, score)[0] is teach


def test_the_threshold_lives_in_fusion_json_only():
    assert C.ENVIRONMENT["learnMinMotion"] == 0.8


def test_trusted_visits_teach_the_network(client, monkeypatch):
    set_site(client)
    for i in range(3):
        assert trusted_visit(client, monkeypatch, i, NET)["status"] == "accepted"
    assert any(r.kind == "link" and r.count == 3 for r in rows())


def test_ten_accepted_but_spoofed_visits_do_not_make_their_network_known(client, monkeypatch):
    """Force the classifier to ACCEPT spoofed submissions (the worst case: a spoof the model missed). Their flat-motion evidence must keep
    their network out of the site's profile, so a later honest visit from a different network is not 'unseen' because of the spoofers."""
    import main

    set_site(client)
    monkeypatch.setattr(main, "score_submission", lambda *a, **k: {"fraud_probability": 0.01, "feature_importances": {"photo_quality": 0.3, "motion_consistency": 0.4, "ambient_fingerprint": 0.3},
                                                                   "top_reason": "No issues detected"})
    spoof_net = {"effectiveType": "3g", "downlink": 1.2, "rtt": 300}
    for i in range(10):
        v = open_visit(client, monkeypatch, worker=f"sp{i}")
        b = sub(client, live(teleport_still()), visit=v, seed=200 + i, worker=f"sp{i}", network_info=spoof_net)
        assert b["status"] == "accepted"          # the (forced) classifier let it through
        assert b["motion_score"] < C.ENVIRONMENT["learnMinMotion"]  # but the movement evidence says the phone never moved
        # the trail is reused per visit: give each its own jitter so the replay guard is not what stops it
        client.app  # noqa: B018 (keeps the fixture referenced)
    assert [r for r in rows() if r.kind == "link"] == []  # nothing was learned from them

    # the honest visits that follow define what 'normal' is
    for i in range(3):
        assert trusted_visit(client, monkeypatch, 50 + i, NET)["status"] == "accepted"
    link_keys = {r.key for r in rows() if r.kind == "link"}
    assert len(link_keys) == 1 and "3g" not in next(iter(link_keys))
    unseen = trusted_visit(client, monkeypatch, 60, spoof_net)
    assert "network_unseen_at_site" in unseen["fusion"]["flags"]  # the spoofers' network is still new here


def test_an_accepted_visit_without_sensors_does_not_teach_either(client):
    """A desktop or a worker who declined recording is accepted (unknown is not suspicious) but proves nothing about the movement."""
    for i in range(5):
        assert sub(client, seed=300 + i, worker=f"d{i}", network_info=NET)["status"] == "accepted"
    assert rows() == []


def test_a_reviewer_approval_still_teaches_because_a_human_decided(client, monkeypatch):
    set_site(client)
    v = open_visit(client, monkeypatch)
    b = sub(client, live(teleport_still()), visit=v, network_info=NET)
    assert b["status"] == "flagged" and rows() == []
    client.post(f"/submissions/{b['id']}/review", json={"reviewer": "alice", "decision": "approve", "reason": ""})
    assert [r.kind for r in rows()] == ["link"]


def test_the_reset_endpoint_still_clears_everything(client, monkeypatch):
    set_site(client)
    for i in range(3):
        trusted_visit(client, monkeypatch, 70 + i, NET)
    assert rows()
    r = client.post("/sites/s1/reset-fingerprint").json()
    assert r["deleted"] is True and rows() == []
