import numpy as np
from scipy import ndimage

from ..config import FAIL, PASS, SKIP, THRESHOLDS, WARN
from ..stats import box3, percentile, ramp
from .result import check_result

AXIS = {0: "horizontal", 2: "vertical"}


def resize_gray(gray, max_side):
    """Area-average downscale with the same block boundaries as the JS resizeGray."""
    h, w = gray.shape
    scale = min(1.0, max_side / max(w, h))
    if scale == 1.0:
        return gray
    nw, nh = max(1, int(np.floor(w * scale + 0.5))), max(1, int(np.floor(h * scale + 0.5)))
    y0 = (np.arange(nh) * h) // nh
    y1 = np.maximum(y0 + 1, ((np.arange(nh) + 1) * h) // nh)
    x0 = (np.arange(nw) * w) // nw
    x1 = np.maximum(x0 + 1, ((np.arange(nw) + 1) * w) // nw)
    s = np.zeros((h + 1, w + 1), dtype=np.float64)
    s[1:, 1:] = gray.astype(np.float64).cumsum(0).cumsum(1)
    block = s[np.ix_(y1, x1)] - s[np.ix_(y0, x1)] - s[np.ix_(y1, x0)] + s[np.ix_(y0, x0)]
    area = (y1 - y0)[:, None] * (x1 - x0)[None, :]
    return (block / area).astype(np.float32)


def shake_metrics(gray, cfg=None):
    cfg = cfg or THRESHOLDS["shake"]
    g = resize_gray(gray, cfg["maxSide"])
    h, w = g.shape
    sm = box3(g)
    gx = np.zeros((h, w), dtype=np.float32)
    gy = np.zeros((h, w), dtype=np.float32)
    c = sm
    gx[1:-1, 1:-1] = ((c[:-2, 2:] + 2 * c[1:-1, 2:] + c[2:, 2:]) - (c[:-2, :-2] + 2 * c[1:-1, :-2] + c[2:, :-2])) / 4
    gy[1:-1, 1:-1] = ((c[2:, :-2] + 2 * c[2:, 1:-1] + c[2:, 2:]) - (c[:-2, :-2] + 2 * c[:-2, 1:-1] + c[:-2, 2:])) / 4
    mag = np.hypot(gx, gy)
    rng = ndimage.maximum_filter(sm, size=7, mode="nearest") - ndimage.minimum_filter(sm, size=7, mode="nearest")
    thr = max(percentile(mag, 0.93), 1.0)
    sel = (mag >= thr) & (rng >= cfg["minLocalRange"])
    th = np.arctan2(gy[sel], gx[sel])
    th = np.where(th < 0, th + np.pi, th)
    b = np.round(th / (np.pi / 4)).astype(int) % 4
    sharp = mag[sel] / rng[sel]
    bins = [sharp[b == i] for i in range(4)]
    min_count = cfg["minBinFrac"] * w * h
    usable = [(i, len(a), percentile(a, 0.75)) for i, a in enumerate(bins) if len(a) >= min_count]
    counts = [len(a) for a in bins]
    if len(usable) < 2:
        return {"aniso": None, "usable": len(usable), "bins": counts}
    sharpest = max(usable, key=lambda u: u[2])
    softest = min(usable, key=lambda u: u[2])
    clear = softest[0] in AXIS and sharpest[0] == (softest[0] + 2) % 4
    return {"aniso": sharpest[2] / softest[2], "direction": AXIS[softest[0]] if clear else None,
            "usable": len(usable), "bins": counts}


def check_shake(frame, ctx=None):
    t = THRESHOLDS["shake"]
    m = shake_metrics(frame.gray)
    if m["aniso"] is None:
        return check_result("shake", SKIP, details={"reason": "not_enough_edges", **m})
    a = m["aniso"]
    status = FAIL if a >= t["failAniso"] else WARN if a >= t["warnAniso"] else PASS
    direction = f" ({m['direction']} blur)" if m.get("direction") else ""
    hint = None if status == PASS else f"Camera moved while shooting{direction}. Hold the phone with both hands, brace your elbows and tap."
    return check_result("shake", status, ramp(a, t["failAniso"] + 0.3, 1.1), a, hint, m)
