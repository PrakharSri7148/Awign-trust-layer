"""P1: PUBLIC_MODE=1 refuses to start unless safe, and removes/guards what a public server must not offer (backend/public_mode.py).
Start-up behaviour is tested in a SUBPROCESS (the switch is read when `main` is imported)."""
import asyncio
import json
import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest

import public_mode as pm
from fusion import ipctx

BACKEND = Path(__file__).resolve().parents[1]
TOKEN = "t0ken-for-tests-only-0123456789"  # a TEST value: no real secret is ever written to a file
SAFE = {"PUBLIC_MODE": "1", "DASHBOARD_TOKEN": TOKEN, "TRUSTED_PROXY_HEADER": "x-forwarded-for"}


def run_py(code, env_extra, tmp_path):
    env = {k: v for k, v in os.environ.items() if k not in ("PUBLIC_MODE", "DASHBOARD_TOKEN", "TRUSTED_PROXY_HEADER", "ALLOWED_ORIGINS", "TRUST_LAYER_DB", "ENV_CHECK")}
    env.update(env_extra)
    return subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=240)


# ---------------------------------------------------------------- the checks themselves (fast)

def good_env(tmp_path):
    return {"DASHBOARD_TOKEN": TOKEN, "TRUSTED_PROXY_HEADER": "x-forwarded-for", "TRUST_LAYER_DB": str(tmp_path / "demo.db")}


def test_a_safe_setup_has_no_problems(tmp_path):
    assert pm.problems(good_env(tmp_path), model_path=BACKEND / "fraud_classifier.pkl", ip_installed=True) == []


@pytest.mark.parametrize("drop,needle", [
    ("DASHBOARD_TOKEN", "DASHBOARD_TOKEN is not set"), ("TRUSTED_PROXY_HEADER", "TRUSTED_PROXY_HEADER is not set"), ("TRUST_LAYER_DB", "TRUST_LAYER_DB is not set"),
])
def test_each_missing_variable_gives_its_own_clear_message(tmp_path, drop, needle):
    env = good_env(tmp_path)
    del env[drop]
    ps = pm.problems(env, model_path=BACKEND / "fraud_classifier.pkl", ip_installed=True)
    assert len(ps) == 1 and needle in ps[0]


def test_other_unsafe_setups_are_named(tmp_path):
    env = good_env(tmp_path)
    assert "shorter than" in pm.problems({**env, "DASHBOARD_TOKEN": "short"}, ip_installed=True)[0]
    assert "folder that does not exist" in pm.problems({**env, "TRUST_LAYER_DB": str(tmp_path / "no" / "such" / "x.db")}, ip_installed=True)[0]
    assert "model file" in pm.problems(env, model_path=tmp_path / "gone.pkl", ip_installed=True)[0]
    assert "no IP database" in pm.problems(env, ip_installed=False)[0]
    assert "https origins only" in pm.problems({**env, "ALLOWED_ORIGINS": "http://example.com"}, ip_installed=True)[0]
    assert pm.problems({**env, "ALLOWED_ORIGINS": "https://a.example, https://b.example/"}, ip_installed=True) == []
    assert pm.allowed_origins({"ALLOWED_ORIGINS": "https://a.example, https://b.example/"}) == ["https://a.example", "https://b.example"]


def test_no_problem_message_ever_contains_a_secret_value(tmp_path):
    env = {**good_env(tmp_path), "DASHBOARD_TOKEN": "tiny-secret-value"[:5]}
    assert "tiny-" not in " ".join(pm.problems(env, ip_installed=False))
    assert TOKEN not in " ".join(pm.problems({**good_env(tmp_path)}, ip_installed=False))


def test_refuse_to_start_raises_one_line_per_problem(tmp_path):
    with pytest.raises(RuntimeError) as e:
        pm.refuse_to_start_if_unsafe({"PUBLIC_MODE": "1"}, ip_installed=False)
    lines = str(e.value).splitlines()
    assert lines[0] == "PUBLIC_MODE=1 refused to start:" and len(lines) == 1 + 4  # token, proxy header, database, ip database


def test_public_mode_is_only_on_for_exactly_1():
    for v, expect in (("1", True), (" 1 ", True), ("0", False), ("true", False), ("", False), ("yes", False)):
        assert pm.enabled({"PUBLIC_MODE": v}) is expect


