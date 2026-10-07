import numpy as np

from ..config import FAIL, PASS, THRESHOLDS, WARN
from ..stats import components, ramp
from .result import check_result

REGIONS = [["top-left", "top", "top-right"], ["left", "centre", "right"], ["bottom-left", "bottom", "bottom-right"]]


def region_name(cx, cy):
    return REGIONS[min(2, int(cy * 3))][min(2, int(cx * 3))]


def glare_metrics(frame, cfg=None):
    cfg = cfg or THRESHOLDS["glare"]
    cell = cfg["cell"]
    h, w = frame.gray.shape
    gx, gy = w // cell, h // cell
    n = gx * gy
    rgb = frame.rgba[: gy * cell, : gx * cell, :3].astype(np.int32)
    gray = frame.gray[: gy * cell, : gx * cell].astype(np.float64)
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = (mx >= cfg["vMin"]) & ((mx - mn) <= cfg["satMax"] * np.maximum(mx, 1))
    px = cell * cell
    sat_frac = sat.reshape(gy, cell, gx, cell).sum(axis=(1, 3)) / px
    mean = gray.reshape(gy, cell, gx, cell).sum(axis=(1, 3)) / px
    sq = (gray ** 2).reshape(gy, cell, gx, cell).sum(axis=(1, 3)) / px
    blown = ((sat_frac >= cfg["cellSatFrac"]) & ((sq - mean * mean) <= cfg["cellFlatVar"])).ravel().astype(np.uint8)
    cell_mean = mean.ravel()

    comps = components(blown, gx, gy)
    total = sum(len(c) for c in comps) / n
    if not comps:
        return {"area": 0.0, "totalBlown": 0.0, "halo": 0.0, "soft": False, "bbox": None, "region": None}
    best = max(comps, key=len)

    dist = np.full(n, -1, dtype=np.int8)
    for c in best:
        dist[c] = 0
    frontier = list(best)
    for d in (1, 2, 3, 4, 5):
        nxt = []
        for c in frontier:
            x, y = c % gx, c // gx
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or ny < 0 or nx >= gx or ny >= gy:
                    continue
                j = ny * gx + nx
                if dist[j] == -1 and not blown[j]:
                    dist[j] = d
                    nxt.append(j)
        frontier = nxt

    def ring(d):
        sel = dist == d
        return float(cell_mean[sel].mean()) if sel.any() else None

    # ring 1 skipped: edges leave partly-bright cells there. A halo falls off
    # steadily outward (ring 2 > 3 > 4 > 5); a coincidentally brighter neighbourhood doesn't.
    means = [ring(d) for d in (2, 3, 4, 5)]
    complete = all(v is not None for v in means)
    halo = (means[0] - means[3]) if complete else 0.0
    monotone = complete and all(means[i - 1] - means[i] >= -1 for i in range(1, 4))
    # ...and it surrounds the blob: most ring-2 cells are brighter than the far ring.
    r2 = dist == 2
    surround = float((cell_mean[r2] > means[3] + cfg["haloMin"] / 2).mean()) if complete and r2.any() else 0.0
    xs = [c % gx for c in best]
    ys = [c // gx for c in best]
    bbox = {"x0": min(xs) / gx, "x1": (max(xs) + 1) / gx, "y0": min(ys) / gy, "y1": (max(ys) + 1) / gy}
    return {"area": len(best) / n, "totalBlown": total, "halo": halo, "monotone": monotone, "surround": surround,
            "soft": monotone and surround >= cfg["haloSurround"] and halo >= cfg["haloMin"], "bbox": bbox,
            "region": region_name((bbox["x0"] + bbox["x1"]) / 2, (bbox["y0"] + bbox["y1"]) / 2)}


def check_glare(frame, ctx=None):
    t = THRESHOLDS["glare"]
    m = glare_metrics(frame)
    status, hint = PASS, None
    if m["soft"] and m["area"] >= t["failArea"]:
        status = FAIL
        hint = f"Strong glare on the {m['region']} of the photo. Change your angle or block the light source."
    elif m["soft"] and m["area"] >= t["warnArea"]:
        status = WARN
        hint = f"Glare on the {m['region']} of the photo. Change your angle to avoid the reflection."
    elif not m["soft"] and m["area"] >= t["hardWarnArea"]:
        status = WARN
        hint = f"A large part of the photo is blown out to white ({m['region']}). Check the lighting."
    score = ramp(m["area"] if m["soft"] else m["area"] * 0.4, t["failArea"] * 1.5, 0)
    return check_result("glare", status, score, m["area"], hint, m)
