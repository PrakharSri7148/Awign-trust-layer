#!/usr/bin/env bash
# One command to bring the whole demo up on the laptop: the backend in PUBLIC MODE, the preflight, then the tunnel (in this terminal).
#
#   export DASHBOARD_TOKEN="<a long random secret you choose>"      # never written to a file; the dashboard asks for it once
#   export DEMO_DOMAIN="my-name.ngrok-free.app"                      # N1: your fixed tunnel address (no https://, no slash)
#   export TUNNEL=ngrok                                              # ngrok (default) or cloudflare
#   demo/demo-up.sh [--no-tunnel]
#
# What it does, in order: refuses to start without the variables above; builds the client for production if needed (`npm run build:prod`);
# starts the backend on 127.0.0.1:8002 with PUBLIC_MODE=1 (NOT 8000: that is your development server); keeps the laptop awake (caffeinate);
# runs the preflight (everything that does not need the tunnel); then runs the tunnel in the foreground. Ctrl+C stops the tunnel and the backend.
# After the tunnel is up, in another terminal:  cd backend && .venv/bin/python tools/preflight.py --url "https://$DEMO_DOMAIN"
#
# Needs: the one-time tunnel setup in environment-consistency/tunnel-runbook.md (ngrok authtoken or cloudflared login, done by YOU).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${DEMO_PORT:-8002}"
TUNNEL="${TUNNEL:-ngrok}"
WITH_TUNNEL=1
for a in "$@"; do case "$a" in --no-tunnel) WITH_TUNNEL=0 ;; -h|--help) sed -n '2,15p' "$0"; exit 0 ;; *) echo "unknown option $a"; exit 2 ;; esac; done

: "${DASHBOARD_TOKEN:?set DASHBOARD_TOKEN first (a long random secret, 12+ characters); it is never stored in a file}"
: "${DEMO_DOMAIN:?set DEMO_DOMAIN first (your fixed tunnel address, e.g. my-name.ngrok-free.app)}"
case "$PORT" in 8000|5174) echo "refusing to use port $PORT: that is your development server"; exit 2 ;; esac
case "$TUNNEL" in ngrok) HEADER="x-forwarded-for" ;; cloudflare) HEADER="cf-connecting-ip" ;; *) echo "TUNNEL must be ngrok or cloudflare"; exit 2 ;; esac

export PUBLIC_MODE=1
export TRUSTED_PROXY_HEADER="${TRUSTED_PROXY_HEADER:-$HEADER}"
export TRUSTED_PROXY_HOPS="${TRUSTED_PROXY_HOPS:-1}"
export TRUST_LAYER_DB="${TRUST_LAYER_DB:-$ROOT/backend/data/demo.db}"
export PHOTO_DIR="${PHOTO_DIR:-$ROOT/backend/data/demo-uploads}"
export ENV_CHECK=1
export ALLOWED_ORIGINS="https://$DEMO_DOMAIN"
mkdir -p "$(dirname "$TRUST_LAYER_DB")" "$PHOTO_DIR" "$ROOT/demo/logs"

echo "== client build (production, same-origin /api, no developer tools)"
if [ ! -f "$ROOT/client/dist/build-info.json" ] || [ -n "$(find "$ROOT/client/src" "$ROOT/client/index.html" "$ROOT/client/public" -newer "$ROOT/client/dist/build-info.json" -type f 2>/dev/null | head -1)" ]; then
  (cd "$ROOT/client" && npm run build:prod)
else
  echo "   dist is up to date"
fi

echo "== backend in public mode on 127.0.0.1:$PORT (the log hides IPs and tokens: $ROOT/demo/logs/backend.log)"
cd "$ROOT/backend"
PY=.venv/bin/python
"$PY" -m uvicorn main:app --host 127.0.0.1 --port "$PORT" --no-access-log >"$ROOT/demo/logs/backend.log" 2>&1 &
BACK=$!
KEEP=""
if command -v caffeinate >/dev/null 2>&1; then caffeinate -dimsu -w $$ & KEEP=$!; fi
cleanup() { kill "$BACK" 2>/dev/null || true; [ -n "$KEEP" ] && kill "$KEEP" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
for i in $(seq 1 60); do curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORT/health" >/dev/null || { echo "the backend did not start; read $ROOT/demo/logs/backend.log"; exit 1; }

echo "== preflight (everything that does not need the tunnel)"
"$PY" tools/preflight.py --pre-tunnel || { echo "fix the red lines above, then run this again"; exit 1; }

if [ "$WITH_TUNNEL" = 0 ]; then echo "backend is up on 127.0.0.1:$PORT (no tunnel). Ctrl+C to stop."; wait "$BACK"; exit 0; fi
echo "== tunnel ($TUNNEL) -> https://$DEMO_DOMAIN   (Ctrl+C stops everything)"
case "$TUNNEL" in
  ngrok) exec ngrok http "${NGROK_DOMAIN_FLAG:---url}=$DEMO_DOMAIN" "$PORT" ;;  # older ngrok versions call the flag --domain: export NGROK_DOMAIN_FLAG=--domain
  cloudflare) exec cloudflared tunnel run "${CF_TUNNEL_NAME:?set CF_TUNNEL_NAME to the tunnel you created (see the runbook)}" ;;
esac
