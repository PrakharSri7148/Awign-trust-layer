# Tunnel runbook (P2): making your laptop reachable from the internet

You run every command in this file yourself. The assistant never opens a tunnel, logs in to a service, or sees a token. Variable NAMES are shown, never values.

## What you are setting up

```
phone (Android app) --https--> a fixed public address --tunnel--> your laptop 127.0.0.1:8002 (the backend, public mode)
```

The backend serves the app and the API on ONE address, so there is one domain, no CORS and no mixed content, and the Android app points at that one address.
Port 8002 is the demo server. Port 8000 is your development server: the demo never touches it.

## Choose one (N1)

| | ngrok free static domain | Cloudflare Tunnel |
|---|---|---|
| Cost | free | free tunnel, but you need a domain you own (about 10 USD a year) |
| Address | one fixed `something.ngrok-free.app` per account | your own `demo.yourdomain.com` |
| Risk | may show a "Visit site" warning page to browsers; in a full-screen app that can spoil the first screen | none known |
| Header the server must trust | `TRUSTED_PROXY_HEADER=x-forwarded-for` (hops 1) | `TRUSTED_PROXY_HEADER=cf-connecting-ip` |

Default: ngrok. If the warning page appears when you open the address on the phone, switch to Cloudflare. **A random "quick tunnel" address is not acceptable**: it changes on every restart and the Android app is tied to the address.

## One-time setup (yours)

### ngrok
1. Create an account at ngrok.com, open **Domains** and create your free static domain. Note the name (this is `DEMO_DOMAIN`).
2. Install ngrok yourself (`brew install ngrok` on macOS) and run `ngrok config add-authtoken <YOUR TOKEN>` once (the token is on your ngrok dashboard; it stays on your machine).
3. If `ngrok http --url=...` says unknown flag, your version uses `--domain`: `export NGROK_DOMAIN_FLAG=--domain`.

### Cloudflare
1. `brew install cloudflared`, then `cloudflared tunnel login` (a browser opens; pick your domain).
2. `cloudflared tunnel create trust-demo`, then `cloudflared tunnel route dns trust-demo demo.yourdomain.com`.
3. Create `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: trust-demo
   credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: demo.yourdomain.com
       service: http://127.0.0.1:8002
     - service: http_status:404
   ```
4. `export TUNNEL=cloudflare CF_TUNNEL_NAME=trust-demo`

## Every time (demo day or a rehearsal)

```bash
export DASHBOARD_TOKEN="<a long random secret you choose, 12+ characters>"   # not stored anywhere; you type it into the dashboard once
export DEMO_DOMAIN="<your fixed address>"                                       # no https://
export TUNNEL=ngrok                                                             # or cloudflare
demo/demo-up.sh
```

`demo-up.sh` builds the client for production if needed, starts the backend in public mode on 127.0.0.1:8002 (the log hides IP addresses and tokens), keeps the laptop awake (`caffeinate`), runs the preflight for everything that does not need the tunnel, then runs the tunnel in that terminal. If a preflight line is red it stops and tells you what to fix.

In a second terminal, once the tunnel is up:

```bash
cd backend && .venv/bin/python tools/preflight.py --url "https://$DEMO_DOMAIN"
curl https://$DEMO_DOMAIN/health        # must say "public_mode": true
```

## The first real network check (do it from the phone, on mobile data)

Open `https://<DEMO_DOMAIN>/api/env/check?site_id=site_demo_1` in Chrome on the phone with **WiFi off**. It shows what the server sees: your carrier, your country, the distance from your carrier's gateway to the site, and the environment score. Write the distance down: the 300 km rule is a guess and this is the first measurement of your own carrier. If it is above 300 km and you are standing at the site, tell the assistant: `ipFarKm` is changed in `fusion.json` with this number as evidence (and logged in `Sensor-fusion/thresholds-changelog.md`). Do the same on the venue's WiFi.

## Keep the laptop reachable

- Plugged in, lid open (or `caffeinate` is running: `demo-up.sh` starts it), no sleep, no VPN on the laptop.
- Bring a phone hotspot as a second internet source. If the venue WiFi dies: connect the laptop to the hotspot; the tunnel reconnects by itself and the address does not change.

## If something is wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `demo-up.sh` says a variable is not set | the `export` lines were not run in this terminal | run them again in the same terminal |
| Preflight red: "IP database" | files missing or older than 45 days | `cd backend && .venv/bin/python tools/fetch_geoip.py` |
| Preflight red: "Demo database" | `TRUST_LAYER_DB` is your development database | leave it unset (the default is `backend/data/demo.db`) or copy your file there once |
| `/health` says `public_mode: false` | you are looking at your development server | the demo address must end at port 8002 |
| The phone shows a warning page before the app (ngrok) | ngrok's free interstitial | click through once, or switch to Cloudflare |
| The dashboard answers 401 | normal: it needs the token | type `DASHBOARD_TOKEN` into the box in the Live feed |
| `/api/env/check` says "could not read this caller's address" | `TRUSTED_PROXY_HEADER` does not match the tunnel | ngrok: `x-forwarded-for`; Cloudflare: `cf-connecting-ip` |
| Every visitor has the same address in the log | same as above | same fix |
