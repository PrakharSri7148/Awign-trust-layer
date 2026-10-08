"""Why was this photo refused for focus (or anything else)? One command, one glance.

    cd backend
    .venv/bin/python tools/focus_diagnose.py PHOTO [PHOTO | FOLDER ...]            # shelf task, full detail
    .venv/bin/python tools/focus_diagnose.py --task task_selfie_checkin selfie.jpg # face task (front camera)
    .venv/bin/python tools/focus_diagnose.py --task task_selfie_checkin --brief ../edge-validator/samples/camera_rejected_good
    .venv/bin/python tools/focus_diagnose.py --json photo.jpg                     # machine-readable

For every image it prints what the SERVER engine (the verdict that counts) measures:
  * every check: status, the value and the threshold(s) it is judged against, whether it blocks;
  * the blur check's 3x3 tile scores (which tiles had texture, which one decided) and its noise floor;
  * for face tasks: the face detector's confidence and size, the face-crop blur score and the crop
    size next to cropBlurFail / cropBlurWarn, plus crop brightness;
  * the verdict and, in plain words, which check blocked and by how much.
It reads the SAME thresholds.json as the app. Nothing is written or modified.

`--client` additionally runs the browser engine (client/tools/diagnose-cli.mjs, Node) on the same file
and prints the numbers side by side, to show whether the two engines agree (hypothesis H6).
`--pipeline video` first pushes the photo through a stand-in for the in-app camera path (long side
<= 1920 px, JPEG q0.95 at that size) so a still can be judged like a camera capture; it does NOT
reproduce real H.264 softness or autofocus.
"""
import argparse
import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from photo_quality import analyze_image  # noqa: E402
from photo_quality.checks.blur import blur_metrics  # noqa: E402
from photo_quality.config import THRESHOLDS, task_config  # noqa: E402
from photo_quality.frame import ImageDecodeError, build_frame  # noqa: E402
from photo_quality.stats import box3, percentile, sobel, tiles  # noqa: E402

EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif"}
LABELS = {"blur": "Focus", "exposure": "Lighting", "glare": "Glare", "resolution": "Resolution", "obstruction": "Lens",
          "noise": "Noise", "shake": "Steadiness", "face": "Face", "liveness": "Liveness"}
FOCUS_FULL = THRESHOLDS["live"]["hud"]["focusFull"]


def focus_pct(score):
    """The 'Focus NN%' the app shows (blur score 0.05 -> 0%, focusFull -> 100%)."""
    return max(0.0, min(1.0, (score - 0.05) / (FOCUS_FULL - 0.05))) * 100


def video_pipeline(data: bytes, long_side=1920, quality=95) -> bytes:
    """Stand-in for the in-app camera: scale to a video-sized frame, re-encode as the canvas does."""
    from PIL import Image

    from photo_quality.frame import open_image

    img = open_image(data)
    scale = min(1.0, long_side / max(img.size))
    if scale < 1.0:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def tile_grid(frame):
    """Every 3x3 tile of the whole-frame blur check: contrast range, edge score or None when it has no texture."""
    cfg = THRESHOLDS["blur"]
    sigma = blur_metrics(frame.gray)["sigma"]
    sm = box3(frame.gray)
    grad = sobel(sm)
    out = []
    for _tx, _ty, x0, x1, y0, y1 in tiles(frame.width, frame.height, cfg["grid"], cfg["grid"]):
        px = sm[y0:y1, x0:x1].ravel()
        rng = percentile(px, 0.95) - percentile(px, 0.05)
        if rng < cfg["minTileRange"]:
            out.append({"range": float(rng), "score": None})
            continue
        peak = percentile(grad[y0:y1, x0:x1].ravel(), 0.98)
        out.append({"range": float(rng), "score": float(max(0.0, peak - 0.94 * sigma) / rng)})
    return out


