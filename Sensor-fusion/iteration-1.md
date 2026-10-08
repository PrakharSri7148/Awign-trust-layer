# Sensor Fusion — Iteration 1: make the motion-consistency signal real

Date: 2026-10-08
Status: **implemented 2026-10-08** (all phases F0-F10, on a simulator and in headless Chrome; nothing is calibrated on real phones). What was built, measured and changed from this plan: [`progress.md`](progress.md). What is left and what you have to do: [`iteration-2.md`](iteration-2.md). The text below is the plan as written; where the build deliberately differs, `progress.md` says so ("Changes from the plan").
Audience: the engineer / agent who implements it in a fresh session. Read first, in this order: `CLAUDE.md` (project root), `README.md` (project root, "How scoring works"), `edge-validator/README.md`, this file, then `progress.md`. The paste-ready prompt is [`iteration-1-prompt.md`](iteration-1-prompt.md).

---

## 0. The goal (the user's own words) and how it is read

> At submission time, the phone's accelerometer/gyroscope data and WiFi/cell environment are compared against the claimed GPS trajectory, producing a **motion-consistency signal**. A genuine visit shows plausible movement leading up to arrival; a spoofed one typically shows **flat motion despite a sudden GPS jump**, or a **WiFi/cell environment inconsistent with the claimed area**. This signal is **not judged in isolation**; it is passed forward as one of the **learned inputs** to the AI classifier.

Broken into testable requirements:

| # | Requirement | Where it is checked in this plan |
|---|---|---|
| R1 | Use the accelerometer **and** gyroscope | Phase F2 |
| R2 | Compare them against a **GPS trajectory** (not a single point) | F1, F3 |
| R3 | A genuine visit shows plausible movement **leading up to arrival** | F3 (arrival check) |
| R4 | A spoof shows **flat motion despite a sudden GPS jump** | F1 (jump), F3 (jump + flat) |
| R5 | A WiFi/cell **environment inconsistent with the claimed area** is evidence of a spoof | F4 (with the web-platform limit in §2) |
| R6 | The result is **one motion-consistency signal** | F3 |
| R7 | It is **one learned input** to the classifier, with the existing photo signal beside it, never a rule that decides alone | F7 |
| R8 | The decision is explainable to a reviewer | F8 |

---

## 1. Where things stand today (verified facts, so you don't have to re-discover them)

Verified by reading the code on 2026-10-08. The fusion code had not changed since the first review.

- **Pipeline:** photo (server re-check) + `motion_score` + `ambient_score` → `GradientBoostingClassifier` → SHAP → `top_reason`. P(fraud) > 0.5 = `flagged`. Entry point: `create_submission` in `backend/main.py` (the two score calls are around line 146).
- **`compute_motion_score`** (`backend/signals.py:12`): mean of `sqrt(x²+y²+z²)` over a **3-second** window ÷ `MOTION_SATURATION = 1.5`, capped at 1. It takes `gps` and `previous_gps` and **ignores both**. It cannot tell a person standing still at the site from a spoofer sitting at home.
- **`compute_ambient_score`** (`backend/signals.py:85`): `effectiveType` + log2 `downlink` + bucketed `rtt` hashed (SHA-256) into 4 floats; the **first submission for a site becomes the baseline** (trust on first use); later ones are the cosine similarity, clamped to [0, 1]. It measures link speed class, **not** where the phone is.
- **GPS:** `getGPS()` (`client/src/lib/sensors.js:1`) = one `getCurrentPosition`. The result is sent and then ignored. It is **not stored** (no GPS column in `Submission`).
- **Gyroscope:** read only by the photo-shake check (`client/src/lib/photoQuality/motionBuffer.js`); fusion does not use it.
- **Browser reality:** a web page **cannot read WiFi SSID/BSSID or cell-tower IDs**. The only network data it gets is `navigator.connection` (Chromium only). So R5 cannot be met literally in the web client (see §2 and F4).
- **Misleading text today:** `REASONS["motion_score"]` (`backend/classifier.py:31`) says "near-zero movement despite location change", and `client/src/lib/mock.js:7` repeats it. Nothing computes a location change.
- **Model inputs:** `FEATURES = ["photo_quality_score", "motion_score", "ambient_score"]` (`backend/classifier.py:12`); SHAP keys exposed to the dashboard: `photo_quality`, `motion_consistency`, `ambient_fingerprint` (`:13`). The name `motion_consistency` already exists in the UI, so keeping those keys avoids a dashboard break.
- **Training data:** `backend/generate_synthetic_data.py` samples the **scores directly** from hand-picked Beta/Normal distributions per case (genuine, spoofed_gps, wrong_site, …). It never simulates a trail, so the model has never "seen" a GPS jump. All its accuracy numbers are properties of that generator (`edge-validator/reports/accuracy-report.md`, section 5).
- **Missing sensors:** no samples → `motion_score = 0` → looks exactly like a spoof. Desktops and phones over plain HTTP are therefore flagged (README "Known limitations").
- **Infrastructure you can reuse:** dashboard token + rate limit (`backend/hardening.py`), reviewer decisions as real labels (`backend/reviews.py`, `backend/tools/reviewed_dataset.py`), the REAL/SYNTHETIC-labelled accuracy report (`backend/tools/accuracy_report.py`, `reportlib/`), the isolated e2e harness (`client/tools/e2e/`, `npm run e2e`), the shared-JSON-thresholds pattern (`thresholds.json` read by both the JS and Python engines, with a parity script), the DB column migration pattern (`SUBMISSION_COLUMNS` in `backend/db.py`), the photo/trail purge tool pattern (`backend/tools/purge_photos.py`).
- **Test baselines recorded in `edge-validator/progress.md` (Phase 8h):** client `npm test` 201 passing, backend `pytest -q` 130 passed, parity 100%, e2e 229 PASS. Phase F0 must **re-measure** these before any change; do not trust these numbers.
- **Repo state:** git repo with many uncommitted changes from earlier work. Do **not** commit, push, reset or clean anything unless the user asks.

