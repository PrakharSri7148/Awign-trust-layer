"""Python passive screen/print detection: behaviour, and agreement with the JavaScript implementation."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
from scipy import ndimage

from photo_quality import passive
from photo_quality.config import THRESHOLDS

ROOT = Path(__file__).resolve().parents[2]
P = THRESHOLDS["passive"]
W, H = 480, 360


def natural(seed=4):
    r = np.random.default_rng(seed)
    g = ndimage.uniform_filter(ndimage.uniform_filter(r.uniform(40, 200, (H // 12, W // 12)).repeat(12, 0).repeat(12, 1), 9), 9)
    return np.clip(g + r.normal(0, 3, g.shape), 0, 255)


def with_grid(g, period, amp, deg=11):
    t = np.deg2rad(deg)
    y, x = np.mgrid[0:H, 0:W]
    u, v = x * np.cos(t) + y * np.sin(t), -x * np.sin(t) + y * np.cos(t)
    return np.clip(g + amp * (np.cos(2 * np.pi * u / period) + np.cos(2 * np.pi * v / period)) / 2, 0, 255)


def framed(inner, dark=20, margin=0.1):
    x0, x1, y0, y1 = round(W * margin), round(W * (1 - margin)), round(H * margin), round(H * (1 - margin))
    out = np.full((H, W), float(dark))
    out[y0:y1, x0:x1] = np.maximum(inner[y0:y1, x0:x1], 90)
    return out


def test_moire_catches_a_screen_like_grid_and_not_natural_texture():
    base = natural()
    assert passive.moire_metrics(base)["score"] < P["moire"]["warn"]
    for period in (3.3, 5):
        m = passive.moire_metrics(with_grid(base, period, 14))
        assert m["score"] >= P["moire"]["fail"] and m["peaks"] >= 1
    assert abs(passive.moire_metrics(with_grid(base, 5, 14))["periodPx"] - 5) < 0.6
    assert passive.moire_metrics(with_grid(base, 5, 4))["score"] < passive.moire_metrics(with_grid(base, 5, 14))["score"]


def test_moire_ignores_a_hard_edge_and_tiny_patches():
    edge = np.where(np.arange(W)[None, :] < 233, 60.0, 190.0) * np.ones((H, 1))
    assert passive.moire_metrics(edge + np.random.default_rng(1).normal(0, 2, edge.shape))["score"] < P["moire"]["warn"]
    assert passive.moire_metrics(np.zeros((40, 40)))["score"] is None


def test_bezel_finds_a_framed_picture_and_discounts_a_rectangle_that_misses_the_face():
    g = framed(natural(2))
    b = passive.bezel_metrics(g)
    assert b["found"] and b["consistent"] == 4 and b["polarity"] == "outside-darker"
    assert passive.bezel_metrics(np.maximum(natural(2), 90))["found"] is False
    inside = passive.bezel_metrics(g, {"x": 0.35, "y": 0.3, "w": 0.3, "h": 0.4})["score"]
    outside = passive.bezel_metrics(g, {"x": 0.0, "y": 0.0, "w": 0.2, "h": 0.25})["score"]
    assert inside > 2 * outside
    door = np.where((np.arange(W)[None, :] > 100) & (np.arange(W)[None, :] < 108), 20.0, 150.0) * np.ones((H, 1))
    assert passive.bezel_metrics(door)["found"] is False


def test_passive_score_matches_the_documented_noisy_or():
    assert passive.passive_score({})["status"] == "unknown"
    s = passive.passive_score({"moire": {"score": P["moire"]["fail"]}})
    assert s["score"] == pytest.approx(P["weights"]["moire"]) and s["status"] == "warn"
    assert passive.passive_score({"moire": {"score": P["moire"]["warn"] - 1}})["status"] == "pass"
    assert passive.passive_score({"planar": {"planar": True}})["score"] < P["warnAt"]
    assert passive.passive_score({"moire": {"score": 99}, "bezel": {"score": 1}})["status"] == "warn"  # failAt is above 1


@pytest.mark.skipif(shutil.which("node") is None or not (ROOT / "client" / "node_modules").exists(), reason="node + client deps needed for the JS side")
def test_python_agrees_with_the_javascript_implementation(tmp_path):
    base = natural(7)
    cases = {
        "natural": base,
        "grid5": with_grid(base, 5, 14),
        "grid3": with_grid(base, 3.3, 10),
        "framed": framed(natural(9)),
        "framed+grid": framed(with_grid(natural(11), 4, 12)),
        "noisy": np.clip(base + np.random.default_rng(3).normal(0, 6, base.shape), 0, 255),
    }
    f = tmp_path / "in.json"
    f.write_text(json.dumps([{"name": k, "w": W, "h": H, "gray": v.astype(np.float32).ravel().tolist()} for k, v in cases.items()]))
    js = json.loads(subprocess.run(["node", str(ROOT / "client" / "tools" / "passive-cli.mjs"), str(f)], capture_output=True, text=True, check=True, cwd=ROOT / "client").stdout)
    for name, g in cases.items():
        g32 = g.astype(np.float32)
        m, b = passive.moire_metrics(g32), passive.bezel_metrics(g32)
        assert m["score"] == pytest.approx(js[name]["moire"]["score"], rel=1e-3), name
        assert m["peaks"] == js[name]["moire"]["peaks"], name
        assert b["score"] == pytest.approx(js[name]["bezel"]["score"], abs=1e-3), name
        assert (b["consistent"], b["sides"]) == (js[name]["bezel"]["consistent"], js[name]["bezel"]["sides"]), name
