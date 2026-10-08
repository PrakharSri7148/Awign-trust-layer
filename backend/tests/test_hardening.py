"""Phase 8f: optional dashboard token, per-worker rate limit, retention purge, graceful face-detector loss."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session, select

import db
import hardening
from models import Submission

from . import imgs
from .conftest import passing_client_report, submit


@pytest.fixture(autouse=True)
def _clean():
    hardening.reset_rate_limits()
    yield
    hardening.reset_rate_limits()


def one(client):
    r = submit(client, imgs.good(seed=9), client_report=passing_client_report()).json()
    return r["id"]


def test_everything_is_open_when_no_token_is_configured(client):
    i = one(client)
    assert client.get("/submissions").status_code == 200 and client.get(f"/submissions/{i}/photo").status_code == 200


def test_with_a_token_the_dashboard_endpoints_need_it_but_workers_do_not(client, monkeypatch):
    i = one(client)
    monkeypatch.setenv("DASHBOARD_TOKEN", "s3cret")
    for path in ("/submissions", f"/submissions/{i}", f"/submissions/{i}/photo", "/reviews/queue", f"/submissions/{i}/reviews"):
        assert client.get(path).status_code == 401, path
    assert client.post(f"/submissions/{i}/review", json={"reviewer": "alice", "decision": "approve"}).status_code == 401
    assert client.post("/sites/s1/reset-fingerprint").status_code == 401
    assert client.get("/submissions", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/submissions", headers={"Authorization": "Bearer s3cret"}).status_code == 200
    assert client.get("/submissions", headers={"X-Dashboard-Token": "s3cret"}).status_code == 200
    assert client.get(f"/submissions/{i}/photo?token=s3cret").status_code == 200  # an <img> cannot send headers
    # the worker side never needs the token
    assert client.get("/health").status_code == 200
    assert submit(client, imgs.good(seed=10), client_report=passing_client_report(), worker="w2").status_code == 200
    assert client.post("/liveness/challenge", json={"worker_id": "w1", "task_id": "task_selfie_checkin"}).status_code == 200


def test_submissions_are_rate_limited_per_worker(client, monkeypatch):
    monkeypatch.setenv("SUBMISSION_RATE_PER_HOUR", "2")
    codes = [submit(client, imgs.good(seed=20 + k), client_report=passing_client_report(), worker="w_rl").status_code for k in range(3)]
    assert codes == [200, 200, 429]
    assert submit(client, imgs.good(seed=30), client_report=passing_client_report(), worker="someone_else").status_code == 200
    monkeypatch.setenv("SUBMISSION_RATE_PER_HOUR", "0")  # unlimited
    assert submit(client, imgs.good(seed=31), client_report=passing_client_report(), worker="w_rl").status_code == 200


def test_the_window_slides():
    hardening.reset_rate_limits()
    import os
    os.environ["SUBMISSION_RATE_PER_HOUR"] = "1"
    try:
        hardening.check_submission_rate("w", now=1000.0)
        with pytest.raises(Exception):
            hardening.check_submission_rate("w", now=1100.0)
        hardening.check_submission_rate("w", now=1000.0 + 3601)  # an hour later: allowed again
    finally:
        os.environ.pop("SUBMISSION_RATE_PER_HOUR")


def test_purge_deletes_old_photos_keeps_verdicts_and_timelines_go(client, tmp_path):
    from pathlib import Path

    from tools import purge_photos

    old_id, new_id = one(client), submit(client, imgs.good(seed=11), client_report=passing_client_report(), worker="w2").json()["id"]
    with Session(db.engine) as s:
        old = s.get(Submission, old_id)
        old.timestamp = datetime.now(timezone.utc) - timedelta(days=40)
        rep = json.loads(old.photo_report)
        rep.setdefault("evidence", {})["liveness"] = {"validation": {"status": "pass"}, "evidence": {"timeline": [[0, 0, 0, 0, 0, 1]], "nonce": "n"}}
        old.photo_report = json.dumps(rep)
        s.add(old); s.commit()
        old_path, verdict = Path(old.photo_path), old.photo_verdict
        assert old_path.is_file()
        dry = purge_photos.purge(s, 30, apply=False)
        assert dry["files"] == 1 and dry["applied"] is False and old_path.is_file()
        done = purge_photos.purge(s, 30, apply=True)
        assert done["files"] == 1 and not old_path.exists()
        s.refresh(old)
        assert old.photo_path is None and old.photo_verdict == verdict and old.quality_flags
        live = json.loads(old.photo_report)["evidence"]["liveness"]
        assert "evidence" not in live and live["purged"] is True and live["validation"]["status"] == "pass"
        assert s.get(Submission, new_id).photo_path is not None  # the recent one is untouched


def test_purge_keeps_a_file_that_a_recent_submission_still_uses(client):
    from pathlib import Path

    from tools import purge_photos

    photo = imgs.good(seed=12)
    a = submit(client, photo, client_report=passing_client_report()).json()["id"]
    b = submit(client, photo, client_report=passing_client_report(), worker="w2").json()["id"]  # same bytes, stored once
    with Session(db.engine) as s:
        sa = s.get(Submission, a); sa.timestamp = datetime.now(timezone.utc) - timedelta(days=90); s.add(sa); s.commit()
        path = Path(sa.photo_path)
        r = purge_photos.purge(s, 30, apply=True)
        assert r["files"] == 0 and path.is_file()


def test_no_retention_period_means_nothing_is_purged(monkeypatch, capsys):
    from tools import purge_photos

    monkeypatch.delenv("PHOTO_RETENTION_DAYS", raising=False)
    assert purge_photos.main([]) == 0
    assert "nothing purged" in capsys.readouterr().out


def test_a_missing_face_detector_degrades_to_unchecked_flags_never_a_crash(client, monkeypatch):
    from photo_quality import face as face_mod

    def boom():
        raise face_mod.FaceDetectorUnavailable("mediapipe is not installed")

    monkeypatch.setattr(face_mod, "_get_detector", boom)
    ev = {"status": "passed", "nonce": "x", "challenges": ["blink", "smile"], "results": [], "timeline": []}
    r = submit(client, imgs.face_photo(), task="task_selfie_checkin", capture_source="camera", liveness_evidence=ev, client_report=passing_client_report(1200, 1200))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "face_unchecked" in body["quality_flags"], body["quality_flags"]
    assert any(f.startswith("liveness") for f in body["quality_flags"])  # forged / unverified: the live check cannot be trusted either
    assert body["photo_quality"]["server"]["checks"]["face"]["details"]["unchecked"] is True
