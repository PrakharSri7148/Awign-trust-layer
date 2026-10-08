"""One command before the demo: is everything ready? Prints a green / red table and exits 0 only when nothing is red.

    cd backend && .venv/bin/python tools/preflight.py --url https://<your-domain>          # the real check, with the tunnel up
    cd backend && .venv/bin/python tools/preflight.py --pre-tunnel                         # everything that does not need the tunnel

It reads the SAME environment variables the server will start with (PUBLIC_MODE=1 is assumed: that is how the demo runs), so run it in the shell
that runs `demo-up`. Read-only: it never writes to the database, never logs in anywhere, and only calls your public URL for GET /health, the manifest
and assetlinks.json. It never prints a secret's value.
Status words: PASS, FAIL, NEEDS <what> (a check that cannot run yet, e.g. no tunnel; allowed only with --pre-tunnel).
"""
import argparse
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

PASS, FAIL = "PASS", "FAIL"
DEV_DB = BACKEND / "trust_layer.db"
MIN_FREE_GB = 1.0


def _c(name, status, detail=""):
    return {"check": name, "status": status, "detail": detail}


def check_ip_database(env):
    from fusion import ipctx

    st = ipctx.DbIpProvider.from_dir(env.get("GEOIP_DIR") or ipctx.DEFAULT_DIR)
    if st is None:
        return _c("IP database", FAIL, "no DB-IP files found: run `.venv/bin/python tools/fetch_geoip.py`")
    s = st.status()
    if not (s["has_city"] and s["has_asn"]):
        return _c("IP database", FAIL, "the city and the ASN file are both needed")
    if s["stale"]:
        return _c("IP database", FAIL, f"data is {s['age_days']} days old (limit {ipctx.STALE_DAYS}): run tools/fetch_geoip.py")
    ctx = st.lookup("8.8.8.8")
    if not ctx or ctx.country != "US" or not ctx.asn:
        return _c("IP database", FAIL, "a lookup of a well-known address did not give the expected country and provider")
    return _c("IP database", PASS, f"data from {s['date']} ({s['age_days']} days old); 8.8.8.8 -> {ctx.country}, AS{ctx.asn}")


def check_site(env):
    import sqlite3

    db = env.get("TRUST_LAYER_DB", "").strip()
    if not db or not Path(db).is_file():
        return _c("A site is registered", FAIL, "the database file does not exist yet: start the server once, then register the site in the dashboard")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        rows = con.execute("select site_id, lat, lng, radius_m, country from site").fetchall()
    except sqlite3.Error:
        return _c("A site is registered", FAIL, "this database has no site table")
    finally:
        con.close()
    if not rows:
        return _c("A site is registered", FAIL, "no site: open the dashboard > Site location and register the demo site")
    bad = [r[0] for r in rows if not (-90 <= r[1] <= 90 and -180 <= r[2] <= 180) or (abs(r[1]) < 1e-6 and abs(r[2]) < 1e-6) or not (5 <= r[3] <= 5000)]
    if bad:
        return _c("A site is registered", FAIL, f"implausible coordinates or radius for {', '.join(bad)}")
    no_country = [r[0] for r in rows if not r[4]]
    if no_country:
        return _c("A site is registered", FAIL, f"{', '.join(no_country)} has no country: the 'network is in another country' check is OFF. Set it in Site location")
    return _c("A site is registered", PASS, f"{len(rows)} site(s): " + ", ".join(f"{r[0]} (r {r[3]:g} m, {r[4]})" for r in rows))


def check_model():
    import classifier

    if not classifier.MODEL_PATH.is_file():
        return _c("Model", FAIL, f"{classifier.MODEL_PATH.name} not found")
    prev, bad = None, []
    for i in range(101):
        p = classifier.score_submission(0.9, 0.97, i / 100.0, env_known=True)["fraud_probability"]
        if prev is not None and p > prev + 1e-9:
            bad.append(i / 100.0)
        prev = p
    if bad:
        return _c("Model", FAIL, f"P(fraud) rises as the environment improves at {bad[:3]}: retrain (./train.sh)")
    lo = classifier.score_submission(0.9, 0.97, 0.17, env_known=True)["fraud_probability"]
    hi = classifier.score_submission(0.9, 0.97, 1.0, env_known=True)["fraud_probability"]
    unk = classifier.score_submission(0.9, 0.97, 0.5, env_known=False)["fraud_probability"]
    if not (lo > 0.5 > hi) or unk > 0.5:
        return _c("Model", FAIL, f"unexpected probabilities: foreign VPN {lo:.2f}, clean {hi:.2f}, unknown {unk:.2f}")
    return _c("Model", PASS, f"{classifier.MODEL_PATH.name} loads; the 101-point environment scan is monotone; foreign VPN {lo:.2f}, clean {hi:.2f}, unknown {unk:.2f}")