### Gap vs goal

| Goal | Today |
|---|---|
| Accel **and gyro** | accel only (3 s) |
| vs a **GPS trajectory** | one GPS point, unused, unstored |
| Movement **leading up to arrival** | nothing before the tap |
| **Flat motion despite GPS jump** | no jump detection; the reason text claims it |
| **WiFi/cell vs claimed area** | link-speed hash vs the first submission |
| One consistency signal | two unrelated scores |
| Unknown ≠ spoof | no sensor = 0 = spoof |
| Learned input | yes (already true) |

---

## 2. Honest scope: what a browser can and cannot do

Read this before promising anything to the business. Every limit below is repeated in `progress.md`'s "Open limits" and must be repeated in the final report.

1. **No background tracking.** A web page only records while it is open and the screen is on (Wake Lock helps; iOS and Android suspend pages). "Movement leading up to arrival" therefore means *movement while the worker has the app open before submitting* (a "Start visit" session). A true all-journey trail needs a native app. This iteration defines the data contract so a native client can fill it later.
2. **No WiFi/cell identifiers on the web.** R5 is met in three layers, from weakest to strongest: (a) the existing link-quality hash, improved (learned per site, no trust-on-first-use); (b) **server-side IP context** (country/region/ASN, mobile vs hosting/VPN) compared with the claimed area, *only if* a geo-IP database is provided (a user decision, §9); (c) **optional native `radio` field** (hashed BSSIDs, cell IDs) accepted and scored if a native client ever sends it. Without (b) or (c) the environment signal is weak and is labelled so.
3. **Everything the device sends can be forged by a modified client or an emulator that injects realistic sensor streams.** The plan raises the cost (consistency across independent streams, server-issued visit sessions, replay protection, raw/window cross-check) but does **not** make it impossible. Do not claim "spoof-proof".
4. **Indoor and urban GPS is noisy.** Honest workers inside a mall or a basement get accuracy of 30–100 m and jumps of 50–200 m. The jump rule must use the reported accuracy and a speed ceiling, and "unreliable GPS" must lower the evidence, not raise suspicion. These are the main false-positive risks; they are in the test plan (§6).
5. **A smooth car ride produces little acceleration.** GPS speed of 15 m/s with flat sensors can be genuine. Vehicle-speed windows carry low weight; the strong evidence is walking-speed GPS with no walking rhythm, and a *jump* with no motion.
6. **Sensor rates differ.** Some browsers throttle `devicemotion` to a few Hz; cadence detection needs ≥ 20 Hz. Below that the cadence is "unknown" and only energy is used.
7. **The training data is synthetic, and so is every accuracy number** until reviewed real submissions exist. The new simulator removes the "scores sampled directly" shortcut but is still the authors' assumptions. Label everything REAL or SYNTHETIC.
8. **Location history is personal data.** Collection needs consent, a purpose, a retention period and access control. Decisions are the user's (§9); mechanisms are built, defaults are conservative.

---

## 3. Design

### 3.1 One picture

```
 PHONE (web)                                          SERVER                                 CLASSIFIER
 ───────────                                          ──────                                 ──────────
 Start visit ──────────────────────────────▶ POST /visits → visit_id + server time
 watchPosition  → fixes (1 per ~5 s)  ┐
 devicemotion   → 5 s windows         ├─ trail ─▶ POST /submissions (multipart, as today, + trail)
   (accel RMS, gyro RMS, cadence)     │             │
 3 s raw snippet (kept, cross-check)  ┘             ├─ F1 clean trail, jumps, speed, mock signatures
 navigator.connection, tz, locale ──────────────────├─ F3 align GPS speed ↔ motion windows
                                                    │      → motion_consistency  ∈ [0,1] + known? + flags + evidence
 request IP (server-side) ──────────────────────────├─ F4 site network profile + IP context (+ native radio)
                                                    │      → environment_consistency ∈ [0,1] + known? + flags
 photo re-check (unchanged) ────────────────────────┴─▶ photo_quality_score
                                                              │
                          [photo_quality, motion_consistency, environment_consistency, known flags] ──▶ GradientBoosting ──▶ SHAP ──▶ reason
```

