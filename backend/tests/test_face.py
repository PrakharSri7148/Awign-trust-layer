import pytest

pytest.importorskip("mediapipe")

from photo_quality import analyze_image  # noqa: E402
from photo_quality import face as face_mod  # noqa: E402
from photo_quality.config import task_config  # noqa: E402

from . import imgs  # noqa: E402
from .conftest import passing_client_report, submit  # noqa: E402

SELFIE = task_config("task_selfie_checkin")


def test_task_config_is_shared_with_the_client():
    assert SELFIE == {"face": "required", "camera": "user", "label": "Selfie check-in", "live": True}
    assert task_config("task_demo_1")["face"] == "off"
    assert task_config("who-knows") == {"face": "off", "camera": "environment"}


def test_real_face_passes_and_matches_the_browser_detector():
    r = analyze_image(imgs.face_photo(), "image/jpeg", SELFIE)
    f = r["checks"]["face"]
    assert r["verdict"] == "pass", r["issues"]
    assert f["status"] == "pass"
    # Same BlazeFace model as the browser: confidence 0.92 and face height 0.19 there.
    assert f["details"]["score"] == pytest.approx(0.92, abs=0.05)
    assert f["details"]["heightFrac"] == pytest.approx(0.19, abs=0.02)


def test_no_face_blocks_a_selfie_task_but_not_a_shelf_task():
    r = analyze_image(imgs.good(), "image/jpeg", SELFIE)
    assert r["verdict"] == "block" and r["checks"]["face"]["status"] == "fail"
    shelf = analyze_image(imgs.good(), "image/jpeg", task_config("task_demo_1"))
    assert "face" not in shelf["checks"] and shelf["verdict"] == "pass"


def test_optional_face_never_blocks():
    r = analyze_image(imgs.good(), "image/jpeg", task_config("task_worker_at_site"))
    assert r["checks"]["face"]["status"] == "fail" and r["verdict"] != "block"


def test_detector_unavailable_is_a_warning_not_a_failure(monkeypatch):
    def boom():
        raise face_mod.FaceDetectorUnavailable("mediapipe is not installed")

    monkeypatch.setattr(face_mod, "_get_detector", boom)
    r = analyze_image(imgs.face_photo(), "image/jpeg", SELFIE)
    f = r["checks"]["face"]
    assert f["status"] == "warn" and f["details"]["unchecked"] is True
    assert r["verdict"] == "warn"


def test_face_geometry_matches_the_client_rules():
    import numpy as np

    gray = np.full((640, 960), 128, dtype=np.float32)

    def f(**kw):
        h = kw.get("h", 0.35)
        return {"box": {"x": kw.get("x", 0.4), "y": 0.28, "w": 0.2, "h": h}, "score": kw.get("score", 0.92),
                "keypoints": [{"x": 0.46, "y": 0.4}, {"x": 0.54, "y": 0.4}, {"x": 0.5 + kw.get("yaw", 0), "y": 0.47}]}

    assert face_mod.evaluate_face([], gray)["status"] == "fail"
    assert face_mod.evaluate_face([f(score=0.4)], gray)["status"] == "fail"
    assert face_mod.evaluate_face([f(score=0.6)], gray)["status"] == "warn"
    assert face_mod.evaluate_face([f(h=0.05)], gray)["status"] == "fail"
    assert face_mod.evaluate_face([f(x=-0.1)], gray)["status"] == "fail"  # half outside the frame
    assert face_mod.evaluate_face([f(yaw=0.2)], gray)["status"] == "fail"  # |yaw| = 0.2*960/(0.08*960) = 2.5 eye-widths
    two = face_mod.evaluate_face([f(), f(x=0.7)], gray)
    assert two["status"] == "warn" and "More than one" in two["hint"]


def test_api_selfie_task_with_a_real_face_passes_the_face_check_but_a_picked_file_is_not_live(client):
    body = submit(client, imgs.face_photo(), task="task_selfie_checkin", client_report=passing_client_report(1200, 1200)).json()
    assert body["photo_quality"]["server"]["checks"]["face"]["status"] == "pass"
    # Phase 7: a selfie is only "verified" with a live challenge (see tests/test_liveness_server.py for the full pass);
    # a picked file has none, so it is accepted for review, not passed.
    assert body["photo_verdict"] == "warn" and "liveness_unverified" in body["quality_flags"]


def test_api_client_claiming_a_face_where_there_is_none_is_caught(client):
    rep = passing_client_report()
    rep["checks"]["face"] = {"status": "pass", "score": 1, "value": 0.4}
    body = submit(client, imgs.good(), task="task_selfie_checkin", client_report=rep).json()
    assert body["photo_verdict"] == "block" and body["photo_quality_pass"] is False
    assert "face" in body["quality_flags"] and "client_missed_face" in body["quality_flags"]
    assert body["client_mismatch"] is True


def test_api_unchecked_face_is_flagged_for_review(client, monkeypatch):
    def boom():
        raise face_mod.FaceDetectorUnavailable("no mediapipe")

    monkeypatch.setattr(face_mod, "_get_detector", boom)
    body = submit(client, imgs.face_photo(), task="task_selfie_checkin", client_report=passing_client_report(1200, 1200)).json()
    assert "face_unchecked" in body["quality_flags"] and body["photo_verdict"] == "warn"
