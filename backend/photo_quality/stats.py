"""Numeric helpers; deliberately the same algorithms as client/src/lib/photoQuality/stats.js."""
import math

import numpy as np

MAX_SAMPLES = 60000


def percentile(values, p):
    v = np.asarray(values).ravel()
    n = v.size
    if n == 0:
        return 0.0
    if n > MAX_SAMPLES:
        v = v[:: -(-n // MAX_SAMPLES)]
    s = np.sort(v.astype(np.float32))
    return float(s[min(len(s) - 1, max(0, int(math.floor(p * len(s)))))])


def ramp(value, bad, good):
    if good == bad:
        return 1.0 if value >= good else 0.0
    return float(max(0.0, min(1.0, (value - bad) / (good - bad))))


def box3(g):
    p = np.pad(g, 1, mode="edge")
    h, w = g.shape
    out = np.zeros_like(g, dtype=np.float32)
    for dy in range(3):
        for dx in range(3):
            out += p[dy : dy + h, dx : dx + w]
    return out / 9.0


def sobel(g):
    h, w = g.shape
    m = np.zeros((h, w), dtype=np.float32)
    c = g
    gx = (c[:-2, 2:] + 2 * c[1:-1, 2:] + c[2:, 2:]) - (c[:-2, :-2] + 2 * c[1:-1, :-2] + c[2:, :-2])
    gy = (c[2:, :-2] + 2 * c[2:, 1:-1] + c[2:, 2:]) - (c[:-2, :-2] + 2 * c[:-2, 1:-1] + c[:-2, 2:])
    m[1:-1, 1:-1] = np.hypot(gx, gy) / 4.0
    return m


def noise_sigma(g, step=1):
    h, w = g.shape
    if h < 3 or w < 3:
        return 0.0
    v = (
        g[:-2, :-2] - 2 * g[:-2, 1:-1] + g[:-2, 2:]
        - 2 * g[1:-1, :-2] + 4 * g[1:-1, 1:-1] - 2 * g[1:-1, 2:]
        + g[2:, :-2] - 2 * g[2:, 1:-1] + g[2:, 2:]
    )
    r = np.abs(v[::step, ::step])
    if r.size == 0:
        return 0.0
    return percentile(r, 0.5) / 0.6745 / 6.0


def tiles(w, h, gx, gy):
    out = []
    for ty in range(gy):
        for tx in range(gx):
            out.append((tx, ty, (tx * w) // gx, ((tx + 1) * w) // gx, (ty * h) // gy, ((ty + 1) * h) // gy))
    return out


def components(mask, gx, gy):
    """4-neighbour connected components of a flat boolean grid -> lists of cell indices."""
    seen = np.zeros(len(mask), dtype=bool)
    out = []
    for i in range(len(mask)):
        if not mask[i] or seen[i]:
            continue
        stack = [i]
        seen[i] = True
        cells = []
        while stack:
            c = stack.pop()
            cells.append(c)
            x, y = c % gx, c // gx
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or ny < 0 or nx >= gx or ny >= gy:
                    continue
                j = ny * gx + nx
                if mask[j] and not seen[j]:
                    seen[j] = True
                    stack.append(j)
        out.append(cells)
    return out