**Design rule:** the consistency engine produces **sub-scores and evidence**, never a verdict. Only the classifier turns them into a probability, together with the photo score. No rule in F1–F4 may set `status` by itself.

### 3.2 Data contract (v1)

Added to the multipart `payload` JSON. Every new field is optional so old clients keep working.

```jsonc
"visit_id": "…",                     // from POST /visits (F5); absent for legacy clients
"trail": {
  "v": 1,
  "started_at": 1760000000000,        // device epoch ms
  "ended_at":   1760000300000,
  "fixes":   [ { "t": 1760000001000, "lat": 12.97, "lng": 77.59, "acc": 8.0, "speed": 1.3|null, "heading": 90|null, "alt": 900|null } ],  // ≤ 240, ≥ 1 s apart
  "windows": [ { "t0": 1760000000000, "t1": 1760000005000, "n": 290, "hz": 58,
                 "acc_rms": 1.7, "acc_peak": 4.2, "gyro_rms": 45, "cad_hz": 1.9|null, "cad_pw": 0.62|null } ],   // 5 s windows, ≤ 120
  "sensors": { "geo": "granted|denied|absent", "motion": "granted|denied|absent|null_events",
               "gyro": true, "linear_accel": true, "hz_median": 58 },
  "env":     { "tz": "Asia/Kolkata", "tz_offset_min": 330, "locale": "en-IN" }
},
"radio": null   // native-only, optional: { "wifi":[{"bssid_h":"…","rssi":-60}], "cell":[{"mcc":404,"mnc":10,"tac":1,"cid":1,"rssi":-85}] }  (hashed identifiers only)
```

Kept as today: `gps`, `motion_samples` (3 s raw snippet), `network_info`. Server limits: body cap for the trail (default 256 KB), caps on counts, timestamps must be monotonic and inside `[visit start, now]`.

### 3.3 Phase F1: trail and geo engine (pure functions, no ML)

`backend/fusion/geo.py`. Inputs: fixes (+ optional site). Outputs a **cleaned trail** and **GPS facts**.

- Haversine distance; per-segment implied speed `d/dt` (never trust the reported `speed`; compare the two as a signal).
- Cleaning: drop fixes with non-monotonic or duplicate timestamps; mark fixes with `acc > accMaxUsable` (starting 100 m) as *unreliable* (kept for display, excluded from rules).
- **Jump:** a segment between two *reliable* fixes with implied speed > `jumpSpeed` (starting 55 m/s ≈ 200 km/h) **or** displacement > `jumpDistance` (starting 1 km) in < 60 s, after allowing `acc_i + acc_j` of error. Output: jump times, sizes.
- **Mock/"too perfect" signatures (weak evidence):** position std < 0.5 m over ≥ 30 s while accuracy is constant; accuracy identical in ≥ 90% of fixes; trajectory residual from a straight line < 1 m over ≥ 200 m; no altitude when the device normally reports it.
- Site relations (needs a site location, F5): distance at start, at end, whether the approach is monotone, `gps_outside_site` at submission (`> radius + acc`).
- Honest "unknown" outputs: < 2 reliable fixes, trail shorter than `minTrailS` (starting 60 s) → `trajectory_known = false`.

### 3.4 Phase F2: motion windows and activity (JS + Python port)

- **Client** `client/src/lib/sensorFusion/windows.js` (pure, unit-tested; runs in the existing recorder): per 5 s window compute `acc_rms` (gravity removed; reuse the low-pass logic in `sensors.js` and `motionBuffer.js`), `acc_peak`, `gyro_rms` (deg/s from `rotationRate`; if absent → `null`), cadence by autocorrelation of the acceleration magnitude in the 1.2–2.8 Hz band (`cad_hz`, `cad_pw` ∈ [0,1]); `null` when `hz < 20`.
- **Activity per window** (starting thresholds in `fusion.json`; rules, not ML): `still` = `acc_rms < 0.15` and `gyro_rms < 8`; `walking` = `cad_pw ≥ 0.35` and `cad_hz` in 1.2–2.8 and `acc_rms ≥ 0.6`; otherwise `moving` (energy without rhythm: vehicle, handling, running). The classifier never sees "vehicle", because sensors alone cannot reliably tell.
- **Python port** `backend/fusion/windows.py`: recompute the windows from the **3 s raw snippet** and compare with the last client window; a large disagreement → `window_raw_mismatch` (cheap integrity check on client-computed windows). Keep JS and Python in parity (a script like `client/tools/parity.mjs`, on scripted signals).