# ---------------------------------------------------------------- the fake IP provider

def test_the_fake_ip_provider_is_refused_in_public_mode(monkeypatch):
    class Fake:
        name = "fake"

        def lookup(self, ip):
            return None

    monkeypatch.setenv("PUBLIC_MODE", "1")
    with pytest.raises(RuntimeError, match="cannot be loaded when PUBLIC_MODE=1"):
        ipctx.set_provider(Fake())
    ipctx.set_provider(None)  # re-detecting the real database is always allowed
    monkeypatch.delenv("PUBLIC_MODE")
    ipctx.set_provider(Fake())  # allowed under test
    ipctx.set_provider(None)


def test_nothing_in_the_product_can_install_a_provider():
    """set_provider is a test hook: grep the product code for any other caller."""
    hits = []
    for f in list(BACKEND.glob("*.py")) + list((BACKEND / "fusion").glob("*.py")) + list((BACKEND / "tools").rglob("*.py")):
        for i, line in enumerate(f.read_text().splitlines(), 1):
            # ipctx.py defines it; preflight.py calls it ONLY to prove that public mode refuses it (check_fake_provider_refused)
            if "set_provider(" in line and not line.lstrip().startswith(("def ", "#", '"""')) and f.name not in ("ipctx.py", "preflight.py"):
                hits.append(f"{f.name}:{i}")
    assert hits == [], hits
    pre = (BACKEND / "tools" / "preflight.py").read_text()
    assert pre.count("set_provider(") == 3 and "def check_fake_provider_refused" in pre  # only the refusal check, nothing else, may use the hook


# ---------------------------------------------------------------- middleware (fast, in-process)

