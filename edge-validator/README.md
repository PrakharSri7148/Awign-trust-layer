# Edge validator

The photo-quality engine behind the Capture screen: it decides, on the worker's phone, whether a photo is good enough to submit, and the backend re-checks the same photo so the device's word is never taken on trust.

| File / folder | What it is |
|---|---|
| [iteration-1.md](iteration-1.md) | The audit of the original single-check validator and the plan for this work |
| [iteration-2.md](iteration-2.md) | **Phase 6 plan: live metrics HUD on the camera** (spec, tasks, acceptance criteria, test recipe) |
| [iteration-3.md](iteration-3.md) / [iteration-3-prompt.md](iteration-3-prompt.md) | **Phase 7 plan: anti-spoofing/liveness, ML accuracy report, camera UI redesign**, and the prompt to start it in a new chat |
| [iteration-4.md](iteration-4.md) / [iteration-4-prompt.md](iteration-4-prompt.md) | **Phase 8 plan: the focus/"good photo refused" bug, then finishing the validator end to end** (what is done and what is still open is at the bottom of progress.md) |
| [thresholds-changelog.md](thresholds-changelog.md) | Every change to `thresholds.json` (and logic that moves verdicts), with the evidence; each report prints the hash of the file it used |
| [reports/accuracy-report.md](reports/accuracy-report.md) | **ML accuracy report** (regenerate with `npm run report`) |
| [progress.md](progress.md) | What was built in each of the 7 phases, how it was verified, and the honest limits |
| `screenshots/phase7/` | Screenshots from the Phase 7 headless-Chrome runs (layouts at 3 viewports, the live-check prompt, the case file); no personal faces |
| `samples/` | **Where real worker photos go** for calibration (one folder per issue, see its README) |
| `backups/` | The database and classifier as they were before phases 2 and 5 |

## How it fits together

```
 phone (client/src/lib/photoQuality)                       server (backend/photo_quality)
 ┌──────────────────────────────────────────┐              ┌────────────────────────────────┐
 │ in-app camera ─ live guidance (5 fps)     │              │ decode photo (Pillow)          │
 │      └ burst of 8 frames → sharpest kept  │   photo +    │ same 7 pixel checks, same thresholds │
 │ or file picker                            │  device's    │ + face (MediaPipe, optional)   │
 │      ↓                                    │  own report  │ compare with the device report │
 │ decode → frame (1280px + native patches)  │ ───────────► │ hash / near-duplicate / EXIF   │
 │      ↓ Web Worker                         │              │ store photo, verdict, flags    │
 │ 7 pixel checks   + face (MediaPipe, WASM) │              │      ↓                         │
 │ + sensor shake (gyro/accel)               │              │ photo_quality_score → fraud    │
 │ + live check (face-required tasks):       │  evidence +  │ model (+ SHAP) → status        │
 │   random challenge + screen/print signals │  nonce       │ nonce / replay / passive recheck│
 │      ↓                                    │              │                                │
 │ policy: pass / warn / block               │              └────────────────────────────────┘
 └──────────────────────────────────────────┘
        thresholds.json  ◄── one shared file, read by both ──►
```

## The checks

| Check | Measures | Blocks? |
|---|---|---|
| **blur** | edge steepness ÷ local contrast, minus a noise floor, per tile | yes |
| **exposure** | mean luma, % crushed (<25), % clipped (>245), contrast range | yes |
| **resolution** | native pixels (not the downscaled analysis size) | yes |
| **obstruction** | flat, dark-or-finger-coloured area touching the frame edge | yes |
| **face** | BlazeFace: found, confidence, cut-off, size, pose, face-crop sharpness/lighting, eyes, extra faces. Only for tasks with `face` ≠ `off` | yes when `required`; never when `optional` |
| **liveness** | A live person answered a random challenge (blink / turn head left or right / smile / open mouth) and the picture does not look like a screen or a print. Only for tasks with `face` ≠ `off`. See *Liveness* below | yes when `required`; flag only when `optional` |
| **glare** | blown-out region with a soft, surrounding, monotone halo | flag only |
| **shake** | edge steepness *per orientation* (directional blur) + gyro/accelerometer around the shutter | flag only |
| **noise** | robust noise σ on native patches + JPEG 8×8 blockiness | flag only |