### 3.5 Phase F3: the consistency engine (the core)

`backend/fusion/consistency.py`. Align each window with the GPS speed over the same interval (interpolate implied speed between reliable fixes), then:

| Evidence | Definition (starting values) | Direction |
|---|---|---|
| **Flat while GPS moves** | window with GPS speed ≥ 1.0 m/s over reliable fixes and activity `still` | spoof-leaning; weight 0.6 × fraction of evaluable windows |
| **Jump + flat motion** (the headline spoof) | a jump (F1) with activity `still` in the ±10 s windows around it, and no `moving` energy bridging it | strong spoof-leaning; weight 0.7 |
| **Arrival without approach** | trail starts > `approachFarM` (150 m) from the site and ends inside it, but the share of non-`still` windows in between < 0.3 | spoof-leaning; weight 0.4 |
| **Rhythm matches speed** | walking-speed GPS (1–2.8 m/s) with `walking` cadence | genuine-leaning (raises the score) |
| **Energy while GPS is still** | GPS speed < 0.3 m/s, accuracy good, and sustained `walking` cadence | weak (people pace indoors); weight 0.1 |
| **Too-perfect GPS** | F1 mock signatures | weak spoof-leaning; weight 0.2 |
| **Reported vs implied speed** | `|speed_reported − speed_implied| > 3 m/s` over many fixes | weak; weight 0.15 |
| **Window ↔ raw mismatch** | F2 integrity check | flag + weight 0.3 |

Output: `motion_consistency` in [0, 1] (1 = fully consistent), `motion_known` (false when there are no evaluable windows: no sensors, no GPS, trail too short), a list of flag ids, and an `evidence` object (per-window table: `t0, speed_gps, activity, acc_rms, gyro_rms, reliable, verdict`; jump list; counts). The weights are **starting values**, to be tuned with real traces (F9); tests pin *ordering invariants* (jump + flat < flat-while-moving < clean walk), not exact numbers.

**Unknown is not suspicious.** `motion_known = false` produces the flag `fusion_insufficient_evidence` (a reviewer hint), a neutral `motion_consistency`, and the model is trained with such rows so the unknown case neither flags nor clears by itself (see F7).

### 3.6 Phase F4: environment consistency

`backend/fusion/environment.py`. Components, each optional, combined into `environment_consistency` + `environment_known`:

- **Site network profile (replaces trust-on-first-use).** New table `SiteNetworkProfile(site_id, key_hash, count, last_seen, source)`. A key = (`effectiveType`, downlink bucket, rtt bucket, ASN if known, coarse IP prefix hash). Only observations from submissions that were **not flagged** (or that a reviewer approved) update the profile, so a spoofed first submission cannot poison it. Fewer than `profileMin` (starting 3) observations → *unknown*, not 1.0. Similarity = frequency-weighted best match. The legacy `SiteFingerprint` table and `reset-fingerprint` endpoint keep working.
- **IP context (server-side, optional).** `backend/fusion/ipctx.py` with a pluggable provider; default `NullProvider` returns unknown. A provider (e.g. an offline GeoLite2 file) gives country/region/ASN/`is_hosting`. Rules are lenient because IP geolocation is coarse and mobile carriers geolocate to a gateway far away: flag only a different **country/state** than the claimed site, or a hosting/anonymizing ASN. Behind a proxy, the client IP must come from a configured trusted header only (`TRUSTED_PROXY_HEADER`), never blindly from `X-Forwarded-For`.
- **Time zone sanity.** Device `tz_offset_min` vs the offset implied by the claimed longitude (± 4 h): a very weak flag (`tz_mismatch`), never scored above weight 0.1.
- **Native radio (future).** If `radio` is present: Jaccard overlap of hashed BSSIDs with the site's known set and a match of cell IDs. Strong evidence when present; wired and unit-tested, inert for the web client.
- Output includes which components were active so the UI can say "based on network speed class only" instead of implying more than it measured.

### 3.7 Phase F5: backend integration and data model

