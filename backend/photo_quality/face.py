"""Face check: a port of client/src/lib/photoQuality/face/facecheck.js.

Detection uses MediaPipe's BlazeFace short-range model, the SAME model the browser
runs, so results agree. mediapipe is an optional dependency (requirements-face.txt):
without it, face tasks are flagged "unchecked" rather than failing.
"""
import math
import os
import threading
from pathlib import Path

import numpy as np

from .checks.blur import blur_metrics
from .checks.exposure import exposure_metrics
from .checks.result import check_result
from .config import FAIL, PASS, SKIP, THRESHOLDS, WARN
from .stats import ramp

_DEFAULT_MODEL = Path(__file__).resolve().parents[2] / "client" / "public" / "mediapipe" / "blaze_face_short_range.tflite"
MODEL_PATH = Path(os.environ.get("FACE_MODEL_PATH", _DEFAULT_MODEL))
_RANK = {PASS: 0, WARN: 1, FAIL: 2}


class FaceDetectorUnavailable(RuntimeError):
    pass


_lock = threading.Lock()
_detector = None


def _get_detector():
    global _detector
    with _lock:
        if _detector is None:
            try:
                from mediapipe.tasks import python as mpp
                from mediapipe.tasks.python import vision
            except ImportError as exc:
                raise FaceDetectorUnavailable("mediapipe is not installed") from exc
            if not MODEL_PATH.is_file():
                raise FaceDetectorUnavailable(f"face model not found at {MODEL_PATH}")
            _detector = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
                base_options=mpp.BaseOptions(model_asset_path=str(MODEL_PATH)),
                running_mode=vision.RunningMode.IMAGE,
                min_detection_confidence=THRESHOLDS["face"]["minDetectionConfidence"]))
        return _detector


def detect_faces(rgb: np.ndarray) -> list[dict]:
    """rgb (h, w, 3) uint8 -> detections normalised to the image, like the browser's."""
    import mediapipe as mp

    det = _get_detector()
    h, w = rgb.shape[:2]
    with _lock:  # the underlying graph is not re-entrant
        res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    out = []
    for d in res.detections:
        bb = d.bounding_box
        out.append({"box": {"x": bb.origin_x / w, "y": bb.origin_y / h, "w": bb.width / w, "h": bb.height / h},
                    "score": d.categories[0].score if d.categories else 0.0,
                    "keypoints": [{"x": k.x, "y": k.y} for k in d.keypoints]})
    return out


def _area(b):
    return max(0, b["w"]) * max(0, b["h"])


def _visible_fraction(b):
    w = min(1, b["x"] + b["w"]) - max(0, b["x"])
    h = min(1, b["y"] + b["h"]) - max(0, b["y"])
    return max(0, w) * max(0, h) / _area(b) if _area(b) else 0.0


def _crop(gray, b, pad, min_side):
    h, w = gray.shape
    x0 = max(0, math.floor((b["x"] - pad * b["w"]) * w))
    y0 = max(0, math.floor((b["y"] - pad * b["h"]) * h))
    x1 = min(w, math.ceil((b["x"] + b["w"] * (1 + pad)) * w))
    y1 = min(h, math.ceil((b["y"] + b["h"] * (1 + pad)) * h))
    if x1 - x0 <= 0 or y1 - y0 <= 0 or min(x1 - x0, y1 - y0) < min_side:
        return None
    return gray[y0:y1, x0:x1]


