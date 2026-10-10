# trust-layer

Verifies field-task submissions. The client checks the photo on the device (focus, lighting, glare, resolution, lens covered, noise/compression, camera shake and, for tasks that need it, the worker's face), then sends the photo plus the **approach trail** recorded while the app was open (GPS fixes and 5-second accelerometer/gyroscope summaries), a 3-second motion sample and network info. The backend **re-checks the photo itself**, **compares the phone's movement with the GPS trail and the network with the claimed area** (sensor fusion), scores the submission with a gradient-boosting classifier and explains the score with SHAP.

The photo-quality engine ("edge validator") has its own folder with the audit, plan, per-phase progress and a how-to: [edge-validator/](edge-validator/README.md). The sensor-fusion signal (GPS trail vs phone sensors, network vs the claimed area) has its own too: [Sensor-fusion/](Sensor-fusion/README.md).

```
backend/         FastAPI + SQLModel (SQLite) + scikit-learn + SHAP, plus photo_quality/ (server-side photo re-check)
client/          Vite + React, dark "command center" UI (framer-motion, recharts, lucide-react), plus src/lib/photoQuality/ (the on-device engine)
edge-validator/  audit, plan, progress log and sample-photo folders for the photo-quality engine
Sensor-fusion/   plan, progress log, how-to and real-trace folders for the sensor-fusion signal (backend/fusion/, client/src/lib/sensorFusion/)
```

## Backend

Requires Python 3.10–3.13. Python 3.12 was used for testing; use it if `shap`/`numba` wheels are missing for your version.

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

./train.sh            # generate_synthetic_data.py -> train_classifier.py -> fraud_classifier.pkl
uvicorn main:app --reload --port 8000
```

`requirements.txt` now includes Pillow and python-multipart (photo upload and re-check) and `maxminddb` (the optional IP-country/ASN reader; run `python tools/fetch_geoip.py` once to download the free DB-IP databases, see [Sensor-fusion/README.md](Sensor-fusion/README.md)). The server-side **face** re-check is optional because `mediapipe` is large: `pip install -r requirements-face.txt` to enable it (otherwise face tasks are flagged `face_unchecked`). Tests: `pip install -r requirements-dev.txt && python -m pytest`.

To reach the backend from a phone, bind it to every interface: `uvicorn main:app --reload --host 0.0.0.0 --port 8000`.

`fraud_classifier.pkl` and `synthetic_fusion_data.csv` are committed. Run `./train.sh` again only if you change the data, the fusion engines or the model: it simulates GPS trails and phone sensors, runs them through the real fusion code and retrains. The server will not start without the `.pkl`. The old 3-input model and its data (`fraud_classifier_v1.pkl`, `synthetic_training_data.csv`) are kept for rollback (`FUSION_MODEL=fraud_classifier_v1.pkl`). **All of this training data is simulated; none of it is evidence about real fraud.**

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{"status": "ok", "ip_database": {provider, installed, data date, age_days, stale, ...}, "public_mode": bool, "env_check": bool}` |
| GET | `/env/check?site_id=` | **only when `ENV_CHECK=1`** (404 otherwise): what the server sees for THIS request (masked IP, country, provider, VPN or not, km to the site, environment score, a sentence). Never returns the site's coordinates. For checking from the phone before a demo |
| POST | `/submissions` | **multipart/form-data**: `payload` (JSON string) + `photo` (file). `payload`: `worker_id, task_id, site_id, gps{lat,lng}\|null, motion_samples[{x,y,z,t}], network_info{effectiveType,downlink,rtt}`, **`visit_id`, `trail`, `radio`** (sensor fusion, all optional: [format](Sensor-fusion/schema/trail.v1.json)), `photo_quality` (the device's own report, advisory), `photo_override` (worker pressed *Submit anyway*), `capture_source` (`camera`\|`file`), `capture_burst`. A plain JSON body (no photo) is still accepted but cannot be verified (see below) |
| GET | `/submissions` | newest first; light rows: `photo_verdict`, `photo_quality_score`, `quality_flags`, `has_photo`, `photo_url`, `feature_importances` as an object |
| GET | `/submissions/{id}` | the same plus `photo_quality`: `{server, client, evidence}` (per-check report from the server and the device, EXIF, capture source, burst). 404 if missing |
| GET | `/submissions/{id}/photo` | the stored photo |
| POST | `/visits` | `{worker_id, task_id, site_id}` -> `{visit_id, server_time_ms, ...}`: opens the session the approach trail must fit inside (by the server's clock; one submission per visit) |
| GET / PUT | `/sites`, `/sites/{site_id}` | where a site really is: `{lat, lng, radius_m, country?, label?, reset_network?}`. `reset_network: true` also forgets the network learned at the old place (only when asked); every change is written to a change log (`GET /sites/{id}/changes`). Nothing is seeded; the arrival, outside-the-site and IP-distance checks need it |
| POST | `/sites/{site_id}/reset-fingerprint` | forgets the network profile learned for this site (and the old fingerprint) |

`status` is `flagged` if `fraud_probability > 0.5`, otherwise `accepted`.

**Photo verification.** The server decodes the photo and runs the same 7 pixel checks (+ face for face tasks) as the client, using the same thresholds (`client/src/lib/photoQuality/thresholds.json`). Its verdict, not the device's, goes to the classifier. Anything suspicious is recorded in `quality_flags`: photo problems (`blur`, `exposure`, `glare`, `resolution`, `obstruction`, `noise`, `shake`, `face`), integrity concerns (`client_missed_<check>`, `client_verdict_mismatch`, `client_dimensions_mismatch`, `duplicate_photo`, `near_duplicate_photo`, `old_photo`, `not_live_capture`, `photo_missing`) and context (`no_exif`, `submitted_anyway`, `camera_shake_reported`, `face_unchecked`). A submission **without a photo** is flagged `photo_missing` and the device's `photo_quality_pass` is **not trusted**; set `PHOTO_REQUIRED=0` to restore the old trust-the-boolean behaviour.

Environment: `PHOTO_DIR` (where photos are stored, default `backend/uploads/`), `MAX_PHOTO_BYTES` (default 25 MB), `PHOTO_REQUIRED`, `TRUST_LAYER_DB` (database path), `PHOTO_QUALITY_THRESHOLDS` (thresholds file, when deploying the backend without the client folder), `FACE_MODEL_PATH`.

## Client

```bash
cd client
npm install
npm run dev           # http://localhost:5174
npm test              # unit tests for the photo-quality engine, camera logic and dashboard helpers
npm run calibrate     # tune thresholds against real photos in edge-validator/samples/ (add --demo to preview)
node tools/parity.mjs # check the client engine and the backend engine agree on the same photos
```

Routes: `/` (Capture: 4-step flow Photo → Sensors → AI scan → Verdict; a task picker chooses what the photo must contain, and the photo is taken with the in-app camera (live guidance, burst, steadiness) or the system picker) and `/dashboard` (polls every 5 seconds; KPIs, charts, a photo-quality panel, filterable live feed with photo verdicts and flags, per-submission case file with the photo and device-vs-server checks). The **DEMO** chip in the top bar fills the dashboard with seeded mock data and adds simulate buttons; it is stored in localStorage and never sent to the backend. Design tokens live in `client/src/styles/tokens.css`.

The Capture page now also has a **Visit recording** box: the worker agrees once (draft consent text), the app opens a server visit and records the approach (GPS fixes + 5-second motion summaries, at most 10 minutes) until the photo is submitted.

By default the client calls `http://<page hostname>:8000`, which is `http://localhost:8000` on desktop. Override it with `?api=<url>` in the page address (saved on the device; `?api=reset` forgets it), the **Server** box in the Sensor feed's developer tools, or `VITE_API_URL` at build time (first match wins in that order).

The Capture page also shows a live **Sensor feed** under the camera (what the visit recording reads right now, and what a web page cannot read, with the reason), and the verdict screen a **What was fetched** panel.

## Testing from a phone on the same Wi-Fi

1. Find your computer's LAN IP:
   - macOS: `ipconfig getifaddr en0`
   - Linux: `hostname -I`
   - Windows: `ipconfig` (look for "IPv4 Address")

   Vite also prints it as `Network: http://<ip>:5174/`.
2. Start the backend with `--host 0.0.0.0` (see above). Then start the client.
3. **Phones only give GPS and motion sensors to HTTPS pages** (or `localhost`). With plain `http://<ip>:5174` you can take a photo, but GPS and motion come back empty, so the visit cannot be recorded and the case just says "not enough sensor data". For a real test:
   ```bash
   npm run dev:https    # https://<ip>:5174, self-signed certificate
   ```
   Open `https://<ip>:5174` on the phone and accept the certificate warning. In this mode the client calls the backend through Vite's `/api` proxy, so the browser does not block plain-HTTP requests from the HTTPS page. The backend can stay on `127.0.0.1` in this mode.
4. iOS asks for motion permission when you tap **Start recording my visit** (it has to be a tap).
5. To record real traces for calibration open `https://<ip>:5174/?record=1` (a download button appears in the Visit recording box; see [Sensor-fusion/samples/README.md](Sensor-fusion/samples/README.md)).

CORS allows `http://localhost:5173`/`5174`, `http(s)://<any IPv4>:5173`/`5174`, the Android app's origins (`http(s)://localhost`, `capacitor://localhost`, `ionic://localhost`) and anything listed in `EXTRA_CORS_ORIGINS` (comma separated, e.g. a tunnel).

**Android app (hackathon):** a Capacitor wrapper around the same web app; build steps in [Sensor-fusion/apk-notes.md](Sensor-fusion/apk-notes.md) (`npm run apk`; needs a one-time `npm i @capacitor/...` that is not done yet). The demo itself: [Sensor-fusion/demo-script.md](Sensor-fusion/demo-script.md); without a phone, `cd client && npm run demo:laptop`.

## Public demo: one address, a tunnel, an Android app

For a demo that judges can reach, the backend serves the **built client and the API from one HTTPS address** (no CORS, no mixed content) through a tunnel from your laptop; an Android Trusted Web Activity opens that address full screen in the phone's real Chrome. Nothing fake ships: real IP lookups, real sensors, a real registered site.

| What | Where |
|---|---|
| The demo in one command (backend in **public mode** on 127.0.0.1:8002, preflight, tunnel) | `demo/demo-up.sh`; setup and troubleshooting: [environment-consistency/tunnel-runbook.md](environment-consistency/tunnel-runbook.md) |
| What `PUBLIC_MODE=1` does: refuses to start unless `DASHBOARD_TOKEN`, `TRUSTED_PROXY_HEADER`, `TRUST_LAYER_DB`, the model and the IP database are set/present; no `/docs`; exact-origin CORS; request-size caps; security headers (`Permissions-Policy`: geolocation, camera, motion for this origin only); logs without IPs or tokens; the test IP provider refuses to load | `backend/public_mode.py`, `backend/serving.py` |
| The production client build (same-origin `/api`, no developer tools, no third-party requests: the fonts fall back to the system's) | `cd client && npm run build:prod` (writes `dist/build-info.json`) |
| Before you go live: a green/red table, exit 0 only if nothing is red | `cd backend && .venv/bin/python tools/preflight.py --url https://<your-domain>` (`--pre-tunnel` before the tunnel exists) |
| Start a rehearsal clean (dry run first, backup on `--apply`, keeps the registered sites) / see how many trusted visits a site has learned | `backend/tools/demo_reset.py`, `backend/tools/seed_check.py` |
| The Android app: manifest, icons (drawn from the logo), Bubblewrap settings, how to build it yourself | `client/public/manifest.webmanifest`, `backend/tools/make_icons.py`, `android/twa-manifest.template.json`, [docs/apk-build.md](docs/apk-build.md) |
| Rehearsal against the public-mode build in headless Chrome (isolated port 8003; real DB-IP lookups; scripted GPS/motion/forwarded address) | `cd client && npm run e2e:public` |
| The 5-minute script, the judge Q&A and the failure table | [environment-consistency/demo-runbook.md](environment-consistency/demo-runbook.md) |
| The final test on a real phone (steps, pass criteria, triage) | [environment-consistency/phone-test.md](environment-consistency/phone-test.md) |

The API is also reachable under an `/api` prefix (`/api/health`, `/api/submissions`, ...): that is what the production client uses.

## How scoring works

Three signals go into the classifier. Details and the full design: [Sensor-fusion/README.md](Sensor-fusion/README.md).

- **photo_quality_score**: the server-measured 0..1 aggregate of the photo checks (0.5 x the worst check + 0.5 x the mean; 0 when there is no photo).
- **motion_consistency** (stored in `motion_score`): does the phone's accelerometer/gyroscope tell the same story as the GPS trail? From the trail: speed (with the GPS error subtracted), **jumps** faster or farther than any device can move, signs of a fake provider (no jitter, constant accuracy, ruler-straight path), the distance to the site. From the sensors, per 5 seconds: still / walking (a rhythm at 1.2-2.8 Hz) / moving. Then: *GPS jump while the phone stayed still*, *GPS says walking but the phone is still*, *arrived at the site with no approach*, *ended outside the site*, *walking rhythm that matches the walking speed* (raises the score). 1 = consistent, low = the sensors contradict the GPS. The evidence per 5-second window is stored and drawn in the case file.
- **environment_consistency** (stored in `ambient_score`): does the network fit the claimed area? A per-site profile learned from **trusted** visits only (accepted, and the phone's movement was compared with the GPS trail with a consistency of at least 0.8, so a spoofer who slips through cannot make their own network "normal"), the request IP's country / region / provider from the DB-IP database, hosting/VPN networks, time zone, and, for a native app only, WiFi/cell identifiers. With no site registered, the IP is compared with the phone's own GPS at a low weight and the case file says so. Weak on the web by nature.
- **Unknown is not suspicious.** If nothing could be compared (no motion sensor, a desktop, a worker who declined the recording, a short trail, a new site) the score is a neutral 0.5, `motion_known` / `env_known` are false and the case carries the note `fusion_insufficient_evidence`. The model is trained with such cases and does not flag them for it.
- **classifier**: a histogram gradient-boosting model, **monotone by construction** (a worse photo, a less consistent motion trail or a less consistent environment can never lower the fraud probability, other inputs fixed; a guard in `classifier.py` enforces it again), on `[photo_quality, motion_consistency, environment_consistency, motion_known, env_known]`. If SHAP's additivity check fails for an input, the score still comes back and the explanation is marked approximate (`explanation: "approximate"`). `feature_importances` are |SHAP| values for that one submission (the known-flags are folded into their score's bar), normalized to sum to 1. `top_reason` is a sentence the fusion engines wrote from what they measured ("GPS jumped 14.0 km in 6 s while the phone stayed still"), the photo problems for a photo reason, or "No issues detected" below p = 0.3.
- **What the model assumes** (see `backend/fusion/simulate.py`): it is trained on a **simulator** of GPS trails, sensor streams and networks that pushes them through the real fusion engines. The IP database's own error (wrong country, positions off by more than 50 km) is modelled from published figures where they exist and from stated assumptions where they do not; a worker whose network is in another country than the site is labelled "send to review" (an assumption, not a measurement). The scenarios, the gait/GPS/network models and the label for each scenario are the authors' assumptions. As before, a poor photo *alone* does not flag a worker; with the same weak evidence a poor photo tips a case towards review (an assumption encoded in the labels, not learned). Accuracy figures printed by the training script or the report are properties of the simulator unless a table says REAL.

## Verified behaviour

Checked against an isolated backend and, for the client, in headless Chrome (real page, real recorder, real server; only the GPS and the motion events are scripted: `cd client && npm run e2e fusion`):

| Scenario | Result |
|---|---|
| Walk 60 m to the registered site (walking motion), then stand there | motion consistency 0.97, `accepted`, no spoof flags, trail drawn in the case file |
| GPS 14 km away, then jumps onto the site; the phone never moves; perfect photo | `gps_jump_flat_motion`, motion consistency 0.27, `flagged`, reason "GPS jumped 14.0 km in 6 s while the phone stayed still", in the review queue |
| The worker did not agree to the recording | no trail sent; "not enough sensor data" note, `accepted` (never flagged for it) |
| Browser denies location | the panel says so, the trail records `geo: denied`, `accepted` |
| Blurry photo | blocked in the browser, no request sent. If a modified client sends it anyway, the server measures it, blocks it in its own verdict and flags `client_missed_blur` |

These show the pipeline works end to end. They are **not** accuracy figures: real phones and real spoofing apps have not been tested.