- **Models/migration** (`models.py`, `db.py` `SUBMISSION_COLUMNS`): `Submission.fusion_version` (0 for legacy rows), `fusion_known` flags, `fusion_flags` (JSON list), `fusion_report` (JSON: summary + evidence, windows table, jump list; the raw fix list is stored only if retention allows, see F6/§9). **Decision (stated so it can be vetoed):** keep the existing `motion_score` / `ambient_score` columns and API names, now holding `motion_consistency` / `environment_consistency`; `fusion_version` tells old from new. New tables: `Site(site_id, lat, lng, radius_m, label)`, `SiteNetworkProfile`, `Visit(id, worker_id, task_id, site_id, started_at, ended_at, submission_id)`.
- **Endpoints:** `POST /visits` (start a session; returns `visit_id` and server time), `GET/PUT /sites/{id}` (set/read coordinates + radius; protected by `require_dashboard`), `GET /sites` (list). Keep `/sites/{id}/reset-fingerprint`.
- **Validation:** trail inside `[visit.started_at, now]` by the server clock (±skew), monotonic times, size/count caps, `visit_id` single use per submission, one trail per visit (replaying a recorded genuine trail under a new visit fails the time check). Failures raise flags (`trail_invalid`, `trail_replayed`), not 500s.
- **Wiring** in `create_submission`: build trail → F1 → F2 integrity → F3 → F4 → `score_submission(...)`. Legacy clients (no trail) go through a compat path: `motion_known = false`, environment from the improved profile; their behaviour is documented, not silently changed.
- **Config:** `client/src/lib/sensorFusion/fusion.json` is the single threshold file read by the JS recorder and the Python engine (same pattern as `thresholds.json`; env override `FUSION_CONFIG` for deploying the backend alone). Per-task policy key `fusion: "off|optional|required"` (default `optional`); `required` + unknown → `fusion_insufficient_evidence` and **needs review**, never an automatic block.
- **Privacy mechanisms (default conservative):** the fix list is kept for `TRAIL_RETENTION_DAYS` (default 30; `tools/purge_trails.py`, dry run by default, same pattern as `purge_photos.py`); derived scores, flags and the window table are kept. Coordinates in the case file are shown only to authenticated dashboard users.

### 3.8 Phase F6: client recorder, UI and consent

