import re

import numpy as np

from ..config import FAIL, PASS, THRESHOLDS, WARN
from ..stats import noise_sigma, ramp
from .result import check_result

STEP_CAP = 20


def blockiness_stats(g):
    h, w = g.shape
    b_sum = b_n = i_sum = i_n = 0.0

    rows = g[::2, :]
    if w > 1:
        d = np.minimum(STEP_CAP, np.abs(np.diff(rows, axis=1)))  # columns x = 1..w-1
        xs = np.arange(1, w)
        m8 = xs % 8
        bmask = m8 == 0
        imask = (m8 != 0) & (m8 != 7) & (m8 != 1)
        b_sum += float(d[:, bmask].sum()); b_n += d.shape[0] * int(bmask.sum())
        i_sum += float(d[:, imask].sum()); i_n += d.shape[0] * int(imask.sum())
    cols = g[:, ::2]
    if h > 1:
        d = np.minimum(STEP_CAP, np.abs(np.diff(cols, axis=0)))  # rows y = 1..h-1
        ys = np.arange(1, h)
        m8 = ys % 8
        bmask = m8 == 0
        imask = (m8 != 0) & (m8 != 7) & (m8 != 1)
        b_sum += float(d[bmask, :].sum()); b_n += int(bmask.sum()) * d.shape[1]
        i_sum += float(d[imask, :].sum()); i_n += int(imask.sum()) * d.shape[1]
    if not b_n or not i_n or i_sum == 0:
        return None
    b, i = b_sum / b_n, i_sum / i_n
    return {"ratio": b / i, "excess": b - i}


def _median(values):
    s = sorted(values)
    return s[len(s) // 2] if s else None


def check_noise(frame, ctx=None):
    t = THRESHOLDS["noise"]
    patches = frame.patches
    sigma = _median([noise_sigma(p) for p in patches])
    blocks = [b for b in (blockiness_stats(p) for p in patches) if b is not None]
    ratio = _median([b["ratio"] for b in blocks])
    excess = _median([b["excess"] for b in blocks])
    block = ratio if ratio is not None and excess >= t["blockMinExcess"] else None

    pixels = frame.native_width * frame.native_height
    bpp = (frame.native_bytes * 8 / pixels) if frame.native_bytes and re.search(r"jpe?g", frame.native_mime or "", re.I) else None

    noisy = FAIL if sigma >= t["sigmaFail"] else WARN if sigma >= t["sigmaWarn"] else PASS
    blocky = PASS if block is None else FAIL if block >= t["blockFail"] else WARN if block >= t["blockWarn"] else PASS
    order = [PASS, WARN, FAIL]
    status = order[max(order.index(noisy), order.index(blocky))]
    hint = None
    if status != PASS:
        parts = []
        if noisy != PASS:
            parts.append("grainy (low light)")
        if blocky != PASS:
            parts.append("heavily compressed")
        hint = f"Photo looks {' and '.join(parts)}. Use more light and send the original, not a forwarded copy."
    score = min(ramp(sigma, t["sigmaFail"] + 5, 1), 1.0 if block is None else ramp(block, t["blockFail"] + 0.2, 1.02))
    return check_result("noise", status, score, sigma, hint,
                        {"noiseSigma": sigma, "blockiness": ratio, "blockExcess": excess, "bitsPerPixel": bpp, "patches": len(patches)})