def check_public_mode(env):
    import public_mode

    problems = public_mode.problems(env, ip_installed=True)
    if env.get("PUBLIC_MODE", "").strip() != "1":
        problems = ["PUBLIC_MODE is not 1 in this shell"] + problems
    if problems:
        return _c("Public mode", FAIL, "; ".join(problems))
    return _c("Public mode", PASS, "PUBLIC_MODE=1, a long DASHBOARD_TOKEN, TRUSTED_PROXY_HEADER and TRUST_LAYER_DB are set (values not shown)")


def check_demo_database(env, allow_dev_db=False):
    db = env.get("TRUST_LAYER_DB", "").strip()
    if not db:
        return _c("Demo database", FAIL, "TRUST_LAYER_DB is not set")
    if Path(db).resolve() == DEV_DB.resolve() and not allow_dev_db:
        return _c("Demo database", FAIL, "this is your development database (backend/trust_layer.db): use a separate demo database, e.g. TRUST_LAYER_DB=backend/data/demo.db "
                  "(copy the file once if you want to keep the site and what it learned), or pass --allow-dev-db")
    return _c("Demo database", PASS, Path(db).name + (" (the development database, allowed by --allow-dev-db)" if Path(db).resolve() == DEV_DB.resolve() else ""))


def check_fake_provider_refused():
    from fusion import ipctx

    class Fake:
        name = "fake"

        def lookup(self, ip):
            return None

    old = os.environ.get("PUBLIC_MODE")
    os.environ["PUBLIC_MODE"] = "1"
    try:
        ipctx.set_provider(Fake())
        ipctx.set_provider(None)
        return _c("No fake IP in public mode", FAIL, "the test IP provider could be loaded with PUBLIC_MODE=1")
    except RuntimeError:
        return _c("No fake IP in public mode", PASS, "ipctx.set_provider refuses anything with PUBLIC_MODE=1")
    finally:
        ipctx.set_provider(None)
        if old is None:
            os.environ.pop("PUBLIC_MODE", None)
        else:
            os.environ["PUBLIC_MODE"] = old


def check_build(dist):
    dist = Path(dist)
    if not (dist / "index.html").is_file():
        return _c("Client build", FAIL, f"{dist} has no index.html: run `cd client && npm run build:prod`")
    info_file = dist / "build-info.json"
    if not info_file.is_file():
        return _c("Client build", FAIL, "build-info.json is missing: build with `npm run build:prod` (not `npm run build`)")
    info = json.loads(info_file.read_text())
    if info.get("demo_tools"):
        return _c("Client build", FAIL, "the build has the developer/demo tools switched on (VITE_DEMO_TOOLS): rebuild with `npm run build:prod`")
    if info.get("api_url") != "/api":
        return _c("Client build", FAIL, f"the build points at {info.get('api_url')!r} instead of the same-origin '/api': rebuild with `npm run build:prod`")
    html = (dist / "index.html").read_text()
    if "fonts.googleapis.com" in html or "fonts.gstatic.com" in html:
        return _c("Client build", FAIL, "index.html still loads fonts from a third party")
    if '<link rel="manifest"' not in html:
        return _c("Client build", FAIL, "index.html has no manifest link (needed for the Android app)")
    return _c("Client build", PASS, f"built {info.get('built_at', '?')}, same-origin /api, no demo tools, no third-party requests in index.html")


def check_disk(env):
    path = Path(env.get("TRUST_LAYER_DB") or BACKEND).expanduser().resolve()
    probe = path if path.exists() else path.parent
    free = shutil.disk_usage(probe if probe.exists() else BACKEND).free / 1e9
    return _c("Disk space", PASS if free >= MIN_FREE_GB else FAIL, f"{free:.1f} GB free")


def check_manifest(dist):
    from tools import validate_manifest

    return validate_manifest.check(Path(dist))


