import time

from .checks import CHECKS
from .config import DEFAULT_TASK, REPORT_VERSION, SKIP
from .face import check_face
from .frame import build_frame
from .policy import aggregate


def analyze_image(data: bytes, mime: str | None = None, task: dict | None = None) -> dict:
    """bytes -> report with the same shape as the client's analyzeFrame()."""
    t0 = time.perf_counter()
    frame = build_frame(data, mime)
    task_cfg = {**DEFAULT_TASK, **(task or {})}
    results, done = [], {}
    for cid, fn in CHECKS.items():
        try:
            r = fn(frame, {"task": task_cfg, "results": done})
        except Exception as exc:  # one failing check must not take the others down
            r = {"id": cid, "status": SKIP, "score": None, "value": None, "hint": None, "details": {"error": str(exc)}}
        done[cid] = r
        results.append(r)
    if task_cfg.get("face", "off") != "off":
        try:
            results.append(check_face(frame, task_cfg))
        except Exception as exc:
            results.append({"id": "face", "status": SKIP, "score": None, "value": None, "hint": None, "details": {"error": str(exc)}})
    verdict, issues, quality = aggregate(results, task_cfg)
    return {
        "version": REPORT_VERSION,
        "verdict": verdict,
        "qualityScore": quality,
        "issues": issues,
        "checks": {r["id"]: r for r in results},
        "metrics": {"width": frame.native_width, "height": frame.native_height, "bytes": frame.native_bytes,
                    "mime": frame.native_mime, "analysisMs": round((time.perf_counter() - t0) * 1000)},
    }
