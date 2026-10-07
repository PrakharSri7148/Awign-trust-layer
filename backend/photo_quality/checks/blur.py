from ..config import FAIL, PASS, THRESHOLDS, WARN
from ..stats import box3, noise_sigma, percentile, ramp, sobel, tiles
from .result import check_result

NOISE_GRAD = 0.94  # p98 of Sobel/4 on 3x3-smoothed white noise, per unit sigma


def blur_metrics(gray, cfg=None):
    cfg = cfg or THRESHOLDS["blur"]
    h, w = gray.shape
    sigma = noise_sigma(gray, 2)
    sm = box3(gray)
    grad = sobel(sm)
    scores = []
    textured = 0
    for _tx, _ty, x0, x1, y0, y1 in tiles(w, h, cfg["grid"], cfg["grid"]):
        px = sm[y0:y1, x0:x1].ravel()
        rng = percentile(px, 0.95) - percentile(px, 0.05)
        if rng < cfg["minTileRange"]:
            continue
        textured += 1
        peak = percentile(grad[y0:y1, x0:x1].ravel(), 0.98)
        scores.append(max(0.0, peak - NOISE_GRAD * sigma) / rng)
    score = percentile(scores, 0.66) if len(scores) >= cfg["minTexturedTiles"] else None
    return {"score": score, "texturedTiles": textured, "sigma": sigma, "tileScores": scores}


def check_blur(frame, ctx=None):
    cfg = THRESHOLDS["blur"]
    m = blur_metrics(frame.gray, cfg)
    if m["score"] is None:
        return check_result(
            "blur", WARN, 0.6, None,
            "Not enough detail to judge focus. Make sure the subject is in frame.",
            {"reason": "low_texture", "texturedTiles": m["texturedTiles"], "noiseSigma": m["sigma"]},
        )
    s = m["score"]
    status = FAIL if s < cfg["failBelow"] else WARN if s < cfg["warnBelow"] else PASS
    hint = {
        FAIL: "Photo is out of focus. Tap the subject to focus and hold steady.",
        WARN: "Photo is slightly soft. Hold steady for a crisper shot.",
        PASS: None,
    }[status]
    return check_result("blur", status, ramp(s, 0.05, 0.25), s, hint,
                        {"texturedTiles": m["texturedTiles"], "noiseSigma": m["sigma"], "tileScores": m["tileScores"]})
