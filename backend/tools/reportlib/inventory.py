"""Dataset inventory: what is in samples/, what it is worth, and which files must not be counted.

The checks that matter for honest numbers: exact duplicates (same SHA-256) inside and across
folders, a file that is both 'good' and 'bad' (label conflict), and near-duplicates (same scene,
re-encoded). Excluding duplicates is deterministic: the earliest folder in ROLE_ORDER keeps the file.
"""
import hashlib
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from photo_quality.evidence import dhash_hex, hamming_hex, read_exif  # noqa: E402
from photo_quality.frame import ImageDecodeError, open_image  # noqa: E402

EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif"}
NEAR_BITS = 5  # same threshold the server uses for `near_duplicate_photo`

# Roles. `negative` = an acceptable photo; `positive` = has the issue its folder names;
# `observation` = real photos we look at but never count as positives (the reason says why).
# Edit a role here, or pass --trust-folder, once a folder really holds what its name says.
ROLES = {
    "good": ("negative", "acceptable photos (a stock-photo set, not worker photos)"),
    "good_selfies": ("negative", "clear selfies (face tasks)"),
    "blurry": ("positive", "out-of-focus photos"),
    "shaky": ("positive", "motion-blurred photos"),
    "dark": ("positive", "under-exposed photos"),
    "low_resolution": ("positive", "small photos"),
    "noisy_compressed": ("positive", "grainy or heavily compressed photos"),
    "lens_covered": ("positive", "lens partly or fully covered"),
    "face_not_visible": ("positive", "face cut off, turned away, covered or too small"),
    # liveness (Phase 7f): not photo-quality folders; evaluated by reportlib/liveness_eval.py with the selfie task
    "live_selfies": ("bonafide", "real people photographed live (genuine presentations)"),
    "spoof_screen": ("attack", "the same people's photos or videos shown on a phone / laptop screen"),
    "spoof_print": ("attack", "printed photos held to the camera"),
    "spoof_video": ("attack", "a video of a face played on a screen"),
    "overexposed": ("observation", "measured: none of these are over-exposed (calibration run 2: all 28 pass the exposure check, "
                    "median mean-luma 165/255); they are walls photographed while moving"),
    "glare": ("observation", "stock lens-flare / headlight art (small bright points on dark), not content-hiding reflections"),
}
ROLE_ORDER = ["live_selfies", "spoof_screen", "spoof_print", "spoof_video", "good", "good_selfies", "blurry", "shaky", "dark", "low_resolution", "noisy_compressed",
              "lens_covered", "face_not_visible", "overexposed", "glare"]
SPOOF_FOLDERS = ["live_selfies", "spoof_screen", "spoof_print", "spoof_video"]  # liveness (7f)


def role_of(folder, trusted=()):
    role, why = ROLES.get(folder, ("unknown", "folder not in ROLES: not used"))
    if role == "observation" and folder in trusted:
        return "positive", f"trusted by --trust-folder (otherwise: {why})"
    return role, why


def scan(root: Path):
    """One record per image file: folder, name, path, sha256, bytes."""
    out = []
    root = Path(root)
    folders = sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: (ROLE_ORDER.index(p.name) if p.name in ROLE_ORDER else 99, p.name)) if root.exists() else []
    for folder in folders:
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() in EXTS:
                data = f.read_bytes()
                out.append({"folder": folder.name, "name": f.name, "path": str(f), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
    return out


def find_duplicates(records):
    """Exact duplicate groups, and which folder pairs they connect."""
    by_hash = defaultdict(list)
    for r in records:
        by_hash[r["sha256"]].append(r)
    groups = [g for g in by_hash.values() if len(g) > 1]
    cross, within = Counter(), Counter()
    for g in groups:
        folders = sorted({r["folder"] for r in g})
        if len(folders) == 1:
            within[folders[0]] += len(g) - 1
        else:
            for i, a in enumerate(folders):
                for b in folders[i + 1:]:
                    cross[f"{a} = {b}"] += 1
    return {"groups": len(groups), "files_in_groups": sum(len(g) for g in groups),
            "cross_folder_pairs": dict(cross), "within_folder_extra_copies": dict(within), "_groups": groups}


def resolve_exclusions(records):
    """-> {(folder, name): reason} for files that must not be counted twice or with conflicting labels."""
    excluded = {}
    for g in find_duplicates(records)["_groups"]:
        roles = {role_of(r["folder"])[0] for r in g}
        order = sorted(g, key=lambda r: (ROLE_ORDER.index(r["folder"]) if r["folder"] in ROLE_ORDER else 99, r["name"]))
        if "negative" in roles and "positive" in roles:
            for r in g:
                excluded[(r["folder"], r["name"])] = "label conflict: the same file is in a good and a bad folder"
            continue
        keep = order[0]
        for r in order[1:]:
            excluded[(r["folder"], r["name"])] = f"exact duplicate of {keep['folder']}/{keep['name']}"
    return excluded


def describe(path):
    """Decode once: size, format, camera make/model, perceptual hash. None if undecodable."""
    p = Path(path)
    data = p.read_bytes()
    try:
        img = open_image(data)
    except ImageDecodeError:
        return None
    ex = read_exif(data)
    return {"width": img.width, "height": img.height, "mp": img.width * img.height / 1e6,
            "camera": " ".join(x for x in (ex.get("make"), ex.get("model")) if x) or None, "dhash": dhash_hex(data)}


def near_duplicates(items):
    """items: [(folder, name, dhash)] -> cross-folder pairs within NEAR_BITS (quadratic; fine for thousands)."""
    pairs = []
    for i, (fa, na, ha) in enumerate(items):
        for fb, nb, hb in items[i + 1:]:
            if fa != fb and hamming_hex(ha, hb) <= NEAR_BITS:
                pairs.append((f"{fa}/{na}", f"{fb}/{nb}"))
    return pairs


def folder_summary(records, descs, excluded, trusted=()):
    out = {}
    for folder in dict.fromkeys(r["folder"] for r in records):
        rs = [r for r in records if r["folder"] == folder]
        ds = [descs[(r["folder"], r["name"])] for r in rs if descs.get((r["folder"], r["name"]))]
        role, why = role_of(folder, trusted)
        mp = [d["mp"] for d in ds]
        cams = Counter(d["camera"] or "no EXIF camera" for d in ds)
        out[folder] = {
            "files": len(rs), "undecodable": len(rs) - len(ds),
            "excluded": sum(1 for r in rs if (folder, r["name"]) in excluded),
            "counted": sum(1 for r in rs if (folder, r["name"]) not in excluded) if role != "unknown" else 0,
            "role": role, "role_reason": why, "provenance": "REAL",
            "formats": dict(Counter(Path(r["name"]).suffix.lower().lstrip(".") for r in rs)),
            "megapixels": {"min": min(mp), "median": statistics.median(mp), "max": max(mp)} if mp else None,
            "cameras": dict(cams.most_common(6)), "n_camera_models": len(cams),
        }
    return out