def explain(report, task):
    """Plain-words reason per non-passing check: [{id, status, blocking, text, value, limit}]."""
    out = []
    t = THRESHOLDS
    blocking = {i["id"] for i in report["issues"] if i["blocking"]}
    for i in report["issues"]:
        c = report["checks"][i["id"]]
        d = c.get("details") or {}
        text, value, limit = c.get("hint") or "", c.get("value"), None
        if i["id"] == "blur" and c.get("value") is not None:
            limit = t["blur"]["failBelow"] if c["status"] == "fail" else t["blur"]["warnBelow"]
            text = (f"Focus {focus_pct(c['value']):.0f}% (score {c['value']:.3f}) is below the "
                    f"{focus_pct(limit):.0f}% (score {limit}) {'minimum' if c['status'] == 'fail' else 'comfortable level'}")
        elif i["id"] == "face":
            rs = [r for r in d.get("reasons", []) if r["status"] == c["status"]]
            if rs and rs[0]["metric"]:
                r = rs[0]
                text = f"{c['hint']} [{r['metric']} {r['value']:.3f} vs limit {r['limit']}]"
        out.append({"id": i["id"], "label": LABELS.get(i["id"], i["id"]), "status": i["status"],
                    "blocking": i["id"] in blocking and i["status"] == "fail", "text": text, "value": value, "limit": limit})
    return out


def diagnose(data: bytes, task_id="task_demo_1", mime=None, pipeline=None):
    """bytes -> dict with the server report plus the numbers behind it."""
    if pipeline == "video":
        data, mime = video_pipeline(data), "image/jpeg"
    task = task_config(task_id)
    frame = build_frame(data, mime)
    report = analyze_image(data, mime, task)
    face = report["checks"].get("face")
    faces = []
    if task.get("face", "off") != "off":
        try:
            from photo_quality.face import detect_faces

            faces = detect_faces(np.ascontiguousarray(frame.rgba[..., :3]))
        except Exception:  # detector unavailable: the report already says "unchecked"
            pass
    return {
        "_faces": faces,
        "task": task_id, "native": [frame.native_width, frame.native_height], "analysis": [frame.width, frame.height],
        "bytes": len(data), "verdict": report["verdict"], "quality": report["qualityScore"],
        "checks": {k: {"status": v["status"], "value": v["value"], "score": v["score"], "hint": v["hint"]}
                   for k, v in report["checks"].items()},
        "blur": {"tiles": tile_grid(frame), "details": {k: v for k, v in report["checks"]["blur"]["details"].items() if k != "tileScores"}},
        "face": (face or {}).get("details"),
        "issues": explain(report, task),
        "_report": report,
    }


def _fmt(v, nd=3):
    return "—" if v is None else f"{v:.{nd}f}"


def show(path, d, client=None):
    t = THRESHOLDS
    print(f"\n=== {path}")
    print(f"    task {d['task']} · native {d['native'][0]}x{d['native'][1]} · analysed at {d['analysis'][0]}x{d['analysis'][1]} · {d['bytes'] / 1024:.0f} KB")
    print(f"    VERDICT (server): {d['verdict'].upper()}   quality {d['quality'] * 100:.0f}%")
    b = d["checks"]["blur"]
    print(f"    Focus (whole frame): score {_fmt(b['value'])}  -> Focus {_fmt(None if b['value'] is None else focus_pct(b['value']), 0)}%   "
          f"[fail < {t['blur']['failBelow']}  warn < {t['blur']['warnBelow']}]  status {b['status']}")
    grid = d["blur"]["tiles"]
    n = t["blur"]["grid"]
    print(f"      3x3 tiles (edge score, '·' = no texture, range < {t['blur']['minTileRange']}); the 66th-percentile tile decides:")
    for r in range(n):
        print("        " + "  ".join(" ·   " if grid[r * n + c]["score"] is None else f"{grid[r * n + c]['score']:.3f}" for c in range(n)))
    print(f"      textured tiles {sum(g['score'] is not None for g in grid)}/{len(grid)} · noise floor σ {_fmt(d['blur']['details'].get('noiseSigma'), 2)}")
    for cid, c in d["checks"].items():
        if cid == "blur":
            continue
        print(f"    {LABELS.get(cid, cid):<11} {c['status']:<5} value {_fmt(c['value'])}  score {_fmt(c['score'], 2)}" + (f"   {c['hint']}" if c["hint"] else ""))
    f = d["face"]
    if f and not f.get("unchecked"):
        if f.get("count") == 0:
            print("    Face detector: no face found")
        else:
            cr = f.get("crop") or {}
            print(f"    Face: confidence {_fmt(f['score'], 2)} (warn<{t['face']['minScoreWarn']} fail<{t['face']['minScoreFail']}) · height {_fmt(f['heightFrac'], 2)} of frame "
                  f"(warn<{t['face']['minHeightWarn']} fail<{t['face']['minHeightFail']}) · visible {_fmt(f['visibleFrac'], 2)} · yaw {_fmt(f['yaw'], 2)}")
            if cr:
                print(f"      FACE-CROP blur {_fmt(cr.get('blur'))} on a {cr.get('width', '?')}x{cr.get('height', '?')} px crop  "
                      f"[fail < {t['face']['cropBlurFail']}  warn < {t['face']['cropBlurWarn']}]   crop brightness {_fmt(cr.get('mean'), 0)} "
                      f"(warn<{t['face']['cropDarkMeanWarn']}) clipped {_fmt(cr.get('clippedFrac'), 2)}")
            else:
                print("      face crop: not judged (low-confidence detection or crop smaller than cropMinSide)")
    elif f:
        print(f"    Face: unchecked ({f.get('reason')})")
    if client:
        cb = client.get("checks", {}).get("blur", {})
        cf = (client.get("checks", {}).get("face") or {}).get("details") or {}
        print(f"    CLIENT engine: verdict {client.get('verdict')} · blur {_fmt(cb.get('value'))} ({cb.get('status')})"
              + (f" · face-crop blur {_fmt((cf.get('crop') or {}).get('blur'))}" if cf else ""))
    print("    WHY:")
    if not d["issues"]:
        print("      nothing to report: every check passed")
    for i in d["issues"]:
        tag = "BLOCKS" if i["blocking"] else ("flag" if i["status"] == "fail" else "warn")
        print(f"      [{tag:<6}] {i['label']}: {i['text']}")