"Blocks" means a `fail` stops the submission; otherwise a `fail` is a flag the worker can override with *Submit anyway* (recorded). Change this in `policy` in `thresholds.json`, no code needed.

## Thresholds (`client/src/lib/photoQuality/thresholds.json`)

Blur and shake were calibrated on 106 real sharp and 338 real blurred photos (calibration run 2 in `progress.md`); dark exposure on 31 real iPhone photos. Lens covered, glare, overexposed and noise/compression are validated on **synthetic** degradations only; the rest are starting points. Re-tune with real photos (below).

| Group | Key | Meaning |
|---|---|---|
| blur | `failBelow` 0.16 / `warnBelow` 0.25 | edge-steepness score at a 1280px analysis size; sharp photos score about 0.3–0.4. `minTileRange` 20 = a tile with less contrast than this is "no texture", not "blurry"; `grid` 3 = 3×3 tiles, the 66th-percentile tile counts |
| exposure | `darkMeanFail/Warn` 40/65, `overMeanFail/Warn` 235/210 | mean luma 0–255. `crushedFrac*` share of pixels <25; `clippedFrac*` share >245; `flatRangeWarn` 45 = p95−p5 below this looks hazy |
| resolution | `failShortSide` 480, `failLongSide` 640, `warnMegapixels` 0.75 | native size |
| noise | `sigmaWarn/Fail` 5/10 | grey levels (0–255) on native-resolution flat-ish pixels. `blockWarn/Fail` 1.15/1.45 = JPEG boundary/interior gradient ratio (~q75 / ~q45); `blockMinExcess` 0.5 = the step must also be this many grey levels |
| obstruction | `warnArea` 0.10, `failArea` 0.35, `fullCoverArea` 0.85 | share of the frame. `flatTileStd`, `flatRelative`, `coverFlatStd` define "texture-less"; `darkTileMean` 50 |
| glare | `warnArea` 0.01, `failArea` 0.04, `hardWarnArea` 0.10 | share of the frame. `haloMin` 10 grey levels, `haloSurround` 0.6, `cell` 8 px |
| shake | `warnAniso` 1.25, `failAniso` 1.6 | image anisotropy (capture check). `optical.warnPct/failPct` 1.0/3.0 = live image motion as % of the frame width per 200 ms (starting values, uncalibrated; `thumbWidth` 160, `maxShift` 6). | sharpest ÷ softest orientation (sharp photos 1.0–1.2, defocus ≤1.25). `sensor.rotWarn/Fail` 25/60 °/s, `accWarn/Fail` 1.2/3 m/s² |
| face | `minScoreWarn/Fail` 0.7/0.5, `minHeightWarn/Fail` 0.15/0.08, `visibleWarn/Fail` 0.95/0.75, `yawWarn/Fail` 0.35/0.7, `rollWarn` 25° | see `face/facecheck.js` |
| live | `size` 480, `blurBad/Soft` 0.2/0.28, `readyFrames` 3, `burst.frames` 8 | live guidance + burst; deliberately coarse |
| live.hud | `ema` 0.4, `hysteresisTicks` 2, `focusFull` 0.40, `nativeCrop` 256, `cropEvery` 2, `faceMissesBeforeNotFound` 3 | live metrics HUD: smoothing, status debounce, the blur score that reads as 100% focus, native-resolution noise crop (every 2nd tick), face detections in a row before "not found" |
| liveness | `challengesPerAttempt` 2, `timeoutMs` 4000, `neutralMs` 200, `faceLostMs` 1200, `validForMs` 30000, `maxAttempts` 3, `sampleEveryMs` 70, per-challenge `neutralBelow`/`activeAbove`/`holdMs` (blink 0.25/0.55, smile 0.25/0.55, open mouth 0.12/0.40, turn 8°/20°) | starting values chosen before any real blink data (see *Liveness*); `policy.liveness.blockOnFail` true |
| passive | `moire` warn 8 / fail 15 (calibrated on 346 real photos: max 7.1), `bezel` (frame detector), `banding`, `planarity`, `weights`, `warnAt` 0.45, `failAt` **1.01** | screen/print heuristics; `failAt` above 1 means they only flag, never block (decision pending real spoof samples) |
| live.hud | (above) plus `segments` 10, `overallSegments` 20 | number of cells of the segment meters |
| tasks | `face` `off\|optional\|required`, `camera` `environment\|user`, `live` | per-task requirements |

