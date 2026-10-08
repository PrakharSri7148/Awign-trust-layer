#!/usr/bin/env bash
# One command to get the hackathon demo ready on the laptop (Sensor-fusion/demo-script.md).
#
#   Sensor-fusion/demo-start.sh            # phone demo: backend on 0.0.0.0:8000 (unless one already runs), prints the address for the app
#   Sensor-fusion/demo-start.sh --https    # also serve the web app over HTTPS for Chrome on the phone (no APK): https://<ip>:5174
#   Sensor-fusion/demo-start.sh --reset    # first clear the demo site's submissions (asks before applying)
#   Sensor-fusion/demo-start.sh --laptop   # no phone: the scripted demo in a visible Chrome on isolated servers (npm run demo:laptop)
#
# It never stops or restarts a server that is already running on 8000 / 5174: it reuses it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${DEMO_SITE:-site_demo_1}"
HTTPS=0; RESET=0; LAPTOP=0
for a in "$@"; do
  case "$a" in
    --https) HTTPS=1 ;; --reset) RESET=1 ;; --laptop) LAPTOP=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option $a"; exit 2 ;;
  esac
done

if [ "$LAPTOP" = 1 ]; then
  cd "$ROOT/client" && exec npm run demo:laptop
fi

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
up() { curl -kfsS -m 2 "$1" >/dev/null 2>&1; }

if [ "$RESET" = 1 ]; then
  (cd "$ROOT/backend" && .venv/bin/python tools/demo_reset.py --site "$SITE")
  read -r -p "Apply this reset? [y/N] " yn
  [ "$yn" = y ] && (cd "$ROOT/backend" && .venv/bin/python tools/demo_reset.py --site "$SITE" --apply)
fi

PIDS=()
trap 'for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done' EXIT INT TERM

if up http://127.0.0.1:8000/health; then
  echo "backend: already running on :8000 (reused). For the phone it must listen on 0.0.0.0, not only 127.0.0.1."
else
  [ -z "${DASHBOARD_TOKEN:-}" ] && echo "note: DASHBOARD_TOKEN is not set: anyone on this network can open the dashboard."
  (cd "$ROOT/backend" && .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000) & PIDS+=($!)
  for _ in $(seq 1 60); do up http://127.0.0.1:8000/health && break; sleep 0.5; done
  up http://127.0.0.1:8000/health || { echo "backend did not start"; exit 1; }
  echo "backend: started on 0.0.0.0:8000"
fi
ls "$ROOT"/backend/data/geoip/dbip-city-lite-*.mmdb >/dev/null 2>&1 || echo "note: no IP database (backend/tools/fetch_geoip.py): the IP line will say 'not available'."

if [ "$HTTPS" = 1 ]; then
  if up https://127.0.0.1:5174 || up http://127.0.0.1:5174; then echo "web: already running on :5174 (reused)"; else (cd "$ROOT/client" && npm run dev:https) & PIDS+=($!); sleep 4; fi
fi

cat <<EOF

  Laptop address on this WiFi: ${IP:-<unknown: check System Settings → Wi-Fi>}
  APK:            Sensor feed → Server → http://${IP:-<ip>}:8000 → Test connection → Save
  Phone Chrome:   $( [ "$HTTPS" = 1 ] && echo "https://${IP:-<ip>}:5174/?demo=1  (accept the certificate warning)" || echo "run again with --https" )
  Dashboard:      http://localhost:5174/dashboard (laptop) or the Dashboard tab in the app
  Reset between runs:  cd client && npm run demo:reset -- --site $SITE --apply

  Ctrl+C stops only what this script started.
EOF
[ "${#PIDS[@]}" -gt 0 ] && wait || true
