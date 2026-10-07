import numpy as np

from ..config import FAIL, PASS, THRESHOLDS, WARN
from ..stats import ramp
from .result import check_result


def _step_energy(g, step):
    sub = g[::2]
    if sub.shape[1] <= step:
        return 0.0
    return float(np.abs(sub[:, step:] - sub[:, :-step]).mean())


def smoothness_ratio(patches):
    ratios = []
    for g in patches:
        e1 = _step_energy(g, 1)
        if e1 < 0.8:
            continue
        ratios.append(_step_energy(g, 2) / e1)
    return sum(ratios) / len(ratios) if ratios else None


def check_resolution(frame, ctx=None):
    t = THRESHOLDS["resolution"]
    w, h = frame.native_width, frame.native_height
    short, long_ = min(w, h), max(w, h)
    mp = w * h / 1e6
    ratio = smoothness_ratio(frame.patches)
    status, hint = PASS, None
    if short < t["failShortSide"] or long_ < t["failLongSide"]:
        status, hint = FAIL, f"Photo is too small ({w}×{h}). Use the camera at full resolution."
    elif mp < t["warnMegapixels"]:
        status, hint = WARN, f"Low resolution ({w}×{h}). Use the camera at full resolution."
    return check_result("resolution", status, ramp(mp, 0.3, 2), mp, hint,
                        {"width": w, "height": h, "megapixels": mp, "smoothnessRatio": ratio})
