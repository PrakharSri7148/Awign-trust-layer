import numpy as np

from ..config import FAIL, PASS, THRESHOLDS, WARN
from ..stats import box3, components, tiles
from .result import check_result


def rgb_to_hsv(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    h = 0.0
    if d > 0:
        if mx == r:
            h = ((g - b) / d + 6) % 6
        elif mx == g:
            h = (b - r) / d + 2
        else:
            h = (r - g) / d + 4
        h *= 60
    return h, (0 if mx == 0 else d / mx), mx / 255


def looks_like_finger(hsv):
    h, s, v = hsv
    # skin is ~0-30 deg; cream / tan / beige walls (~35-45) must not read as a finger
    warm = h <= 32 or h >= 345
    return warm and 0.15 <= s <= (0.95 if h < 20 else 0.75) and 0.2 <= v <= 0.97


def obstruction_metrics(frame):
    t = THRESHOLDS["obstruction"]
    h, w = frame.gray.shape
    rgba = frame.rgba
    sm = box3(frame.gray)
    grid = t["grid"]
    cells = tiles(w, h, grid, grid)
    info = []
    for _tx, _ty, x0, x1, y0, y1 in cells:
        px = sm[y0:y1, x0:x1]
        mean = float(px.astype(np.float64).mean())
        std = float(np.sqrt(((px.astype(np.float64) - mean) ** 2).mean()))
        sub = rgba[y0:y1:2, x0:x1:2, :3].reshape(-1, 3).astype(np.float64)
        r, g, b = sub.mean(axis=0)
        info.append({"std": std, "mean": mean, "hsv": rgb_to_hsv(r, g, b)})

    stds = sorted(i["std"] for i in info)
    median_std = stds[len(stds) // 2]
    frame_mean = sum(i["mean"] for i in info) / len(info)
    dark_limit = min(t["darkTileMean"], 0.6 * frame_mean)
    flat_limit = min(t["flatTileStd"], t["flatRelative"] * median_std)
    cover = [0] * len(cells)
    textured = full_flat = 0
    for k, tile in enumerate(info):
        tile["flat"] = tile["std"] < max(flat_limit, 0) or tile["std"] < t["coverFlatStd"]
        tile["dark"] = tile["mean"] < dark_limit
        tile["finger"] = looks_like_finger(tile["hsv"])
        cover[k] = 1 if tile["flat"] and (tile["dark"] or tile["finger"]) else 0
        if not tile["flat"]:
            textured += 1
        if tile["std"] < t["coverFlatStd"]:
            full_flat += 1

    best = {"area": 0.0, "cells": []}
    for comp in components(cover, grid, grid):
        touches = any((c % grid) in (0, grid - 1) or (c // grid) in (0, grid - 1) for c in comp)
        area = len(comp) / len(cells)
        if touches and area > best["area"]:
            best = {"area": area, "cells": comp}
    cover_total = sum(cover) / len(cells)
    bbox = None
    finger = False
    if best["cells"]:
        xs = [c % grid for c in best["cells"]]
        ys = [c // grid for c in best["cells"]]
        bbox = {"x0": min(xs) / grid, "x1": (max(xs) + 1) / grid, "y0": min(ys) / grid, "y1": (max(ys) + 1) / grid}
        finger = sum(1 for c in best["cells"] if info[c]["finger"]) / len(best["cells"]) > 0.5
    full_flat_frac = full_flat / len(cells)
    finger_frac = sum(1 for i in info if i["finger"]) / len(info)
    full_cover = full_flat_frac >= t["fullCoverArea"] and (frame_mean < t["darkTileMean"] or finger_frac >= 0.5)
    return {"area": best["area"], "coverTotal": cover_total, "texturedFrac": textured / len(cells), "bbox": bbox,
            "finger": finger, "medianStd": median_std, "fullFlatFrac": full_flat_frac, "fullCover": full_cover,
            "frameMean": frame_mean}


def check_obstruction(frame, ctx=None):
    t = THRESHOLDS["obstruction"]
    m = obstruction_metrics(frame)
    status, hint = PASS, None
    full = m["fullCover"]
    tag = " (finger?)" if m["finger"] else ""
    if full or m["area"] >= t["failArea"]:
        status = FAIL
        hint = ("The photo is almost completely dark: uncover the lens or move to better light, then retake." if full
                else f"The lens looks partly covered{tag}. Move your hand or clean the lens and retake.")
    elif m["area"] >= t["warnArea"]:
        status = WARN
        hint = f"Something may be covering part of the lens{tag}. Check and retake."
    score = 0.0 if full else max(0.0, 1 - max(m["area"], m["coverTotal"] * 0.8) / t["failArea"])
    return check_result("obstruction", status, score, m["area"], hint, m)
