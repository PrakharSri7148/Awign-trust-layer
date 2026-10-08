"""P1: PUBLIC_MODE=1 is the one switch that turns the server into something safe to put on the internet through a tunnel. It does NOT add features:
it REFUSES to start unless the setup is safe, and it removes what a public server must not offer.

Refuses to start (with one clear line per problem) unless:
  DASHBOARD_TOKEN           is set (at least 12 characters): the dashboard, photos, sites and review endpoints need it
  TRUSTED_PROXY_HEADER      is set (x-forwarded-for for ngrok, cf-connecting-ip for Cloudflare): otherwise every visitor looks like the tunnel
  TRUST_LAYER_DB            is set explicitly and its folder exists (no accidental default database)
  the model file            exists
  the IP database           is installed (the network check is the point of the demo)
  ALLOWED_ORIGINS           if set, every entry is an https origin
In public mode: /docs, /redoc and /openapi.json are off, CORS allows only ALLOWED_ORIGINS (none needed for the single-origin build), the fake IP
provider hook (ipctx.set_provider) refuses to load anything, request bodies are capped, logs never carry a raw IP or a token, and responses
carry security headers. Worker endpoints (POST /submissions, /visits, /liveness/challenge, GET /health) stay open: workers have no token.
The security headers are set in every mode (they are harmless in development).
"""
import logging
import os
import re
from pathlib import Path

MIN_TOKEN = 12
PERMISSIONS_POLICY = "geolocation=(self), camera=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), microphone=()"
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": PERMISSIONS_POLICY,
}


def enabled(env=None) -> bool:
    return (env if env is not None else os.environ).get("PUBLIC_MODE", "").strip() == "1"


def allowed_origins(env=None) -> list:
    raw = (env if env is not None else os.environ).get("ALLOWED_ORIGINS", "")
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


def problems(env=None, *, model_path=None, ip_installed=None) -> list:
    """-> a list of plain sentences, empty when the setup is safe for public mode. Never includes a secret's value."""
    env = env if env is not None else os.environ
    out = []
    token = env.get("DASHBOARD_TOKEN", "").strip()
    if not token:
        out.append("DASHBOARD_TOKEN is not set: without it anyone on the internet could read every photo and location. Set it to a long random secret.")
    elif len(token) < MIN_TOKEN:
        out.append(f"DASHBOARD_TOKEN is shorter than {MIN_TOKEN} characters: use a long random secret.")
    if not env.get("TRUSTED_PROXY_HEADER", "").strip():
        out.append("TRUSTED_PROXY_HEADER is not set: behind a tunnel every visitor would look like the tunnel and the IP check would see nothing "
                   "(ngrok: x-forwarded-for, Cloudflare: cf-connecting-ip).")
    db = env.get("TRUST_LAYER_DB", "").strip()
    if not db:
        out.append("TRUST_LAYER_DB is not set: name the database file explicitly so a demo can never start on the wrong one.")
    elif not Path(db).expanduser().resolve().parent.is_dir():
        out.append("TRUST_LAYER_DB points into a folder that does not exist.")
    if model_path is not None and not Path(model_path).is_file():
        out.append(f"the model file {Path(model_path).name} does not exist (run ./train.sh in backend/).")
    if ip_installed is False:
        out.append("no IP database is installed: run `cd backend && .venv/bin/python tools/fetch_geoip.py`.")
    for o in allowed_origins(env):
        if not o.startswith("https://"):
            out.append("ALLOWED_ORIGINS must list https origins only.")
            break
    return out


def refuse_to_start_if_unsafe(env=None, *, model_path=None, ip_installed=None) -> None:
    ps = problems(env, model_path=model_path, ip_installed=ip_installed)
    if ps:
        raise RuntimeError("PUBLIC_MODE=1 refused to start:\n  - " + "\n  - ".join(ps))


# ---------------------------------------------------------------- middleware (pure ASGI)

class SecurityHeaders:
    def __init__(self, app, headers=None):
        self.app, self.headers = app, [(k.lower().encode(), v.encode()) for k, v in (headers or SECURITY_HEADERS).items()]

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def wrapped(message):
            if message["type"] == "http.response.start":
                have = {k.lower() for k, _ in message.get("headers", [])}
                message = {**message, "headers": list(message.get("headers", [])) + [(k, v) for k, v in self.headers if k not in have]}
            await send(message)

        await self.app(scope, receive, wrapped)


class ForwardedProto:
    """Behind a TLS tunnel the app sees http; honour X-Forwarded-Proto: https, but only when a trusted proxy header is configured."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and os.environ.get("TRUSTED_PROXY_HEADER", "").strip():
            for k, v in scope.get("headers", []):
                if k == b"x-forwarded-proto" and v.strip().lower() in (b"https", b"http"):
                    scope = {**scope, "scheme": v.strip().decode().lower()}
                    break
        await self.app(scope, receive, send)


def body_cap(method: str, path: str, max_photo: int) -> int:
    """The largest request body this endpoint may receive, in bytes."""
    if method == "POST" and path.rstrip("/") in ("/submissions",):
        return max_photo + 2 * 1024 * 1024  # the photo plus the JSON payload (trail, motion samples)
    return 256 * 1024  # visits, liveness challenges, reviews, site edits are small JSON


class BodyLimit:
    """Public mode: refuse oversized bodies before they are read, and bodies of unknown size on writes."""

    def __init__(self, app, max_photo: int):
        self.app, self.max_photo = app, max_photo

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] in ("POST", "PUT", "PATCH"):
            path = scope.get("path", "")
            if path.startswith("/api/") or path == "/api":
                path = path[4:] or "/"
            length = None
            for k, v in scope.get("headers", []):
                if k == b"content-length":
                    try:
                        length = int(v)
                    except ValueError:
                        length = -1
                    break
            status = detail = None
            if length is None:
                status, detail = 411, "Content-Length is required"
            elif length < 0 or length > body_cap(scope["method"], path, self.max_photo):
                status, detail = 413, "Request body too large"
            if status:
                body = ('{"detail": "%s"}' % detail).encode()
                await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


# ---------------------------------------------------------------- logs

_TOKEN = re.compile(r"(token=)[^&\s\"']+", re.I)
_IPV4 = re.compile(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b")
_IPV6 = re.compile(r"\b((?:[0-9a-f]{1,4}:){3})(?:[0-9a-f]{0,4}:){1,5}[0-9a-f]{0,4}\b", re.I)


def redact(text: str) -> str:
    """No raw IP and no token in a log line: tokens become token=***, IPv4 keeps three octets, IPv6 only its /48."""
    text = _TOKEN.sub(r"\1***", str(text))
    text = _IPV4.sub(r"\1.0", text)
    return _IPV6.sub(r"\1:", text)


class RedactAccessLog(logging.Filter):
    """uvicorn's access log carries the client address and the full path (including ?token=): redact both."""

    def filter(self, record):
        try:
            record.msg = redact(record.getMessage())
            record.args = ()
        except Exception:
            record.msg, record.args = "(access log line withheld)", ()
        return True


def install_log_redaction() -> None:
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn", "trust_layer", "trust_layer.ipctx"):
        lg = logging.getLogger(name)
        if not any(isinstance(f, RedactAccessLog) for f in lg.filters):
            lg.addFilter(RedactAccessLog())
