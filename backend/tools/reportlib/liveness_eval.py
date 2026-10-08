"""Liveness / presentation-attack evaluation (Phase 7f): APCER / BPCER / ACER with confidence intervals.

REAL data: `live_selfies/` (bona fide), `spoof_screen/`, `spoof_print/`, `spoof_video/` (attacks) in edge-validator/samples.
What can be measured depends on what the folders contain:
  * stills only  -> the PASSIVE layer on the photo (the same moire + frame detector the server runs), photo-only.
  * a sidecar `<photo stem>.evidence.json` (the `liveness_evidence` the app sent; the server stores it in
    photo_report.evidence.liveness.evidence) -> the active challenge is REPLAYED too: completion rate, time to
    pass, and the combined system (an attack is accepted only if the challenge passes AND the photo is not flagged).
Optional `labels.txt` per folder: `filename: key=value, key=value` (device, light, glasses, ...) for per-slice BPCER.

The SYNTHETIC smoke test (generated spoofs of real good photos) only proves the pipeline and shows how the passive
layer reacts to a grid/frame of known strength; it is never presented as accuracy.
"""
import io
import json
import statistics
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from photo_quality import analyze_image, liveness as lv  # noqa: E402
from photo_quality.config import task_config  # noqa: E402

from . import stats  # noqa: E402

ATTACKS = {"spoof_screen": "screen replay", "spoof_print": "print", "spoof_video": "video replay"}
MIN_REAL = {"live_selfies": 40, "spoof_screen": 40, "spoof_print": 20, "spoof_video": 20}
SELFIE = task_config("task_selfie_checkin")
FLAGGED = ("warn", "fail")


def read_labels(folder: Path):
    out = {}
    f = folder / "labels.txt"
    if f.is_file():
        for line in f.read_text().splitlines():
            if ":" in line and not line.strip().startswith("#"):
                name, rest = line.split(":", 1)
                out[name.strip()] = dict(kv.strip().split("=", 1) for kv in rest.split(",") if "=" in kv)
    return out


def _analyze(path: Path):
    data = path.read_bytes()
    rep = analyze_image(data, f"image/{path.suffix[1:].lower()}", SELFIE)
    p = rep.get("passive") or {}
    return {"file": path.name, "status": p.get("status", "unknown"), "score": p.get("score"),
            "moire": (p.get("moire") or {}).get("score"), "bezel": (p.get("bezel") or {}).get("score"),
            "face": rep["checks"].get("face", {}).get("status")}


def _replay(path: Path):
    side = path.with_suffix(".evidence.json")
    if not side.is_file():
        return None
    ev = json.loads(side.read_text())
    if not ev.get("challenges") or not ev.get("timeline"):
        return None
    run = lv.replay(ev["challenges"], ev["timeline"])
    t_pass = run.results[-1]["t1"] if run.phase == "passed" and run.results else None
    return {"passed": run.phase == "passed", "ms": t_pass}