def check_assetlinks(env):
    import serving

    f = serving.ASSETLINKS
    if not f.is_file():
        return _c("assetlinks.json", FAIL, f"{f.name} is missing")
    try:
        data = json.loads(f.read_text())
        fp = [x for e in data for x in (e.get("target", {}).get("sha256_cert_fingerprints") or [])]
    except (ValueError, AttributeError):
        return _c("assetlinks.json", FAIL, "not valid JSON")
    if not fp or any("REPLACE" in x.upper() for x in fp):
        return _c("assetlinks.json", "NEEDS N3", "still the placeholder: build the APK once and put its SHA-256 fingerprint in (docs/apk-build.md). The app works without it but shows a browser address bar")
    return _c("assetlinks.json", PASS, f"{len(fp)} fingerprint(s)")


def _get(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "trust-layer-preflight"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers.get("content-type", ""), r.read(200000)


def check_public_url(url, env):
    if not url:
        return [_c("Public URL answers", "NEEDS N1", "no --url given: needs the tunnel (N1)")]
    out = []
    base = url.rstrip("/")
    if not base.startswith("https://"):
        return [_c("Public URL answers", FAIL, "the public address must be https")]
    try:
        s, ct, body = _get(base + "/health")
        j = json.loads(body)
        if not isinstance(j, dict) or not isinstance(j.get("ip_database", {}), dict):
            out.append(_c("Public URL: /health", FAIL, "the address answers, but not with this backend's /health"))
            return out
        ok = s == 200 and j.get("status") == "ok" and j.get("public_mode") is True and j.get("ip_database", {}).get("installed") is True
        out.append(_c("Public URL: /health", PASS if ok else FAIL,
                      f"public_mode={j.get('public_mode')}, IP database installed={j.get('ip_database', {}).get('installed')}, ENV_CHECK on={j.get('env_check')}"))
    except (urllib.error.URLError, ValueError, OSError) as e:
        out.append(_c("Public URL: /health", FAIL, f"{type(e).__name__}: could not read /health at that address"))
        return out
    for path, name, want in (("/manifest.webmanifest", "manifest", "manifest"), ("/.well-known/assetlinks.json", "assetlinks.json", "json")):
        try:
            s, ct, body = _get(base + path)
            ok = s == 200 and want in ct
            out.append(_c(f"Public URL: {name}", PASS if ok else FAIL, f"{s} {ct.split(';')[0]}"))
        except (urllib.error.URLError, OSError) as e:
            out.append(_c(f"Public URL: {name}", FAIL, f"{type(e).__name__}"))
    for path in ("/submissions", "/docs"):
        try:
            s, ct, _ = _get(base + path)
            leaked = s == 200 and "json" in ct
            out.append(_c(f"Public URL: {path} is closed", FAIL if leaked else PASS, f"{s}"))
        except urllib.error.HTTPError as e:
            out.append(_c(f"Public URL: {path} is closed", PASS if e.code in (401, 403, 404) else FAIL, str(e.code)))
        except (urllib.error.URLError, OSError):
            out.append(_c(f"Public URL: {path} is closed", FAIL, "no answer"))
    return out


def run_checks(env=None, *, url=None, dist=None, allow_dev_db=False):
    env = env if env is not None else dict(os.environ)
    dist = dist or env.get("CLIENT_DIST") or (BACKEND.parent / "client" / "dist")
    results = [
        check_public_mode(env), check_demo_database(env, allow_dev_db), check_ip_database(env), check_site(env), check_model(), check_fake_provider_refused(),
        check_build(dist), check_manifest(dist), check_assetlinks(env), check_disk(env),
    ]
    results += check_public_url(url, env)
    return results


def render(results):
    w = max(len(r["check"]) for r in results)
    lines = [f"{'GREEN' if r['status'] == PASS else 'RED  ' if r['status'] == FAIL else 'WAIT '}  {r['check']:<{w}}  {r['status']:<8} {r['detail']}" for r in results]
    return "\n".join(lines)


def exit_code(results, pre_tunnel=False):
    if any(r["status"] == FAIL for r in results):
        return 1
    if not pre_tunnel and any(r["status"] not in (PASS,) for r in results):
        return 1
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=None, help="your public https address (needs the tunnel up)")
    ap.add_argument("--pre-tunnel", action="store_true", help="allow checks that need the tunnel or the APK fingerprint to stay 'NEEDS ...'")
    ap.add_argument("--allow-dev-db", action="store_true")
    ap.add_argument("--dist", default=None)
    a = ap.parse_args(argv)
    res = run_checks(url=a.url, dist=a.dist, allow_dev_db=a.allow_dev_db)
    print(f"Preflight {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n")
    print(render(res))
    code = exit_code(res, a.pre_tunnel)
    print("\n" + ("READY: nothing is red." if code == 0 else "NOT READY: fix the red lines above."))
    return code


if __name__ == "__main__":
    sys.exit(main())