def run_client(path, task_id, faces, pipeline=None):
    """The browser engine in Node on the same file (pixel checks always; the face logic with the detections given)."""
    import tempfile

    src = path
    tmp = None
    if pipeline == "video":  # judge exactly the bytes the server judged
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        tmp.write(video_pipeline(Path(path).read_bytes()))
        tmp.close()
        src = tmp.name
    args = ["node", str(ROOT / "client" / "tools" / "diagnose-cli.mjs"), "--task", task_id, src]
    try:
        r = subprocess.run(args, input=json.dumps(faces), capture_output=True, text=True, cwd=ROOT / "client")
    finally:
        if tmp:
            Path(tmp.name).unlink(missing_ok=True)
    if r.returncode != 0:
        return {"error": r.stderr[-400:]}
    return json.loads(r.stdout)[0]


def collect(paths):
    files = []
    for p in map(Path, paths):
        if p.is_dir():
            files += [f for f in sorted(p.iterdir()) if f.suffix.lower() in EXTS]
        else:
            files.append(p)
    return files


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help="photos or folders")
    ap.add_argument("--task", default="task_demo_1", help="task id from thresholds.json (task_selfie_checkin = face required)")
    ap.add_argument("--pipeline", choices=["video"], help="push the photo through a stand-in for the in-app camera path first")
    ap.add_argument("--client", action="store_true", help="also run the browser engine (Node) and compare")
    ap.add_argument("--brief", action="store_true", help="one line per photo")
    ap.add_argument("--json", action="store_true", help="print JSON instead of text")
    a = ap.parse_args(argv)

    out = []
    for f in collect(a.paths):
        try:
            d = diagnose(f.read_bytes(), a.task, None, a.pipeline)
        except ImageDecodeError as exc:
            print(f"{f}: cannot decode ({exc})", file=sys.stderr)
            continue
        client = None
        if a.client:
            client = run_client(str(f), a.task, d["_faces"], a.pipeline)
        d.pop("_report")
        d.pop("_faces")
        out.append({"file": str(f), **d, "client": client})
        if a.json:
            continue
        if a.brief:
            blk = [i for i in d["issues"] if i["blocking"]]
            cr = (d["face"] or {}).get("crop") or {}
            print(f"{d['verdict']:<5} focus {_fmt(d['checks']['blur']['value'])} faceCrop {_fmt(cr.get('blur'))}  "
                  f"{'BLOCKED BY ' + ', '.join(i['id'] for i in blk) if blk else ''}  {f.name}")
        else:
            show(f, d, client)
    if a.json:
        json.dump(out, sys.stdout, indent=1, default=float)
    elif len(out) > 1:
        from collections import Counter

        c = Counter(o["verdict"] for o in out)
        bc = Counter(i["id"] for o in out for i in o["issues"] if i["blocking"])
        print(f"\n{len(out)} photos: {dict(c)}  blocked by: {dict(bc)}")


if __name__ == "__main__":
    main()