## Camera layout (Phase 7b)

Phones (≤ 720 px): an **immersive** full-viewport camera (`100dvh`, safe-area insets, ✕ to close, page scroll locked, shutter always on screen, metrics compact above the hint). 721–999 px: the stage at full width with the metrics under it. ≥ 1000 px: a large stage **sized to the camera's own aspect ratio** (no black bars) with the metrics panel beside it. The photo-picker fallback and the post-capture preview + checklist use the same larger layout. Code: `components/capture/LiveCamera.jsx`, `useLayoutMode.js`, `lib/photoQuality/segments.js` (pure `toSegments` / `segmentTicks` / `positionSegments`), `styles/global.css`.

## Liveness / anti-spoofing (Phase 7c–7e)

Reported bug: a person's photo shown on another phone or screen to the camera was accepted. Now, for tasks with `face: required` (the Selfie check-in):
1. **Active challenge** (`lib/photoQuality/face/liveness.js`, pure): the server issues a random list of two different *kinds* of action (`POST /liveness/challenge` → ids + a single-use nonce, TTL 180 s); the phone verifies them with MediaPipe FaceLandmarker blendshapes (eye blink, smile, jaw open) and head yaw from the transformation matrix. A challenge counts only on **neutral → active** (→ neutral for a blink): a face that is already smiling, eyes held open or shut, a still photo, or a face that leaves the frame and comes back cannot pass. The **shutter stays disabled** until the live check passes (valid for 30 s); after 3 failed attempts the worker may **"Send for review"** (a warning, not a block).
2. **Passive screen / print signals** (`lib/photoQuality/passive/`, evidence not verdicts): moiré (narrow isolated spectral peaks of the screen's pixel grid), a large rectangular frame (bezel or paper margin) that contains the face, flicker bands drifting between frames, landmark planarity (a flat picture moves as one homography), glare on the face. A noisy-OR of weights; a passed challenge on a picture that scores ≥ 0.45 becomes a **warning for review**, never a block (`failAt` 1.01).
3. **Server re-check** (`backend/photo_quality/liveness.py`, `passive.py`): the nonce must be ours, for this worker and task, unexpired and **unused** (atomic claim); the challenges must be the issued ones; the device's signal timeline is **replayed** through a Python port of the state machine and must pass the same challenges; moiré and the frame detector are recomputed on the stored photo. Flags: `liveness_unverified`, `liveness_forged`, `liveness_expired`, `liveness_replayed`, `liveness_mismatch`, `liveness_failed`, `liveness_review_requested`, `liveness_review_unearned` (a review must be earned: the server must have issued ≥ 3 challenges to that worker/task recently), `spoof_suspected`. For `required` tasks invalid or missing evidence makes the server verdict **block**; `optional` tasks never block; `off` tasks run nothing.

**Limits (do not oversell):** this stops photos, prints, replayed or forged evidence and most casual video replays. It does **not** stop a person who performs the action for the attacker, a replayed video that happens to match the random challenges, or an injected virtual camera. The thresholds are starting values: **real pass rate and real spoof detection rates are unmeasured until `live_selfies/` and `spoof_*` samples exist** (`samples/README.md`); the end-to-end tests use a labelled mock for the blink the fake camera cannot perform and synthetic spoof streams. Challenges exclude some people (eye or mobility conditions): the only alternative today is "Send for review". Dev builds expose `window.__landmarkerMock` (compiled out of production) for the tests.

## Live metrics HUD (on the camera)

While framing a shot the camera shows, live (about 5 times a second): an overall **Live quality %**, and a row per parameter with a number, a bar and a green/amber/red status: **Brightness %**, **Focus %**, **Lens** (clear / partly N% / covered), **Glare**, **Steadiness** (°/s), **Noise** (σ), **Resolution** and **Face** (confidence · size, or "off" / "searching…" / "not found"). JPEG compression can't be measured on a video stream, so it says *checked when you capture*. Every metric is a **10-segment meter** (20 for the overall) that lights up and goes dark step by step as the value moves: green when the row passes, amber/red when it is in warn/fail; brightness is one lit segment at the mean-luma position with the good zone outlined; small notches mark where warn/fail start; each meter is a `role="meter"` with the value as text. The **Metrics** button switches between the full panel (default beside or under the preview) and a compact grid (default over the camera on phones); the choice is remembered per layout. Add `?hud=raw` to the URL to see the raw numbers under each row and per-tick timing (`window.__liveTickMs`). The post-capture checklist shows the same words ("Focus 82%", "Brightness 46%").

**Steadiness** uses two sources and shows the worse: the phone's motion sensors (°/s, m/s²) when it has them, and the picture itself (how far the whole image moved between frames, shown as `motion N%`), which works on any camera, including laptops and phones where the browser hides the sensors. **Face mesh:** on tasks with a face, a face-analysis mesh (blue dots joined by white lines at ~28 key points: brows, eye corners, nose, cheeks, mouth, jaw, chin) is drawn over the face using MediaPipe FaceLandmarker (`public/mediapipe/face_landmarker.task`, 3.7 MB, loaded only for face tasks); face tasks also start with the compact HUD so the panel doesn't cover the face. Code: `face/meshGraph.js`, `face/meshDraw.js`, `face/mediapipeLandmarker.js`, `components/capture/FaceMesh.jsx`.

Focus % is a *relative* score (0.05 → 0%, `focusFull` → 100% of the coarse blur score at preview size), not a physical unit, and the live thresholds are intentionally coarser than the capture ones: an amber live Focus can still pass the full check on the captured photo. The numbers are display-only and are never sent to the server.

Code: `lib/photoQuality/liveMetrics.js` (pure model: rows, EMA, hysteresis, face miss counter), `live.js` (`analyzeLive`: each pixel metric computed once), `components/capture/LiveHud.jsx`, `LiveCamera.jsx`. The per-tick pixel work runs in the Web Worker (`workerHandlers.js`); only the native crop read, the frame read and the face detector stay on the UI thread. End-to-end harness: `client/tools/e2e/` (see below).

## Accuracy report

```bash
cd client && npm run report        # ~4 min -> edge-validator/reports/accuracy-report.md + accuracy-report.json
```
Reproducible (seeded, no network, same inputs give the same numbers; latency excluded). For the fraud classifier, each photo-quality check treated as a classifier, the face detector and (once samples exist) liveness it gives: dataset inventory with duplicates, confusion matrices, precision/recall/F1/specificity/AUC with 95% CIs, threshold sweeps around the deployed values, error analysis with file names, latency, client-vs-server parity. **Every table is labelled REAL or SYNTHETIC**; synthetic numbers are never real-world accuracy. Folder roles (which real folder counts as a positive, which is observation-only and why) live in `backend/tools/reportlib/inventory.py::ROLES`; `--trust-folder overexposed,glare` overrides. Maths and inventory are unit-tested (`backend/tests/test_report_*.py`, `test_accuracy_report.py`).

## Calibrating with real photos

1. Drop photos into `samples/<issue>/` (see [samples/README.md](samples/README.md)): ≥100 in `good/`, ≥30 in each issue folder.
2. `cd client && npm run calibrate`
   - shows, per folder, how many photos pass / warn / block and how many are caught by the expected check;
   - shows how many **good** photos the current thresholds wrongly reject (the number that matters most);
   - for each check, the separation (AUC) between good and issue photos and a **suggested** threshold in the gap between them (or at your false-reject target if the groups overlap).
   - `--synthesize lens_covered,noisy_compressed,overexposed,glare` fills missing folders with synthetic degradations of `good/` (labelled in the report); `--dump file.json` saves per-photo results; `--skip folder` ignores a folder.
   - `npm run calibrate -- --demo` shows the format using bundled photos before you have any; `--max-false-reject 0.02` changes the target; `--write` saves `thresholds.suggested.json` (the real file is never modified).
3. Review the suggestions, copy the numbers you accept into `thresholds.json`, then run the tests and `node tools/parity.mjs`.

Treat anything based on fewer than 30 photos per group as indicative only (the tool says so).

## "Why was my photo refused?" (focus and everything else)

The Capture screen now says it: a red **"Why this photo can't be submitted"** box names every blocking check with the measured value and the limit (for example *Focus 19% — needs at least 31%*, *face is 5% of the frame height — needs at least 8%*), and `?debug=checks` on the URL shows every check, the 3×3 blur tiles and the face-crop sharpness. For one file, or a whole folder of refused photos, from the terminal:

```bash
cd backend
.venv/bin/python tools/focus_diagnose.py photo.jpg                                   # shelf task: every check, value vs threshold, blur tiles, verdict, WHY
.venv/bin/python tools/focus_diagnose.py --task task_selfie_checkin --client selfie.jpg   # face task + the browser engine's numbers side by side
.venv/bin/python tools/focus_diagnose.py --task task_selfie_checkin --brief folder/        # one line per photo + a count of what blocked
```
Other experiment scripts behind the Phase 8 diagnosis: `tools/focus_experiments.py sigma` (what softness the block line means), `client/tools/focus-experiments.mjs burst|scale`, `client/tools/e2e/focus-capture.mjs` (real photos through the real in-app capture in headless Chrome).

**Focus rules in force:** the whole-photo focus check blocks below score 0.16 (≈ a Gaussian softness of 3.7 px at 1280 px; the real blurry set sits at 3–4+ px) and warns below 0.25. The face-crop sharpness **no longer blocks on its own**: if the whole-photo focus does not fail, a face whose only failure is crop sharpness is a warning ("Submit anyway", recorded).

## Reviewer workflow (the end of the pipeline)

Flags used to end at a badge. Now the dashboard has a **Review queue** (cases the fraud model flagged, photos the server blocked, and integrity flags such as `spoof_suspected`, `duplicate_photo`, `liveness_*`, `client_missed_*`). A reviewer opens the case (photo, live-check evidence, flags), types their name and records **Approve / Reject / Needs retake** with a reason (required unless approving). It is stored in the `review` table (reviewer, time, history kept, latest wins), shown in the case file and as a badge in the feed, and is the first source of **real labels**: the accuracy report's section 5 shows, per flag, how often a human upheld it (Wilson CIs) and who reviewed how many. `backend/tools/reviewed_dataset.py` exports a labelled CSV only once there are ≥ 200 reviewed cases with ≥ 50 in each class; until then the fraud classifier stays labelled SYNTHETIC, and liveness/spoof flags stay policy (never classifier features). API: `GET /reviews/queue`, `POST /submissions/{id}/review {reviewer, decision, reason}`, `GET /submissions/{id}/reviews`. `REVIEWERS="alice,bob"` restricts who may record a decision (otherwise any name; the name is self-declared, **not authentication**).

## Privacy, retention and access (mechanisms ready, decisions are yours)

| Setting | Default | What it does |
|---|---|---|
| `PHOTO_RETENTION_DAYS` + `backend/tools/purge_photos.py [--apply]` | unset = photos are kept | dry run by default; deletes stored photos and the liveness signal timelines older than N days, **keeps verdicts, flags, scores, hashes and review decisions**; a photo file still used by a recent submission is kept |
| `DASHBOARD_TOKEN=<secret>` | unset = open | the dashboard, reviewer and photo endpoints then need `Authorization: Bearer <secret>` (or `X-Dashboard-Token`, or `?token=` for images); workers' `POST /submissions`, `POST /liveness/challenge`, `GET /health` stay open. The dashboard asks for the token once (kept in `sessionStorage`). A shared secret, not accounts: put SSO / a gateway in front for real use |
| `SUBMISSION_RATE_PER_HOUR` | 120 | per worker, 429 beyond it; 0 = unlimited (challenge requests were already limited to 40 unused per worker+task per hour) |
| `REVIEWERS` | unset | allowlist of reviewer names |

The selfie task shows a one-line notice that the face photo and live check are used only to verify the submission (draft wording: have it approved before real use, and add the retention period once decided). Image content is never logged. A missing `mediapipe` on the server degrades to `face_unchecked` / `liveness_unverified` flags, never a crash (tested). The camera needs **HTTPS** (or localhost): `npm run dev:https` for a phone on the LAN; in production serve the client over HTTPS and the API behind the same origin or a CORS allowlist (the dev CORS list in `main.py` is localhost only).

## One-command end-to-end test

```bash
cd client && npm run e2e [scenario]      # builds the fake-camera streams, starts an ISOLATED backend (temp DB, :8001) and Vite (:5173), runs every scenario, tears down
```
It refuses to run if `8001` / `5173` are busy or if asked to use `8000` / `5174` (your dev servers). Scenarios: good, dark, blurry, noisy, covered, shaky, face, laptop, mesh, facetiming, liveness, spoof, fullstack, casefile, **sharpcapture** (real photos are not refused; a blurry one is, with numbers), **liveoffline** (server unreachable → explicit message, one nonce per attempt), **review**, layout, segments, toggle, timing, burst. The "person" in the liveness scenarios is a labelled mock (dev builds only); the fake camera cannot autofocus or blink.

## What to capture next (so `npm run report` can turn it into numbers)

| Folder under `samples/` | What | How many | Gives you |
|---|---|---|---|
| `camera_rejected_good/` | photos that looked good but were refused, from the in-app camera, plus `notes.txt` (what the red box said, task, phone) | 10+ | the true cause of any remaining focus refusals (`focus_diagnose.py --brief`) |
| `good_selfies/` | clear selfies from the front camera, with consent, varied phones/light/glasses/hijab/beard | 40+ | face false-reject rate, face-crop sharpness tuning |
| `good/` (worker phones) | sharp shelf/site photos from real workers' phones | 100+ | false-block rate on real worker photos |
| `live_selfies/`, `spoof_screen/`, `spoof_print/`, `spoof_video/` | see `samples/README.md` | 40 / 40 / 20 / 20 | real liveness APCER/BPCER/ACER, passive threshold tuning |
| `glare/`, `overexposed/`, `lens_covered/`, `noisy_compressed/` | real photos of each problem | 30+ each | replaces the synthetic-only validation |

## Manual device test sheet (physical phones stay your decision)

On an iPhone (Safari) and an Android phone (Chrome), on HTTPS, once with the front camera (Selfie check-in) and once with the rear (Shelf): (1) does the camera open and is the shutter on screen without scrolling? (2) note the Focus % and the hint on the live screen; (3) take 3 sharp photos: write down the title (verified / warnings / needs retake) and, if refused, the red "Why this photo can't be submitted" text; (4) take 1 deliberately blurred photo: it must be refused with a reason; (5) selfie: does the live check start, how many seconds did two challenges take, did it pass first time? (6) turn Wi-Fi off before the live check: you should see "Can't reach the server"; (7) record phone model, OS, browser version. Put refused-but-good photos in `camera_rejected_good/` with those notes.

## Running the tests and tools

```bash
cd client  && npm test                      # 201 tests: checks, face logic, liveness state machine, passive screen/print signals, segments, camera logic, merge, dashboard helpers
cd backend && .venv/bin/python -m pytest    # 130 tests (~5 min): reviewer workflow, hardening/retention, focus regression, engine, API, spoofing, duplicates, EXIF, face, classifier, migration, calibration, report maths, passive, liveness server (nonce/replay/forgery)
cd client  && node tools/parity.mjs [photo] # JS engine vs Python engine on 37 degraded variants of one photo
```

## End-to-end HUD test in headless Chrome

```bash
cd client
node tools/e2e/mkstreams.mjs /tmp/hudcams          # fake-camera streams with known brightness / noise / blur / covered lens / face
# a dev server that is NOT the one you work on, with its own cache (see iteration-2.md §4), then:
node tools/e2e/hud-e2e.mjs /tmp/hudcams [good|dark|blurry|noisy|covered|shaky|face|laptop|mesh|facetiming|liveness|spoof|fullstack|casefile|layout|segments|toggle|timing|burst]
# fullstack/casefile need the ISOLATED backend (TRUST_LAYER_DB=<tmp>/e2e.db PHOTO_DIR=<tmp>/uploads uvicorn main:app --port 8001) and Vite started with VITE_API_URL=http://127.0.0.1:8001; never the real servers
```
Needs `puppeteer-core` (not an app dependency). Chrome's fake camera plays full-range JPEG as limited-range video, so the browser sees `(Y-16)*255/219`; the harness compares against that.

## Adding a new check

1. `client/src/lib/photoQuality/checks/<name>.js`: a pure `(frame, ctx) → checkResult(...)`; register it in `checks/index.js`; add its id to `schema.js` (`CHECK_IDS`, `CHECK_LABELS`) and thresholds + policy to `thresholds.json`.
2. Port it to `backend/photo_quality/checks/<name>.py`, register it in `checks/__init__.py`.
3. Add a flag description to `FLAG_META` in `client/src/lib/format.js`.
4. Tests in both languages, then `node tools/parity.mjs` must still show 100% agreement.
