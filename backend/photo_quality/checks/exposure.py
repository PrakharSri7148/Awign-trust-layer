import numpy as np

from ..config import FAIL, PASS, THRESHOLDS, WARN
from ..stats import percentile, ramp
from .result import check_result


def exposure_metrics(gray):
    g = gray.ravel()
    return {
        "mean": float(g.astype(np.float64).mean()),
        "crushedFrac": float((g < 25).mean()),
        "clippedFrac": float((g > 245).mean()),
        "p5": percentile(g, 0.05),
        "p95": percentile(g, 0.95),
    }


def check_exposure(frame, ctx=None):
    t = THRESHOLDS["exposure"]
    m = exposure_metrics(frame.gray)
    rng = m["p95"] - m["p5"]
    state = {"status": PASS, "kind": None}

    def raise_(s, k):
        if s == FAIL or state["status"] == PASS:
            state["status"], state["kind"] = s, k

    if m["mean"] < t["darkMeanFail"] or m["crushedFrac"] > t["crushedFracFail"]:
        raise_(FAIL, "dark")
    elif m["mean"] < t["darkMeanWarn"] or m["crushedFrac"] > t["crushedFracWarn"]:
        raise_(WARN, "dark")
    if m["mean"] > t["overMeanFail"] or m["clippedFrac"] > t["clippedFracFail"]:
        raise_(FAIL, "over")
    elif m["mean"] > t["overMeanWarn"] or m["clippedFrac"] > t["clippedFracWarn"]:
        raise_(WARN, "over")
    if state["status"] == PASS and rng < t["flatRangeWarn"]:
        raise_(WARN, "flat")

    dark = min(ramp(m["mean"], t["darkMeanFail"] - 20, t["darkMeanWarn"] + 25), ramp(m["crushedFrac"], 0.8, 0.2))
    over = min(ramp(m["mean"], t["overMeanFail"] + 15, t["overMeanWarn"] - 25), ramp(m["clippedFrac"], 0.5, 0.05))
    score = min(dark, over, ramp(rng, 15, t["flatRangeWarn"] + 15))
    hints = {
        "dark": "Too dark. Move to better light or turn on the flash.",
        "over": "Overexposed. Move away from the bright light or avoid pointing at it.",
        "flat": "Low contrast, the photo looks washed out or hazy. Wipe the lens and avoid shooting into light.",
    }
    return check_result("exposure", state["status"], score, m["mean"],
                        hints.get(state["kind"]), {**m, "range": rng, "kind": state["kind"]})