def evaluate_real(folders: dict, n_boot=1000, seed=0):
    """folders: {folder name: [Path]} (counted files only). -> section dict, or evaluated=False."""
    live = folders.get("live_selfies", [])
    attacks = {k: folders.get(k, []) for k in ATTACKS if folders.get(k)}
    found = {k: len(v) for k, v in folders.items() if k == "live_selfies" or k in ATTACKS}
    if not live or not attacks:
        return {"evaluated": False, "folders_found": found}
    rows = {"live_selfies": [], **{k: [] for k in attacks}}
    for k in rows:
        labels = read_labels(Path((folders[k][0]).parent))
        for p in folders[k]:
            r = _analyze(p)
            r["replay"] = _replay(p)
            r["labels"] = labels.get(p.name, {})
            rows[k].append(r)
    out = {"evaluated": True, "label": "REAL", "folders_found": found, "min_recommended": MIN_REAL,
           "small_sample": {k: len(v) < MIN_REAL[k] for k, v in rows.items()}}

    def flagged(r):
        return r["status"] in FLAGGED

    # ---- photo-only (passive) detector -------------------------------------------------------------------
    bp = [flagged(r) for r in rows["live_selfies"]]
    per = {ATTACKS[k]: [not flagged(r) for r in rs] for k, rs in rows.items() if k in ATTACKS}
    out["passive_only"] = stats.pad_metrics(bp, per)
    live_s = [r["score"] for r in rows["live_selfies"] if r["score"] is not None]
    att_s = [r["score"] for k, rs in rows.items() if k in ATTACKS for r in rs if r["score"] is not None]
    auc = stats.bootstrap_auc(att_s, live_s, n_boot=n_boot, seed=seed) if live_s and att_s else (float("nan"),) * 3
    out["passive_auc"] = {"value": auc[0], "lo": auc[1], "hi": auc[2], "n_attacks": len(att_s), "n_live": len(live_s)}
    grid = sorted({round(x, 3) for x in np.linspace(0.05, 0.95, 10)} | {0.45})
    out["passive_sweep"] = [{"t": t, "bpcer": stats.rate(sum(s >= t for s in live_s), len(live_s)),
                             "apcer": stats.rate(sum(s < t for s in att_s), len(att_s))} for t in grid]
    # ---- the active challenge, where evidence sidecars exist -------------------------------------------
    have = {k: [r for r in rs if r["replay"]] for k, rs in rows.items()}
    if any(have.values()):
        lv_rows = have["live_selfies"]
        times = [r["replay"]["ms"] for r in lv_rows if r["replay"]["passed"] and r["replay"]["ms"]]
        out["challenge"] = {
            "live_completion": stats.rate(sum(r["replay"]["passed"] for r in lv_rows), len(lv_rows)),
            "median_ms_to_pass": statistics.median(times) if times else None,
            "attacks_accepted_by_challenge": {ATTACKS[k]: stats.rate(sum(r["replay"]["passed"] for r in rs), len(rs)) for k, rs in have.items() if k in ATTACKS and rs},
        }
        comb_b = [not r["replay"]["passed"] or flagged(r) for r in lv_rows]
        comb_a = {ATTACKS[k]: [r["replay"]["passed"] and not flagged(r) for r in rs] for k, rs in have.items() if k in ATTACKS and rs}
        out["combined"] = stats.pad_metrics(comb_b, comb_a)
    # ---- slices ----------------------------------------------------------------------------------------
    slices = {}
    for r in rows["live_selfies"]:
        for key, val in r["labels"].items():
            slices.setdefault(f"{key}={val}", []).append(flagged(r))
    out["slices"] = {k: {"n": len(v), "bpcer": stats.rate(sum(v), len(v)), "indicative_only": len(v) < 30} for k, v in sorted(slices.items())}
    out["errors"] = {
        "live_flagged (false rejects)": [{k: r[k] for k in ("file", "status", "score", "moire", "bezel", "labels")} for r in rows["live_selfies"] if flagged(r)],
        "attacks_accepted (missed)": [{"folder": k, **{kk: r[kk] for kk in ("file", "status", "score", "moire", "bezel")}} for k, rs in rows.items() if k in ATTACKS for r in rs if not flagged(r)],
    }
    return out


def synthetic_smoke(good_paths, n=40):
    """SYNTHETIC: real good photos as the 'bona fide' side, generated spoofs (rotated pixel grid and/or a dark frame) as attacks."""
    from PIL import Image

    picks = list(good_paths)[:: max(1, len(good_paths) // n)][:n]
    if not picks:
        return None

    def spoof(path, amp, frame):
        im = Image.open(path).convert("RGB")
        im.thumbnail((1280, 1280))
        a = np.asarray(im, dtype=np.float64)
        h, w = a.shape[:2]
        if amp:
            y, x = np.mgrid[0:h, 0:w]
            t = np.deg2rad(11)
            u, v = x * np.cos(t) + y * np.sin(t), -x * np.sin(t) + y * np.cos(t)
            a = a + (amp * (np.cos(2 * np.pi * u / 3.3) + np.cos(2 * np.pi * v / 3.3)) / 2)[..., None]
        if frame:
            m = int(0.06 * min(h, w))
            a[:m], a[-m:], a[:, :m], a[:, -m:] = 12, 12, 12, 12
        buf = io.BytesIO()
        Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(buf, "JPEG", quality=94)
        return buf.getvalue()

    def status(data):
        p = analyze_image(data, "image/jpeg", SELFIE).get("passive") or {}
        return p.get("status") in FLAGGED

    live = [status(Path(p).read_bytes() if str(p).lower().endswith((".jpg", ".jpeg")) else _as_jpeg(p)) for p in picks]
    kinds = {"grid amp 6": (6, False), "grid amp 12": (12, False), "frame only": (0, True), "grid amp 12 + frame": (12, True)}
    att = {k: [not status(spoof(p, *args)) for p in picks] for k, args in kinds.items()}
    return {"label": "SYNTHETIC", "n": len(picks), "metrics": stats.pad_metrics(live, att)}


def _as_jpeg(path):
    from PIL import Image

    im = Image.open(path).convert("RGB")
    im.thumbnail((1280, 1280))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=94)
    return buf.getvalue()
