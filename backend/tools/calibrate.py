"""Calibrate the photo-quality thresholds against real, labelled photos.

    cd client && npm run calibrate                 # reads edge-validator/samples/<issue>/*.jpg
    cd client && npm run calibrate -- --demo       # no photos yet? see what the report looks like
    ../backend/.venv/bin/python backend/tools/calibrate.py --help

Put photos in edge-validator/samples/{good,blurry,dark,overexposed,glare,low_resolution,
lens_covered,noisy_compressed,shaky,face_not_visible}/ (see samples/README.md). For every
check it shows how well the CURRENT thresholds separate "good" photos from that issue's
photos, then suggests thresholds that keep false rejections of good photos under a target.
Nothing is changed unless you pass --write (it writes thresholds.suggested.json next to the
real file; review it, then copy the numbers you accept into thresholds.json).
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from photo_quality import analyze_image  # noqa: E402
from photo_quality import config  # noqa: E402
from photo_quality.config import task_config  # noqa: E402
from photo_quality.frame import ImageDecodeError  # noqa: E402

SAMPLES = ROOT / "edge-validator" / "samples"
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif"}

# Folders analysed as a face task (everything else is analysed as a plain photo task, so a good
# shelf photo is never failed for "no face"). `good_selfies` = clear selfies, the face check's "good".
FACE_FOLDERS = {"face_not_visible", "good_selfies"}

# folder -> the check that should catch it. (shaky photos may be caught by blur too.)
EXPECTED = {
    "blurry": ["blur"], "dark": ["exposure"], "overexposed": ["exposure"], "glare": ["glare"],
    "low_resolution": ["resolution"], "lens_covered": ["obstruction"], "noisy_compressed": ["noise"],
    "shaky": ["shake", "blur"], "face_not_visible": ["face"],
}

# check -> (threshold group, [(key, direction)]). direction "low": a LOWER metric is worse.
# These are the keys whose values we can suggest from the good-photo distribution.
TUNABLE = {
    "blur": ("blur", [("warnBelow", "low"), ("failBelow", "low")]),
    "resolution": ("resolution", []),  # pixel-count tiers are policy, not statistics
    "noise": ("noise", [("sigmaWarn", "high"), ("sigmaFail", "high")]),
    "shake": ("shake", [("warnAniso", "high"), ("failAniso", "high")]),
    "glare": ("glare", [("warnArea", "high"), ("failArea", "high")]),
    "obstruction": ("obstruction", [("warnArea", "high"), ("failArea", "high")]),
}


DEFAULT_TASK_CFG = task_config("task_demo_1")


def load_samples(root: Path):
    out = {}
    for folder in sorted(p for p in root.iterdir() if p.is_dir()) if root.exists() else []:
        files = [f for f in sorted(folder.iterdir()) if f.suffix.lower() in EXTS]
        if files:
            out[folder.name] = files
    return out


def demo_samples(tmp: Path):
    """Build a tiny labelled set from the bundled real photographs + synthetic degradations."""
    import io

    from PIL import Image, ImageFilter

    fx = ROOT / "client" / "src" / "lib" / "photoQuality" / "testing" / "fixtures"
    base = [Image.open(fx / n).convert("RGB") for n in ("china.jpg", "flower.jpg")]
    rng = np.random.default_rng(0)
    recipes = {
        "good": lambda im: im,
        "blurry": lambda im: im.filter(ImageFilter.GaussianBlur(5)),
        "dark": lambda im: Image.eval(im, lambda v: int(v * 0.15)),
        "overexposed": lambda im: Image.eval(im, lambda v: min(255, int(v * 2 + 90))),
        "noisy_compressed": lambda im: Image.fromarray(np.clip(np.asarray(im) + rng.normal(0, 14, np.asarray(im).shape), 0, 255).astype("uint8")),
        "low_resolution": lambda im: im.resize((320, 214)),
    }
    crops = [(0, 0, 1.0), (0, 0, 0.8), (0.2, 0.1, 0.8), (0.1, 0.2, 0.75), (0.05, 0.05, 0.9), (0.15, 0.0, 0.85)]
    for name, fn in recipes.items():
        d = tmp / name
        d.mkdir(parents=True, exist_ok=True)
        for i, im in enumerate(base):
            for j, (fx0, fy0, scale) in enumerate(crops):
                # varied crops of each photo, enlarged only ~2x so the "good" ones are not softened
                w, h = im.size
                box = (int(fx0 * w), int(fy0 * h), int(fx0 * w + scale * w), int(fy0 * h + scale * h))
                crop = im.crop(box)
                big = crop.resize((1280, int(1280 * crop.height / crop.width)), Image.Resampling.LANCZOS) if name != "low_resolution" else crop.resize((320, int(320 * crop.height / crop.width)))
                buf = io.BytesIO()
                fn(big).save(buf, "JPEG", quality=[95, 92, 90, 94, 93, 91][j])
                (d / f"{i}_{j}.jpg").write_bytes(buf.getvalue())
    return tmp


SYNTHETIC = {"lens_covered", "noisy_compressed", "overexposed", "glare"}


def synthesize(good_files, kinds, dest: Path, n=40, max_side=1600):
    """Degrade real good photos into the issues that have no real samples yet.

    These are the SAME degradations the checks were designed against, so they prove the checks
    work and find gross threshold problems, but they cannot tell you how real worker photos of
    these problems look. The report labels them (synthetic).
    """
    import io

    from PIL import Image, ImageDraw, ImageFilter

    rng = np.random.default_rng(7)
    picks = good_files[:: max(1, len(good_files) // n)][:n]

    def load(f):
        im = Image.open(f).convert("RGB")
        im.thumbnail((max_side, max_side))
        return im

    def save(im, folder, i, q=93):
        d = dest / folder
        d.mkdir(parents=True, exist_ok=True)
        im.save(d / f"synthetic_{i:03d}.jpg", "JPEG", quality=q)

    for i, f in enumerate(picks):
        im = load(f)
        w, h = im.size
        if "lens_covered" in kinds:
            c = im.copy()
            d = ImageDraw.Draw(c, "RGBA")
            kind = i % 3
            if kind == 0:  # dark patch over a corner (cloth / dirt)
                d.rectangle([0, 0, int(w * rng.uniform(0.35, 0.55)), int(h * rng.uniform(0.35, 0.55))], fill=(10, 10, 10, 255))
            elif kind == 1:  # a finger over the lens: warm, flat, soft-edged, from a bottom corner
                r = int(min(w, h) * rng.uniform(0.35, 0.55))
                layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
                ImageDraw.Draw(layer).ellipse([w - r, h - r, w + r, h + r], fill=(205, 140, 115, 255))
                layer = layer.filter(ImageFilter.GaussianBlur(r * 0.06))
                c = Image.alpha_composite(c.convert("RGBA"), layer).convert("RGB")
            else:  # most of the frame dark
                d.rectangle([0, 0, int(w * rng.uniform(0.6, 0.9)), h], fill=(8, 8, 10, 255))
            save(c, "lens_covered", i)
        if "noisy_compressed" in kinds:
            a = np.asarray(im, dtype=np.float32)
            if i % 2 == 0:  # grainy low light
                a = np.clip(a + rng.normal(0, rng.uniform(9, 16), a.shape), 0, 255)
                save(Image.fromarray(a.astype("uint8")), "noisy_compressed", i, q=92)
            else:  # heavily recompressed (forwarded copy)
                save(im, "noisy_compressed", i, q=int(rng.integers(12, 30)))
        if "overexposed" in kinds:
            a = np.asarray(im, dtype=np.float32) * rng.uniform(1.7, 2.4) + rng.uniform(50, 100)
            save(Image.fromarray(np.clip(a, 0, 255).astype("uint8")), "overexposed", i)
        if "glare" in kinds:
            c = im.copy().convert("RGBA")
            for _ in range(int(rng.integers(1, 3))):
                r = int(min(w, h) * rng.uniform(0.2, 0.4))
                cx, cy = int(rng.uniform(0.2, 0.8) * w), int(rng.uniform(0.2, 0.8) * h)
                core = Image.new("RGBA", im.size, (0, 0, 0, 0))
                ImageDraw.Draw(core).ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
                halo = Image.new("RGBA", im.size, (0, 0, 0, 0))
                ImageDraw.Draw(halo).ellipse([cx - r * 2, cy - r * 2, cx + r * 2, cy + r * 2], fill=(255, 255, 250, 150))
                halo = halo.filter(ImageFilter.GaussianBlur(r * 0.7))
                c = Image.alpha_composite(Image.alpha_composite(c, halo), core.filter(ImageFilter.GaussianBlur(r * 0.15)))
            save(c.convert("RGB"), "glare", i)


def analyze_all(samples, task):
    results = {}
    for folder, files in samples.items():
        task = task_config("task_selfie_checkin") if folder in FACE_FOLDERS else DEFAULT_TASK_CFG
        rows = []
        for f in files:
            try:
                rows.append((f.name, analyze_image(f.read_bytes(), f"image/{f.suffix[1:].lower()}", task)))
            except ImageDecodeError as exc:
                print(f"  ! skipped {folder}/{f.name}: {exc}")
        results[folder] = rows
    return results


def pct(a, q):
    return float(np.percentile(a, q)) if len(a) else float("nan")


def metric(report, check):
    v = report["checks"].get(check, {}).get("value")
    return None if v is None else float(v)


def auc(good, bad, bad_is_higher):
    """P(a random bad photo's metric is 'worse' than a random good one's); 0.5 = no signal."""
    if not len(good) or not len(bad):
        return float("nan")
    g, b = np.asarray(good)[:, None], np.asarray(bad)[None, :]
    wins = (b > g) if bad_is_higher else (b < g)
    return float(wins.mean() + 0.5 * (b == g).mean())


def suggest(good, bad, direction, fr, bad_q):
    """A threshold that flags at most `fr` of the good photos and catches the issue photos.

    Lowest value meeting the false-reject target is maximally aggressive, so when there is a
    gap between the good photos and (at least `bad_q`% of) the issue photos the threshold goes
    in the middle of the gap; if the two overlap it is set at the false-reject target and the
    recall that results is reported. Returns None without issue photos to separate from.
    """
    if len(good) < 10 or len(bad) < 5:
        return None
    high = direction == "high"  # higher metric = worse
    g_edge = pct(good, 100 * (1 - fr)) if high else pct(good, 100 * fr)  # where `fr` of good photos cross
    b_edge = pct(bad, bad_q) if high else pct(bad, 100 - bad_q)  # how far in the issue photos reach
    gap = g_edge <= b_edge if high else g_edge >= b_edge
    if gap:
        t = float(np.sqrt(g_edge * b_edge)) if g_edge > 0 and b_edge > 0 else (g_edge + b_edge) / 2
    else:
        t = g_edge
    g, b = np.asarray(good), np.asarray(bad)
    flagged = (lambda x: x >= t) if high else (lambda x: x <= t)
    return {"t": t, "gap": gap, "false_flag": float(flagged(g).mean()), "recall": float(flagged(b).mean())}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--samples", type=Path, default=SAMPLES, help="folder of <issue>/ sub-folders")
    ap.add_argument("--demo", action="store_true", help="use bundled photos + synthetic degradations")
    ap.add_argument("--max-false-reject", type=float, default=0.03, help="target share of GOOD photos that may be blocked (default 0.03)")
    ap.add_argument("--synthesize", default="", help="comma list of folders to generate synthetically from good/ (lens_covered,noisy_compressed,overexposed,glare)")
    ap.add_argument("--skip", default="", help="comma list of folders to ignore")
    ap.add_argument("--dump", type=Path, help="write every photo's per-check status/value to this JSON file (for threshold analysis)")
    ap.add_argument("--write", action="store_true", help="write thresholds.suggested.json")
    args = ap.parse_args(argv)

    tmp = None
    root = args.samples
    if args.demo:
        import tempfile

        tmp = Path(tempfile.mkdtemp(prefix="calib-demo-"))
        root = demo_samples(tmp)
        print(f"DEMO MODE: {sum(len(list(p.iterdir())) for p in root.iterdir())} generated photos (real photographs + synthetic degradations). Not a substitute for worker photos.\n")

    samples = load_samples(root)
    for name in [x for x in args.skip.split(",") if x]:
        samples.pop(name, None)
    synth = [x for x in args.synthesize.split(",") if x]
    if synth and "good" in samples:
        import tempfile

        sdir = Path(tempfile.mkdtemp(prefix="calib-synth-"))
        synthesize(samples["good"], set(synth), sdir)
        for name in synth:
            if (sdir / name).exists():
                samples[name] = sorted(f for f in (sdir / name).iterdir() if f.suffix.lower() in EXTS)
    if not samples:
        print(f"No photos found in {root}.\nAdd photos to edge-validator/samples/<issue>/ (see samples/README.md), or try --demo.")
        return 1
    if "good" not in samples:
        print("There is no samples/good/ folder: without good photos false rejections cannot be measured. Add at least ~30.")
        return 1

    results = analyze_all(samples, None)
    if args.dump:
        args.dump.write_text(json.dumps({
            folder: [{"file": n, "verdict": r["verdict"], "quality": r["qualityScore"],
                      "checks": {c: {"status": v["status"], "value": v["value"], "hint": v["hint"]} for c, v in r["checks"].items()}}
                     for n, r in rows] for folder, rows in results.items()}))
        print(f"(per-photo results written to {args.dump})")
    good = results["good"]
    n_good = len(good)
    print(f"{'folder':<30}{'photos':>7}  {'pass':>5} {'warn':>5} {'block':>5}   caught by the expected check (warn+)")
    for folder, rows in results.items():
        verdicts = Counter(r["verdict"] for _n, r in rows)
        expect = EXPECTED.get(folder)
        caught = ""
        if expect and rows:
            hit = sum(any(r["checks"].get(c, {}).get("status") in ("warn", "fail") for c in expect) for _n, r in rows)
            caught = f"{hit}/{len(rows)} = {100 * hit / len(rows):.0f}%  ({'/'.join(expect)})"
        print(f"{folder + (' (synthetic)' if folder in synth else ''):<30}{len(rows):>7}  {verdicts['pass']:>5} {verdicts['warn']:>5} {verdicts['block']:>5}   {caught}")

    bad_good = sum(r["verdict"] == "block" for _n, r in good)
    warn_good = sum(r["verdict"] == "warn" for _n, r in good)
    print(f"\nFALSE REJECTIONS among {n_good} good photos: {bad_good} blocked ({100 * bad_good / n_good:.1f}%), {warn_good} warned ({100 * warn_good / n_good:.1f}%)   target: blocked <= {100 * args.max_false_reject:.0f}%")
    if bad_good:
        for name, r in good:
            if r["verdict"] == "block":
                print(f"   blocked: {name}: " + ", ".join(i["id"] for i in r["issues"] if i["blocking"]))

    suggestions = {}
    print("\nPer check (current thresholds → suggestion for <= {:.0f}% false blocks on good photos):".format(100 * args.max_false_reject))
    for check, (group, keys) in TUNABLE.items():
        gvals = [v for _n, r in good if (v := metric(r, check)) is not None]
        bad_folders = [f for f, ex in EXPECTED.items() if check in ex and f in results]
        bvals = [v for f in bad_folders for _n, r in results[f] if (v := metric(r, check)) is not None]
        higher_is_worse = any(d == "high" for _k, d in keys) if keys else False
        if check == "resolution" or not gvals:
            continue
        line = f"  {check:<12} good n={len(gvals)} median {np.median(gvals):.3g} [p5 {pct(gvals, 5):.3g} .. p95 {pct(gvals, 95):.3g}]"
        if bvals:
            a = auc(gvals, bvals, higher_is_worse)
            line += f" | issue photos n={len(bvals)} median {np.median(bvals):.3g} | separation (AUC) {a:.2f}" + ("  ⚠ weak: this metric barely tells good from bad on your photos" if a < 0.75 else "")
        print(line)
        cur = config.THRESHOLDS[group]
        if keys and not bvals:
            print(f"      (no {'/'.join(f for f, ex in EXPECTED.items() if check in ex)} photos yet, so no threshold can be suggested; the current ones stay)")
        for key, direction in keys if bvals else []:
            is_warn = "warn" in key.lower()
            # warn levels may flag more good photos (they never block); fail levels follow the target.
            sg = suggest(gvals, bvals, direction, 0.10 if is_warn else args.max_false_reject, 10 if is_warn else 25)
            if sg is None:
                print(f"      {key:<10} now {cur[key]:<8} (need >= 10 good and >= 5 issue photos to suggest)")
                continue
            note = "in the gap between good and issue photos" if sg["gap"] else "OVERLAP: no clean split; set at the false-flag target"
            print(f"      {key:<10} now {cur[key]:<8} suggested {sg['t']:.3g}   → flags {100 * sg['false_flag']:.0f}% of good, catches {100 * sg['recall']:.0f}% of issue photos ({note})")
            suggestions.setdefault(group, {})[key] = float(f"{sg['t']:.3g}")
        small = len(gvals) < 30 or (bvals and len(bvals) < 30)
        if small and bvals:
            print("      ⚠ fewer than 30 photos in a group: treat these as indicative only")

    if "dark" in results or "overexposed" in results:
        gm = [metric(r, "exposure") for _n, r in good]
        print(f"  {'exposure':<12} good mean luma median {np.median(gm):.0f} [p5 {pct(gm, 5):.0f} .. p95 {pct(gm, 95):.0f}]  (dark warn/fail < {config.THRESHOLDS['exposure']['darkMeanWarn']}/{config.THRESHOLDS['exposure']['darkMeanFail']}, over > {config.THRESHOLDS['exposure']['overMeanWarn']}/{config.THRESHOLDS['exposure']['overMeanFail']})")
        for folder in ("dark", "overexposed"):
            if folder in results:
                vals = [metric(r, "exposure") for _n, r in results[folder]]
                print(f"      {folder:<12} median mean-luma {np.median(vals):.0f} [min {min(vals):.0f} .. max {max(vals):.0f}]")

    if "face_not_visible" in results:
        bad_scores = [d["score"] for _n, r in results["face_not_visible"] if (d := r["checks"].get("face", {}).get("details", {})).get("score") is not None]
        found = sum(1 for _n, r in results["face_not_visible"] if r["checks"].get("face", {}).get("details", {}).get("count", 0) > 0)
        n = len(results["face_not_visible"])
        flagged = sum(1 for _n, r in results["face_not_visible"] if r["checks"].get("face", {}).get("status") in ("warn", "fail"))
        print(f"  face         face_not_visible n={n}: detector found a face in {found}/{n}; flagged warn/fail in {flagged}/{n} ({100 * flagged / n:.0f}%)")
        if "good_selfies" in results and results["good_selfies"]:
            g = results["good_selfies"]
            gf = sum(1 for _n, r in g if r["checks"].get("face", {}).get("status") == "fail")
            gw = sum(1 for _n, r in g if r["checks"].get("face", {}).get("status") == "warn")
            print(f"               good_selfies n={len(g)}: {gf} wrongly failed, {gw} warned ({100 * (gf + gw) / len(g):.0f}% flagged)")
        else:
            print("               (no good_selfies/ folder: cannot measure how often a CLEAR face is wrongly rejected)")

    if args.write and suggestions:
        cur = json.loads(config._PATH.read_text())
        for group, vals in suggestions.items():
            cur["thresholds"][group].update(vals)
        out = config._PATH.with_name("thresholds.suggested.json")
        out.write_text(json.dumps(cur, indent=2) + "\n")
        print(f"\nWrote {out}. Review the diff against thresholds.json and copy across what you accept.")
    elif suggestions:
        print("\n(Run with --write to save these as thresholds.suggested.json. The real file is never modified.)")
    print("\nNOTE: thresholds that decide BLOCK (blur, exposure, resolution, obstruction, face) deserve the most care: a false block stops a worker.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
