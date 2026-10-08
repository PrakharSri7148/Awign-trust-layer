"""Phase 8e: the reviewer workflow (queue, decisions, history, allowlist)."""
import pytest

from . import imgs
from .conftest import passing_client_report, submit


def blocked(client):
    r = submit(client, imgs.blurry(), client_report=passing_client_report()).json()  # server blocks it
    assert r["photo_verdict"] == "block", r["quality_flags"]
    return r


def good(client, **kw):
    r = submit(client, imgs.good(seed=5), client_report=passing_client_report(), **kw).json()
    assert r["photo_verdict"] == "pass", r["quality_flags"]
    return r


def test_a_blocked_photo_enters_the_queue_and_a_clean_one_does_not(client):
    b, g = blocked(client), good(client, worker="w2")
    assert b["needs_review"] is True and "photo_blocked" in b["review_reasons"]
    assert g["needs_review"] is False
    q = client.get("/reviews/queue").json()
    assert [x["id"] for x in q] == [b["id"]]


def test_reject_needs_a_reason_approve_does_not(client):
    b = blocked(client)
    url = f"/submissions/{b['id']}/review"
    assert client.post(url, json={"reviewer": "alice", "decision": "reject", "reason": ""}).status_code == 422
    assert client.post(url, json={"reviewer": "alice", "decision": "maybe", "reason": "x"}).status_code == 422
    assert client.post(url, json={"reviewer": "a", "decision": "approve"}).status_code == 422  # name too short
    ok = client.post(url, json={"reviewer": "alice", "decision": "approve"})
    assert ok.status_code == 200 and ok.json()["review"]["decision"] == "approve" and ok.json()["review"]["reviewer"] == "alice"


def test_a_reviewed_case_leaves_the_queue_and_shows_in_the_feed_and_case_file(client):
    b = blocked(client)
    r = client.post(f"/submissions/{b['id']}/review", json={"reviewer": "alice", "decision": "reject", "reason": "blurred and no face"}).json()
    assert r["needs_review"] is False and r["review"]["reason"] == "blurred and no face" and r["review"]["at"].endswith("Z")
    assert client.get("/reviews/queue").json() == []
    feed = {x["id"]: x for x in client.get("/submissions").json()}
    assert feed[b["id"]]["review"]["decision"] == "reject"
    assert client.get(f"/submissions/{b['id']}").json()["review"]["reviewer"] == "alice"


def test_history_is_kept_and_the_latest_decision_wins(client):
    b = blocked(client)
    url = f"/submissions/{b['id']}/review"
    client.post(url, json={"reviewer": "alice", "decision": "needs_retake", "reason": "too dark to tell"})
    client.post(url, json={"reviewer": "bob", "decision": "approve"})
    hist = client.get(f"/submissions/{b['id']}/reviews").json()
    assert [(h["reviewer"], h["decision"]) for h in hist] == [("alice", "needs_retake"), ("bob", "approve")]
    assert client.get(f"/submissions/{b['id']}").json()["review"]["decision"] == "approve"


def test_unknown_submission_is_404(client):
    assert client.post("/submissions/999/review", json={"reviewer": "alice", "decision": "approve"}).status_code == 404
    assert client.get("/submissions/999/reviews").status_code == 404


def test_the_reviewer_allowlist_when_configured(client, monkeypatch):
    b = blocked(client)
    monkeypatch.setenv("REVIEWERS", "Alice, bob")
    url = f"/submissions/{b['id']}/review"
    assert client.post(url, json={"reviewer": "mallory", "decision": "approve"}).status_code == 403
    assert client.post(url, json={"reviewer": "ALICE", "decision": "approve"}).status_code == 200  # case-insensitive
