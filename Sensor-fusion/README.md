# Sensor fusion

Compares what the phone's own sensors say with where the GPS says it went, and whether the network looks like the claimed area. The two results are **inputs to the fraud classifier** (with the photo score); no rule here decides anything by itself.

Plan: [iteration-1.md](iteration-1.md) · what is done: [progress.md](progress.md) · what comes next: [iteration-2.md](iteration-2.md) · hackathon: [plan](hackathon-plan.md), [demo script](demo-script.md), [APK notes](apk-notes.md)

## What it does, end to end

1. **Start of a visit (phone).** A worker agrees once to "record my approach" (`VisitPanel`, draft consent text in `client/src/lib/sensorFusion/consent.js`). The app asks the server for a **visit** (`POST /visits`: id + the server's clock) and starts the **trip recorder** (`client/src/lib/sensorFusion/tripRecorder.js`): GPS fixes about every 5 s (`watchPosition`) and, every 5 s, one **summary** of the accelerometer and gyroscope (RMS energy, step rhythm), never the raw stream. At most 10 minutes are kept; a wake lock keeps the screen on where supported. A phone with a wrong clock is corrected by the offset measured at visit start.
2. **Photo, then "I've reached the site" (phone).** The photo is taken and checked on the device first. Only when it passes does the button **I've reached the site · send my location** appear (the site itself is set by the company in the dashboard, never by the worker). Tapping it takes the existing 3-second motion sample and sends the trail with the photo and the visit id; the verdict starts with an **Arrival at site** line (inside / outside / close / could not be checked). Outside the site only flags the case for review. The existing 3-second motion sample is still taken; then the trail (fixes + windows + which sensors were present) is sent with the photo and the visit id.
3. **Server: validate.** `fusion/trail.py` + `fusion/pipeline.py`: size and count caps, times checked against the **server's** clock and the visit (a trail that starts before its visit existed, or is from the future, or was used before, is ignored and flagged `trail_replayed` / `trail_invalid`), one trail per visit, exact-replay hash.
4. **Server: motion vs GPS** (`fusion/geo.py`, `windows.py`, `consistency.py`). From the fixes: speed (with the GPS error subtracted), **jumps** (faster or farther than any device can move), signs of a fake provider (no jitter, constant accuracy, ruler-straight path), distance to the site. From the windows: still / walking (a rhythm at 1.2-2.8 Hz) / moving. Then line them up: *GPS says walking but the phone is still*, *a GPS jump while the phone stayed still*, *arrived without any approach*, *ended outside the site*... → `motion_consistency` (0-1) + the evidence per 5 s window.
5. **Server: network vs the claimed area** (`fusion/environment.py`, `ipctx.py`). A per-site profile of what the network usually looks like (learned from **accepted** visits only, not from the first submission), the request IP's country/region/ASN (optional database), hosting/VPN networks, time zone, and (native app only) WiFi/cell identifiers → `environment_consistency` (0-1).
6. **Unknown is not suspicious.** If nothing could be compared (no sensor, no trail, a short trail, a new site) the score is a neutral 0.5, `known = false`, and the case gets the note `fusion_insufficient_evidence`. A desktop or a worker who declined recording is never flagged for that.
7. **Classifier.** `[photo_quality, motion_consistency, environment_consistency, motion_known, env_known]` → a monotone histogram gradient-boosting model → SHAP (a failing SHAP check falls back to an approximate, marked explanation; the score always comes back). The reason shown is a sentence the fusion engines wrote from what they measured ("GPS jumped 14.0 km in 6 s while the phone stayed still"), never an invented cause.
8. **Dashboard.** The case file's *Sensor fusion* section: both scores and how much evidence there was, the trail drawn locally (no map service) with the site radius and jumps, a timeline of GPS speed vs phone activity with mismatches outlined, the network checks, plain-language flags.

## Files

| Where | What |
|---|---|
| `client/src/lib/sensorFusion/fusion.json` | every threshold, shared by the browser and the server (uncalibrated starting values) |
| `client/src/lib/sensorFusion/` | `windows.js` (features + activity), `tripRecorder.js`, `display.js` (case-file helpers), `flags.js` (plain-language flag text), `consent.js`, `exportTrace.js` (`?record=1`), tests |
| `client/src/components/capture/VisitPanel.jsx`, `TrailTile.jsx` | consent + live recording, the Sensors-step tile |
| `client/src/components/dashboard/FusionSection.jsx` | the case-file section |
| `client/src/components/capture/SensorFeed.jsx`, `FetchedPanel.jsx` | the live **Sensor feed** under the camera (GPS, motion, activity, session, network, mini trail, what cannot be fetched and why, the backend address) and **What was fetched** on the verdict screen |
| `client/src/components/dashboard/SiteLocationPanel.jsx`, `client/src/lib/sensorFusion/siteForm.js`, `sites.js` | the dashboard's **Site location** panel: edit `site_demo_1`, use the phone's GPS, forget the learned network (ticked by default for a move over 1 km), confirm old to new, change log (also "Register this spot as the site" in the demo tools) |
| `client/capacitor.config.json`, `client/tools/apk.mjs` | the Android wrapper and `npm run apk` ([apk-notes.md](apk-notes.md)) |
| `backend/tools/demo_reset.py`, `Sensor-fusion/demo-start.sh` | clear one site's demo submissions (dry run by default); start the demo |
| `backend/fusion/` | `geo.py`, `windows.py`, `consistency.py`, `environment.py`, `ipctx.py`, `trail.py`, `pipeline.py`, `simulate.py`, `cli.py` |
| `backend/classifier.py`, `train_classifier.py`, `generate_fusion_data.py` | the model and its (SYNTHETIC) training data |
| `backend/tools/fetch_geoip.py`, `purge_trails.py`, `reportlib/fusion.py` | IP database download, location retention, the report section |
| `backend/fraud_classifier_v1.pkl`, `synthetic_training_data*.csv` | the old 3-input model, kept for rollback (`FUSION_MODEL=fraud_classifier_v1.pkl`) |

## Commands

```bash
cd backend
./train.sh                                  # regenerate the simulated trails (through the real engines) and retrain
.venv/bin/python -m pytest -q               # all backend tests (fusion: test_fusion_*.py)
.venv/bin/python tools/fetch_geoip.py       # download the free DB-IP city + ASN databases (see below), then restart the backend
.venv/bin/python tools/purge_trails.py      # dry run: how many stored coordinates are older than TRAIL_RETENTION_DAYS (default 30); --apply to remove

cd client
npm test                                    # includes src/lib/sensorFusion/*.test.js
npm run fusion:parity                       # JS window features vs the Python port on scripted signals
npm run e2e fusion                          # real page + real server on ISOLATED ports (8001 / 5173); scripted GPS and motion
npm run report                              # accuracy report; section 5b is sensor fusion (add --fusion-scale 0.1 for a quick one)
npm run demo:laptop                         # the judges' demo in a visible Chrome on isolated servers (scripted walk + teleport)
npm run demo:reset -- --apply               # clear site_demo_1's submissions / visits / learned network (dry run without --apply)
npm run apk                                 # Android debug APK (one-time setup first: apk-notes.md)
```

**Developer tools** (the "Register this spot" button and the Server box in the Sensor feed) show with `?demo=1` or `?record=1`, inside the APK, or in a build made with `VITE_DEMO_TOOLS=1`. **Backend address:** `?api=<url>` (saved on the device; `?api=reset` forgets it) > the saved address > `VITE_API_URL` > `http://<page host>:8000` (or `/api` over HTTPS).

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/visits` | `{worker_id, task_id, site_id}` → `{visit_id, server_time_ms, max_trail_s, fix_interval_s, window_s}`. Open to workers (rate-limited like submissions) |
| POST | `/submissions` | new optional payload fields: `visit_id`, `trail`, `radio` (format: `backend/fusion/trail.py`; JSON Schema: `schema/trail.v1.json`). Every field is optional; older clients keep working |
| GET / PUT | `/sites`, `/sites/{id}` | where a site really is: `{lat, lng, radius_m, country?, label?, reset_network?}` (dashboard token when `DASHBOARD_TOKEN` is set). **No site is seeded**: a made-up location would flag every demo submission. Every change is logged (`GET /sites/{id}/changes`); `reset_network` forgets the learned network only when asked |
| GET | `/env/check?site_id=` | `ENV_CHECK=1` only (404 otherwise): the caller's own network vs the site, never the site's coordinates |
| POST | `/sites/{id}/reset-fingerprint` | also forgets the learned network profile |

Environment: `FUSION_CONFIG` (thresholds file), `FUSION_MODEL` (model file; `fraud_classifier_v2_pre_env.pkl` is the model before the environment work, `fraud_classifier_v1.pkl` the 3-input one), `GEOIP_DIR` (IP databases, default `backend/data/geoip`), `TRUSTED_PROXY_HEADER` + `TRUSTED_PROXY_HOPS` (only when you really run behind a proxy that sets it), `ENV_CHECK=1` (enables `GET /env/check`), `TRAIL_RETENTION_DAYS`.

## The IP database

The environment signal gets much stronger with the request IP's country / region / provider. The free **DB-IP "lite"** city + ASN databases are read with the small `maxminddb` package. Install or refresh them with `cd backend && .venv/bin/python tools/fetch_geoip.py` (monthly), check them with `tools/fetch_geoip.py --check` (exit 1 if missing or older than 45 days), then restart the backend (the provider is detected at start-up; a start-up warning says so when it is missing or old). `GET /health` returns `ip_database` (provider, file names, data date, age, stale); the dashboard footer shows the credit and the top bar a chip when the database is missing or old. The data is **CC BY 4.0: credit DB-IP** (<https://db-ip.com>), shown as text with a link wherever the data is shown.

**What the real files showed (2026-10, REAL):** 8.8.8.8 resolves to Mountain View / Google LLC, 193.0.14.129 to Amsterdam / RIPE NCC, a Bengaluru broadband address to Bengaluru / Atria; but anycast and CDN addresses resolve to where the database thinks the operator is, not where the traffic entered (1.1.1.1 to Sydney, 103.21.244.1 to Toronto, Google's IPv6 test address to Montreal), and some addresses have a city record but no ASN record. Carrier-grade NAT addresses (100.64.0.0/10) and every non-routable address are "unavailable", never "far". IPv4-mapped IPv6 forms are normalised.

**Which address is the caller's (E3).** Nothing is believed from the network unless you configure it: `TRUSTED_PROXY_HEADER` (`x-forwarded-for`, `cf-connecting-ip`, ...) and, for `x-forwarded-for`, `TRUSTED_PROXY_HOPS` (default 1): the entry that many places from the **right** is the client (each trusted proxy appends what it saw; anything a client wrote to the left is ignored). A header from a direct caller with nothing configured is ignored. Only a **shortened** address is stored (IPv4 last octet zeroed, IPv6 only the /48), and `tools/purge_trails.py` removes it (and the city) after the retention period. `GET /env/check` (set `ENV_CHECK=1`) tells you, from the phone, what the server sees.

**IP error model in the simulator (SYNTHETIC world, published numbers where they exist).** MaxMind publishes about 99.8% country-level accuracy and about 63% of US IPs within 50 km (so about 37% farther); DB-IP lite is a reduced-accuracy subset of its commercial database. The simulator uses 37% of IPs displaced (median 120 km, lognormal: the shape is an **assumption**) and 2% wrong country (10x MaxMind's rate for a lite database: an **assumption**). India-specific figures could not be retrieved and were not invented.

## What is partial, and what you still owe

- **WiFi/cell identifiers cannot be read by a web page.** Only a **native phone app** can send them (the `radio` field, hashed WiFi/cell IDs, is already accepted and scored). **Decision for you, later: do you want a native app?** Without it, "WiFi/cell inconsistent with the claimed area" is approximated by the IP database + the learned link profile.
- **No background tracking on the web:** "leading up to arrival" means the movement recorded while the app is open.
- **Everything here is evidence from the device**, so a modified client or an emulator that feeds realistic sensor streams can fool it. It raises the cost of faking; it does not make it impossible.
- **All thresholds and every accuracy number are SYNTHETIC / uncalibrated** until real traces exist (`samples/README.md`).
- **Your privacy decisions:** the consent wording (a draft), the retention period (default 30 days for the coordinates), and who may see locations (the dashboard token).
