# Sensor fusion

Compares what the phone's own sensors say with where the GPS says it went, and whether the network looks like the claimed area. The two results are **inputs to the fraud classifier** (with the photo score); no rule here decides anything by itself.

Plan: [iteration-1.md](iteration-1.md) · what is done: [progress.md](progress.md) · what comes next: [iteration-2.md](iteration-2.md)

## What it does, end to end

1. **Start of a visit (phone).** A worker agrees once to "record my approach" (`VisitPanel`, draft consent text in `client/src/lib/sensorFusion/consent.js`). The app asks the server for a **visit** (`POST /visits`: id + the server's clock) and starts the **trip recorder** (`client/src/lib/sensorFusion/tripRecorder.js`): GPS fixes about every 5 s (`watchPosition`) and, every 5 s, one **summary** of the accelerometer and gyroscope (RMS energy, step rhythm), never the raw stream. At most 10 minutes are kept; a wake lock keeps the screen on where supported. A phone with a wrong clock is corrected by the offset measured at visit start.
2. **Submit (phone).** The existing 3-second motion sample is still taken; then the trail (fixes + windows + which sensors were present) is sent with the photo and the visit id.
3. **Server: validate.** `fusion/trail.py` + `fusion/pipeline.py`: size and count caps, times checked against the **server's** clock and the visit (a trail that starts before its visit existed, or is from the future, or was used before, is ignored and flagged `trail_replayed` / `trail_invalid`), one trail per visit, exact-replay hash.
4. **Server: motion vs GPS** (`fusion/geo.py`, `windows.py`, `consistency.py`). From the fixes: speed (with the GPS error subtracted), **jumps** (faster or farther than any device can move), signs of a fake provider (no jitter, constant accuracy, ruler-straight path), distance to the site. From the windows: still / walking (a rhythm at 1.2-2.8 Hz) / moving. Then line them up: *GPS says walking but the phone is still*, *a GPS jump while the phone stayed still*, *arrived without any approach*, *ended outside the site*... → `motion_consistency` (0-1) + the evidence per 5 s window.
5. **Server: network vs the claimed area** (`fusion/environment.py`, `ipctx.py`). A per-site profile of what the network usually looks like (learned from **accepted** visits only, not from the first submission), the request IP's country/region/ASN (optional database), hosting/VPN networks, time zone, and (native app only) WiFi/cell identifiers → `environment_consistency` (0-1).
6. **Unknown is not suspicious.** If nothing could be compared (no sensor, no trail, a short trail, a new site) the score is a neutral 0.5, `known = false`, and the case gets the note `fusion_insufficient_evidence`. A desktop or a worker who declined recording is never flagged for that.
7. **Classifier.** `[photo_quality, motion_consistency, environment_consistency, motion_known, env_known]` → gradient boosting → SHAP. The reason shown is a sentence the fusion engines wrote from what they measured ("GPS jumped 14.0 km in 6 s while the phone stayed still"), never an invented cause.
8. **Dashboard.** The case file's *Sensor fusion* section: both scores and how much evidence there was, the trail drawn locally (no map service) with the site radius and jumps, a timeline of GPS speed vs phone activity with mismatches outlined, the network checks, plain-language flags.

## Files

| Where | What |
|---|---|
| `client/src/lib/sensorFusion/fusion.json` | every threshold, shared by the browser and the server (uncalibrated starting values) |
| `client/src/lib/sensorFusion/` | `windows.js` (features + activity), `tripRecorder.js`, `display.js` (case-file helpers), `flags.js` (plain-language flag text), `consent.js`, `exportTrace.js` (`?record=1`), tests |
| `client/src/components/capture/VisitPanel.jsx`, `TrailTile.jsx` | consent + live recording, the Sensors-step tile |
| `client/src/components/dashboard/FusionSection.jsx` | the case-file section |
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
```

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/visits` | `{worker_id, task_id, site_id}` → `{visit_id, server_time_ms, max_trail_s, fix_interval_s, window_s}`. Open to workers (rate-limited like submissions) |
| POST | `/submissions` | new optional payload fields: `visit_id`, `trail`, `radio` (format: `backend/fusion/trail.py`; JSON Schema: `schema/trail.v1.json`). Every field is optional; older clients keep working |
| GET / PUT | `/sites`, `/sites/{id}` | where a site really is: `{lat, lng, radius_m, country?, label?}` (dashboard token when `DASHBOARD_TOKEN` is set). **No site is seeded**: a made-up location would flag every demo submission |
| POST | `/sites/{id}/reset-fingerprint` | also forgets the learned network profile |

Environment: `FUSION_CONFIG` (thresholds file), `FUSION_MODEL` (model file), `GEOIP_DIR` (IP databases, default `backend/data/geoip`), `TRUSTED_PROXY_HEADER` (e.g. `x-forwarded-for`, only when you really run behind a proxy that sets it), `TRAIL_RETENTION_DAYS`.

## The IP database (you have to run one command)

The environment signal gets much stronger with the request IP's country / region / provider. I could not download the free **DB-IP "lite"** databases from this session (the download was blocked by the sandbox), so the code, the downloader and the tests are ready but **no database is installed yet**. Run `cd backend && .venv/bin/python tools/fetch_geoip.py` and restart the backend. Until then the IP part is "unavailable" and the network signal is the weak link-speed profile only. The data is **CC BY 4.0: credit DB-IP** (<https://db-ip.com>) wherever it is shown to people.

## What is partial, and what you still owe

- **WiFi/cell identifiers cannot be read by a web page.** Only a **native phone app** can send them (the `radio` field, hashed WiFi/cell IDs, is already accepted and scored). **Decision for you, later: do you want a native app?** Without it, "WiFi/cell inconsistent with the claimed area" is approximated by the IP database + the learned link profile.
- **No background tracking on the web:** "leading up to arrival" means the movement recorded while the app is open.
- **Everything here is evidence from the device**, so a modified client or an emulator that feeds realistic sensor streams can fool it. It raises the cost of faking; it does not make it impossible.
- **All thresholds and every accuracy number are SYNTHETIC / uncalibrated** until real traces exist (`samples/README.md`).
- **Your privacy decisions:** the consent wording (a draft), the retention period (default 30 days for the coordinates), and who may see locations (the dashboard token).
