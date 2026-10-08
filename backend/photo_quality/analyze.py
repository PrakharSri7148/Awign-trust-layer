import time

from .checks import CHECKS
from .config import DEFAULT_TASK, REPORT_VERSION, SKIP
from .face import check_face, soften_crop_blur
from .frame import build_frame
from .passive import passive_from_frame, passive_score
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
            results.append(soften_crop_blur(check_face(frame, task_cfg), done.get("blur")))
        except Exception as exc:
            results.append({"id": "face", "status": SKIP, "score": None, "value": None, "hint": None, "details": {"error": str(exc)}})
    passive = None
    if task_cfg.get("face", "off") != "off":
        # Screen / print evidence from THIS photo (moire + frame detector); banding and planarity are client-only.
        try:
            face_box = ((done.get("face") or next((r for r in results if r["id"] == "face"), {})).get("details") or {}).get("box")
            raw = passive_from_frame(frame, face_box)
            sc = passive_score(raw)
            passive = {"moire": {"score": raw["moire"].get("score"), "peaks": raw["moire"].get("peaks", 0)},
                       "bezel": {"score": raw["bezel"]["score"], "consistent": raw["bezel"]["consistent"]},
                       "score": sc["score"], "status": sc["status"]}
        except Exception as exc:  # evidence must never take the photo check down
            passive = {"error": str(exc), "score": None, "status": "unknown"}
    verdict, issues, quality = aggregate(results, task_cfg)
    return {
        "version": REPORT_VERSION,
        "verdict": verdict,
        "qualityScore": quality,
        "issues": issues,
        "checks": {r["id"]: r for r in results},
        "passive": passive,
        "metrics": {"width": frame.native_width, "height": frame.native_height, "bytes": frame.native_bytes,
                    "mime": frame.native_mime, "analysisMs": round((time.perf_counter() - t0) * 1000)},
    }


def with_check(report: dict, result: dict, task: dict | None = None) -> dict:
    """Add (or replace) one check in a finished report and re-derive verdict / issues / quality."""
    task_cfg = {**DEFAULT_TASK, **(task or {})}
    checks = {**report["checks"], result["id"]: result}
    verdict, issues, quality = aggregate(list(checks.values()), task_cfg)
    return {**report, "checks": checks, "verdict": verdict, "issues": issues, "qualityScore": quality}
