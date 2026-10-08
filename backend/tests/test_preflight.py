"""P3/P4: the manifest validator and the preflight (tools/preflight.py), each check against a broken setup and a good one."""
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

import serving
from fusion import ipctx
from tools import make_icons, preflight, validate_manifest

BACKEND = Path(__file__).resolve().parents[1]
TOKEN = "t0ken-for-tests-only-0123456789"
GOOD_MANIFEST = {
    "name": "Trust Layer", "short_name": "Trust Layer", "start_url": "/", "scope": "/", "display": "standalone", "theme_color": "#05070d", "background_color": "#05070d",
    "icons": [{"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"}, {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
              {"src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
}


@pytest.fixture(scope="module")
def icons(tmp_path_factory):
    d = tmp_path_factory.mktemp("icons")
    make_icons.main(["--out", str(d)])
    return d


def build_dist(tmp_path, icons, *, manifest=None, info=None, html=None):
    dist = tmp_path / "dist"
    (dist / "icons").mkdir(parents=True)
    for f in icons.glob("*.png"):
        (dist / "icons" / f.name).write_bytes(f.read_bytes())
    (dist / "manifest.webmanifest").write_text(json.dumps(GOOD_MANIFEST if manifest is None else manifest))
    (dist / "index.html").write_text(html or '<html><head><link rel="manifest" href="/manifest.webmanifest"></head><body></body></html>')
    (dist / "build-info.json").write_text(json.dumps(info or {"built_at": "2026-10-08T10:00:00Z", "demo_tools": False, "api_url": "/api"}))
    return dist


# ---------------------------------------------------------------- icons and the manifest validator

def test_the_generated_icons_have_the_declared_sizes(icons):
    from PIL import Image

    for name, size in (("icon-192.png", 192), ("icon-512.png", 512), ("icon-maskable-512.png", 512), ("apple-touch-icon.png", 180)):
        with Image.open(icons / name) as im:
            assert im.size == (size, size) and im.mode == "RGB"


def test_the_icons_are_deterministic(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    make_icons.main(["--out", str(a)])
    make_icons.main(["--out", str(b)])
    assert (a / "icon-512.png").read_bytes() == (b / "icon-512.png").read_bytes()


def test_a_maskable_icon_keeps_its_picture_inside_the_safe_zone(icons):
    """The launcher crops a maskable icon; everything but the dark background must sit inside the centre 80%."""
    import numpy as np
    from PIL import Image

    with Image.open(icons / "icon-maskable-512.png") as im:
        a = np.asarray(im).astype(int)
    ink = (np.abs(a - np.array(make_icons.BG)).sum(axis=2) > 40)
    ys, xs = np.where(ink)
    assert xs.min() >= 512 * 0.1 and xs.max() <= 512 * 0.9 and ys.min() >= 512 * 0.1 and ys.max() <= 512 * 0.9


def test_the_real_manifest_in_client_public_is_valid():
    assert validate_manifest.problems(BACKEND.parent / "client" / "public") == []


def test_a_good_manifest_passes(tmp_path, icons):
    assert validate_manifest.problems(build_dist(tmp_path, icons)) == []


@pytest.mark.parametrize("patch,needle", [
    ({"name": ""}, "name is missing"), ({"short_name": "x" * 20}, "longer than 12"), ({"start_url": "https://elsewhere.example/"}, "start_url"),
    ({"scope": "/app/"}, "scope"), ({"display": "browser"}, "standalone"), ({"theme_color": "red"}, "theme_color"), ({"background_color": None}, "background_color"),
])
def test_each_manifest_mistake_is_named(tmp_path, icons, patch, needle):
    ps = validate_manifest.problems(build_dist(tmp_path, icons, manifest={**GOOD_MANIFEST, **patch}))
    assert any(needle in p for p in ps), ps


def test_missing_or_wrong_icons_are_named(tmp_path, icons):
    no_mask = {**GOOD_MANIFEST, "icons": GOOD_MANIFEST["icons"][:2]}
    assert any("maskable" in p for p in validate_manifest.problems(build_dist(tmp_path / "a", icons, manifest=no_mask)))
    wrong = {**GOOD_MANIFEST, "icons": [{**GOOD_MANIFEST["icons"][0], "sizes": "512x512"}] + GOOD_MANIFEST["icons"][1:]}
    assert any("declares 512x512 but is 192x192" in p for p in validate_manifest.problems(build_dist(tmp_path / "b", icons, manifest=wrong)))
    gone = {**GOOD_MANIFEST, "icons": GOOD_MANIFEST["icons"] + [{"src": "/icons/none.png", "sizes": "96x96", "type": "image/png"}]}
    assert any("does not exist" in p for p in validate_manifest.problems(build_dist(tmp_path / "c", icons, manifest=gone)))


def test_no_manifest_and_a_broken_one(tmp_path):
    assert "is missing" in validate_manifest.problems(tmp_path)[0]
    (tmp_path / "manifest.webmanifest").write_text("{nope")
    assert "not valid JSON" in validate_manifest.problems(tmp_path)[0]


# ---------------------------------------------------------------- the checks

def good_env(tmp_path):
    return {"PUBLIC_MODE": "1", "DASHBOARD_TOKEN": TOKEN, "TRUSTED_PROXY_HEADER": "x-forwarded-for", "TRUST_LAYER_DB": str(tmp_path / "demo.db")}


def make_db(path, sites=(), profile=False):
    con = sqlite3.connect(path)
    con.execute("create table site (site_id text primary key, lat real, lng real, radius_m real, country text, label text)")
    for s in sites:
        con.execute("insert into site values (?,?,?,?,?,?)", s)
    con.commit()
    con.close()


def test_public_mode_check(tmp_path):
    env = good_env(tmp_path)
    assert preflight.check_public_mode(env)["status"] == "PASS"
    assert TOKEN not in preflight.check_public_mode(env)["detail"]
    for drop in ("PUBLIC_MODE", "DASHBOARD_TOKEN", "TRUSTED_PROXY_HEADER", "TRUST_LAYER_DB"):
        e = {k: v for k, v in env.items() if k != drop}
        r = preflight.check_public_mode(e)
        assert r["status"] == "FAIL", drop
    assert preflight.check_public_mode({**env, "DASHBOARD_TOKEN": "short"})["status"] == "FAIL"


def test_the_demo_database_must_not_be_the_development_database(tmp_path):
    assert preflight.check_demo_database({}, False)["status"] == "FAIL"
    assert preflight.check_demo_database({"TRUST_LAYER_DB": str(preflight.DEV_DB)}, False)["status"] == "FAIL"
    assert preflight.check_demo_database({"TRUST_LAYER_DB": str(preflight.DEV_DB)}, True)["status"] == "PASS"
    assert preflight.check_demo_database({"TRUST_LAYER_DB": str(tmp_path / "demo.db")}, False)["status"] == "PASS"


def test_the_site_check(tmp_path):
    env = good_env(tmp_path)
    assert preflight.check_site(env)["status"] == "FAIL"  # no file yet
    make_db(tmp_path / "demo.db")
    assert "no site" in preflight.check_site(env)["detail"]
    for name, row, needle in (("zero", ("s", 0.0, 0.0, 100.0, "IN", "x"), "implausible"), ("far", ("s", 95.0, 10.0, 100.0, "IN", "x"), "implausible"),
                              ("tiny", ("s", 12.9, 77.6, 1.0, "IN", "x"), "implausible"), ("nocountry", ("s", 12.9, 77.6, 100.0, None, "x"), "no country")):
        p = tmp_path / f"{name}.db"
        make_db(p, [row])
        r = preflight.check_site({**env, "TRUST_LAYER_DB": str(p)})
        assert r["status"] == "FAIL" and needle in r["detail"], (name, r)
    p = tmp_path / "good.db"
    make_db(p, [("site_demo_1", 12.9259481, 77.6722586, 100.0, "IN", "Home")])
    assert preflight.check_site({**env, "TRUST_LAYER_DB": str(p)})["status"] == "PASS"
    junk = tmp_path / "junk.db"
    sqlite3.connect(junk).execute("create table other (a)").connection.commit()
    assert "no site table" in preflight.check_site({**env, "TRUST_LAYER_DB": str(junk)})["detail"]


def test_the_site_check_never_writes_to_the_database(tmp_path):
    p = tmp_path / "ro.db"
    make_db(p, [("s", 12.9, 77.6, 100.0, "IN", "x")])
    before = p.read_bytes()
    preflight.check_site({"TRUST_LAYER_DB": str(p)})
    assert p.read_bytes() == before


def test_the_ip_database_check(tmp_path):
    empty = tmp_path / "geo"
    empty.mkdir()
    r = preflight.check_ip_database({"GEOIP_DIR": str(empty)})
    assert r["status"] == "FAIL" and "fetch_geoip" in r["detail"]
    (empty / "dbip-city-lite-2026-10.mmdb").write_bytes(b"junk")
    assert preflight.check_ip_database({"GEOIP_DIR": str(empty)})["status"] == "FAIL"
    if ipctx.DbIpProvider.from_dir(ipctx.DEFAULT_DIR):
        r = preflight.check_ip_database({})
        assert r["status"] == "PASS" and "8.8.8.8 -> US" in r["detail"]


def test_the_model_check_and_the_fake_provider_check():
    assert preflight.check_model()["status"] == "PASS"
    assert preflight.check_fake_provider_refused()["status"] == "PASS"
    assert os.environ.get("PUBLIC_MODE") != "1"  # the check restores the environment


def test_the_build_check(tmp_path, icons):
    ok = build_dist(tmp_path / "ok", icons)
    assert preflight.check_build(ok)["status"] == "PASS"
    assert "no index.html" in preflight.check_build(tmp_path / "none")["detail"]
    nobi = build_dist(tmp_path / "nobi", icons)
    (nobi / "build-info.json").unlink()
    assert "build:prod" in preflight.check_build(nobi)["detail"]
    demo = build_dist(tmp_path / "demo", icons, info={"demo_tools": True, "api_url": "/api"})
    assert "developer/demo tools" in preflight.check_build(demo)["detail"]
    abs_api = build_dist(tmp_path / "abs", icons, info={"demo_tools": False, "api_url": "http://localhost:8000"})
    assert "same-origin" in preflight.check_build(abs_api)["detail"]
    fonts = build_dist(tmp_path / "fonts", icons, html='<link rel="manifest" href="/m"><link href="https://fonts.googleapis.com/css2?family=Inter">')
    assert "third party" in preflight.check_build(fonts)["detail"]
    nomf = build_dist(tmp_path / "nomf", icons, html="<html></html>")
    assert "manifest link" in preflight.check_build(nomf)["detail"]


def test_assetlinks_placeholder_is_reported_as_needing_n3(tmp_path, monkeypatch):
    f = tmp_path / "assetlinks.json"
    monkeypatch.setattr(serving, "ASSETLINKS", f)
    assert preflight.check_assetlinks({})["status"] == "FAIL"
    f.write_text("not json")
    assert preflight.check_assetlinks({})["status"] == "FAIL"
    f.write_text(json.dumps([{"target": {"sha256_cert_fingerprints": ["REPLACE_WITH_THE_SHA256"]}}]))
    assert preflight.check_assetlinks({})["status"] == "NEEDS N3"
    f.write_text(json.dumps([{"target": {"sha256_cert_fingerprints": ["AB:CD:EF"]}}]))
    assert preflight.check_assetlinks({})["status"] == "PASS"


def test_the_shipped_assetlinks_file_is_a_placeholder_until_n3():
    data = json.loads((BACKEND / "data" / "assetlinks.json").read_text())
    assert "REPLACE" in json.dumps(data) and data[0]["target"]["namespace"] == "android_app"


def test_the_public_url_checks(monkeypatch):
    assert preflight.check_public_url(None, {})[0]["status"] == "NEEDS N1"
    assert preflight.check_public_url("http://x.example", {})[0]["status"] == "FAIL"
    good = {"/health": (200, "application/json", json.dumps({"status": "ok", "public_mode": True, "ip_database": {"installed": True}, "env_check": True}).encode()),
            "/manifest.webmanifest": (200, "application/manifest+json", b"{}"), "/.well-known/assetlinks.json": (200, "application/json", b"[]")}

    def fake_get(url, timeout=10):
        path = "/" + url.split("//", 1)[1].split("/", 1)[1]
        if path in good:
            return good[path]
        import urllib.error

        raise urllib.error.HTTPError(url, 401 if path == "/submissions" else 404, "x", {}, None)

    monkeypatch.setattr(preflight, "_get", fake_get)
    res = preflight.check_public_url("https://demo.example/", {})
    assert all(r["status"] == "PASS" for r in res), res
    good["/health"] = (200, "application/json", json.dumps({"status": "ok", "public_mode": False, "ip_database": {"installed": True}}).encode())
    assert preflight.check_public_url("https://demo.example", {})[0]["status"] == "FAIL"  # a development server, not public mode
    good["/health"] = (200, "application/json", json.dumps({"status": "ok", "public_mode": True, "ip_database": {"installed": True}}).encode())
    monkeypatch.setattr(preflight, "_get", lambda url, timeout=10: good["/health"] if url.endswith("/health") else (200, "application/json", b"[]"))  # the dashboard answers without a token: LEAK
    leaked = preflight.check_public_url("https://demo.example", {})
    assert any(r["check"].endswith("/submissions is closed") and r["status"] == "FAIL" for r in leaked)
    monkeypatch.setattr(preflight, "_get", lambda url, timeout=10: (200, "application/json", b"[]"))  # not this backend at all
    assert preflight.check_public_url("https://demo.example", {})[0]["status"] == "FAIL"


def test_exit_code_rules():
    p = {"check": "a", "status": "PASS", "detail": ""}
    w = {"check": "b", "status": "NEEDS N1", "detail": ""}
    f = {"check": "c", "status": "FAIL", "detail": ""}
    assert preflight.exit_code([p]) == 0
    assert preflight.exit_code([p, w]) == 1 and preflight.exit_code([p, w], pre_tunnel=True) == 0
    assert preflight.exit_code([p, f], pre_tunnel=True) == 1
    out = preflight.render([p, w, f])
    assert out.count("GREEN") == 1 and out.count("WAIT") == 1 and out.count("RED") == 1


def test_the_command_line_is_red_with_a_broken_setup_and_never_prints_the_token(tmp_path):
    env = {k: v for k, v in os.environ.items() if k not in ("PUBLIC_MODE", "DASHBOARD_TOKEN", "TRUSTED_PROXY_HEADER", "TRUST_LAYER_DB", "GEOIP_DIR")}
    env.update({"DASHBOARD_TOKEN": TOKEN, "GEOIP_DIR": str(tmp_path / "empty-geo")})  # no PUBLIC_MODE, no proxy header, no database, no IP database
    r = subprocess.run([sys.executable, "tools/preflight.py", "--pre-tunnel", "--dist", str(tmp_path / "nodist")], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=240)
    assert r.returncode == 1 and "NOT READY" in r.stdout
    assert r.stdout.count("RED") >= 4
    assert TOKEN not in r.stdout and TOKEN not in r.stderr