- `client/src/lib/sensorFusion/tripRecorder.js`: start/stop; `watchPosition` (high accuracy) downsampled to ~1 fix / 5 s; motion listener feeding `windows.js`; rolling buffer (max 10 min); Wake Lock where available; survives a page reload by persisting to `sessionStorage`/IndexedDB with try/catch (blocked storage must not crash it); iOS motion permission asked inside the tap that starts the visit; explicit states for every sensor (`granted/denied/absent/null_events`; desktop Chrome fires null-valued `devicemotion` events, so those must count as `null_events`, never as "still").
- **Capture flow:** a **Start visit** control on the task brief (and auto-start when the Capture page opens, if consent was given); a short consent line (draft wording, needs the user's approval, §9); the Sensors step (`Capture.jsx` `onSubmit`) now shows the real trail summary (fixes, metres travelled, activity timeline, GPS accuracy) instead of only a 3-second gauge; the existing 3 s raw snippet is still taken at the end for the cross-check. Missing/denied sensors show as *unavailable*, never as a fake reading.
- Everything pure is unit-tested with a fake clock (no real sensors in CI): windowing, downsampling, buffer limits, permission states, persistence failure.

### 3.9 Phase F7: simulator and classifier v2

- **Simulator** `backend/fusion/simulate.py` + `backend/generate_fusion_data.py`: generates **raw trails** (GPS fixes with an AR(1) noise model and per-scenario accuracy distributions, accelerometer/gyro windows from a gait/vehicle/still model) and runs them through the **real** F1–F4 code to get the model inputs. It must **not** import the scoring weights, so the scores come out of the pipeline, not out of the author's guess of the score. Scenarios (labelled genuine/fraud):
  - genuine: walk to site; drive then walk; already at site (stationary, GPS jitter); phone in pocket; slow elevator/stairs; honest bad photo.
  - **hard genuine (false-positive traps):** indoor GPS with 50–100 m accuracy and drift; a fix dropout/tunnel followed by a legitimate re-acquire jump; smooth highway ride (flat sensors, high GPS speed); desktop/no sensor; VPN user; first visit to a site (no profile); throttled sensor rate.
  - fraud: GPS teleport with a still device; static mock location while the phone is at home; perfectly linear mock "drive"; mock trail with *replayed* real accelerometer (the hard case: expected to be only partly caught); wrong-area network/IP; fraud with a perfect photo.
- Retrain `GradientBoostingClassifier` (same size) on `[photo_quality_score, motion_consistency, environment_consistency, motion_known, environment_known]`; keep the v1 model as `fraud_classifier_v1.pkl` for rollback (`FUSION_MODEL` env). SHAP keys remain `photo_quality`, `motion_consistency`, `ambient_fingerprint` (the `known` indicators are folded into their sub-score's importance so the dashboard needs no new bars; the implementer may choose another way if the SHAP tests still pass). Tests pin: unknown never flags alone; jump + flat flags with a perfect photo; a bad photo alone still does not flag; hard-genuine traps stay accepted at a stated rate.
- `train.sh` regenerates data and retrains both ways; the committed CSV/pkl are updated and the old synthetic data stays reproducible (a test pins that).

### 3.10 Phase F8: explanations and dashboard

- `classifier.py` reasons come from the fusion **flags**, in plain words that state only what was measured: e.g. "GPS jumped 14.2 km in 4 s while the phone stayed still", "GPS says walking for 2 min but the phone shows no steps", "Arrived at the site with no movement beforehand", "Network looks like a different region (IP: Mumbai, site: Bengaluru)", "Not enough sensor data to judge" (a note, not an accusation). Remove the false "despite location change" sentence everywhere (`classifier.py`, `mock.js`).
- **Case file:** a *Sensor fusion* section: (a) a trail drawn as an SVG polyline with the site circle and the jump marked (no map tiles, no network request: nothing about the worker leaves the system); (b) a timeline of GPS speed vs phone activity per window with mismatch windows highlighted; (c) the sub-scores with "known/unknown" and which evidence components were active; (d) plain-language flags. Update the "Sensors read" step line and demo/mock data; add the new `fusion_*` fields to the feed row only if light.
- Reviewer actions already exist (`reviews.py`); fusion flags become part of `review_reasons` where appropriate.

### 3.11 Phase F9: evaluation, real-trace tooling

- Extend `accuracy_report.py` with a **Sensor fusion** section (every table labelled SYNTHETIC or REAL): per-scenario outcomes with Wilson CIs, false-flag rate on the hard-genuine set (reported separately, this is the number that matters for workers), held-out simulator with different noise/speeds/seed, ablation (drop each input, AUC change), threshold sensitivity for the jump rule, calibration, SHAP stability, the leakage statement (the simulator and the detector share the authors' assumptions), and a "REAL: not evaluated" block until traces exist. Reviewer-labelled evidence reuses `reviews.py`.
- **Real traces:** a `?record=1` developer mode on the Capture page that downloads the trail JSON (fixes + windows + sensors, no photo) into `Sensor-fusion/samples/<scenario>/`; `backend/tools/fusion_calibrate.py` prints per-scenario feature distributions and suggests threshold changes (never edits `fusion.json` by itself; changes go through a `Sensor-fusion/thresholds-changelog.md`, with before/after evidence, like the edge validator's).

### 3.12 Phase F10: verification and handover

Re-run every suite, regenerate the report, update `progress.md`, the project `README.md` ("How scoring works", "Known limitations") and a short `Sensor-fusion/README.md`; final message lists what works, what was measured (REAL vs SYNTHETIC), what is open and what the user must provide.

---

## 4. Phase table

| Phase | Scope | Size | Depends on |
|---|---|---|---|
| F0 | Baseline measurements, decision log, data contract + `fusion.json` skeleton, folders | S | – |
| F1 | Trail/geo engine + tests | M | F0 |
| F2 | Window features + activity (JS + Python), parity, integrity check | M | F0 |
| F3 | Consistency engine → `motion_consistency` + evidence | L | F1, F2 |
| F4 | Environment engine → `environment_consistency` (+ IP provider interface, native radio hook) | M | F0 |
| F5 | Backend integration: models, migration, sites/visits endpoints, validation, wiring, retention tool | L | F1–F4 |
| F6 | Client recorder, consent, Sensors step UI, unit tests | L | F2, F5 contract |
| F7 | Simulator + classifier v2 + tests | L | F3, F4 |
| F8 | Reasons + dashboard case file | M | F5, F7 |
| F9 | Accuracy report section + real-trace tooling | M | F7 |
| F10 | e2e scenarios, full regression, docs, handover | M | all |

Order of execution: F0 → F1 → F2 → F3 → F4 → F5 → F7 → F6 → F8 → F9 → F10 (F7 before F6 so the model exists when the UI is wired; F6 may start in parallel with F7 if the contract in §3.2 is frozen).

---

## 5. Step-by-step checklist (what has to be done to reach the goal)

**F0: Baseline and spec**
- [ ] Run and record the baselines: `cd client && npm test`; `cd backend && .venv/bin/python -m pytest -q`; `node client/tools/parity.mjs` on a sample; `npm run e2e` (isolated servers only); `npm run build`.
- [ ] Record the current behaviour of the fusion path with a script (flat motion → ~0.998; steady → ~0.005) as characterization tests, so legacy behaviour changes are deliberate.
- [ ] Write the data contract (§3.2) as a JSON Schema in `Sensor-fusion/schema/trail.v1.json` and a Pydantic model; freeze it.
- [ ] Create `fusion.json` with every starting threshold from §3.3–§3.6 and a `README` line saying they are uncalibrated.
- [ ] Create `Sensor-fusion/samples/` with a `README.md` (capture protocol, §8) and the scenario folders.
- [ ] Decision log in `progress.md` (§9 defaults), flagging which ones need the user.

**F1: Trail/geo engine**
- [ ] haversine, implied speed, cleaning, reliability marking
- [ ] jump detection with accuracy allowance; teleport, dropout/re-acquire, indoor-drift fixtures
- [ ] mock signatures (zero jitter, constant accuracy, perfectly linear)
- [ ] site relations (distance, approach monotonicity, outside-radius)
- [ ] tests: hand-built trails for every rule, plus "unknown" paths (0–1 fix, short trail)

**F2: Motion windows**
- [ ] JS `windows.js` (RMS, peak, gyro RMS, cadence autocorrelation, `null` below 20 Hz) with synthetic signals (1.8 Hz walk, flat, noise)
- [ ] activity rules + tests
- [ ] Python port + parity script on scripted signals
- [ ] raw-snippet cross-check (`window_raw_mismatch`)

**F3: Consistency engine**
- [ ] alignment of windows and GPS speed
- [ ] all evidence rows in §3.5 with weights from `fusion.json`
- [ ] `motion_known` logic; evidence table output
- [ ] ordering-invariant tests; adversarial tests (replayed accel on a mock trail, noise-only accel)

**F4: Environment**
- [ ] `SiteNetworkProfile`, updates only from unflagged/approved visits, cold start = unknown
- [ ] IP provider interface + `NullProvider`; trusted-proxy header handling; hosting/VPN flag
- [ ] timezone sanity; native radio scoring
- [ ] tests incl. "poisoned first submission", "legit new network", "VPN worker"

**F5: Backend**
- [ ] models + migration (old DB upgrades; `test_migration.py` extended)
- [ ] `/visits`, `/sites` endpoints; auth + rate limit; size/count caps
- [ ] trail validation vs server clock; replay/duplicate handling
- [ ] wiring in `create_submission`; legacy compat path
- [ ] `purge_trails.py` (dry run default) and tests
- [ ] API tests: genuine trail accepted, teleport + still flagged, legacy payload still works, malformed trail 422/flag not 500

**F6: Client**
- [ ] `tripRecorder.js` with fake-clock tests (windowing, downsampling, caps, permission states, blocked storage)
- [ ] Start visit control + consent line; Capture integration; Sensors step shows the real trail summary
- [ ] null-event handling on desktop; iOS permission inside the gesture
- [ ] existing Waveform/Sensors components keep working; `npm run build` OK

**F7: Simulator + model**
- [ ] simulator with the scenario list in §3.9 running through the real F1–F4 code
- [ ] data generation script, committed CSV, deterministic by seed (test pins it)
- [ ] retrain; v1 kept for rollback; probe grid (unknown, jump+flat, bad photo alone, hard-genuine traps)
- [ ] SHAP keys stay compatible; `test_classifier.py` updated, not deleted

**F8: Explanations/dashboard**
- [ ] reasons from flags; false sentence removed (backend and `mock.js`)
- [ ] case-file Sensor fusion section (trail SVG, speed-vs-activity timeline, sub-scores, flags); demo data updated
- [ ] unit test for the formatting helpers; screenshot checked by eye at phone and desktop widths

**F9: Evaluation + real-trace tooling**
- [ ] report section (SYNTHETIC labelled), hard-genuine false-flag rate, held-out simulator, ablation, leakage
- [ ] `?record=1` export and `fusion_calibrate.py`; `thresholds-changelog.md`
- [ ] "REAL: not evaluated" until samples exist

**F10: Verify + hand over**
- [ ] e2e scenarios in the isolated harness: genuine walk (scripted geolocation + dispatched `devicemotion`), teleport + still, denied permissions, desktop null events, legacy payload
- [ ] full regression, numbers vs F0 baseline recorded in `progress.md`
- [ ] README + `Sensor-fusion/README.md` updated; honest limits restated; "what you need to do next" list

---

## 6. Test plan

- **Unit (pure):** every rule in F1, F2, F3, F4 against hand-built fixtures; unknown paths; boundaries at each threshold; monotonicity (more flat windows never raise the score).
- **Adversarial:** teleport + still; mock static; linear mock drive; replayed real accelerometer on a mock trail; noise-only accelerometer; replayed genuine trail under a new visit (time check); forged `visit_id`; oversize trail; non-monotonic timestamps; `gps` far from `trail` end.
- **False-positive traps (must stay accepted at the stated rate):** indoor drift, tunnel dropout, smooth highway, pocketed phone, desktop, VPN, first visit to a site, throttled sensor rate. The report prints this rate prominently.
- **Parity:** JS vs Python window features on scripted signals (100% within tolerance).
- **API:** as listed in F5; old DB migrates; old payload works.
- **Model:** probe grid and ordering tests (not exact probabilities); SHAP keys; `test_classifier.py` kept green or deliberately updated.
- **E2E (isolated servers only, ports 8001/5173 on 127.0.0.1; never touch the user's 8000/5174):** puppeteer `setGeolocation` for GPS and `window.dispatchEvent` of synthetic `DeviceMotionEvent`s for sensors; scenarios in F10. Do not edit `client/src` while an e2e run is active (earlier phases got spurious failures that way).
- **Accuracy report:** regenerated; every new table labelled REAL or SYNTHETIC.

## 7. Acceptance criteria (definition of done)

1. R1–R8 each have an explicit status in `progress.md`: **met**, **met on web only partially (with the stated reason)**, or **blocked on a user decision/sample**. R5 will be "partial on web" unless the user supplies a geo-IP provider or a native client.
2. A teleporting GPS with a still phone is flagged in the API test and in the e2e, even with a perfect photo; the same trail with walking-rhythm motion across the jump is *not* flagged by the motion signal alone.
3. A genuine walk-in (scripted) is accepted; the hard-genuine set has a measured false-flag rate that is printed in the report.
4. `unknown` (no sensors / legacy client / short trail) never flags by itself and is visible as "not enough evidence".
5. The false sentence "near-zero movement despite location change" no longer exists in the code (grep).
6. All suites green with the numbers compared to the F0 baseline; parity 100%; build OK; e2e on isolated servers passes.
7. The report has a Sensor fusion section with the leakage statement; no synthetic number is presented as real.
8. No commit/push; the user's running servers untouched; no new system software installed; no dependency added without asking (geo-IP libraries and databases especially).

## 8. What the user needs to provide (so real evidence exists)

1. **Real traces** into `Sensor-fusion/samples/<scenario>/` (exported with `?record=1` after F9, or follow the protocol from F0): `walk_to_site/` (5+, phone in hand and in pocket), `drive_then_walk/` (3+), `stationary_at_site/` (5+, indoors and outdoors), `indoor_poor_gps/` (3+), and spoof tests: `spoof_teleport/` (Chrome DevTools → Sensors → Location override on a laptop or a phone left still), `spoof_mock_android/` (a mock-location app on an Android phone, if available), `spoof_static_home/`. Each trace gets a one-line note: phone, OS/browser, what happened.
2. **Site coordinates + radius** for at least two real sites (or confirm the demo site is enough for now).
3. Answers to the decisions in §9.
4. A physical phone over HTTPS (`npm run dev:https`) for at least one genuine walk; the earlier phases were only tested in headless Chrome.

Do not put other people's location data in the repo without consent.

## 9. Decisions: defaults chosen on the user's behalf (veto any of them)

| # | Decision | Default used | Owner |
|---|---|---|---|
| D1 | Folder name | `Sensor-fusion/` (the existing folder; capital S) | user |
| D2 | When recording starts | auto-start when Capture opens (if consent) **plus** a visible "Start visit"; max 10 min rolling | user |
| D3 | Keep `motion_score`/`ambient_score` column names | yes; `fusion_version` distinguishes old from new rows | engineer |
| D4 | Two model inputs, not twenty | sub-scores + `known` flags; the full feature table is stored for later training on real data | engineer |
| D5 | Fusion can only **flag/review, never block** | yes | user |
| D6 | `required` task + unknown evidence | flag `fusion_insufficient_evidence` and send to review | user |
| D7 | Trail retention | 30 days for the fix list; scores/flags/windows kept | **user (privacy)** |
| D8 | Consent wording | draft line in the UI, not final | **user (privacy/legal)** |
| D9 | Geo-IP provider | **Resolved: install it.** DB-IP "lite" city + ASN (free, CC BY 4.0, no account) read with `maxminddb`; `NullProvider` when the files are absent. The download itself was blocked in the build session: run `tools/fetch_geoip.py` | **user** |
| D10 | Native app / WiFi+cell IDs | out of scope for now (the user's choice); contract and scoring hook only. **Reminder: the user still has to decide whether to build a native app** | **user** |
| D11 | Site coordinates source | `Site` table + dashboard-token-protected endpoint. **Changed: no demo site is seeded** (a made-up location would flag every demo submission made from somewhere else) | user |
| D12 | Supervisor | **Resolved by the user: no supervisor agent is wanted** (the `CLAUDE.md` rule is to be removed; see progress.md) | user |

## 10. Risks and how the plan answers them

| Risk | Mitigation |
|---|---|
| False flags on honest workers (indoor GPS, tunnels) | accuracy-aware rules, unreliable-fix exclusion, hard-genuine set measured and printed, unknown ≠ suspicious, flag-only policy |
| Simulator proves only the authors' assumptions | scores come out of the real pipeline, held-out shifted simulator, explicit leakage statement, real traces + reviewer labels as the exit path |
| Forged sensor streams | multiple independent streams, server-issued visit session, time/replay checks, raw/window cross-check; limits stated, never "spoof-proof" |
| Privacy of location data | consent, minimal and downsampled trail, retention + purge tool, authenticated display, no third-party map tiles |
| Breaking the dashboard/old clients | same SHAP keys and column names, optional payload fields, legacy compat path, migration tested |
| Scope growth (native app, geo-IP, maps) | explicitly out of scope; hooks only |

## 11. Out of scope for this iteration

Native/background tracking, real WiFi/cell scanning, buying or integrating a geo-IP service, face/photo changes (edge validator), authentication redesign, deployment, map tiles, any commit/push.
