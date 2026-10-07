# trust-layer

Verifies field-task submissions. The client checks the photo on the device (focus, lighting, glare, resolution, lens covered, noise/compression, camera shake and, for tasks that need it, the worker's face), then sends the photo plus GPS, a 3-second motion sample and network info. The backend **re-checks the photo itself**, scores the submission with a gradient-boosting classifier and explains the score with SHAP.

The photo-quality engine ("edge validator") has its own folder with the audit, plan, per-phase progress and a how-to: [edge-validator/](edge-validator/README.md).

```
backend/         FastAPI + SQLModel (SQLite) + scikit-learn + SHAP, plus photo_quality/ (server-side photo re-check)
client/          Vite + React, dark "command center" UI (framer-motion, recharts, lucide-react), plus src/lib/photoQuality/ (the on-device engine)
edge-validator/  audit, plan, progress log and sample-photo folders for the photo-quality engine
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

`requirements.txt` now includes Pillow and python-multipart (photo upload and re-check). The server-side **face** re-check is optional because `mediapipe` is large: `pip install -r requirements-face.txt` to enable it (otherwise face tasks are flagged `face_unchecked`). Tests: `pip install -r requirements-dev.txt && python -m pytest`.

To reach the backend from a phone, bind it to every interface: `uvicorn main:app --reload --host 0.0.0.0 --port 8000`.

`fraud_classifier.pkl` and `synthetic_training_data.csv` are committed. Run `./train.sh` again only if you change the data or the model. The server will not start without the `.pkl`.

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{"status": "ok"}` |
| POST | `/submissions` | **multipart/form-data**: `payload` (JSON string) + `photo` (file). `payload`: `worker_id, task_id, site_id, gps{lat,lng}\|null, motion_samples[{x,y,z,t}], network_info{effectiveType,downlink,rtt}`, `photo_quality` (the device's own report, advisory), `photo_override` (worker pressed *Submit anyway*), `capture_source` (`camera`\|`file`), `capture_burst`. A plain JSON body (no photo) is still accepted but cannot be verified (see below) |
| GET | `/submissions` | newest first; light rows: `photo_verdict`, `photo_quality_score`, `quality_flags`, `has_photo`, `photo_url`, `feature_importances` as an object |
| GET | `/submissions/{id}` | the same plus `photo_quality`: `{server, client, evidence}` (per-check report from the server and the device, EXIF, capture source, burst). 404 if missing |
| GET | `/submissions/{id}/photo` | the stored photo |
| POST | `/sites/{site_id}/reset-fingerprint` | the next submission for this site becomes the new baseline |

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

By default the client calls `http://<page hostname>:8000`, which is `http://localhost:8000` on desktop. Set `VITE_API_URL` to override it.

## Testing from a phone on the same Wi-Fi

1. Find your computer's LAN IP:
   - macOS: `ipconfig getifaddr en0`
   - Linux: `hostname -I`
   - Windows: `ipconfig` (look for "IPv4 Address")

   Vite also prints it as `Network: http://<ip>:5174/`.
2. Start the backend with `--host 0.0.0.0` (see above). Then start the client.
3. **Phones only give GPS and motion sensors to HTTPS pages** (or `localhost`). With plain `http://<ip>:5174` you can take a photo, but GPS and motion come back empty, so every submission gets flagged for motion. For a real test:
   ```bash
   npm run dev:https    # https://<ip>:5174, self-signed certificate
   ```
   Open `https://<ip>:5174` on the phone and accept the certificate warning. In this mode the client calls the backend through Vite's `/api` proxy, so the browser does not block plain-HTTP requests from the HTTPS page. The backend can stay on `127.0.0.1` in this mode.
4. iOS asks for motion permission when you tap Submit.

CORS allows `http://localhost:5173`/`5174` and `http(s)://<any IPv4>:5173`/`5174`.

## How scoring works

- **motion_score**: the mean of `sqrt(x²+y²+z²)` over the samples, divided by 1.5 and capped at 1. A still device scores about 0. If there are no samples, the score is 0. If a device reports only `accelerationIncludingGravity`, the client removes gravity with a low-pass filter. Without that, every phone would read about 9.8 m/s² and score 1.0.
- **ambient_score**: `effectiveType`, `downlink` (log2 bucket) and `rtt` (coarse bucket) are hashed with SHA-256 into 4 floats in [-1, 1]. The bucketing absorbs the browser's normal jitter. The first submission for a site stores this vector as the baseline and scores 1.0. Later submissions score the cosine similarity with the baseline, clamped to [0, 1].
- **photo_quality_score**: the server-measured 0..1 aggregate of the photo checks (0.5 × the worst check + 0.5 × the mean; 0 when there is no photo).
- **classifier**: a GradientBoosting model on `[photo_quality_score, motion_score, ambient_score]`. `feature_importances` are |SHAP| values for that one submission, normalized to sum to 1. `top_reason` is the feature with the highest importance that also has a bad raw value (photo score < 0.5, motion < 0.4, or ambient < 0.5); a photo reason names the actual problems ("Photo quality problem: blurry, glare"). If the probability is below 0.3, the reason is "No issues detected".
- **What the model assumes about photos** (see `generate_synthetic_data.py`): photo quality varies independently of fraud, so a poor photo *alone* does not flag a worker (an honest bad photo scores p ≈ 0.02); it only tips submissions whose motion/ambient signals are already ambiguous. That is an assumption encoded in synthetic data, not learned from real labels.

## Verified behaviour

Checked against the running server and, for the client, in headless Chrome:

| Scenario | Result |
|---|---|
| Steady motion, same network as the baseline | p ≈ 0.005, `accepted`, "No issues detected" |
| Flat/still motion (or no samples) | p ≈ 0.998, `flagged`, "Motion mismatch: ..." |
| Different network after the baseline is set | p ≈ 0.998, `flagged`, "Site fingerprint mismatch: ..." |
| Blurry photo | blocked in the browser, no request sent. If a modified client sends it anyway, the server measures it, blocks it in its own verdict and flags `client_missed_blur` |

## Known limitations

- **The ambient fingerprint is weak.** It has only 4 hashed dimensions, so about 19% of pairs of *different* network profiles still have similarity ≥ 0.5 and are not flagged. It also depends on `navigator.connection`, which exists only in Chromium browsers. On Safari and Firefox every submission sends nulls, so they all look like the same "network". Treat it as a weak signal.
- **Photo-quality thresholds are starting values.** They were tuned on synthetic degradations of a few real photographs, not on your workers' photos. Add samples to `edge-validator/samples/` and run `npm run calibrate`.
- **Photo quality is only weakly tied to fraud.** The classifier is trained on synthetic data; how much a poor photo should matter is an assumption (documented above) until real reviewed submissions exist.
- **Client checks are advisory.** The device's report can be forged; the server re-check (and the flags it raises when the device's claim and its own measurement disagree) is the control. `capture_source`, EXIF and the sensor readings are device-reported or trivially editable, so they are weak signals.
- **Faces:** the on-device detector can't see faces below ~15% of the frame, does not reliably detect masks, and (like all face detectors) is not equally accurate across skin tones and lighting. Validate it on your own workers before relying on a *required* face to block someone. Face presence does not identify *who* it is.
- **Desktop browsers have no motion sensor**, so desktop submissions score motion 0 and are flagged.
- The in-app camera needs HTTPS (or localhost) and gives the camera's *video* resolution, which can be lower than the native camera app's still photos. It was tested with Chrome's fake camera, not yet on a physical phone.
- `previous_gps` is accepted by `compute_motion_score` but not used yet. Submissions do not store GPS.
