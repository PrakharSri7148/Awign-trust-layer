"""Optional protections, all OFF unless configured (the decisions about them are the deployment owner's):

  DASHBOARD_TOKEN=<secret>        the dashboard / reviewer / photo endpoints then need `Authorization: Bearer <secret>`,
                                  `X-Dashboard-Token: <secret>` or `?token=<secret>` (an <img> cannot send headers).
                                  Worker endpoints (POST /submissions, POST /liveness/challenge, GET /health) stay open.
                                  This is a shared secret, not user accounts: put a gateway / SSO in front for real use.
  SUBMISSION_RATE_PER_HOUR=<n>    at most n POST /submissions per worker per hour (default 120); 0 = unlimited.
"""
import os
import secrets
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


def dashboard_token():
    return os.environ.get("DASHBOARD_TOKEN", "").strip() or None


def require_dashboard(request: Request):
    """FastAPI dependency for the endpoints that expose photos, evidence or reviews."""
    token = dashboard_token()
    if token is None:
        return
    supplied = request.headers.get("authorization", "")
    supplied = supplied[7:].strip() if supplied.lower().startswith("bearer ") else (request.headers.get("x-dashboard-token") or request.query_params.get("token") or "")
    if not secrets.compare_digest(supplied.encode(), token.encode()):
        raise HTTPException(status_code=401, detail="Dashboard token required", headers={"WWW-Authenticate": "Bearer"})


_hits = defaultdict(deque)
_lock = threading.Lock()


def submission_rate_limit():
    try:
        return int(os.environ.get("SUBMISSION_RATE_PER_HOUR", "120"))
    except ValueError:
        return 120


def check_submission_rate(worker_id: str, now: float | None = None):
    """Raise 429 when a worker posts more than SUBMISSION_RATE_PER_HOUR submissions in an hour."""
    limit = submission_rate_limit()
    if limit <= 0:
        return
    now = time.time() if now is None else now
    with _lock:
        q = _hits[worker_id]
        while q and q[0] <= now - 3600:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(status_code=429, detail=f"Too many submissions from this worker (limit {limit} per hour)")
        q.append(now)


def reset_rate_limits():
    with _lock:
        _hits.clear()
