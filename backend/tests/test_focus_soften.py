"""Phase 8b regression: a face task must not BLOCK on the face-crop sharpness alone when the whole photo is in focus.
KEEP IN SYNC with client/src/lib/photoQuality/softenCropBlur.test.js."""
from photo_quality.config import FAIL, PASS, WARN
from photo_quality.face import soften_crop_blur


def face(reasons, status=FAIL):
    return {"id": "face", "status": status, "hint": "x", "details": {"reasons": reasons}}


CROP_ONLY = [{"metric": "cropBlur", "status": FAIL, "value": 0.09, "limit": 0.1}]


def test_crop_blur_alone_becomes_a_warning_when_the_photo_is_in_focus():
    out = soften_crop_blur(face(CROP_ONLY), {"status": PASS})
    assert out["status"] == WARN and out["details"]["softened"] == "crop_blur_only"
    assert out["details"]["reasons"][0]["status"] == WARN
    assert "submit" in out["hint"]


def test_warn_on_the_whole_photo_is_still_softened_but_a_whole_photo_fail_is_not():
    f = face(CROP_ONLY)
    assert soften_crop_blur(f, {"status": WARN})["status"] == WARN
    assert soften_crop_blur(f, {"status": FAIL}) is f
    assert soften_crop_blur(f, None) is f


def test_another_failing_reason_keeps_the_block():
    f = face(CROP_ONLY + [{"metric": "visible", "status": FAIL, "value": 0.5, "limit": 0.75}])
    assert soften_crop_blur(f, {"status": PASS}) is f


def test_a_real_soft_face_on_an_in_focus_photo_does_not_block_end_to_end():
    """A real face (NASA astronaut portrait) with ONLY the face region softened: used to be blocked ('Your face is blurry')."""
    import io

    import numpy as np
    import pytest

    pytest.importorskip("mediapipe")
    from PIL import Image, ImageFilter

    from photo_quality import analyze_image
    from photo_quality.config import task_config
    from photo_quality.face import detect_faces

    from . import imgs

    selfie = task_config("task_selfie_checkin")
    base = Image.open(io.BytesIO(imgs.face_photo(1200)))
    box = detect_faces(np.asarray(base))[0]["box"]
    W, H = base.size
    mx, my = 0.25 * box["w"], 0.25 * box["h"]
    region = (int((box["x"] - mx) * W), int((box["y"] - my) * H), int((box["x"] + box["w"] + mx) * W), int((box["y"] + box["h"] + my) * H))
    soft = base.copy()
    soft.paste(base.crop(region).filter(ImageFilter.GaussianBlur(10)), region[:2])
    buf = io.BytesIO()
    soft.save(buf, "JPEG", quality=95)
    r = analyze_image(buf.getvalue(), "image/jpeg", selfie)
    assert r["checks"]["blur"]["status"] != FAIL, r["checks"]["blur"]
    assert r["checks"]["face"]["status"] == WARN, r["checks"]["face"]["details"]
    assert r["checks"]["face"]["details"].get("softened") == "crop_blur_only"
    assert r["verdict"] != "block", r["issues"]
