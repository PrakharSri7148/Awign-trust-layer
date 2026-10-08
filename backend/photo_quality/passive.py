"""Passive screen / print detection: the Python twin of client/src/lib/photoQuality/passive/{moire,bezel,passive}.js.

The server recomputes these on the UPLOADED photo (the device's word is never trusted). Same thresholds file, same
algorithm step for step; tests/test_passive.py pins agreement with the JS implementation on shared inputs.
Banding (needs several frames) and planarity (needs landmarks over time) are client-only evidence.
"""
import math

import numpy as np

from .config import THRESHOLDS
from .stats import ramp

_NEIGH = [(4, 0), (-4, 0), (0, 4), (0, -4), (3, 3), (3, -3), (-3, 3), (-3, -3)]


def _floor_pow2(n):
    return 2 ** int(math.floor(math.log2(max(1, n))))


def moire_metrics(gray, cfg=None):
    cfg = cfg or THRESHOLDS["passive"]["moire"]
    h, w = gray.shape
    n = min(cfg["size"], _floor_pow2(min(w, h)))
    if n < 64:
        return {"score": None, "peaks": 0, "n": 0, "reason": "patch too small"}
    x0, y0 = (w - n) // 2, (h - n) // 2
    patch = gray[y0:y0 + n, x0:x0 + n].astype(np.float64)
    patch = patch - patch.mean()
    hann = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / (n - 1))
    M = np.abs(np.fft.fft2(patch * np.outer(hann, hann)))

    ky, kx = np.mgrid[0:n // 2 + 1, 0:n]
    fy = ky.astype(np.float64)
    fx = np.where(kx <= n / 2, kx, kx - n).astype(np.float64)
    r = np.hypot(fx, fy)
    g8, g16 = n / 8, n / 16

    def near_multiple(v, g):
        m = np.abs(v) % g
        return np.minimum(m, g - m) <= 1

    keep = (r >= n * cfg["bandLo"]) & (r <= n * cfg["bandHi"])
    keep &= ~((fy == 0) & (fx <= 0))
    keep &= (np.abs(fx) >= cfg["axisExclude"]) & (np.abs(fy) >= cfg["axisExclude"])
    keep &= ~((near_multiple(fx, g8) & near_multiple(fy, g8)) | (near_multiple(fx, g16) & near_multiple(fy, g16)))
    if not keep.any():
        return {"score": None, "peaks": 0, "n": n, "reason": "empty band"}

    vals = M[ky, kx][keep]
    band_median = float(np.median(vals))
    cy, cx = fy[keep].astype(int), fx[keep].astype(int)
    nb = np.full(vals.shape, band_median)
    for dx, dy in _NEIGH:
        nb = np.maximum(nb, M[(cy + dy) % n, (cx + dx) % n])
    ratio = vals / np.where(nb > 0, nb, 1e-12)
    best = int(np.argmax(ratio))
    at = (int(cx[best]), int(cy[best]))
    return {"score": float(ratio[best]), "peaks": int((ratio >= cfg["peakAt"]).sum()), "n": n, "at": at,
            "periodPx": n / math.hypot(*at)}


def _downscale(gray, max_side):
    h, w = gray.shape
    f = max(1, math.ceil(max(w, h) / max_side))
    if f == 1:
        return gray.astype(np.float64)
    nh, nw = h // f, w // f
    return gray[:nh * f, :nw * f].astype(np.float64).reshape(nh, f, nw, f).mean(axis=(1, 3))


def _smooth3(a):
    p = np.concatenate([a[:1], a, a[-1:]])
    return (p[:-2] + p[1:-1] + p[2:]) / 3


def _pick(cov, lo, hi, thr, from_start):
    idx = [i for i in range(max(2, lo), min(len(cov) - 3, hi) + 1)
           if cov[i] >= thr and cov[i] >= cov[i - 1] and cov[i] >= cov[i + 1] and cov[i] >= cov[i - 2] and cov[i] >= cov[i + 2]]
    if not idx:
        return None
    return idx[0] if from_start else idx[-1]


def bezel_metrics(gray, face_box=None, cfg=None):
    cfg = cfg or THRESHOLDS["passive"]["bezel"]
    g = _downscale(gray, cfg["maxSide"])
    h, w = g.shape
    if w < 40 or h < 40:
        return {"score": 0.0, "sides": 0, "consistent": 0, "found": False}
    T = cfg["edgeStep"]
    x0, x1 = int(math.floor(w * (1 - cfg["span"]) / 2)), int(math.ceil(w * (1 + cfg["span"]) / 2))
    y0, y1 = int(math.floor(h * (1 - cfg["span"]) / 2)), int(math.ceil(h * (1 + cfg["span"]) / 2))
    row_cov = np.zeros(h)
    col_cov = np.zeros(w)
    row_cov[1:-1] = (np.abs(g[2:, x0:x1] - g[:-2, x0:x1]) >= T).sum(axis=1) / (x1 - x0)
    col_cov[1:-1] = (np.abs(g[y0:y1, 2:] - g[y0:y1, :-2]) >= T).sum(axis=0) / (y1 - y0)
    rc, cc = _smooth3(row_cov), _smooth3(col_cov)
    ins = cfg["inset"]
    top = _pick(rc, int(math.floor(h * ins)), int(math.floor(h * 0.45)), cfg["coverage"], True)
    bottom = _pick(rc, int(math.ceil(h * 0.55)), int(math.ceil(h * (1 - ins))), cfg["coverage"], False)
    left = _pick(cc, int(math.floor(w * ins)), int(math.floor(w * 0.45)), cfg["coverage"], True)
    right = _pick(cc, int(math.ceil(w * 0.55)), int(math.ceil(w * (1 - ins))), cfg["coverage"], False)
    ok_v = top is not None and bottom is not None and bottom - top >= cfg["minGap"] * h
    ok_h = left is not None and right is not None and right - left >= cfg["minGap"] * w
    B = cfg["band"]

    def mean_rect(xa, xb, ya, yb):
        ya, yb, xa, xb = max(0, ya), min(h, yb), max(0, xa), min(w, xb)
        return float(g[ya:yb, xa:xb].mean()) if yb > ya and xb > xa else None

    span_x = (int(math.floor((left if ok_h else w * 0.15) + B)), int(math.ceil((right if ok_h else w * 0.85) - B)))
    span_y = (int(math.floor((top if ok_v else h * 0.15) + B)), int(math.ceil((bottom if ok_v else h * 0.85) - B)))
    diffs = {}
    if top is not None and ok_v:
        diffs["top"] = mean_rect(*span_x, top - 1 - B, top - 1) - mean_rect(*span_x, top + 2, top + 2 + B)
    if bottom is not None and ok_v:
        diffs["bottom"] = mean_rect(*span_x, bottom + 2, bottom + 2 + B) - mean_rect(*span_x, bottom - 1 - B, bottom - 1)
    if left is not None and ok_h:
        diffs["left"] = mean_rect(left - 1 - B, left - 1, *span_y) - mean_rect(left + 2, left + 2 + B, *span_y)
    if right is not None and ok_h:
        diffs["right"] = mean_rect(right + 2, right + 2 + B, *span_y) - mean_rect(right - 1 - B, right - 1, *span_y)
    vals = [v for v in diffs.values() if v is not None and not math.isnan(v)]
    pos = [v for v in vals if v >= cfg["minStep"]]
    neg = [v for v in vals if v <= -cfg["minStep"]]
    use = pos if len(pos) >= len(neg) else neg
    consistent = len(use)
    rect = {"x0": left / w, "y0": top / h, "x1": right / w, "y1": bottom / h} if ok_v and ok_h else None
    area = (rect["x1"] - rect["x0"]) * (rect["y1"] - rect["y0"]) if rect else 0.0
    score = 0.0
    if consistent >= 3 and rect and area >= cfg["minArea"]:
        mean_abs = sum(abs(v) for v in use) / len(use)
        score = (consistent / 4) * min(1.0, mean_abs / cfg["stepFull"])
        if face_box:
            ix = max(0.0, min(rect["x1"], face_box["x"] + face_box["w"]) - max(rect["x0"], face_box["x"]))
            iy = max(0.0, min(rect["y1"], face_box["y"] + face_box["h"]) - max(rect["y0"], face_box["y"]))
            if (ix * iy) / (face_box["w"] * face_box["h"]) < cfg["faceInside"]:
                score *= 0.3
    return {"score": score, "sides": len(vals), "consistent": consistent, "found": score > 0, "rect": rect, "area": area,
            "polarity": "outside-brighter" if use is pos else "outside-darker"}


def passive_score(signals, cfg=None):
    """signals: {'moire': {'score'}, 'bezel': {'score'}, ...} (any may be missing) -> same shape as passive.js."""
    cfg = cfg or THRESHOLDS["passive"]
    w = cfg["weights"]
    m = signals.get("moire") or {}
    parts = {
        "moire": None if m.get("score") is None else ramp(m["score"], cfg["moire"]["warn"], cfg["moire"]["fail"]),
        "bezel": (signals.get("bezel") or {}).get("score"),
        "banding": (signals.get("banding") or {}).get("score"),
        "planar": None if (signals.get("planar") or {}).get("planar") is None else (1.0 if signals["planar"]["planar"] else 0.0),
        "glareFace": None,
    }
    gf = (signals.get("glareFace") or {}).get("overlap")
    if gf is not None:
        parts["glareFace"] = ramp(gf, cfg["glareFace"]["warnOverlap"], cfg["glareFace"]["fullOverlap"])
    keep, used = 1.0, []
    for k, v in parts.items():
        if v is None:
            continue
        used.append(k)
        keep *= 1 - w[k] * v
    score = (1 - keep) if used else None
    status = "unknown" if score is None else "fail" if score >= cfg["failAt"] else "warn" if score >= cfg["warnAt"] else "pass"
    return {"score": score, "status": status, "parts": parts, "used": used}


def passive_from_frame(frame, face_box=None):
    """The photo part: moire on the first native patch (centre) + the frame detector on the analysis image."""
    moire = moire_metrics(frame.patches[0]) if frame.patches else {"score": None}
    return {"moire": moire, "bezel": bezel_metrics(frame.gray, face_box)}
