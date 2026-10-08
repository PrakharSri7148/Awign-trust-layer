"""P0: one public address for everything. The backend serves the BUILT client (client/dist) and the API from the same origin, so there is
no CORS, no mixed content and one address for the tunnel and the Android app.

  /api/<path>   is the API again under a prefix (the client uses '/api' on HTTPS pages, the same base its dev:https mode uses): the prefix
                is stripped before routing, so every API route works both with and without it.
  everything else that is not an API route: a file from client/dist, or index.html for the client's own routes ('/', '/dashboard'),
                so a hard refresh on /dashboard works. Unknown /api/... paths and unknown FILES (a path with an extension) are a plain
                404, never index.html: a missing script must not be answered with a page of HTML.
  caching       hashed files under /assets are immutable for a year; index.html is never cached (it names the current hashed files).

Where the build is: CLIENT_DIST (env, read per request), default <repo>/client/dist. If there is no index.html there the fallback answers
404 and the API behaves exactly as before.
"""
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

API_PREFIX = "/api"
DEFAULT_DIST = Path(__file__).resolve().parents[1] / "client" / "dist"
ASSETLINKS = Path(os.environ.get("ASSETLINKS_FILE", Path(__file__).resolve().parent / "data" / "assetlinks.json"))

IMMUTABLE = "public, max-age=31536000, immutable"
NO_CACHE = "no-cache"
SHORT = "public, max-age=3600"


def dist_dir() -> Path:
    return Path(os.environ.get("CLIENT_DIST") or DEFAULT_DIST)


class ApiPrefix:
    """Pure ASGI middleware: '/api/x' is routed as '/x' ('/api' alone as '/')."""

    def __init__(self, app, prefix: str = API_PREFIX):
        self.app, self.prefix = app, prefix

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if path == self.prefix or path.startswith(self.prefix + "/"):
                new = path[len(self.prefix):] or "/"
                scope = {**scope, "path": new, "raw_path": new.encode(), "via_api_prefix": True}  # the fallback must not answer these with the app
        await self.app(scope, receive, send)


def _file_response(path: Path, rel: str) -> Response:
    if rel == "index.html":
        cache = NO_CACHE
    elif rel.startswith("assets/"):
        cache = IMMUTABLE  # Vite names these by content hash
    else:
        cache = SHORT
    return FileResponse(path, headers={"Cache-Control": cache})


def install(app: FastAPI) -> None:
    """Register the fallback LAST (after every API route) so it can never shadow one."""
    app.add_middleware(ApiPrefix)

    @app.get("/.well-known/assetlinks.json", include_in_schema=False)
    def assetlinks():
        """Digital Asset Links for the Android app (Trusted Web Activity). The file holds the signing fingerprint: placeholder until you run
        the APK build once (docs/apk-build.md)."""
        if not ASSETLINKS.is_file():
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        return Response(ASSETLINKS.read_bytes(), media_type="application/json", headers={"Cache-Control": SHORT})

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def client_files(full_path: str, request: Request):
        root = dist_dir()
        index = root / "index.html"
        not_found = JSONResponse({"detail": "Not Found"}, status_code=404)
        if request.scope.get("via_api_prefix") or full_path in ("api", "docs", "redoc", "openapi.json") or full_path.startswith("api/") or not index.is_file():  # docs are off in public mode: a 404, not the app
            return not_found
        rel = full_path.strip("/")
        if rel:
            try:
                target = (root / rel).resolve()
                inside = root.resolve() in target.parents
            except (OSError, ValueError):
                return not_found
            if inside and target.is_file():
                return _file_response(target, rel)
            if "." in rel.rsplit("/", 1)[-1]:
                return not_found  # a missing file is a 404, not the app
        return _file_response(index, "index.html")