def evaluate_face(faces, gray, cfg=None):
    cfg = cfg or THRESHOLDS["face"]
    if not faces:
        return check_result("face", FAIL, 0, 0,
                            "No face found. Move closer, face the camera with your whole face in frame, and use good light.",
                            {"count": 0})
    H, W = gray.shape
    srt = sorted(faces, key=lambda f: (-f["score"], -_area(f["box"])))
    main = srt[0]
    b = main["box"]
    problems = []  # (kind, status, hint)

    if main["score"] < cfg["minScoreFail"]:
        problems.append(("score", FAIL, "No clear face found. Remove anything covering your face, improve the light and face the camera."))
    elif main["score"] < cfg["minScoreWarn"]:
        problems.append(("score", WARN, "Your face is only partly clear. Improve the light and face the camera."))

    visible = _visible_fraction(b)
    kp = main.get("keypoints") or []
    eye_r, eye_l, nose = (kp + [None] * 3)[:3]

    def inside(p):
        m = cfg["edgeMargin"]
        return p is not None and m <= p["x"] <= 1 - m and m <= p["y"] <= 1 - m

    eyes_inside = inside(eye_r) and inside(eye_l)
    if visible < cfg["visibleFail"] or (len(kp) >= 2 and not eyes_inside):
        problems.append(("cut", FAIL, "Your face is cut off by the edge of the photo. Move back or re-centre so the whole face is in frame."))
    elif visible < cfg["visibleWarn"]:
        problems.append(("cut", WARN, "Part of your face touches the edge of the photo. Re-centre yourself."))

    if b["h"] < cfg["minHeightFail"]:
        problems.append(("size", FAIL, "Your face is too small in the photo. Move closer to the camera."))
    elif b["h"] < cfg["minHeightWarn"]:
        problems.append(("size", WARN, "Your face is quite small in the photo. Move a little closer."))

    reliable = main["score"] >= cfg["minScoreFail"]
    yaw = roll = None
    if reliable and eye_r and eye_l and nose:
        dx = (eye_l["x"] - eye_r["x"]) * W
        dy = (eye_l["y"] - eye_r["y"]) * H
        eye_dist = math.hypot(dx, dy)
        if eye_dist > 0:
            yaw = (nose["x"] - (eye_r["x"] + eye_l["x"]) / 2) * W / eye_dist
            roll = math.degrees(math.atan2(dy, dx))
    if yaw is not None and abs(yaw) >= cfg["yawFail"]:
        problems.append(("pose", FAIL, "You are looking away from the camera. Face the camera directly."))
    elif yaw is not None and abs(yaw) >= cfg["yawWarn"]:
        problems.append(("pose", WARN, "Your head is turned. Face the camera directly."))
    if roll is not None and abs(roll) >= cfg["rollWarn"]:
        problems.append(("pose", WARN, "Your head is tilted. Hold the phone level."))

    crop = _crop(gray, b, cfg["cropPad"], cfg["cropMinSide"]) if reliable else None
    inner = _crop(gray, b, -cfg["innerShrink"], cfg["cropMinSide"]) if reliable else None
    crop_info = None
    if crop is not None:
        blur = blur_metrics(crop, {"grid": 1, "minTileRange": 12, "minTexturedTiles": 1})["score"]
        exp = exposure_metrics(inner if inner is not None else crop)
        crop_info = {"blur": blur, "mean": exp["mean"], "clippedFrac": exp["clippedFrac"]}
        if blur is not None and blur < cfg["cropBlurFail"]:
            problems.append(("quality", FAIL, "Your face is blurry. Hold steady and let the camera focus on your face."))
        elif blur is not None and blur < cfg["cropBlurWarn"]:
            problems.append(("quality", WARN, "Your face is a little soft. Hold steady."))
        if exp["mean"] < cfg["cropDarkMeanFail"]:
            problems.append(("quality", FAIL, "Your face is in shadow. Face the light."))
        elif exp["mean"] < cfg["cropDarkMeanWarn"]:
            problems.append(("quality", WARN, "Your face is a bit dark. Face the light."))
        if exp["clippedFrac"] > cfg["cropClippedWarn"]:
            problems.append(("quality", WARN, "Your face is washed out by bright light. Move out of direct glare."))

    if eye_r and eye_l and crop is not None:
        r = max(2, round(cfg["eyePatch"] * math.hypot((eye_l["x"] - eye_r["x"]) * W, (eye_l["y"] - eye_r["y"]) * H)))

        def patch_mean(k):
            cx, cy = round(k["x"] * W), round(k["y"] * H)
            p = gray[max(0, cy - r): min(H - 1, cy + r) + 1, max(0, cx - r): min(W - 1, cx + r) + 1]
            return float(p.mean()) if p.size else crop_info["mean"]

        eye_mean = (patch_mean(eye_r) + patch_mean(eye_l)) / 2
        crop_info["eyeRatio"] = eye_mean / crop_info["mean"] if crop_info["mean"] > 0 else 1
        if crop_info["eyeRatio"] < cfg["eyeDarkRatio"]:
            problems.append(("eyes", WARN, "Your eyes look covered. Take off sunglasses or anything hiding your eyes."))

    others = [f for f in srt[1:] if f["score"] >= cfg["minScoreFail"] and _area(f["box"]) >= cfg["multiRatio"] * _area(b)]
    if others:
        problems.append(("multi", WARN, "More than one face is in the photo. Make sure only you are in frame."))

    order = ["cut", "size", "pose", "eyes", "quality", "score", "multi"]
    problems.sort(key=lambda p: order.index(p[0]))
    status = PASS
    for _k, s, _h in problems:
        if _RANK[s] > _RANK[status]:
            status = s
    first = next((p for p in problems if p[1] == status), None)
    score = min(ramp(main["score"], cfg["minScoreFail"] - 0.2, cfg["minScoreWarn"] + 0.2),
                ramp(b["h"], cfg["minHeightFail"] * 0.5, cfg["minHeightWarn"] + 0.1),
                ramp(visible, cfg["visibleFail"] - 0.2, 1),
                1.0 if yaw is None else ramp(abs(yaw), cfg["yawFail"] + 0.3, 0.1))
    return check_result("face", status, score, b["h"], first[2] if first else None, {
        "count": len(faces), "score": main["score"], "heightFrac": b["h"], "visibleFrac": visible, "eyesInside": eyes_inside,
        "yaw": yaw, "roll": roll, "crop": crop_info, "box": dict(b),
        "problems": [f"{s}: {h}" for _k, s, h in problems]})


def _unchecked(reason):
    return check_result("face", WARN, 0.5, None, "Couldn't check your face on this device. The photo will be reviewed.",
                        {"unchecked": True, "reason": reason})


def check_face(frame, task):
    if not task or task.get("face", "off") == "off":
        return check_result("face", SKIP, details={"reason": "task_does_not_need_a_face"})
    try:
        faces = detect_faces(np.ascontiguousarray(frame.rgba[..., :3]))
    except FaceDetectorUnavailable as exc:
        return _unchecked(str(exc))
    except Exception as exc:  # a detector crash must not fail the submission
        return _unchecked(f"detector error: {exc}")
    return evaluate_face(faces, frame.gray)


def warm_up():
    """Load the detector now (called in a background thread at startup) so the first
    face submission doesn't pay the import + model-load cost. Never raises."""
    try:
        _get_detector()
        return True
    except Exception:
        return False
