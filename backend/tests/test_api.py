import json
from datetime import datetime, timedelta

from . import imgs
from .conftest import passing_client_report, submit


def test_good_photo_is_verified_stored_and_served(client):
    r = submit(client, imgs.good(), client_report=passing_client_report())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["photo_verdict"] == "pass"
    assert body["photo_quality_pass"] is True
    assert body["has_photo"] is True and body["client_mismatch"] is False
    assert body["photo_quality"]["server"]["verdict"] == "pass"
    photo = client.get(body["photo_url"])
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg"
    assert photo.content == imgs.good()


def test_blurry_photo_is_blocked_by_the_server(client):
    body = submit(client, imgs.blurry(), client_report=passing_client_report()).json()
    assert body["photo_verdict"] == "block"
    assert body["photo_quality_pass"] is False
    assert "blur" in body["quality_flags"]


def test_spoofed_client_report_is_caught(client):
    """The device claims a clean photo and photo_quality_pass=true for a blurry one."""
    body = submit(client, imgs.blurry(), client_report=passing_client_report(), photo_quality_pass=True).json()
    assert body["photo_verdict"] == "block"
    assert body["client_mismatch"] is True
    assert "client_missed_blur" in body["quality_flags"]
    assert "client_verdict_mismatch" in body["quality_flags"]


def test_spoofed_dimensions_are_caught(client):
    body = submit(client, imgs.good(), client_report=passing_client_report(width=4000, height=3000)).json()
    assert body["client_mismatch"] is True and "client_dimensions_mismatch" in body["quality_flags"]


def test_no_photo_cannot_be_verified(client):
    body = submit(client, None, photo_quality_pass=True).json()
    assert body["photo_verdict"] == "unverified"
    assert body["photo_quality_pass"] is False  # the boolean from the device is NOT trusted
    assert body["quality_flags"] == ["photo_missing"]


def test_plain_json_body_still_accepted(client):
    r = client.post("/submissions", json={"worker_id": "w", "task_id": "t", "site_id": "s", "photo_quality_pass": True})
    assert r.status_code == 200 and r.json()["quality_flags"] == ["photo_missing"]


def test_legacy_mode_trusts_the_boolean(client, monkeypatch):
    import photo_service

    monkeypatch.setattr(photo_service, "PHOTO_REQUIRED", False)
    body = submit(client, None, photo_quality_pass=True).json()
    assert body["photo_quality_pass"] is True and body["quality_flags"] == ["photo_unverified"]
    assert body["photo_quality_score"] == 1.0


def test_submitted_anyway_is_recorded_only_for_warnings(client):
    body = submit(client, imgs.good(), client_report=passing_client_report(), override=True).json()
    assert body["photo_override"] is True and "submitted_anyway" in body["quality_flags"]


def test_duplicate_photo_from_another_worker_is_flagged(client):
    img = imgs.good(seed=3)
    submit(client, img, worker="alice", client_report=passing_client_report())
    body = submit(client, img, worker="bob", client_report=passing_client_report()).json()
    assert "duplicate_photo" in body["quality_flags"]


def test_same_worker_task_site_resend_is_a_retry_not_reuse(client):
    img = imgs.good(seed=4)
    submit(client, img, client_report=passing_client_report())
    body = submit(client, img, client_report=passing_client_report()).json()
    assert "duplicate_photo" not in body["quality_flags"]


def test_recompressed_copy_is_a_near_duplicate(client):
    submit(client, imgs.good(seed=5, quality=95), worker="alice", client_report=passing_client_report())
    body = submit(client, imgs.good(seed=5, quality=60), worker="bob", client_report=passing_client_report()).json()
    assert "near_duplicate_photo" in body["quality_flags"]


def test_exif_flags(client):
    now = datetime.now().strftime("%Y:%m:%d %H:%M:%S")
    old = (datetime.now() - timedelta(days=10)).strftime("%Y:%m:%d %H:%M:%S")
    fresh = submit(client, imgs.good(seed=6, exif=imgs.exif_bytes(now)), worker="a", client_report=passing_client_report()).json()
    assert "old_photo" not in fresh["quality_flags"] and "no_exif" not in fresh["quality_flags"]
    stale = submit(client, imgs.good(seed=7, exif=imgs.exif_bytes(old)), worker="b", client_report=passing_client_report()).json()
    assert "old_photo" in stale["quality_flags"]
    stripped = submit(client, imgs.good(seed=8), worker="c", client_report=passing_client_report()).json()
    assert "no_exif" in stripped["quality_flags"]


