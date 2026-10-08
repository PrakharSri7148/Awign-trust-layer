"""Validate the web app manifest the Android app (a Trusted Web Activity) needs, in the BUILT client (client/dist) or in client/public.

    cd backend && .venv/bin/python tools/validate_manifest.py [--dist ../client/dist]

Checks: valid JSON; name, short_name; start_url and scope inside the origin ('/'); display standalone; theme and background colours; icons of
192 and 512 px (PNG, the declared size is the real size) and a MASKABLE 512 px icon (the launcher crops it, so the picture must sit in the
centre 80%); every icon file exists. Exit 0 when valid.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def problems(dist: Path) -> list:
    mf = dist / "manifest.webmanifest"
    if not mf.is_file():
        return [f"{mf} is missing"]
    try:
        m = json.loads(mf.read_text())
    except ValueError as e:
        return [f"manifest.webmanifest is not valid JSON ({e})"]
    out = []
    for k in ("name", "short_name"):
        if not isinstance(m.get(k), str) or not m[k].strip():
            out.append(f"{k} is missing")
    if isinstance(m.get("short_name"), str) and len(m["short_name"]) > 12:
        out.append("short_name is longer than 12 characters (the launcher cuts it)")
    if m.get("start_url") not in ("/", "./", "/?source=twa", "/index.html"):
        out.append(f"start_url {m.get('start_url')!r} should be '/' (same origin, the Capture page)")
    if m.get("scope") != "/":
        out.append(f"scope {m.get('scope')!r} should be '/'")
    if m.get("display") != "standalone":
        out.append("display must be 'standalone' (a Trusted Web Activity runs full screen)")
    for k in ("theme_color", "background_color"):
        if not isinstance(m.get(k), str) or not HEX.match(m[k]):
            out.append(f"{k} must be a #rrggbb colour")
    icons = m.get("icons") or []
    have = {(i.get("sizes"), i.get("purpose", "any")) for i in icons if isinstance(i, dict)}
    for sizes, purpose in (("192x192", "any"), ("512x512", "any"), ("512x512", "maskable")):
        if (sizes, purpose) not in have:
            out.append(f"no {sizes} icon with purpose '{purpose}'")
    for i in icons:
        if not isinstance(i, dict):
            out.append("an icon entry is not an object")
            continue
        src = i.get("src", "")
        f = dist / src.lstrip("/")
        if not src.startswith("/") or not f.is_file():
            out.append(f"icon {src!r} does not exist")
            continue
        if i.get("type") != "image/png":
            out.append(f"icon {src} should declare type image/png")
        try:
            from PIL import Image

            with Image.open(f) as im:
                if f"{im.width}x{im.height}" != i.get("sizes"):
                    out.append(f"icon {src} declares {i.get('sizes')} but is {im.width}x{im.height}")
        except Exception:
            out.append(f"icon {src} is not a readable image")
    return out


def check(dist: Path) -> dict:
    ps = problems(Path(dist))
    if ps:
        return {"check": "Web app manifest", "status": "FAIL", "detail": "; ".join(ps)}
    m = json.loads((Path(dist) / "manifest.webmanifest").read_text())
    return {"check": "Web app manifest", "status": "PASS", "detail": f"{m['name']} ({m['short_name']}), standalone, {len(m['icons'])} icons incl. maskable 512"}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dist", default=str(Path(__file__).resolve().parents[2] / "client" / "dist"))
    a = ap.parse_args(argv)
    r = check(Path(a.dist))
    print(f"{r['status']}: {r['detail']}")
    return 0 if r["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