async def _call(app, method="GET", path="/", headers=None, scope_extra=None):
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(m):
        sent.append(m)

    scope = {"type": "http", "method": method, "path": path, "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()], "scheme": "http", **(scope_extra or {})}
    await app(scope, receive, send)
    start = next(m for m in sent if m["type"] == "http.response.start")
    return start["status"], {k.decode(): v.decode() for k, v in start["headers"]}


async def _ok(scope, receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": [(b"content-length", b"0")]})
    await send({"type": "http.response.body", "body": b""})


def test_security_headers_are_added_and_never_overwrite_an_existing_one():
    status, h = asyncio.run(_call(pm.SecurityHeaders(_ok)))
    assert h["x-content-type-options"] == "nosniff" and h["referrer-policy"] == "no-referrer"
    assert h["permissions-policy"] == pm.PERMISSIONS_POLICY
    for feature in ("geolocation=(self)", "camera=(self)", "accelerometer=(self)", "gyroscope=(self)", "microphone=()"):
        assert feature in h["permissions-policy"]

    async def has_own(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": [(b"referrer-policy", b"origin")]})
        await send({"type": "http.response.body", "body": b""})

    assert asyncio.run(_call(pm.SecurityHeaders(has_own)))[1]["referrer-policy"] == "origin"


@pytest.mark.parametrize("method,path,length,status", [
    ("POST", "/submissions", 1_000, 200), ("POST", "/submissions", 25 * 1024 * 1024 + 2 * 1024 * 1024, 200), ("POST", "/submissions", 25 * 1024 * 1024 + 2 * 1024 * 1024 + 1, 413),
    ("POST", "/visits", 200_000, 200), ("POST", "/visits", 300_000, 413), ("PUT", "/sites/s", 300_000, 413), ("POST", "/liveness/challenge", 5_000_000, 413),
    ("POST", "/submissions/1/review", 300_000, 413), ("GET", "/health", None, 200),
])
def test_body_caps_by_endpoint(method, path, length, status):
    app = pm.BodyLimit(_ok, max_photo=25 * 1024 * 1024)
    headers = {} if length is None else {"content-length": str(length)}
    assert asyncio.run(_call(app, method, path, headers))[0] == status


def test_a_write_without_a_content_length_or_with_a_bad_one_is_refused():
    app = pm.BodyLimit(_ok, max_photo=1024)
    assert asyncio.run(_call(app, "POST", "/visits", {}))[0] == 411
    assert asyncio.run(_call(app, "POST", "/visits", {"content-length": "abc"}))[0] == 413
    assert asyncio.run(_call(app, "POST", "/visits", {"content-length": "-5"}))[0] == 413


def test_forwarded_proto_is_honoured_only_with_a_trusted_proxy_header(monkeypatch):
    seen = {}

    async def spy(scope, receive, send):
        seen["scheme"] = scope["scheme"]
        await _ok(scope, receive, send)

    monkeypatch.delenv("TRUSTED_PROXY_HEADER", raising=False)
    asyncio.run(_call(pm.ForwardedProto(spy), headers={"x-forwarded-proto": "https"}))
    assert seen["scheme"] == "http"
    monkeypatch.setenv("TRUSTED_PROXY_HEADER", "x-forwarded-for")
    asyncio.run(_call(pm.ForwardedProto(spy), headers={"x-forwarded-proto": "https"}))
    assert seen["scheme"] == "https"
    asyncio.run(_call(pm.ForwardedProto(spy), headers={"x-forwarded-proto": "javascript"}))
    assert seen["scheme"] == "http"


# ---------------------------------------------------------------- logs

@pytest.mark.parametrize("raw,expect", [
    ('1.2.3.4:5555 - "GET /submissions/1/photo?token=abc123SECRET HTTP/1.1" 200', '1.2.3.0:5555 - "GET /submissions/1/photo?token=*** HTTP/1.1" 200'),
    ("client 203.0.113.77 asked", "client 203.0.113.0 asked"),
    ("v6 2001:4860:4860:0:0:0:0:8888 seen", "v6 2001:4860:4860:: seen"),
    ("GET /x?a=1&token=SECRET&b=2", "GET /x?a=1&token=***&b=2"),
    ("no secrets here", "no secrets here"),
])
def test_log_lines_never_carry_a_raw_ip_or_a_token(raw, expect):
    assert pm.redact(raw) == expect


def test_the_access_log_filter_redacts_uvicorn_style_records():
    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d', ("198.51.100.23:4000", "GET", "/submissions/3/photo?token=SECRET", "1.1", 200), None)
    assert pm.RedactAccessLog().filter(rec) is True
    assert "198.51.100.23" not in rec.msg and "SECRET" not in rec.msg and "198.51.100.0" in rec.msg and rec.args == ()


# ---------------------------------------------------------------- start-up in a subprocess

def test_start_up_is_refused_with_every_problem_listed(tmp_path):
    r = run_py("import main", {"PUBLIC_MODE": "1"}, tmp_path)
    assert r.returncode != 0
    err = r.stderr
    assert "PUBLIC_MODE=1 refused to start" in err and "DASHBOARD_TOKEN is not set" in err and "TRUSTED_PROXY_HEADER is not set" in err and "TRUST_LAYER_DB is not set" in err


def test_without_public_mode_the_same_import_works(tmp_path):
    r = run_py("import main; print('PUBLIC', main.PUBLIC)", {"TRUST_LAYER_DB": str(tmp_path / "x.db")}, tmp_path)
    assert r.returncode == 0 and "PUBLIC False" in r.stdout, r.stderr[-400:]


PROBE = r'''
import json, main
from fastapi.testclient import TestClient
T = "%(token)s"
H = {"Authorization": "Bearer " + T}
out = {}
with TestClient(main.app) as c:
    out["docs"] = [c.get(p).status_code for p in ("/docs", "/redoc", "/openapi.json")]
    r = c.get("/health")
    out["health"] = {"public_mode": r.json()["public_mode"], "env_check": r.json()["env_check"], "headers": {k: r.headers.get(k) for k in ("x-content-type-options", "referrer-policy", "permissions-policy")}}
    out["no_token"] = {p: c.get(p).status_code for p in ("/submissions", "/sites", "/sites/s1", "/reviews/queue", "/submissions/1/photo", "/sites/s1/changes", "/sites/s1/profile", "/submissions/1")}
    out["no_token_write"] = [c.put("/sites/s1", json={"lat": 1, "lng": 1}).status_code, c.post("/sites/s1/reset-fingerprint").status_code,
                             c.post("/submissions/1/review", json={"reviewer": "a", "decision": "approve"}).status_code]
    out["wrong_token"] = c.get("/submissions", headers={"Authorization": "Bearer nope"}).status_code
    out["query_token"] = c.get("/submissions?token=" + T).status_code
    out["with_token"] = [c.get("/submissions", headers=H).status_code, c.put("/sites/s1", json={"lat": 12.9, "lng": 77.6, "radius_m": 50}, headers=H).status_code]
    out["worker_open"] = [c.post("/visits", json={"worker_id": "w", "task_id": "t", "site_id": "s1"}).status_code, c.get("/health").status_code]
    out["too_big"] = [c.put("/sites/s1", content=b"x" * 300000, headers={**H, "Content-Type": "application/json"}).status_code,
                      c.post("/visits", content=b"x" * 300000, headers={"Content-Type": "application/json"}).status_code]
    out["cors"] = c.options("/submissions", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}).headers.get("access-control-allow-origin")
    out["cors_own"] = c.options("/submissions", headers={"Origin": "https://demo.example", "Access-Control-Request-Method": "POST"}).headers.get("access-control-allow-origin")
    out["env_check"] = c.get("/env/check").status_code
    out["api_prefix"] = c.get("/api/health").status_code
    out["unknown_api"] = c.get("/api/nothing").status_code
try:
    from fusion import ipctx
    class F:
        name = "f"
        def lookup(self, ip): return None
    ipctx.set_provider(F())
    out["fake_provider"] = "LOADED"
except RuntimeError as e:
    out["fake_provider"] = str(e)
print("PROBE" + json.dumps(out), flush=True)
import os
os._exit(0)  # the face-model warm-up thread can crash a normal interpreter shutdown; the result is already printed
'''


@pytest.fixture(scope="module")
def probe(tmp_path_factory):
    if not ipctx.DbIpProvider.from_dir(ipctx.DEFAULT_DIR):
        pytest.skip("needs the real DB-IP files installed (public mode refuses to start without them)")
    tmp = tmp_path_factory.mktemp("public")
    env = {**SAFE, "TRUST_LAYER_DB": str(tmp / "p.db"), "PHOTO_DIR": str(tmp / "up"), "ALLOWED_ORIGINS": "https://demo.example", "ENV_CHECK": "1"}
    r = run_py(PROBE % {"token": TOKEN}, env, tmp)
    assert r.returncode == 0, r.stderr[-800:]
    line = next(l for l in r.stdout.splitlines() if l.startswith("PROBE"))
    return json.loads(line[5:]), r


def test_public_mode_starts_with_a_safe_setup_and_has_no_docs(probe):
    out, _ = probe
    assert out["docs"] == [404, 404, 404]
    assert out["health"]["public_mode"] is True


def test_every_response_carries_the_security_headers(probe):
    h = probe[0]["health"]["headers"]
    assert h["x-content-type-options"] == "nosniff" and h["referrer-policy"] == "no-referrer" and "geolocation=(self)" in h["permissions-policy"]


def test_dashboard_photo_sites_and_review_endpoints_need_the_token(probe):
    out = probe[0]
    assert set(out["no_token"].values()) == {401}, out["no_token"]
    assert out["no_token_write"] == [401, 401, 401] and out["wrong_token"] == 401
    assert out["with_token"] == [200, 200] and out["query_token"] == 200  # the <img> form (?token=) still works


def test_worker_endpoints_stay_open(probe):
    assert probe[0]["worker_open"] == [200, 200]


def test_oversized_bodies_are_refused_before_they_are_read(probe):
    assert probe[0]["too_big"] == [413, 413]


def test_cors_allows_only_the_exact_origin_you_named(probe):
    out = probe[0]
    assert out["cors"] is None and out["cors_own"] == "https://demo.example"


def test_env_check_is_allowed_and_reports_that_it_is_on(probe):
    assert probe[0]["env_check"] == 200 and probe[0]["health"]["env_check"] is True


def test_the_api_prefix_works_and_unknown_api_paths_404(probe):
    assert probe[0]["api_prefix"] == 200 and probe[0]["unknown_api"] == 404


def test_the_fake_ip_provider_is_refused_in_the_running_public_server(probe):
    assert "cannot be loaded when PUBLIC_MODE=1" in probe[0]["fake_provider"]


def test_the_token_never_appears_in_the_servers_output(probe):
    _, r = probe
    assert TOKEN not in r.stdout and TOKEN not in r.stderr