def test_garbage_photo_is_422(client):
    r = submit(client, b"not an image at all", client_report=passing_client_report())
    assert r.status_code == 422 and "could not be read" in r.json()["detail"]


def test_oversized_photo_is_413(client, monkeypatch):
    import main

    monkeypatch.setattr(main, "MAX_PHOTO_BYTES", 1000)
    assert submit(client, imgs.good(), client_report=passing_client_report()).status_code == 413


def test_bad_payload_is_422(client):
    r = client.post("/submissions", data={"payload": "{not json"}, files={"photo": ("p.jpg", imgs.good(), "image/jpeg")})
    assert r.status_code == 422
    assert client.post("/submissions", data={"x": "y"}, files={"photo": ("p.jpg", imgs.good(), "image/jpeg")}).status_code == 422


def test_list_is_light_and_detail_is_full(client):
    sid = submit(client, imgs.good(), client_report=passing_client_report()).json()["id"]
    listed = client.get("/submissions").json()[0]
    assert "photo_quality" not in listed and listed["photo_verdict"] == "pass" and "photo_path" not in listed
    detail = client.get(f"/submissions/{sid}").json()
    assert detail["photo_quality"]["server"]["checks"]["blur"]["status"] == "pass"
    assert "photo_path" not in detail and "photo_sha256" not in json.dumps(detail)


def test_missing_photo_404(client):
    sid = submit(client, None).json()["id"]
    assert client.get(f"/submissions/{sid}/photo").status_code == 404


def test_camera_capture_is_not_flagged_for_missing_exif_but_file_is(client):
    cam = submit(client, imgs.good(seed=21), client_report=passing_client_report(), capture_source="camera", worker="a").json()
    assert "no_exif" not in cam["quality_flags"]
    assert cam["photo_quality"]["evidence"]["capture"]["source"] == "camera"
    file = submit(client, imgs.good(seed=22), client_report=passing_client_report(), capture_source="file", worker="b").json()
    assert "no_exif" in file["quality_flags"]


def test_live_task_answered_with_a_picked_file_is_flagged(client):
    # task_selfie_checkin is a live-capture task; the face check isn't what is being tested here.
    sub = submit(client, imgs.face_photo(), task="task_selfie_checkin", capture_source="file", client_report=passing_client_report(1200, 1200)).json()
    assert "not_live_capture" in sub["quality_flags"]
    live = submit(client, imgs.face_photo(), task="task_selfie_checkin", capture_source="camera", worker="w2", client_report=passing_client_report(1200, 1200)).json()
    assert "not_live_capture" not in live["quality_flags"]


def test_burst_and_sensor_evidence_is_stored(client):
    rep = passing_client_report()
    rep["sensor"] = {"rotation_rms": 4.2, "accel_rms": 0.2, "samples": 30}
    body = submit(client, imgs.good(seed=23), client_report=rep, capture_source="camera",
                  capture_burst={"frames": 6, "picked": 3, "sharpness": [0.1, 0.2, 0.3, 0.31, 0.2, 0.1]}).json()
    ev = body["photo_quality"]
    assert ev["evidence"]["capture"]["burst"]["picked"] == 3
    assert ev["client"]["sensor"]["rotation_rms"] == 4.2


def test_reported_camera_shake_becomes_a_flag(client):
    rep = passing_client_report()
    rep["sensor"] = {"rotation_rms": 80.0, "accel_rms": 0.2, "samples": 30}
    assert "camera_shake_reported" in submit(client, imgs.good(seed=24), client_report=rep, capture_source="camera", worker="s1").json()["quality_flags"]
    rep["sensor"] = {"rotation_rms": 4.0, "accel_rms": 0.2, "samples": 30}
    assert "camera_shake_reported" not in submit(client, imgs.good(seed=25), client_report=rep, capture_source="camera", worker="s2").json()["quality_flags"]
