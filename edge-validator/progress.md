# Edge Validator — Progress

Plan: see `iteration-1.md`. Updated after every phase. How to use the result: see `README.md`.

**Status (2026-10-07): phases 0–6 complete (Phase 6 = live metrics HUD, spec in [`iteration-2.md`](iteration-2.md), results at the bottom of this file).** Calibration runs 1–2 are done (see the sections above); further calibration is optional and not a prerequisite for Phase 6.

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation: `photoQuality/` structure, shared frame + decode, result schema, policy, request-id guard, test env | ✅ done |
| 1 | Pixel checks: blur, exposure, resolution, noise/compression, lens obstruction + checklist UI + policy | ✅ done |
| 2 | Glare, image-based shake, "Submit anyway", backend schema + upload + server recheck | ✅ done |
| 3 | Face check (MediaPipe) + per-task config | ✅ done |
| 4 | In-app camera, live feedback, burst best-frame, sensor-synced shake, Web Worker | ✅ done |
| 5 | Calibration tool, classifier retrain, dashboard | ✅ done |
| 6 | **Live metrics HUD on the camera** (brightness %, focus %, all 8 parameters, overall live quality %) — plan in `iteration-2.md` | ✅ done |
| 7 | **Iteration 3:** liveness / anti-spoofing (photo-of-a-screen bug), ML accuracy report, camera UI redesign (bigger frame, 10-segment green meters) — plan in `iteration-3.md`, paste-ready prompt in `iteration-3-prompt.md` | ✅ done except the real-sample liveness evaluation (7f, waiting for your samples); see "Phase 7" at the bottom |

---

## Phase 0 — Foundation ✅

**What was built** (all under `client/src/lib/photoQuality/`)

- `schema.js`: result vocabulary (`pass|warn|fail|skip`, verdicts, check ids, labels, `ramp()` for 0..1 scores).
- `frame.js`: a "frame" = 640px analysis image (RGBA + gray) + native-resolution 384px patches (8px-aligned, for noise/JPEG-blockiness later) + file metadata. Pure helpers: `rgbaToGray`, `resizeGray`, `analysisSize`, `patchOrigins`, `buildFrame`.
- `decode.js`: `decodeToFrame(file)` using `createImageBitmap` (no full-size canvas, so 48MP photos don't blow memory). Environment is injected, so the real decode path is testable in Node.
- `config.js`: thresholds + block/flag policy in one place; `DEFAULT_TASK` (face off).
- `policy.js`: `aggregate()` → verdict (`pass|warn|block`), ordered issue list, 0..1 quality score.
- `checks/blur.js`: the original Laplacian check moved behind the common interface (unchanged behaviour; rewritten in Phase 1).
- `index.js`: `analyzeFrame()` (pure; one failing check can't break the rest) and `runPhotoQuality(file)`.
- `edgeValidator.js`: now a back-compat shim, so `Capture.jsx` still works.
- `testing/synth.js` + `testing/nodeEnv.js`: synthetic image generators (scene, blur, motion blur, noise, discs…) and a Node canvas environment (`@napi-rs/canvas`).

**Fixes**

- Stale-result race in `Capture.jsx`: a slow older check can no longer overwrite a retake (request-id guard).
- Large photos no longer decode through a full-size canvas.

**Tests:** 13 passing (`npm test`), including real PNG/JPEG decode → blur verdict.
**Dependency added:** `@napi-rs/canvas` (dev only).


---

## Phase 1 — Pixel checks ✅

**New checks** (`client/src/lib/photoQuality/checks/`), each a pure function of a frame:

| Check | Method | Verified on |
|---|---|---|
| **blur** | Edge steepness per tile (top-2% Sobel gradient on a 3×3-smoothed image) ÷ the tile's own contrast, minus an estimated sensor-noise floor; 3×3 tile grid, 66th-percentile tile so a sharp subject on a soft background passes; flat scenes return *warn: cannot judge*, not *fail* | Sharp photos 0.30–0.42; heavy blur < 0.14 |
| **exposure** | Mean luma, % crushed (<25), % clipped (>245), p5–p95 range → dark / over / washed-out | dark ×0.3, over ×2+90, hazy |
| **resolution** | Native pixel size (from the original file, not the downscaled analysis frame) | 4000×3000 pass, 960×640 warn, 640×360 fail |
| **noise / compression** | Robust (median-based) Immerkaer noise σ on native-resolution patches + JPEG 8×8 blockiness (ratio *and* absolute step size, difference-capped) | σ estimate within 1% of true on white noise; JPEG q95→q12 monotone |
| **obstruction** | 12×12 tile grid: flat tiles judged against the photo's own median texture, that are dark *relative to the photo* or finger-coloured, connected to a frame edge | clean/plain wall/sky pass; corner patch warn; half or full cover fail; uniformly dim photo is *not* "covered" |

**Findings from real photographs** (macOS wallpaper + scikit-learn's two sample photos, degraded in software):

- The old Laplacian-variance metric was **16× lower for a dim copy of the same sharp photo**, and **blur + noise scored higher than the sharp original** (7,163 vs 5,623). Both are fixed by the new blur metric.
- Analysing at 640px hid moderate blur (r=5 blur still scored 93% of sharp). **Analysis size raised to 1280px**: the same blur now scores 70%.
- A first-cut "photo was enlarged" detector could not be told apart from mild blur (1px blur read 1.89, a 4× upscale 1.91, a sharp photo 1.45). **It was removed as a flag** and kept only as an informational number in `details` for calibration against real photos.

**Policy** (`config.js`): blur/exposure/resolution/obstruction block on `fail`; noise (and later glare, shake) only flag.

**UI:** `QualityChecklist` replaces the single sharpness gauge: one row per check with a ✓ / ⚠ / ✗, a plain-language hint, and a quality score. Block → only *Retake*; warn → *Submit anyway*; pass → *Submit*. Non-blocking failures show amber, only blocking failures red.

**Verified in real headless Chrome** (not just Node): `createImageBitmap` + canvas decode path works, ~300–550 ms per photo including upload, no browser console errors; good → "Photo verified", blurry/dark/covered → blocked with the right row, noisy → "accepted with warnings / Submit anyway".

**Tests:** 33 passing. New regression tests encode the failures measured in the audit (noise ≠ sharpness, flat wall ≠ blurry, dim sharp ≠ blurry) plus real-photo fixtures.

**Known limits / honest notes**

- All thresholds are tuned on *synthetic degradations of 3 real photos*, not on worker photos. Treat them as starting values until the samples arrive (Phase 5 calibration).
- Noise check measures what the camera left after its own denoising; real phone photos may need different σ thresholds.
- Per-check time in Node is ~250–500 ms for a 2 MP photo; the Web Worker in Phase 4 moves it off the UI thread.


---

## Phase 2 — Glare, shake, "Submit anyway", server recheck ✅

### New client checks

| Check | Method |
|---|---|
| **glare** | 8px cell grid: a cell is *blown* if ≥70% of it is near-white (brightest channel ≥245, saturation ≤0.2) **and** texture-less. Largest connected blown blob → area + bounding box + named region ("top-right"). To tell glare from a white poster: glare has a **halo**, so ring 2 must be brighter than ring 5, fall off **monotonically** (2>3>4>5), and **surround** the blob (≥60% of ring-2 cells). Soft blob ≥1% → warn, ≥4% → fail; a hard-edged white area only ever warns, and only above 10% |
| **shake** | Edge steepness (gradient ÷ local contrast) measured **per orientation** (4 bins). Motion blur softens only edges perpendicular to the motion, defocus softens all equally, a sharp photo is equal in all. Ratio sharpest/softest orientation: sharp photos 1.0–1.2, defocus ≤1.25, motion blur 1.4–1.9. Warn ≥1.4, fail ≥1.8. Names "horizontal/vertical" only when unambiguous |

Both are **flag-only** (never block), per the policy.

### Two false-positive bugs found and fixed while testing glare

1. The halo was first measured on ring 1 vs ring 3. That only "worked" because my synthetic poster edge happened to sit exactly on the 8px grid; with the Python port's antialiased resize, the edge cell was partly white and a hard-edged poster read as glare. Real edges never align to the grid. → compare ring 2 vs ring 5.
2. A bright shape next to a small poster produced a one-sided brightness fall-off that passed the halo test by coincidence. → require monotone fall-off **and** that the halo surrounds the blob.

### Shared thresholds

`client/src/lib/photoQuality/thresholds.json` is now the single source of truth for thresholds + block/flag policy, read by both the JS engine and the Python engine (so they cannot drift).

### Backend: server-side recheck (the real trust control)

New package `backend/photo_quality/` — a numpy/scipy/Pillow port of the engine (blur, exposure, resolution, noise/compression, obstruction, glare, shake), same thresholds, same report shape.

**Parity (JS engine vs Python engine, same photos):** `node tools/parity.mjs [photo]`
- 3 real source photos × 37 degraded variants = **111 photo pairs: 100% status agreement on every check, 100% verdict agreement, 0 disagreements.**
- Metrics agree to a median of ≤1.4% (worst single case: blur 13%).

**`POST /submissions`** now takes `multipart/form-data` (`payload` JSON + `photo` file); plain JSON still works.
- The server decodes the photo, runs all checks, and **its verdict, not the device's, feeds the classifier** (`photo_quality_pass = server verdict != block`).
- **Spoof detection:** the device's report is compared with the server's. Flags: `client_missed_<check>` (device said pass, server measured fail), `client_verdict_mismatch`, `client_dimensions_mismatch` (claimed size ≠ real size, >2%), `client_report_missing`. Borderline differences are deliberately *not* flagged (browsers differ slightly).
- **No photo = unverified:** a submission without a photo gets `photo_missing`, `photo_quality_pass=false`. `PHOTO_REQUIRED=0` restores the old trust-the-boolean behaviour.
- **Photo evidence:** SHA-256 + 64-bit perceptual hash (dHash) → `duplicate_photo` (same file from a different worker/task/site) and `near_duplicate_photo` (re-compressed/resized copy, ≤5 bits). The same worker re-sending the same photo for the same task+site is treated as a retry, not reuse. EXIF → `no_exif` (screenshots / forwarded copies) and `old_photo` (>48h before submission).
- `submitted_anyway` recorded when the worker overrode a warning.
- Photos stored under `backend/uploads/<aa>/<sha256>.<ext>`; `GET /submissions/{id}/photo` serves them. List endpoint stays light (verdict, score, flags); `GET /submissions/{id}` returns the full client + server report.
- Limits: 25 MB (`MAX_PHOTO_BYTES`), >100 MP refused, undecodable → 422, oversized → 413. CPU work runs in a thread pool.

**Database:** 9 new `submission` columns, added to existing databases automatically at startup (`ALTER TABLE`, idempotent). **Your existing `trust_layer.db` was migrated on reload with all 3 rows intact**; a backup of the original is in `edge-validator/backups/trust_layer.db.before-phase2`.

### Verification

- Client tests: **41 passing** (`npm test`).
- Backend tests: **25 passing** (`backend/.venv/bin/python -m pytest`): engine, API incl. the **spoofed-report scenario**, duplicates/retries/near-duplicates, EXIF, 413/422 handling, legacy mode, and the DB migration.
- **End-to-end in real Chrome → real backend** (isolated throwaway DB so your data wasn't touched): good photo → submitted, server verdict `pass`; noisy photo → "Submit anyway" → server verdict `warn`, flags `noise, no_exif, submitted_anyway`, override recorded; both photos stored; no browser errors.

### Honest notes

- Photos from some iPhones can be HEIC; Pillow can't read those without `pillow-heif`. Safari normally converts to JPEG on upload from a file input, but this is untested on a real iPhone.
- The duplicate check scans all prior hashes in Python — fine for thousands of submissions, would need an index/vector approach at scale.
- `old_photo` uses EXIF time, which has no timezone; a ±14h tolerance is applied. EXIF is trivially editable, so these are weak signals (flags only, never blocking).


---

## Phase 3 — Face check + per-task config ✅

### Per-task config (shared client ↔ server)

`thresholds.json → tasks` defines, per task id: `face` (`off` | `optional` | `required`) and `camera` (`environment` | `user`). Three tasks ship: **Shelf / site photo** (no face, rear camera), **Selfie check-in** (face required, front camera), **Worker at site** (face optional). Unknown tasks default to no face / rear camera. The Capture screen has a task picker; the file input asks for the right camera; switching task resets the photo.

### The face check (`photoQuality/face/facecheck.js`, ported to `backend/photo_quality/face.py`)

Detector: **MediaPipe BlazeFace short-range**, on-device (WASM in the browser, same model in Python on the server). The runtime and the 230 KB model are served from our own origin, not a CDN, and are loaded lazily (and pre-fetched when a face task is chosen). The photo never leaves the device for this check. The pure evaluation takes normalised detections, so all logic is unit-tested with scripted faces.

| Aspect | Rule |
|---|---|
| **Found** | none → fail "No face found. Move closer…" |
| **Confidence** | <0.5 fail ("no clear face"), <0.7 warn |
| **Cut off** | visible share of the face box <0.75 fail, <0.95 warn; an eye outside the frame fails |
| **Size** | face height <8% of the frame fail, <15% warn |
| **Pose** | yaw from nose offset ÷ eye distance (warn 0.35, fail 0.7); head tilt >25° warn |
| **Face quality** | sharpness of the *face crop* and lighting of the *inner face* measured separately, so a blurred or shadowed face fails even when the rest of the photo is fine |
| **Eyes hidden** | eye patches <45% of the face brightness → "take off sunglasses" (warn) |
| **More than one person** | second *confident* face of similar size → warn |

Design decisions worth knowing:
- The **main face is the most confident one**, not the biggest box (a spurious large low-confidence box was being picked).
- **Pose, eye and quality judgements are skipped for low-confidence detections**: their keypoints are noise (a cut-off face produced "yaw 2.85").
- If the detector can't load (offline, unsupported browser) the result is a **non-blocking warning** ("will be reviewed"), never a block — a worker with no signal must not be stranded.
- `required` face can block; `optional` never blocks; `off` doesn't run it.
- Server: if `mediapipe` isn't installed the face check is "unchecked" and flagged `face_unchecked` (install `requirements-face.txt` to enable the recheck). The detector is preloaded at server start.

### UI
- Overlays on the photo: green/amber/red box on the **face**, amber on **glare**, red on a **covered lens** (`PhotoOverlay`, correct under letterboxing).
- Checklist gains a **Face** row; the capture hint reads "Front camera · photo quality check" on face tasks.

### Verification
- Client tests **60 passing** (19 new for the face logic: confidence, size, cut-off, pose, multi-face, main-face choice, garbage-keypoint gating, blurred/shadowed/sunglasses, detector failure, required/optional/off policy).
- Backend tests **34 passing** (9 new: real face passes, no-face blocks selfie but not shelf, optional never blocks, detector-unavailable → warning, geometry parity, **client claiming a face that isn't there is caught (`client_missed_face`)**, API flows).
- **Real MediaPipe in real Chrome** on NASA's public-domain astronaut portrait + 14 degraded variants (cut off, covered, tiny, blurred, dark, tilted, sunglasses, two faces, no face): behaviour as designed.
- **Browser vs server parity on those 15 images: 15/15 identical statuses.** Detector outputs agree closely (confidence 0.92 vs 0.917, face height 0.19 vs 0.189).
- **UI end-to-end** (real Chrome → real backend, isolated DB): selfie task → front camera requested → face passes with a green FACE box → submit → server verdict `pass`, server and client face both `pass`; a photo with no face is blocked; the shelf task never runs the face check.

### Honest notes / limits
- **Masks are not reliably detected** by this detector (it "finds" the face from shape). Sunglasses are caught by the eye-brightness heuristic; masks, hands over the mouth and similar are not.
- **The short-range model needs the face to be ≳15% of the frame's longer side**; smaller faces simply aren't detected, so "too small" and "no face" both show as "No face found… move closer". It's built for selfie distance.
- **First load is heavy**: ~13 MB WASM (plus a 12 MB no-SIMD fallback for old devices). It's lazy and cached, but on a slow network the first face task will wait; brotli on the host cuts this roughly 3–4×. Pre-fetch starts when the task is chosen.
- **Fairness caveat.** Face detectors do not perform equally across skin tones, lighting and head coverings. Because `required` face can *block* a worker, validate it on your real worker photos (including diverse lighting and head coverings) before relying on it; until then consider setting `policy.face.blockOnFail` to `false` in `thresholds.json` so a miss is a flag, not a block.
- Yaw/roll thresholds are starting values (no real pose data yet). Face presence ≠ identity: this does not verify *who* is in the photo.
- The first-ever Python mediapipe call on this machine took 35 s (one-time macOS cost); subsequent cold starts are ~0.8 s and detection is 2–20 ms.


---

## Phase 4 — In-app camera, live guidance, burst, sensor shake, Web Worker ✅

### What was built

| Piece | Where | What it does |
|---|---|---|
| **In-app camera** | `components/capture/LiveCamera.jsx` | `getUserMedia` viewfinder (front or rear per task, up to 4K ideal). Opens on a tap (needed for iOS motion permission); auto-reopens after *Retake / New submission*. Falls back to the file picker if unsupported, insecure (non-HTTPS) or permission is denied |
| **Live guidance** | `lib/photoQuality/live.js` | ~5×/second on a 480px preview: **Lens, Light, Face, Steady, Focus, Glare** chips + one headline hint ("Too dark…", "Hold still."), and a "Looks good. Tap to capture." state after 3 consecutive clean frames. Face runs every 3rd tick without queueing. Deliberately coarse (see notes) |
| **Burst best-frame** | `burst.js` | On the shutter: 8 genuinely different video frames (waits for a new frame each time via `requestVideoFrameCallback`), each scored for sharpness × how steady the phone was at that instant; the winner is encoded as JPEG q0.95 |
| **Sensor-synced shake** | `checks/shakeSensor.js`, `motionBuffer.js`, `merge.js` | Rolling gyro/accelerometer buffer; the window around the picked frame is judged (RMS rotation deg/s, RMS acceleration m/s²) and **merged into the `shake` check: the worse of image and sensor wins**, both kept as evidence |
| **Web Worker** | `worker.js`, `client.js`, `transfer.js` | Pixel checks run off the UI thread (frames transferred, not copied). Face (MediaPipe) stays on the main thread and is merged back with `withCheck`. Falls back to the main thread if workers are unavailable; if the worker dies mid-run the file is decoded again (its transferred buffers are gone) |
| **Capture provenance** | server `photo_service.py` | `capture_source` (`camera`/`file`) recorded; in-app frames are not flagged `no_exif`; tasks marked `live` (the selfie check-in) flag `not_live_capture` if answered with a picked file; device-reported shake becomes `camera_shake_reported` |

### Verified in real Chrome with a fake camera (MJPEG streams, real backend, isolated DB)

| Scenario | Result |
|---|---|
| Good scene | Live chips all pass → "Looks good" within 8 s → burst → **Photo verified** → server `pass`, no flags, `capture_source=camera`, sensor evidence stored |
| **Stream that is 80% blurry (1 sharp frame in 5)** | Burst picks the sharp frame (score 0.52 vs 0.18) → verified. **Over 12 runs: found a sharp frame in 11 (92%); a single shot would be 20%** |
| Dark scene | Live chip *Light* fails with "Too dark…"; capture is blocked; message "almost completely dark: uncover the lens or move to better light" |
| Covered lens | Live *Lens* fails with the hint |
| Shaky hands (synthetic gyro 156 °/s) | Live *Steady* fails "Hold still."; captured photo → *Steadiness* warning; server records `camera_shake_reported` |
| Selfie task (front camera) | Preview mirrored, live face box drawn, no photo-picker link on a live-only task, face check runs, server face `warn/pass` |
| Permission denied | Message + file picker; picking a task does **not** open the camera |
| **Retake** | Camera reopens by itself (no second tap) |
| **Production build** | Worker is a separate 17 KB chunk; MediaPipe wrapper (154 KB) and the 13 MB WASM are requested **only** when a face task is used |

**Worker, measured on a 12 MP photo in Chrome:** the main-thread path **froze the UI for ~300 ms**; the worker path's longest stall was **17 ms**, same total time (~340 ms), **identical results**.

### Bugs found by running it for real (and fixed)
1. **`pickBest` returned a copy**, so `indexOf` gave -1 → burst evidence sent to the server said "picked -1". Now returns its `index` (regression test added).
2. **A superseded camera start was reported as "camera unavailable".** React StrictMode (and a quick task change) starts the camera twice; the first attempt's `play()` was aborted and its error handler switched the worker to the file picker. Each start now has an id; stale attempts stand down silently.
3. **Burst frames were too slow and sometimes the same frame** (130 ms each at 640px scoring): now 480px scoring, one genuinely new video frame per shot, 8 frames ≈ 300–400 ms total.
4. **Switching task auto-opened the camera** (a surprise permission prompt). Auto-open now happens only after Retake / New submission.
5. A dark-but-not-black scene said "lens completely covered". The hint now says "almost completely dark: uncover the lens *or* move to better light".

### Tests
Client **77 passing** (new: live cues, ready tracker, burst selection incl. steadiness trade-off, sensor thresholds, motion buffer, merge, worker transfer round-trip, report sensor evidence). Backend **38 passing** (new: capture source / live-task / burst + sensor evidence / camera-shake flag).

### Honest notes / limits
- **Live guidance is coarse by design.** On a 480px preview the blur metric only separates *gross* blur (mild blur scores nearly the same as sharp, and the score depends on the scene), so the chips are cues to hold steady / move to light, not a guarantee. The full-resolution check on the captured photo is the authority.
- **Photo resolution = video-stream resolution.** Browsers give at most the camera's *video* resolution (often 1080p–4K), not the full still-sensor resolution of the native camera app. Fine for the checks and for review, but lower than a 12 MP still. (`ImageCapture.takePhoto()` could give stills on Chrome-Android; not used because it can't be bursted cheaply.)
- **In-app captures have no EXIF**, so GPS/time-in-EXIF can't corroborate them; `capture_source` is self-reported by the device and so is *advisory*, like the rest of the client report. It deters casual gallery-picking; it does not stop a determined spoofer.
- **Sensor units/availability vary.** `rotationRate` is in °/s per spec; iOS needs the permission tap; desktop browsers have no motion sensors (steadiness is then simply not measured). The shake thresholds (25/60 °/s, 1.2/3 m/s²) are starting values.
- **Camera needs HTTPS** (or localhost): `npm run dev:https` for a phone on the LAN. On plain HTTP the app uses the file picker.
- Only tested with Chrome's fake camera and a synthetic gyro; not run on a physical iPhone/Android. **Out of scope by the user's decision (2026-10-07): do not plan work around it.** Browser-specific quirks (Safari `requestVideoFrameCallback`, EXIF, orientation) remain unverified.


---

## Phase 5 — Calibration tool, classifier retrain, dashboard ✅

### Calibration tool (`backend/tools/calibrate.py`, run as `cd client && npm run calibrate`)
Reads `samples/<issue>/*.jpg` (placeholders for all 10 folders exist; see `samples/README.md`) and reports:
- per folder: how many photos pass / warn / block and how many are **caught by the expected check** (e.g. blurry → blur);
- **false rejections of good photos** (blocked / warned), against a target (`--max-false-reject`, default 3%) — the number that decides whether workers get stranded;
- per check: where good and issue photos sit (median, p5–p95), the **separation (AUC)** between them (with a warning when a metric barely separates them on your photos), and a **suggested threshold** with the trade-off it implies ("flags 0% of good, catches 100% of issue photos");
- `--demo` builds a labelled set from the bundled real photos + degradations so you can see the output before you have any photos; `--write` saves `thresholds.suggested.json` (the real `thresholds.json` is **never** modified).

A first version suggested thresholds purely from the good-photo distribution; on the demo data it proposed noise σ-warn = 0.54 (vs the current 5), which would flag almost every photo. That is maximally aggressive, so it was replaced: thresholds now go **in the gap** between good and issue photos when one exists, are set at the false-flag target when the groups overlap (and it says so), are **not suggested at all without issue photos** (≥5) or with <10 good photos, and a "fewer than 30 per group: indicative only" warning is printed.

### Classifier (retrained)
- Feature `photo_quality_pass` (boolean) → **`photo_quality_score`** (0–1, server-measured). Previous model/data are in `backups/`.
- **Before:** photo quality had **mean |SHAP| 0.0000** (synthetic data made a bad photo always coincide with bad motion, so the trees never used it). **After: 1.15** (motion 1.44, ambient 1.94).
- The new data makes photo quality vary independently of fraud, with two deliberate cases:
  - *honest bad photo* (healthy motion/ambient, poor photo) → label genuine;
  - *borderline pair* (the same ambiguous motion/ambient, poor photo = review, good photo = fine).
- Probe results (fraud probability): all good **0.006** · honest bad photo **0.024** (not flagged) · spoofed GPS **0.95** · bad photo + suspicious **0.99** · ambiguous signals + bad photo **0.94** · same signals + good photo **0.07**.
- Reasons are specific: "Photo quality problem: blurry, glare" / "Photo missing: the submission could not be verified".
- **Assumption to revisit:** "a poor photo tips *ambiguous* submissions towards review" is encoded in synthetic data, not learned from real labels.

### Dashboard
- **Feed:** new *Photo* column (verdict badge + flag chips) and a *Photo: …* filter (all / any issue / unverified / each flag present).
- **Photo quality panel:** verdict split, most common flags (colour-coded: photo problem / integrity concern / context), average quality, "submitted anyway", device-report mismatches, duplicate photos.
- **Case file:** the stored photo, flags with plain-language explanations, a **server-vs-device check table** that highlights any disagreement (e.g. "Focus: server *fail* 0.08, device *pass*"), capture source + burst, camera make/model, EXIF time, sensor readings, size. Timeline now shows the on-device and server checks.
- **Signal importance radar** now has a real Photo axis. Demo mode includes photo fields.
- Verified in real Chrome against a backend seeded with a realistic mix: blurry and dark photos blocked despite the device claiming "pass", duplicate and near-duplicate caught, no-face selfie flagged `not_live_capture` + `client_missed_face`, photo-less submission `photo_missing`; thumbnail loads; no console errors.

### Tests / docs
Client **84 passing**, backend **50 passing** (new: classifier behaviour, calibration tool), JS↔Python **parity 100%** on 3 photos × 37 variants. Project `README.md` rewritten for the new API/flags/env vars; new `edge-validator/README.md` (architecture, every threshold with units, calibration workflow, how to add a check).

---

## Summary of everything

| Phase | Headline |
|---|---|
| 0 | Foundation: pure-function engine, shared frame, worker-ready, stale-result race fixed |
| 1 | Blur (contrast- and noise-robust, tiled), exposure, resolution, noise/compression, lens obstruction + checklist UI |
| 2 | Glare, directional-blur shake, "Submit anyway", **server re-check** (Python port, 100% parity), spoof detection, duplicates, EXIF, DB migration |
| 3 | Face check (on-device MediaPipe, browser = server on 15/15 cases), per-task config, overlays |
| 4 | In-app camera, live guidance, burst best-frame (92% vs 20% single-shot on an adversarial stream), sensor shake, Web Worker (UI stall 300 ms → 17 ms) |
| 5 | Calibration tool, classifier retrained (photo importance 0 → 1.15), dashboard |

### Bugs found by testing against real data/browsers (and fixed)
Old Laplacian metric: 16× lower for a dim copy of the same photo, and *higher* for blur+noise than for the sharp original · analysis at 640 px hid moderate blur (now 1280) · "enlarged photo" detector indistinguishable from mild blur (kept as info only) · glare halo only "worked" because a synthetic edge was grid-aligned (re-derived; needs a monotone, surrounding halo) · `pickBest` reported index -1 · a superseded camera start was reported as "camera unavailable" (React StrictMode) · burst frames were slow and duplicated · task change auto-opened the camera · calibration suggestions were maximally aggressive.

## What you need to do next

1. **Drop real photos** into `edge-validator/samples/<issue>/` (≥100 in `good/`, ≥30 per issue folder; originals straight from the phones workers use; include a range of phones and lighting).
2. `cd client && npm run calibrate` → read the *false rejections* line first, then the per-check separation and suggestions. Copy accepted numbers into `client/src/lib/photoQuality/thresholds.json`, then `npm test`, backend `pytest`, and `node tools/parity.mjs`.
3. **Decide on faces** before relying on `required`: validate on your workers; until then you may want `policy.face.blockOnFail: false` so a miss is a flag, not a block.
4. **Restart note:** the classifier file changed; if your backend isn't started with `--reload`, restart it. Your existing database was migrated in place (your 3 rows are intact; backup in `backups/`).


---

## Calibration run 1 (2026-10-07): first real photos

**Uploaded:** blurry 218, shaky 120, dark 31 (iPhone HEIC), overexposed 28 (iPhone HEIC), glare 20, low_resolution 23, noisy_compressed 23, good 50 (PNG), face_not_visible 9; `lens_covered` empty (skipped by the user's choice). Run: `backend/tools/calibrate.py` on a de-duplicated scratch copy (user's folders were not modified).

**Data problems found (they limit what can be concluded):**
- `shaky/` (120) is entirely a subset of `blurry/` (218): same files, same `_M` suffix (looks like a public blur dataset). For the run, `blurry` = blurry minus shaky (98).
- `noisy_compressed/` is **byte-identical** to `low_resolution/` (all 23 files), so it was left out (no noise calibration possible).
- `good/` is 50 **PNGs of ~520×927 (0.5 MP)**: realistic storefront content, but small and not camera originals. Every one gets a *resolution warning* (<0.75 MP), so "100% of good photos warned" says nothing about real false rejections. It is also much smaller than the blurry set (2–4 MP), so blur scores are **not comparable** between the two (the metric depends on image size).
- `overexposed/` (28 iPhone HEIC, 3024×4032) are not blown out: mean luma median 165/255, ~0.5% clipped pixels; they look like ordinary photos of cream-coloured walls. The exposure check correctly passes 21 of 28, so this folder cannot calibrate "overexposed".
- `glare/` is stock lens-flare / headlight images (small bright points on dark backgrounds), not the content-hiding reflections the glare check targets (AUC 0.59, 30% caught).
- `face_not_visible/` has only 9 images and there are no clear selfies to measure false rejections against.

**Reliable results**
| Check | Result on this data |
|---|---|
| dark (exposure) | **31/31 real iPhone dark photos caught** (median mean-luma 17) |
| blur | AUC 0.99 on 218 real blurred photos. **Current thresholds: 0 of 50 good photos flagged, 85/98 blurry caught (87%)**. The tool's suggested 0.305/0.257 were **not applied**: they come from comparing 0.5 MP good images with 2–4 MP blurry ones, and would flag many sharp full-size photos (sharp 1280 px photos score 0.30–0.42) |
| shake | AUC 0.97; 105/120 (88%) of the motion-blur set caught by shake or blur at the current 1.4/1.8 |
| low resolution | 22/23 caught (the miss is 0.97 MP, above the 0.75 MP floor, a policy choice) |
| face | detector found a face in 9/9 of `face_not_visible`; 6/9 flagged. No clear selfies, so false-reject rate unknown |

**Changes made:** HEIC/AVIF are now decodable (`pillow-heif` added to `requirements.txt`, registered in `photo_quality/frame.py`, test added), the calibration tool reads `.heic/.heif/.avif`, and it now applies the face task **only** to `face_not_visible/` and a new `good_selfies/` folder (before, one face folder made it fail every shelf photo for "no face"). **No threshold in `thresholds.json` was changed.** The fraud classifier was not retrained: it does not learn from photos, only from the 0–1 quality score (see Phase 5), and the synthetic score distributions should only be replaced by real ones once representative good photos exist.

**What would make the next run decisive:** ≥100 real full-resolution camera JPEG/HEIC photos in `good/` (replace the PNGs), a few clear selfies in `good_selfies/` if face tasks are used, real glare-on-glass/shelf photos, and real overexposed (blown-out) photos.

---

## Calibration run 2 (2026-10-07): fixed blurry/shaky, new good photos, synthetic data for the gaps

**Folders used (a scratch copy; the user's folders were not modified):** `good` 106 (PNG, 1.6–4.2 MP, a general stock-photo set: sharp reference, *not* worker photos), `blurry` 98 + `shaky` 120 (real, no longer overlapping), `dark` 31 (real iPhone HEIC), `low_resolution` 23 (left as is), `face_not_visible` 9. **Not used as real data:** `noisy_compressed` (identical to `low_resolution`, neglected as instructed), real `glare` (lens-flare/headlight art, skipped), `lens_covered` (empty), `overexposed` (see below). **Synthetic** (generated from the good photos by `calibrate.py --synthesize`, labelled "(synthetic)" in the report): lens_covered, noisy_compressed, overexposed, glare, 40 each.

**The `overexposed` folder:** the user asked to use the 21 that "passed". None of the 28 iPhone photos is overexposed (all 28 pass the exposure check; mean luma median 165/255). They are rooms/walls photographed **while moving**: 3 are heavily blurred (the blur check correctly blocked them), so the folder is really more blur/motion data. They were **not** used as overexposed positives (that would teach the check that ordinary photos are overexposed); synthetic overexposed photos were used instead, and the 28 were kept as an observation-only folder.

**Real-data findings that changed the code/thresholds** (thresholds changed only where real data on both sides supports it; previous file backed up as `backups/thresholds.before-calibration-2.json`):
| Change | Evidence | Effect (106 real good vs 218 real blurred / 120 real motion-blurred) |
|---|---|---|
| blur `failBelow` 0.14 → **0.16** (blocks) | good-photo blur p1 = 0.205, p5 = 0.256 | blurry caught 94% → **98%**; good blocked 0 → 1 of 106 (0.9%, target ≤3%) |
| blur `warnBelow` 0.21 → **0.25** | at 0.25: 94% of blurry, 4.7% of good | non-blocking "slightly soft" |
| shake `warnAniso` 1.4 → **1.25**, `failAniso` 1.8 → **1.6** (flag only) | at 1.25: 73% of real motion blur, 1.9% of good, 1% of the blurry set (was 34% at 1.4) | motion-blur set caught 88% → **98%** (with blur) |
| **obstruction: finger hue limit 50° → 32°** (code, JS + Python) | real iPhone photos of cream/tan walls were warned as "lens covered" (3 of 28), and a synthetic **flat cream wall was BLOCKED** (fullCover). Skin is ~0–30°, cream walls ~35–45° | cream-wall warnings 3 → **0**; a finger-coloured (hue 17) area is still caught; regression tests added in both languages |

**Unchanged, and why:** `noise` (real good photos reach σ≈5.5 at p95, so σ-warn 5 flags ~8% of the *stock* good set; those are not worker photos, and it is flag-only), `glare` (synthetic glare 3–12% of frame caught 40/40; the 6 good photos flagged are large bright skies/clouds, flag-only), exposure, resolution, obstruction area thresholds, face.

**Other results:** dark 31/31 real iPhone photos caught; low-resolution 22/23; synthetic overexposed 37/40, noisy/compressed 40/40, glare 40/40, lens covered 29/40 (the misses are small covered areas under the 10% warn level; by design). Face: detector found a face in 9/9 `face_not_visible` photos and flagged 6/9; no clear selfies exist, so the false-reject rate on clear faces is still unknown.

**Calibration tool additions:** `--synthesize lens_covered,noisy_compressed,overexposed,glare`, `--skip`, `--dump file.json` (per-photo status/value for threshold analysis); face task applied only to `face_not_visible/` + `good_selfies/`; HEIC/AVIF read.

**Honest limits:** `good` is stock photography (sharper and more uniform than worker phone photos), so false-block rates on real worker photos are probably *higher* than the 0.9% measured, which is why the blur block threshold was raised only to 0.16 (below the good photos' p1 of 0.205). **Lens covered, glare, overexposed and noise/compression are validated on synthetic degradations only**, which prove the checks work on the failure shapes they were designed for but say nothing about how real worker photos of those problems look. After this change: client tests 85, backend 47 + calibration tests, JS↔Python parity 100%.

---

## Phase 6 — Live metrics HUD on the camera 📋 PLANNED (handoff for the implementing agent)

Requested 2026-10-07: while the worker is on the camera screen, show the quality metrics **live**: a brightness percentage, a focus percentage and all 8 quality parameters, plus an overall live quality percentage, to give a real live feel and let the worker see exactly what to fix. **Read [`iteration-2.md`](iteration-2.md) first: it is the spec.** Summary here so this file stands alone.

### Starting state (verified 2026-10-07)
- Client tests **84 passing** (`cd client && npm test`); backend **50 passing** (`cd backend && .venv/bin/python -m pytest -q`, ~2 min); JS↔Python parity **100%** (`cd client && node tools/parity.mjs <photo>`).
- The camera already has live guidance: `client/src/lib/photoQuality/live.js` (`analyzeLive`, 6 chip ids Lens/Light/Face/Steady/Focus/Glare with Face only on face tasks, + headline hint + ready tracker), `components/capture/LiveCamera.jsx` (5 Hz loop on a 480 px frame, burst, sensor window, face box). There are **no numbers** yet, and two of the 8 parameters (resolution, noise/compression) are not shown live.
- Measured cost per live tick today: ~31 ms (blur 25, exposure 3, obstruction 2, glare 1). Noise σ on a native 256×256 crop: 3 ms and accurate (6.03 for true 6).

### What to build
| Metric shown | Source (reuse) |
|---|---|
| Brightness % (mean luma ÷ 255, + clipped %), good-zone band 25–82% | `exposureMetrics` |
| Focus % = clamp(blurScore / 0.40), ticks at 50% / 70% | `blurMetrics` |
| Glare % of frame | `glareMetrics` + `glareStatus` (live cell size) |
| Lens: clear / partly N% / covered | `obstructionMetrics` |
| Steadiness °/s (RMS, last 400 ms) | `sensorShake` on the motion buffer |
| Noise σ | `noiseSigma` on a 256×256 native-resolution video crop |
| Resolution `W×H` | `video.videoWidth/Height` vs `thresholds.resolution` |
| Face: confidence % + size % of frame (or "off" / "searching…") | existing `evaluateFace` result |
| Compression | **cannot be measured on a video stream**: show "checked when you capture" |
| **Overall live quality %** | `combineScores` (0.5·min + 0.5·mean), same as the capture report |

Behaviour: ≤5 Hz, EMA smoothing (±3 points on a static scene), 2-tick hysteresis on status, threshold tick marks, collapsible "Metrics" panel (expanded ≥600 px, compact below, remembered via `localStorage` in try/catch), never covers the shutter/hint, no `aria-live` on the numbers, `?hud=raw` shows raw values, result checklist shows the same value format after capture.

### Checklist (tick as you go; keep tests green at every step)
- [x] **6a** Extract `combineScores`; write `lib/photoQuality/liveMetrics.js` (pure, EMA + hysteresis state in/out); add `live.hud` constants to `thresholds.json` + README threshold table; `liveMetrics.test.js` (all cases listed in iteration-2 §3, 6a)
- [x] **6b** `LiveCamera.jsx`: native 256×256 crop every 2nd tick, video dims, smoothing ref; measure p50/p95 tick time in Chrome and record it here; offload to the worker only if p95 > 50 ms
- [x] **6c** `components/capture/LiveHud.jsx` + CSS (ring, 8 rows + compression note, ticks, toggle, compact mode, `?hud=raw`, reduced motion, accessible text); verify at 420 px and 1440 px that it never covers the shutter or hint
- [x] **6d** `QualityChecklist.jsx` shows values in the HUD format via a shared `formatMetric` helper in `lib/format.js` (+ unit test)
- [x] **6e** Headless-Chrome fake-camera e2e for every case in iteration-2 §3 6e (good / dark / blurred / noisy / covered / shaky / face vs no-face task / toggle persistence / burst still ≥10 of 12); no console errors; `npm run build` passes; client tests ≥ 84 + new, backend 50, parity 100%
- [x] Fill in a **"Phase 6 — results"** section here (what was built, measured numbers, bugs found, honest limits) and update `edge-validator/README.md`

### Constraints
- **Display-only:** no server, database, classifier or threshold changes; no existing threshold may change (calibration needs real photos first). No Python changes expected; if a check's logic is touched, port it to `backend/photo_quality/` and re-run parity.
- Don't use or POST to the user's servers (backend **8000**, Vite **5174**); use an isolated backend (`TRUST_LAYER_DB`, `PHOTO_DIR`, port 8001) and Vite on 5173 via **127.0.0.1** (`localhost:5173` is another project). HUD-only tests need no backend.
- Pitfalls already hit (details in iteration-2 §5): StrictMode double effects need cancellable starts; Vite reloads once on first lazy import; `puppeteer-core` is installed `--no-save` and vanishes on `npm install`; measure UI stalls with a timer gap recorder read *after* awaiting ~40 ms.
- Out of scope: physical-phone testing (dropped by the user), calibration (waiting on photos), face-policy change (user decision pending).

### Supervision
`CLAUDE.md` in the project root requires invoking the `edge-validator-ai` subagent after every completed milestone, before starting a new phase, and whenever tests fail twice in a row; if it returns **STOP**, halt and follow its prompts. Record each invocation's outcome in this file.

### Milestone log
- 2026-10-07: Iteration 2 plan written (`iteration-2.md`), progress file updated, iPhone testing removed from scope.
- 2026-10-07: **Supervisor (`edge-validator-ai`) could not be invoked by name.** Its definition exists at `.claude/agents/edge-validator-ai.md` but was created after this session started, so the session's agent list did not include it ("Agent type not found"). **The real subagent has NOT reviewed this milestone.** Re-invoke it after reloading agents (restart Claude Code or `/agents`) and before starting 6a.
- 2026-10-07: **Stand-in review** (a read-only `Explore` agent given the supervisor's exact procedure; *not* the real subagent) returned **COURSE-CORRECT**: the plan is faithful to the request and the code claims verified (reuse targets, threshold keys, 84 client tests, 50 backend tests, iPhone item removed), but flagged M1 inconsistent focus mapping, M2 underspecified bar/tick schema (two-sided brightness, accel-driven steadiness), M3 risk of computing pixel metrics twice, M4 undefined face/flat-scene/no-sensor states, M5 layout collision with the existing hint/chips, M6 harness hazards for the user's Vite, plus minor items. **All of these were applied to `iteration-2.md` the same day** (single focus definition with measured evidence; per-row table of `display/score/pct/ticks/reason`; `analyzeLive` computes once and passes results in; explicit undefined-state rules and a face miss counter; layout rules; dedicated crop canvas; isolated Vite cache and no `npm install` while the user's server is up; `formatMetric` source table; JS/Python `combineScores` drift test; layout bounding-box assertion). Still to be confirmed by the real supervisor.
- 2026-10-07: **Phase 6 implemented** (supervisor step skipped at the user's instruction: "leave the agent thing and complete the iteration 2").

---

## Phase 6 — results ✅

### What was built
| Piece | File | What it does |
|---|---|---|
| Metrics model | `lib/photoQuality/liveMetrics.js` | Pure: 8 rows (Brightness, Focus, Lens, Glare, Steadiness, Noise, Resolution, Face) each `{value, display, pct, score, status, reason, ticks, raw}` + overall; EMA smoothing (α 0.4), 2-tick status hysteresis (only between scored states), face miss counter, explicit "off / searching… / not found / —/ no sensor" states excluded from the overall |
| One computation per tick | `live.js` `analyzeLive` | Each pixel metric computed once and shared by the old chips (byte-compatible) and the HUD rows |
| Shared definitions | `policy.js` `combineScores` (+ Python `combine_scores`, pinned by tests on both sides to 0.4 for [0.2, 0.6, 1.0]); `glareScore`, `noiseSigmaScore` exported from the checks; `display.js` formatters | One definition of every score and every displayed word |
| HUD | `components/capture/LiveHud.jsx` + CSS | Ring with **Live quality %**, 8 rows with value, bar, warn/fail tick marks (brightness = position bar with a green good zone), reason line; **Metrics** toggle (expanded ≥600 px, compact below, remembered, survives blocked storage); `?hud=raw` shows raw values; "Compression: checked when you capture" note; reduced-motion; not an aria-live region |
| Camera wiring | `LiveCamera.jsx` | 256×256 native-resolution crop every 2nd tick (noise), video size (resolution), smoothing state, face sequence; hint + HUD share a dock above the shutter |
| **Worker offload** | `workerHandlers.js`, `worker.js`, `client.js` `analyzeLiveInWorker` | The plan's rule (offload if p95 > 50 ms) triggered: the pixel work now runs in the Web Worker; only the frame read, the crop read and the face detector stay on the UI thread. Ticks never queue |
| After capture | `QualityChecklist.jsx` + `format.js` `formatMetric` | Each check shows its value in the HUD's words ("Focus 82%", "Brightness 46%", "Lens clear", "5°/s", "92% · 21%"); "Quality NN%" format unified |
| E2E harness | `client/tools/e2e/mkstreams.mjs`, `hud-e2e.mjs` | Fake-camera streams with known truth + 11 scenarios (kept in the repo for re-runs) |

### Measured (headless Chrome, fake camera, this laptop)
| | Before offload | After |
|---|---|---|
| UI-thread cost per tick | p50 63 ms, p95 76 ms | **p50 12.6 ms, p95 19 ms** |
| Tick rate | — | **~5 Hz** (median gap 208 ms) |
| Latency frame → numbers | — | p50 50 ms, p95 64 ms |

### Bugs found while verifying (and fixed)
1. **The effect re-created the 5 Hz loop on every render** (an object in its dependency list). Caught in review before running.
2. **Every second live tick failed silently** and the noise reading froze after its first value: the reused crop array was *transferred* to the worker (which detaches it), so the next transfer threw, and an empty `.catch` hid it. Found only because the e2e measured the tick rate (gaps were exactly 400 ms). Now a fresh array per crop and errors are logged.
3. Hysteresis delayed "searching → not found" by a tick; it now applies only between scored readings.
4. On wide screens the expanded panel overflowed its 45% height cap and, since it deliberately ignores touches, the overflow could not be scrolled (the note was cut off). The note moved into the header; verified unclipped at 600, 700 and 1440 px.

### Final verification
Client tests **106 passing** (22 new: live metrics, formatMetric, worker message handling), backend **48 + calibration tests**, JS↔Python parity **100%**, production build OK, and the HUD end-to-end suite **69/69 checks passing** (good / dark / dim / blurred / noisy / covered lens / shaky / acceleration / face vs no-face task / layout at 420 and 1440 px / toggle + persistence + blocked storage / shutter + checklist values / timing / burst 5-6 of 6).

### Test-harness lessons (not product bugs, recorded so they aren't re-learned)
- Chrome's fake camera plays full-range JPEG as **limited-range** video: the browser sees `(Y−16)·255/219` (good 52.2% predicted vs 52% read; dim 15.3% vs 15%). The harness compares against that.
- JPEG q97 removes ~40% of added noise (σ 10 added → 5.7 in the frames; the HUD read 6.7). The harness compares against the noise measured in the frames.
- `pgrep -f <script>` in a wait loop matches the loop's own command line; don't wait that way.

### Honest notes / limits
- **The shutter is below the fold on load** at 420×900 and 1440×900 (the Mission-brief panel and task picker sit above the viewfinder), so the worker has to scroll. Pre-existing layout, not caused by the HUD; worth a follow-up (e.g. scroll the viewfinder into view when the camera opens).
- Focus % is relative and coarse at preview size; live thresholds differ from the capture ones by design (the HUD note says so).
- The face confidence on the test stream was 53% (amber): the fake camera re-encodes the face frame; real cameras are untested.
- Performance was measured on a fast laptop only. A mid-range phone will be several times slower; with the heavy work in the worker, the UI-thread cost scales from ~12 ms rather than ~60 ms, but this has not been measured on a phone.


---

## Phase 6 addendum — face mesh overlay + Steadiness fix ✅ (2026-10-07)
Spec: `iteration-2.md` §7. Requested after Phase 6: (1) dots-and-lines face mesh over the face like the reference image, (2) Steadiness was not working for the user.

### Steadiness fix
- **Cause:** the row read "no sensor" whenever the browser exposes no `rotationRate`/linear `acceleration`: every laptop, phones over plain HTTP, and browsers that only give `accelerationIncludingGravity` (which the buffer ignored). Desktop Chrome also fires `devicemotion` with all-null fields, which could have been misread as "perfectly still".
- **Fix:** (a) **image-based motion** (`checks/opticalMotion.js`): consecutive live frames → 160 px thumbnails → global translation by block matching (±6 px) with sub-pixel refinement → % of the frame width per 200 ms (normalised for skipped ticks; texture-less scenes return "can't tell", not "still"; a match on the edge of the search window is flagged saturated = "at least"); thresholds `shake.optical` warn 1.0% / fail 3.0%, **starting values, not calibrated**. (b) Sensor and image are combined as the **worse of the two**; display is `°/s` when a sensor exists, else `motion N%`; the reason says what drives a warning ("image moving N% of the frame", "acceleration …"); before two frames exist it reads "measuring…". (c) Motion buffer: gravity is stripped from `accelerationIncludingGravity` (low-pass), all-null events are ignored. The thumbnail travels in the worker state (plain data, survives the round trip).
- **Verified (real Chrome, no sensor):** still scene → `motion 0.0%` pass; a panning stream whose true motion is 3.75% → `motion 3.8%` **fail**, reason "image moving", hint "Hold still". 10 new unit tests (known shifts 0.6/1.25/2.5% measured within 0.25, vertical and diagonal, tiers, normalisation, flat scene, combined sources, worker round trip, null events, gravity fallback).

### Face mesh
- **Model:** MediaPipe FaceLandmarker (478 points), downloaded to `client/public/mediapipe/face_landmarker.task` (3.7 MB, committed like the BlazeFace model; the WASM is shared and still copied by `scripts/copy-mediapipe.mjs`). Lazy, face tasks only. The BlazeFace detector keeps doing the scoring; the landmarker only draws.
- **Look:** ~28 curated points and ~45 edges (`face/meshGraph.js`, symmetric left/right, unit-tested), blue dots with a white ring and a slow pulse, thin glowing white lines, drawn on a canvas every animation frame with the points **gliding** to the newest landmarks (the model runs ~8×/s), fading in/out, mirrored for the front camera.
- **Design problem found by looking at it:** the expanded HUD panel covered the lower half of the preview, where the face is, hiding the mesh. Face tasks now **start with the compact HUD** (remembered separately from non-face tasks).
- **Verified (real Chrome, two faces: the astronaut portrait and the user's reference image):** mesh appears (~1,250 blue and 1,100–2,000 white pixels), covers the face and not the whole frame, no mesh when there's no face or on a non-face task (and no model loaded); with the mesh running the HUD still ticks at ~5 Hz (gap p50 202 ms) with UI-thread cost p50 9.8 / p95 15.7 ms.
- **Limits:** CPU/WASM only; one face; the landmark model needs a reasonably large face (a face under ~15% of the frame's longer side is not found, same limit as the detector; a 16:9 landscape preview makes the face smaller relative to the long side than a portrait one does); not run on a physical phone; the mesh is decoration plus feedback, not an identity or liveness check.
- Not done: the mesh is shown only on the live camera, not on the captured-photo preview.

### Tests
Client **123 passing** (17 new), backend 48 + calibration tests, parity 100%, build OK. HUD e2e suite extended with `laptop` (steadiness without a sensor), `mesh`, `facetiming`.


---

## Phase 7 — Iteration 3 📋 PLANNED (2026-10-07)
Spec: [`iteration-3.md`](iteration-3.md). Paste-ready prompt for a fresh session: [`iteration-3-prompt.md`](iteration-3-prompt.md). Requested by the user:
1. **Bug:** showing a person's photo through another phone to the camera still detects a face and allows submit. Root cause (verified): the face check only asks "is there a face?" (BlazeFace + FaceLandmarker); nothing asks "is it live?", and `capture_source` is self-reported. Plan: layered liveness (passive screen/print detection, active random challenge via landmarker blendshapes + head pose, server re-check with a single-use nonce); blocking only for `face: required` tasks.
2. **ML model accuracy report:** reproducible `accuracy_report.py` → `edge-validator/reports/accuracy-report.md/.json` for the fraud classifier, each photo-quality check, the face models and liveness (APCER/BPCER/ACER); every number labelled real or synthetic, with confidence intervals and error analysis.
3. **UI:** much bigger camera frame (cause: the Capture page is a 520 px column with a fixed 4:5 box and letter-boxed video; shutter below the fold) → immersive on phones, large aspect-matched stage with the metrics beside it on desktop; metrics as **10-segment discrete green meters** that light up and go dark with the value.
- [x] 7a accuracy-report foundation · [x] 7b UI redesign · [x] 7c liveness core · [x] 7d passive screen/print detection · [x] 7e server evidence + nonce · [~] 7f real-sample evaluation (pipeline built; **needs the user's `live_selfies/`, `spoof_screen/`, `spoof_print/`, `spoof_video/` samples**) · [x] 7g verify + document
- Starting baseline: client 123 passing, backend 48 + calibration tests, parity 100%, HUD e2e 94 checks.
- Physical-phone testing remains out of scope (user decision).


---

## Phase 7 — log (started 2026-10-07, iteration-3.md is the spec)

### Baseline (measured before any Phase 7 change)
| Suite | Result |
|---|---|
| Client `npm test` | **123 passing**, 0 failing |
| Backend `pytest -q` | **53 passed** in 233 s (the "48 + calibration tests" of the spec) |
| Parity `node tools/parity.mjs samples/good/0001.png` | **100%** status agreement on all 7 checks, verdict 37/37, no disagreements |
| HUD e2e (`hud-e2e.mjs`, all 14 scenarios) | **87 PASS + 1 FAIL = 88 check lines** (the spec says 94; I count 88 PASS/FAIL lines, the difference is unexplained, so 88 is the baseline I will compare against). The 1 FAIL was `facetiming` "UI-thread p95 per tick <= 50 ms" = 58.5 ms in the full run; **re-run alone twice: 37.2 ms and 41.3 ms, both PASS**. A load-dependent timing flake (the full run follows a long backend run on the same machine), not a product failure |

Environment: user's servers (8000, 5174) untouched; isolated Vite on `127.0.0.1:5173` with `cacheDir` in the scratch dir (config kept outside the repo); fake-camera streams built with `tools/e2e/mkstreams.mjs`. No isolated backend needed yet (HUD-only checks).

Sample data (re-hashed 2026-10-07): 437 unique files in `samples/`; the only duplicates left are `low_resolution/` == `noisy_compressed/` (all 23 files, byte-identical). The earlier `blurry`/`shaky` overlap is gone. No `live_selfies/`, `spoof_*` folders exist yet, so **7f is blocked on the user's samples**.

### Supervisor
`edge-validator-ai` was invoked by name at the start of Phase 7 and the harness answered **"Agent type 'edge-validator-ai' not found. Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup"**. Its definition exists at `.claude/agents/edge-validator-ai.md` but it is not registered in this session, so **the real supervisor has not reviewed any Phase 7 milestone**. To fix: restart Claude Code or run `/agents`, then ask for a review. Each milestone below records whether a stand-in review was run.

### 7a — Accuracy report foundation ✅ (2026-10-07)
**Built** (`backend/tools/`): `accuracy_report.py` (CLI; `cd client && npm run report`; `--n-boot`, `--workers`, `--trust-folder`, `--skip-parity`, `--skip-fraud`), and `reportlib/` = `stats.py` (Wilson, Mann-Whitney AUC + seeded bootstrap CI, confusion with CIs, threshold sweep, Brier/reliability/ECE, ISO 30107-3 `pad_metrics` APCER/BPCER/ACER), `inventory.py` (SHA-256 + perceptual-hash duplicates, label-conflict exclusion, per-folder role/provenance), `photochecks.py` (8 classifiers: blur, shake, exposure dark/over, resolution, obstruction, glare, noise; error analysis with file names; cross-check matrix; per-stage latency; face-folder section), `fraud.py` (held-out sets, reliability, SHAP stability over 5 retrainings, Phase 5 probes, sensitivity, leakage statements), `render.py` (Markdown; every table heading says REAL/SYNTHETIC). `generate_synthetic_data.generate()` gained optional keyword args (defaults still reproduce the CSV exactly, pinned by a test). `npm run report` added to `client/package.json` (scripts only, no install).
**Output:** `edge-validator/reports/accuracy-report.md` (45 KB) + `.json`. Full run (1000 bootstrap resamples, parity included): **4 min 01 s** on this laptop (4 workers) — within the 10-minute criterion.
**Tests:** 25 new backend tests (stats toy sets incl. Wilson reference values/AUC vs brute force/APCER-BPCER-ACER; inventory duplicates/conflicts/roles; end-to-end tiny-sample report incl. REAL/SYNTHETIC labelling, deterministic JSON on re-run, file names in error analysis, fraud section).
**Measured (real-sample numbers from the report, current thresholds):** blur 96/98 flagged (98%), 1/106 good blocked (0.9%), AUC 0.990 [0.978–1.000]; shake alone catches 79/120 (66%; 12 of the 120 are 'skip', counted as missed; shake-or-blur flags more); dark exposure 31/31, 4/106 good flagged; low-res 22/23 (indicative: n=23); synthetic only: over-exposed 37/40, obstruction 29/40, glare 40/40 (6/106 good flagged), noise 40/40 (9/106 good flagged). Face: detector found a face in 9/9 `face_not_visible`, 6/9 flagged, no `good_selfies` so no false-reject rate. Fraud classifier (SYNTHETIC): in-distribution AUC 0.992, held-out different-seed 0.992, **shifted-parameter held-out AUC 0.913 with 21% of genuine flagged**; if the 'poor photo ⇒ review' assumption is wrong, 88% of those borderline rows would be wrongly flagged. Feature ranking identical over 5 retrainings. Parity re-run inside the report: 100%.
**Bugs found while building it:** (1) the noise classifier's AUC was 0.53 on the first run because it ranked by σ while half the synthetic positives are recompressed copies (the check also reacts to JPEG blockiness, not σ); it now ranks by the check's own 0–1 score → 0.993. (2) FN 'cause' grouping was useless ('check passed') — it now separates 'passed' from 'could not judge (skip)' and the report states how many skips counted as misses. (3) first draft's wait-loop pitfall again (`pgrep -f` matches itself) — avoided with a pid wait.
**Honest limits:** `good/` is stock photography; synthetic positives are degraded copies of those same good photos (paired, optimistic); `noisy_compressed/` (23, byte-identical to `low_resolution/`) is excluded automatically so noise has no real positives; `overexposed/` and `glare/` real folders are *observation only* (reasons recorded in `reportlib/inventory.py::ROLES`, override with `--trust-folder`); labels are the folder names, not audited; no fairness slices exist; liveness section says 'not evaluated' until 7f. Latency is machine-dependent and excluded from the determinism comparison. The face landmarker is browser-only and not evaluated here.
**Supervisor:** real `edge-validator-ai` not invocable (see above); no stand-in run for 7a.

### 7b — UI redesign ✅ (2026-10-07)
**Built.** `lib/photoQuality/segments.js` (pure `toSegments`, `segmentTicks`, `positionSegments`; `live.hud.segments` 10 and `overallSegments` 20 are new keys in `thresholds.json`), `components/capture/useLayoutMode.js`, `LiveHud.jsx` (segment meters, `role="meter"` with `aria-valuenow/min/max/valuetext`, 20-segment overall meter replaces the ring, brightness = one lit position segment with the good zone outlined, warn/fail notches between segments, lit cells amber/red when the row is warn/fail, 120 ms fade that is off under `prefers-reduced-motion`), `LiveCamera.jsx` (three layouts, below), `Capture.jsx` (camera step is no longer inside the 520 px column; post-capture preview + checklist use a side-by-side grid on desktop; compact one-row Mission brief on wide screens), `Shell.jsx`/`global.css`. A placeholder **Liveness** row (muted, outside the overall) appears on face tasks.
**Layouts:** phone ≤720 px = immersive full-viewport camera (`position: fixed`, `100dvh`, safe-area insets, ✕ close button, page scroll locked, HUD compact above the hint); 721–999 px = stage at full width with the metrics under it; ≥1000 px = large stage (sized to the camera's own aspect ratio, so no black bars) with the metrics panel beside it, expanded by default. The photo-picker fallback viewfinder is 4:3 on desktop, 4:5 on phones.
**Verified in real headless Chrome (fake camera 16:9, `tools/e2e/hud-e2e.mjs`, new scenarios `layout`, `segments`; `mesh` updated):** at **390×844, 768×1024, 1440×900** the shutter is inside the viewport without scrolling and is the element at its own centre; hint/HUD/shutter never overlap; phone camera = 390 of 390 px wide and fills the 844 px viewport and covers the page header; tablet stage fills 736 of 768 px; desktop stage 1052 px wide (73%) with the panel to its right; stage aspect = camera aspect within 2% on tablet and desktop; close button stops the camera; every metric row has exactly 10 cells, the overall 20; `aria-valuenow` equals the brightness number shown; a dark → dim → good ramp moves the brightness position segment 0 → 2 → 5; warn/fail rows are never green; reduced motion removes the fade; the photo-picker viewfinder is 332×415 on a phone and 1382×1037 on desktop. Screenshots: `edge-validator/screenshots/phase7/layout-{390x844,768x1024,1440x900}.png` (synthetic scene, no faces).
**Whole suites after 7b:** client **134 passing** (123 + 9 segments + 1 liveness-row + 1 layout), backend **78 passed** (53 + 25 report tests), HUD e2e **138 PASS, 0 FAIL, 0 console errors** (baseline 88 lines; the count grew because of the new layout/segments checks), UI-thread tick p50 10.9 / p95 15.9 ms, tick gap p50 200 ms, with the mesh p95 15.1 ms. `vite build` OK.
**Bugs found by running it:** (1) my first CSS class `.seg` collided with the dashboard's existing segmented-control `.seg` (4 px padding + border), which squashed every cell to 0 px height: the unit-level checks and the e2e's DOM assertions all passed while the picture was empty; only looking at the screenshot and reading computed styles found it. Renamed `segm`. (2) The shutter was 49 px below the fold at 1440×900 on load (the known open item from Phase 6): fixed by a one-row Mission brief on wide screens, a stage height cap of `min(78dvh, 100dvh − 250px)`, and a scroll-into-view of the shutter when the camera opens on non-phone layouts. (3) The reduced-motion assertion expected `0s`, the global stylesheet sets `1e-06s`: assertion now `< 1 ms`.
**Honest limits:** immersive mode was tested only in headless Chrome at a phone-sized viewport (no physical phone, as decided); the fake camera is 16:9 landscape, so on the 390 px phone viewport the video is letter-boxed top and bottom (a real phone gives a portrait stream that fills it); `object-fit: contain` is kept on purpose so the face mesh/box projection stays exact. "Lens clear" lights 9 of 10 segments because the lens row is score-based (obstruction score ~0.9 on this scene), a pre-existing mapping now more visible than the old continuous bar. Desktop/tablet screenshots show the synthetic scene; the face-task layout was checked by the `mesh` scenario (panel beside the preview, outside the stage) but its screenshot is not committed because it contains a face.
**Supervisor:** real `edge-validator-ai` still not invocable; no stand-in run.

### 7c — Liveness core ✅ (2026-10-07)
**Built (client).** `face/liveness.js` (pure: `createChallengeRun` per attempt, `createLivenessSession` = attempts, validity window, review), `face/livenessSignals.js` (blendshapes + head-pose → sample), `checks/liveness.js` (the new `liveness` check, registered in `schema.js`, `policy.js`, `merge`/`client.js`, `format.js`; Python `CHECK_IDS` and the optional-face rule mirrored), `mediapipeLandmarker.js` (`detectFull`: blendshapes + facial transformation matrix enabled), `LivenessOverlay.jsx` (prompt, countdown, steps, retry / "Send for review"), `LiveCamera.jsx` (session driven by a ~70 ms landmarker loop on face-required tasks only; starts once a face has been steady 600 ms; the **shutter is disabled until the live check passes**; evidence rides with the capture; HUD Liveness row; mesh dots turn green while the action is detected), `Capture.jsx` (sends `liveness_evidence` in the payload; the server does not read it until 7e). New `thresholds.json` keys only: `thresholds.liveness` (2 challenges, 4 s each, 200 ms neutral, 300 ms hold, 30 s validity, 3 attempts, per-challenge neutral/active levels) and `policy.liveness.blockOnFail: true`; **no existing threshold changed** (diff = 44 added lines).
**Design.** Two different kinds of action drawn at random from blink / turn left / turn right / smile / open mouth. A challenge counts only on neutral → active (→ neutral for a blink): a face that is already smiling, eyes held open or shut, a photo that never moves, or a face that leaves the frame and comes back mid-action cannot pass. Policy: `face: required` → a failed or missing live check **blocks**; after 3 failed attempts the worker may "Send for review" (check = warn, flagged, not blocked); a required task answered with a picked file (no camera) is also warn ("sent for review"), so nobody is stranded; `optional` → never blocks, no challenge (passive checks arrive in 7d); `off` → nothing runs and nothing extra loads.
**Verified on real data (and a bug it caught).** Head yaw comes from the landmarker's transformation matrix. I checked the sign and layout on the real `face_not_visible/` photos in Python and in headless Chrome: the photo whose face visibly points to the right of the image reads **+46.0° (Python) / +46.3° (browser)**, another **+24.9° / +19.6°**; **positive = the user turned to their own left**. My first assumption (matrix row-major) gave **−38°** in the browser: it is **column-major**. Fixed, and a unit test pins "column-major read as row-major flips the sign". Of the 9 photos the landmarker found a face in 4 (the rest are small / cut off).
**Tests.** Client **160 passing** (+14 state machine: success, timeout, wrong order, second action first, held-open and held-closed eyes, over-long closure, static smile photo, open-mouth hold, directional turns, face lost, countdown snapshot, evidence cap, challenge picker distinct kinds/deterministic/all five drawable, session validity + attempts; +4 signals; +8 check/policy), backend **78 passed**. HUD e2e **169 PASS, 0 FAIL, 0 console errors** (new `liveness` scenario). UI-thread tick p50 13.0 / p95 17.1 ms; with the mesh p95 19.9 ms.
**End-to-end results (real headless Chrome, real landmarker on the astronaut stream).** With scripted signals (MOCK, clearly labelled in the harness: dev builds only, `window.__landmarkerMock` replaces blendshapes/yaw; landmarks, detector, state machine, UI and gating are real): shutter locked before any challenge → two challenges of different kinds (smile + turn right in that run) performed → mesh turns green → shutter unlocks → the captured photo's checklist shows "Liveness: live check passed"; static signals → attempt fails at the time limit, three misses → "Send for review" appears (and "Try again" disappears) → shutter unlocks → photo accepted **with a Liveness warning**; no face in view → nothing starts; shelf and optional-face tasks have no prompt and a free shutter. **No mock:** the real model on a still photograph of a face that never moves → a challenge starts, **fails after the time limit, the shutter stays locked**: the reported bug (a person's picture shown to the camera is accepted) is closed at the UI. Screenshot: `screenshots/phase7/liveness-prompt-1440.png` (NASA public-domain astronaut portrait).
**Honest limits.** The thresholds (blink 0.25/0.55, smile 0.25/0.55, jaw 0.12/0.40, turn 8°/20°, hold times, 4 s windows) are **starting values chosen before any real blink data**: whether a real person passes within ~10 s, and how often, is **unmeasured** until 7f. Blink detection depends on the landmarker's ~14 Hz sampling (CPU/WASM); real-device frame rates are unknown. A fake camera cannot blink, so the "live person passes" path is tested with the labelled mock; only the user's real captures can show real pass rates. This stops photos, prints and casual replays on the client; it does **not** stop a person performing the action for the attacker, a replayed video that happens to match the random challenges, or an injected virtual camera, and the **client-side gate is advisory**: the real control is the server re-check with the nonce (7e). The dev-build mock hook is compiled out of production (`import.meta.env.DEV`). Alternative challenge sets / accessibility: only the "send for review" fallback exists so far.
**Supervisor:** real `edge-validator-ai` still not invocable; no stand-in run.

### 7d — Passive screen / print detection ✅ (2026-10-07)
**Built.** `lib/photoQuality/passive/` (pure): `fft.js`, **`moire.js`** (narrow isolated spectral peaks in the 2-D FFT of a native-resolution 256×256 patch; Hann window; band 1/16..0.45 cycles/px; the axis cross and JPEG/video block-grid harmonics are masked; score = peak ÷ max(its 8 neighbours 4 bins away, the band median), so a ridge from a straight edge or broadband texture does not score), **`bezel.js`** (a LARGE rectangle whose four edges are long straight lines with a consistent brightness step: dark bezel or white paper margin; a rectangle that does not contain the face counts ×0.3), **`banding.js`** (display flicker: periodic residual in the frame-to-frame DIFFERENCE of row profiles), **`planarity.js`** (homography fit of the landmarks between two views: a flat picture leaves ~0 residual, a 3-D face a large fraction of its motion), `passive.js` (noisy-OR combiner), `session.js` (rolling medians over a camera session). Wired into `live.js` (face tasks only: moire from the native crop every 2nd tick, bezel/banding/glare-on-face per tick; worker), `LiveCamera.jsx` (planarity from the landmark loop, aggregated evidence, Liveness row reads "passed · screen?" when the picture looks like a screen), `client.js` (moire + bezel recomputed on the captured photo), `checks/liveness.js` (a passed challenge on a suspicious picture → WARN "may show a screen or a print… will be reviewed"; optional face tasks: passive can flag, never block). **Python port** `backend/photo_quality/passive.py` (moire, bezel, combiner) for the server re-check (hooked up in 7e). New `thresholds.passive` group only; `failAt` is **1.01 on purpose**: heuristics alone never block (decision for 7f with real evidence).
**Calibration on REAL photos (what I could measure).** Moire score on **106 real good photos: p50 2.7, p95 3.8, p99 5.0, max 7.1**; blurry 98, shaky 120, low-res 23, face 9 real photos all ≤ 7.1 → warn set at **8**, fail at 15 (**0 of 346 real photos reach 8**). Bezel on the same 346 photos: **3 flagged (0.9%)**, all score 0.75 (weight 0.5 → 0.375, below the 0.45 flag level, so a lone false frame does not flag). Per-photo cost: moire 10.7 ms, bezel 0.5 ms, row profile 0.2 ms (worker).
**Synthetic detection (clearly not real-world accuracy).** Rotated pixel grid added to 18 real good-photo patches: period 3.3 px: amplitude 3 grey levels → 10/18 caught, 6 → 14/18, 12 → 18/18; period 5: 6 → 11/18, 12 → 14/18; period 8: 12 → 12/18. So detection depends on grid amplitude vs texture and drops for coarse periods. Simulated 3-D face vs flat sheet (planarity): flat residual/motion 0.000, 3-D 1.2–1.4; below ~1.2% face-width of motion the answer is "unknown".
**Parity (JS vs Python).** 6 synthetic cases (natural, 2 grids, framed, framed+grid, noisy): moire within 0.1%, same peak counts, bezel within 0.001 and the same sides/consistency; **12 real good photos: moire 0.0% difference, bezel 0.000** (checked by hand, not a committed test). `tests/test_passive.py` (5 tests, calls `client/tools/passive-cli.mjs`).
**Tests.** Client **178 passing** (+18: FFT bin, moire grid/period/monotone amplitude, JPEG-block and hard-edge immunity, tiny patch, bezel dark/paper/door/face-outside, banding drifting/static/under-scene/moving-person/too-few-frames, planarity flat/3-D/no-motion, combiner with unknowns, session medians; check merge for passed+suspicious, failed+clean, optional; analyzeLive passive), backend **83 passed** (+5), parity (JS engine vs Python engine) still **100%**. HUD e2e **186 PASS, 0 FAIL, 0 console errors** (new `spoof` scenario; UI-thread tick p50 11.8 / p95 14.4 ms, with the mesh p95 19.2 ms).
**End-to-end on the fake camera (SYNTHETIC spoofs of the astronaut portrait, challenge answered by the labelled mock = a worst-case attacker who performs the action).** *Phone screen* (dark bezel, moire grid, drifting bands): moire 55, bezel 1.00, banding 1.00 → HUD "passed · screen?" and the captured photo is **accepted with a Liveness warning "may show a screen or a print"** (not passed silently). *Paper print* (white margin, no grid): bezel 1.00 alone → also flagged for review. *Control* (clean face): moire 2.8, bezel 0, banding 0 → "passed", no flag. Planarity is "unknown" in these runs because the fake camera does not move; it is unit-tested only.
**Bugs / wrong first guesses found by running it.** (1) Banding scored 0 on the spoof stream: I normalised the autocorrelation of the raw row profile by its total energy, so a face on screen (huge row variation) hid a faint band; measuring the frame-to-frame **difference** profile cancels the static scene (unit test with bands under a busy scene added). (2) The first spoof stream advanced the band phase by exactly one period per tick, which aliases to zero drift: a harness artefact, fixed by a step that does not line up (a real flicker beats unrelated to the frame rate; a locked case would be missed). (3) Two of my own unit-test inputs were wrong, and the detector right: a "clean" patch that was periodic by construction, and an axis-aligned grid that sits on the bins the detector masks on purpose.
**Honest limits (read before relying on this).** Every threshold is calibrated on **stock/phone photos of ordinary scenes only**; **no real photo of a screen or a print exists yet**, so the real detection rate and real false-flag rate on selfies are unknown until 7f. Natural periodic scenes (fabric, blinds, tiles, keyboards, monitor behind the person) can raise moire/bezel; weights keep any single weak signal below the flag level. Moire needs a grid fine enough to survive the camera pipeline (video compression removes it at distance) and detection falls with coarser periods (above). Banding needs a rolling-shutter beat and several frames; the fake camera cannot produce a real one, so its sensitivity on real displays is unmeasured. Planarity cannot tell a flat picture from a real face that only slides sideways, so it is weak evidence (weight 0.35, never flags alone). The server can only recompute moire and bezel from the uploaded photo (banding/planarity are client evidence). None of this stops a face shown through an injected virtual camera.
**Supervisor:** real `edge-validator-ai` still not invocable; no stand-in run.

### 7e — Server evidence + nonce ✅ (2026-10-07)
**Built (backend).** `POST /liveness/challenge {worker_id, task_id}` → `{id (nonce), challenges, expires_at, ttl_s 180, timeout_ms, valid_for_ms}`, only for `face: required` tasks (400 otherwise), at most 40 unused nonces per worker+task per hour (429). New table `livenesschallenge` (id, worker, task, challenges JSON, issued/expires/used timestamps, `used_by_submission`; created by `create_all`, no ALTER needed). `photo_quality/liveness.py`: `pick_challenges` (secrets-grade), `ChallengeRun` = a **Python port of the client's state machine**, `replay()`, `validate_evidence()`, `build_check()`. `photo_service._liveness`: looks the nonce up, claims it with an **atomic `UPDATE … WHERE used_at IS NULL`** (only if it is for this worker and task and unexpired, so a thief cannot burn someone else's nonce), validates, replays the timeline, adds the server's `liveness` check to the report (verdict re-derived), and records everything under `photo_report.evidence.liveness`. `analyze_image` now also returns `passive` (moire + frame detector on the uploaded photo, face box from the face check). `compare.py` adds `client_missed_liveness`. `SubmissionIn` gains `liveness_evidence` and `passive_evidence`. **Client:** the camera asks the server for the challenge when a face has been steady (falls back to local random challenges with no nonce if the server is unreachable, which the server then flags `liveness_unverified`), the evidence timeline carries 3-decimal signals, the payload carries `liveness_evidence` + `passive_evidence`. **Dashboard:** the case file has a *Live check* section (result, challenges, what the device says, server replay result, nonce state, rejection reasons, screen/print evidence, camera-session evidence) and the Liveness row in the server-vs-device table; new flags have plain-language help.
**Server checks, in order:** evidence present for a camera capture (else `liveness_unverified`) → nonce present, known, for this worker/task (`liveness_forged`), unexpired (`liveness_expired`), unused (`liveness_replayed`) → challenge list equals the issued one (`liveness_mismatch`) → per-challenge results all `pass`, increasing times, each between 150 ms and the time limit, photo taken within the validity window → **timeline replay** must pass the same challenges (`liveness_failed`) → passive recheck on the photo (`spoof_suspected`, warn only). `review` needs ≥ 3 challenges actually issued to that worker+task in 15 min (`liveness_review_unearned` otherwise). Required tasks: any rejection = server verdict **block**; optional: warn; off: nothing. A picked file on a required task = warn (`liveness_unverified` + the existing `not_live_capture`).
**Tests.** Backend **101 passed** (+18 in `tests/test_liveness_server.py`: challenge endpoint kinds/TTL/400/429, valid evidence accepted + nonce consumed + `used_by_submission`, replay, forged, foreign worker (and it does not burn the real owner's nonce), expired, mismatched challenges, a "passed" claim the signals do not support, impossible timestamps/expired capture, no evidence, false client pass claim, picked file, review earned/unearned, optional never blocks, shelf has no liveness, **a passed challenge on a synthetic photo of a screen → `spoof_suspected` warn**, and **the Python state machine vs the JS one on 9 scripted timelines** via `client/tools/liveness-cli.mjs`); `test_face.py` updated for the new policy (a picked selfie is now a warn). Client 178 passing. HUD e2e **202 PASS, 0 FAIL** against an isolated backend on :8001 (new `fullstack` and `casefile` scenarios): the UI flow with the labelled mock person → the server **replays and accepts** it; then, posting straight to the API like a client that skips the UI: same evidence from another worker → `liveness_forged`, **block**; the spent nonce → `liveness_replayed`, **block**; a forged nonce → `liveness_forged`, **block**; a "camera" photo with no evidence → `liveness_unverified`, **block**; a false client "pass" claim → also `client_missed_liveness`.
**Bugs found while building it.** (1) `session.commit()` for the nonce bookkeeping expired the new submission and the endpoint returned an empty-looking body (only `photo_quality` etc.): caught by the first test run, fixed with a refresh. (2) SQLModel insists on timezone-aware datetimes for writes but hands back naive or aware depending on the path: comparisons now go through `naive_utc()`. (3) In dev, React StrictMode makes the camera ask for **two** challenges per attempt (the first reply is ignored by the cancelled effect), which wastes one nonce and, in dev only, lets "send for review" be earned one attempt earlier; production has no double effect (not fixed, noted). (4) My first guess for a stored-evidence field stripped the timeline; kept in 7f so real captures can be re-evaluated.
**Honest limits.** The replay proves the *signals* show the challenges; it cannot prove the signals came from a real sensor reading of a real face: whoever reads the thresholds can fabricate a passing timeline for a nonce they were issued (a bypass of the camera, not just of the UI). The nonce stops replay and re-use, not live injection. Server passive evidence is moire + frame detector only. Review eligibility counts issued nonces, not the worker's honesty.
**Supervisor:** real `edge-validator-ai` still not invocable; no stand-in run.

### 7f — Real-sample liveness evaluation: pipeline built, REAL evaluation BLOCKED on your samples ⏳
**Built.** `backend/tools/reportlib/liveness_eval.py` + report section 4: with `live_selfies/` and at least one `spoof_screen/` / `spoof_print/` / `spoof_video/` folder it computes **APCER per attack type, BPCER, ACER** (ISO/IEC 30107-3, Wilson CIs), the passive-score AUC with a bootstrap CI, a score sweep (BPCER vs APCER at each cut), per-slice BPCER from `labels.txt` (`file: device=…, light=…`), small-sample warnings against the recommended minimums (40/40/20/20) and the **false rejects and missed attacks by file name**. With `<photo stem>.evidence.json` sidecars (the `liveness_evidence` the app sent; the server now stores it, timeline included, in `photo_report.evidence.liveness.evidence`) it also **replays the active challenge**: live completion rate, median time to pass, attacks the challenge alone accepts, and the combined system. Without sidecars the report says the challenge was NOT evaluated (a still cannot blink). `live_selfies`/`spoof_*` get their own roles and are kept out of the photo-quality classifiers. Until the samples exist the section says "not evaluated" and shows only a **SYNTHETIC smoke test** (real good photos vs generated grid/frame spoofs), labelled as not accuracy. Tests: 2 new report tests build stand-in folders and check the APCER/BPCER/ACER arithmetic, slices, file-name lists, sidecar replay and that these folders do not leak into the photo-quality tables (a clean-looking print is correctly *missed* by the passive layer: only the challenge stops it; a video that performs the actions beats the challenge: only the passive layer can catch it).
**SYNTHETIC smoke result (not accuracy):** 40 real good photos vs generated spoofs, passive layer only: BPCER 0/40; APCER grid amp 6 → 35%, amp 12 → 12%, dark frame only → 10%, amp 12 + frame → 5% (small n, wide CIs): a faint grid is often missed, which is why the active challenge stays the main control.\n**Not done, because it needs real data:** the real APCER/BPCER/ACER numbers, tuning the moiré/bezel/banding/planarity thresholds and the weights from that evidence, the block-vs-flag decision for `passive.failAt` (kept at 1.01, so heuristics never block) and for `policy.liveness`, and the optional ML PAD model evaluation (§2.3 layer 3): **no ML PAD model was added**; there is no evidence yet that one is needed or that it would beat challenge + heuristics, and the licence/size/accuracy of candidates were not verified. **What I need from you:** `live_selfies/` (40+, with consent, varied light/devices), `spoof_screen/` (40+), `spoof_print/` (20+), `spoof_video/` (20+); optionally evidence sidecars and `labels.txt`. Then `cd client && npm run report`.

---

## Phase 7 — final results (7g) ✅ (all but the real-sample work in 7f)
| Suite | Baseline | Final |
|---|---|---|
| Client `npm test` | 123 | **178 passing** |
| Backend `pytest -q` | 53 | **103 passed** |
| Parity JS vs Python (37 variants of `samples/good/0001.png`) | 100% | **100%** (verdict 37/37, no disagreements) |
| HUD e2e (`tools/e2e/hud-e2e.mjs`) | 87 PASS + 1 timing flake (88 lines) | **202 PASS, 0 FAIL, 0 console errors** (last full run, before the 7f report-only changes; scenarios added: layout/segments rework, liveness, spoof, fullstack, casefile) |
| `npm run report` | n/a | ~4 min, deterministic (test), regenerated after 7f |

**What works (measured).** A face that never moves cannot unlock the shutter on a selfie task (real model, real Chrome, no mock); a scripted live person passes two random challenges and the server replays and accepts the evidence; replayed, forged, foreign, expired, mismatched and absent evidence is rejected and blocks on face-required tasks (live API tests + e2e); a passed challenge on a synthetic screen/print is flagged for review; every metric is a 10-segment meter; the camera is immersive on phones and a large aspect-matched stage on desktop with the shutter on screen at 390/768/1440 px; the accuracy report covers the fraud model, 8 photo-quality classifiers, the face detector and liveness (pending samples) with REAL/SYNTHETIC labels.
**Real vs synthetic.** REAL: photo-quality numbers on the sample folders (blur AUC 0.990, 0.9% good blocked, dark 31/31, low-res 22/23; shake alone 66% on 120 motion-blur photos), moiré/bezel false-flag rates on 346 real photos, head-pose sign/layout on real photos, JS/Python parity. SYNTHETIC: over-exposed, obstruction, glare, noise, the whole fraud classifier, every spoof (screen/print) and the challenge "live person" (mock). **Unmeasured: real liveness pass rate, real spoof detection, face false-reject on clear selfies, fairness slices.**
**Honest limits (summary).** Heuristic thresholds are starting values; the challenge stops photos, prints, forged/replayed evidence and casual replays, not a person performing it for the attacker, a matching replayed video, or an injected camera; the client gate is advisory and the server replay proves the signals show the actions, not that a real sensor produced them; dev StrictMode double-issues a nonce; physical phones untested (out of scope); the real `edge-validator-ai` supervisor could not be invoked in this session (not registered) so **no milestone was reviewed by it**.
**Open:** your liveness samples (7f), calibration of the passive layer and the block/flag defaults from them, good selfies for the face false-reject rate, real glare/overexposed/lens-covered/noisy photos, alternative challenge set for accessibility, supervisor review after `/agents` reload.


---

## Phase 8 — Iteration 4 (started 2026-10-07; spec: [`iteration-4.md`](iteration-4.md))
Checklist: [~] 8a focus diagnosis · [ ] 8b focus fix + real false-block table · [ ] 8c `npm run e2e` + "sharp capture is not refused" · [ ] 8d challenge UX/accessibility + nonce robustness · [ ] 8e reviewer workflow + real-label reporting · [ ] 8f privacy/retention/auth + hardening · [ ] 8g real-sample evaluation (pending your samples) · [ ] 8h verify + document

### Baseline (measured before any Phase 8 change, 2026-10-07)
| Suite | Result |
|---|---|
| Client `npm test` | **178 passing**, 0 failing |
| Backend `pytest -q` | **103 passed** in 247 s (note: I edited `face.py` while this run was in progress; its modules were already imported, and the full suite is re-run after the change) |
| Parity `node tools/parity.mjs ../edge-validator/samples/good/0001.png` | **100%** on all 7 checks, verdict 37/37, no disagreements |
| HUD e2e (202 checks) | re-run on isolated servers later in this phase (see 8c) |

Environment: your servers on 8000 / 5174 untouched (never POSTed to). Isolated backend on `127.0.0.1:8001` (scratch DB + uploads) and a separate Vite on `127.0.0.1:5173` (`VITE_API_URL=http://127.0.0.1:8001`, own cacheDir outside the repo). Note `[::1]:5173` is another project's server; `127.0.0.1` is free.

### Supervisor
`edge-validator-ai` was invoked by name at the start of Phase 8 and the harness answered **"Agent type 'edge-validator-ai' not found. Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup"**. The definition exists at `.claude/agents/edge-validator-ai.md` but is not registered in this session, so **it cannot be invoked and no Phase 8 milestone has been reviewed by it** (third session in a row). To fix: restart Claude Code or run `/agents` so the agent list reloads, then ask for a review. I did not substitute a stand-in reviewer for this baseline.

### 8a — Focus diagnosis: interim findings (2026-10-07, paused at the user's request to collect real photos first)
**Built (no threshold changed):** `backend/tools/focus_diagnose.py` (every check with value vs threshold, 3×3 blur tile scores, face-crop blur + crop size, verdict, blocking checks in plain words; `--client` runs the browser engine in Node on the same file and compares; `--pipeline video` is a stand-in for the in-app capture), `client/tools/diagnose-cli.mjs`, `client/tools/focus-experiments.mjs`, `backend/tools/focus_experiments.py`, `client/tools/e2e/focus-capture.mjs` (real photos through Chrome's fake camera and the real shutter; saves the captured JPEG), `lib/photoQuality/explain.js` (+5 tests) and a **"Why this photo can't be submitted"** box in the checklist naming the check, the measured value and the limit (e.g. "Focus 19% — needs at least 31%"), plus a `?debug=checks` panel. The face check now reports structured `details.reasons` (metric, value, limit) and crop size, in JS and Python (additive; behaviour unchanged).
**Measured (REAL photos; where degraded, labelled SYNTHETIC):**
| Hypothesis | Evidence | Verdict so far |
|---|---|---|
| The Phase 7 "sharp astronaut reads Focus 42% soft" | `astronaut.png` is 512×512; the e2e face stream stretches a **250×250 px crop to 1080 px (4.3×)**. Same pixels: native **0.420 pass**, 2.9× **0.254**, 4.3× **0.204 warn** | **A fixture artefact, not a product bug.** Also shows the score depends on pixel scale |
| H1 face-crop blur too strict | Sharp real faces with a judged crop: `good/` n=10 min 0.196 (p5 0.196), `face_not_visible/` n=7 min 0.221; thresholds 0.10 / 0.16 → **0/17 blocked or warned**. Real blurry faces: median 0.091, shaky 0.137 | Not supported on stills. Camera selfies untested (no data) |
| H2 whole-frame blur on face-filling/plain frames | Code: a frame with <2 textured tiles is a *warn*, never a block. Sharp real faces' whole-frame blur p5 0.225, 0/26 below 0.16 | Not supported |
| H3 video-pipeline softness | **24 real good photos through the real in-app capture in headless Chrome (never upscaled, 1920×1080 stream): 0/24 blocked**; captured/source blur ratio median 1.05 (0.83–1.37); browser vs server on the same JPEG: median 1.8% diff, max 3.1% | The browser pipeline does not soften. Real front-camera/H.264 softness NOT reproducible here |
| Block line in "softness" terms | Gaussian softness sweep on 106 real good photos (SYNTHETIC blur): the **block line 0.16 = σ≈3.7 px**, the warn line 0.25 = σ≈1.9 px at 1280 px; real blurry set ≈ σ 3–4+ px | The block only fires on clearly blurred pictures |
| H6 client vs server | Same numbers within 3.1% on 24 captures; JS and Python identical on the 2 face photos checked; parity 100% | Not supported |
| H8 warn treated as a block | Code trace: only `fail` + `blockOnFail` blocks; a warn shows "Submit anyway"; all 9 warn-only captures (noise σ 6.4 on grainy stock) were submittable | Not supported |
| H4 autofocus, H5 burst metric, H7 other blockers | **Not measured yet.** H5 experiment written but killed (too slow with other jobs running); the selfie-capture run (17 real faces) failed to start the live challenge twice (harness issue: face too small for the live landmarker / CPU load) | Open |
**Other findings:** a real selfie flow can still be refused by (a) the server nonce TTL of 180 s from issue to submit (`liveness_expired` → block on a required task), and (b) a pass older than 30 s needing "Try again" (does not use up attempts). **Root cause of the user's refusal: NOT established.** Everything measurable with the existing samples says the blur/face-crop block lines are not too strict for sharp pictures; what is missing is real camera captures that were refused. Needed: see "What to upload" in the final message of this session.

### 8b — Focus fix ✅ (2026-10-07) — what changed and what the numbers say
**Decision (from the numbers above, no new photos were available):**
1. **Whole-frame blur thresholds NOT changed (0.16 block / 0.25 warn).** Sweep on the real sets (Wilson 95% CIs), block if score < t: t=0.16 → good 1/106 (0.9% [0.2–5.2]), blurry 77/98 (78.6% [69.5–85.5]), shaky 66/120 (55.0% [46.1–63.6]); t=0.14 → good 0/106 (0.0% [0–3.5]), blurry 65/98 (66.3% [56.5–74.9]), shaky 57/120 (47.5% [38.8–56.4]); t=0.12 → blurry 48.0%, shaky 30.8%. Loosening to 0.14 would remove the one false block but cost 12 points of blur-block recall (the iteration-4 rule allows ≤ 3), so the line stays.
2. **Face-crop sharpness no longer blocks on its own** (`softenCropBlur` in `face/facecheck.js`, `soften_crop_blur` in `backend/photo_quality/face.py`, applied in `analyzeFrameAsync`, the browser entry `client.js` and the server `analyze_image`): if the whole-photo focus check does not *fail* and the face's only failures are `cropBlur`, the face becomes a **warning** ("you can still submit", "Submit anyway", recorded) instead of a block. Reason: the crop is mostly smooth skin (noisier signal than the whole-frame score) and a single sharpness signal should not strand a worker. Any other face failure (cut off, tiny, no face, shadow) still blocks; a genuinely blurry photo still blocks via the whole-frame check.
**Before / after on the 168 REAL photos that contain a face, scored as a selfie task (verdict counts):** good 26: pass 2 / warn 7 / block 17 → **unchanged**; face_not_visible 9 → unchanged; low_resolution 23 → unchanged; **blurry 37: 36 block → 36 block (unchanged)**; **shaky 51: 43 block → 43 block (unchanged)**; glare 13, overexposed 2 → unchanged; **dark 7: 7 block → 6 block + 1 warn** (IMG_0192.HEIC, blocked before only by face-crop sharpness; it is a dark-folder photo whose whole-frame exposure passes). **Net: 0 of 88 real blurry/shaky faces lost, 1 of 7 dark-folder photos now warns, 0 good photos changed.** So on the available data the fix is *neutral*: it removes a single-signal block but there was no measured false block on these samples to cure. It is justified as a robustness rule, **not** as a measured improvement; the real benefit (selfies with smooth skin from real front cameras) can only be shown with `camera_rejected_good/` / `good_selfies/`.
**Tests:** client **188 passing** (+5 `softenCropBlur.test.js`, +5 `explain.test.js`); backend `tests/test_focus_soften.py` (4, incl. an end-to-end real face with only the face region softened: before the change "Your face is blurry" blocked it, now WARN); parity (JS engine vs Python engine) **100%** (37/37).
**Root cause status (honest):** NOT established. Nothing measurable on the samples says good photos are being blocked on focus; the reproducible "soft astronaut" was a 4.3× enlargement in the test stream. What remains unmeasured and could still be the cause on the user's device: real front-camera / H.264 softness, autofocus not settled, a laptop webcam (the `low_resolution` folder looks like webcam frames: 3 of 23 are blocked on whole-frame focus and the two I looked at really were out of focus / dark). The refusal now explains itself in numbers, which is the fastest way to find it.
**Still to measure when photos exist:** H4 autofocus timing, H5 burst-vs-check metric (script `client/tools/focus-experiments.mjs burst`, not run to completion), the real false-block table (`camera_rejected_good/`, `good_selfies/`), per front/rear camera.

### 8c — `npm run e2e` ✅ (2026-10-07)
`cd client && npm run e2e [scenario]` (`tools/e2e/run.mjs`): builds the fake-camera streams, starts an **isolated** backend (temp DB + uploads, `127.0.0.1:8001`) and a separate Vite (`127.0.0.1:5173`, own cache dir, `VITE_API_URL` → 8001), runs `hud-e2e.mjs`, prints the summary, tears everything down. It **refuses to run** if 8001/5173 are busy (never reuses a server) or if asked to use 8000/5174. New scenarios: **`sharpcapture`** (3 REAL `samples/good` photos, never enlarged, through the real shutter: not refused and Submit offered; a blurry capture is still refused with "Focus 2% — needs at least 31%"; the debug panel shows the numbers), `liveoffline`, `review`. The streams builder gained `sharp0..2` (real photos). Harness bugs found: (1) puppeteer request interception broke module loading, so the offline test wraps `fetch` in the page instead; (2) editing client source while a suite runs makes Vite reload pages mid-scenario (two spurious failures: do not edit `client/src` during an e2e run); (3) `fullstack`'s "replay the spent nonce" attack re-sent the *same photo*, which the new idempotent-retry rule (8d) correctly accepts: the attack now uses a different photo and a new check proves the retry is accepted.

### 8d — Challenge robustness ✅, accessibility partly ⏳ (2026-10-07)
**Done:** (a) **one nonce request per attempt**: in-flight requests for the same worker+task are shared (`lib/api.js`), which removes the dev StrictMode double request (5 unit tests; e2e `liveoffline` asserts exactly 1 real request); (b) **server unreachable is explicit**: "Can't reach the server — the live check needs a connection… trying again", shutter stays locked, retries every 4 s and starts by itself when the server is back (no more silent local fallback that the server then flagged); (c) **idempotent retries (server)**: the same photo bytes from the same worker/task/site re-sending a spent nonce (a lost response) is accepted as a retry and judged *as of the first use* (so it also survives the 180 s TTL); a different photo, another worker, or a forged nonce is still `liveness_replayed` / `liveness_forged` and blocks (3 backend tests + 2 e2e checks); (d) **failure reasons in words**: face left the frame / never relaxed first / too little movement / did not return to neutral (3 tests); (e) optional **read prompts aloud** (speech synthesis, off by default, remembered, guarded) + a short vibration on pass; the overlay stays `role=status`.
**Not done (waiting for your decision, as the spec says it is yours):** the **alternative challenge set** (smile + open mouth only, flagged `liveness_alt_set`) for people who cannot blink or turn: today the only fallback is "Send for review". Also not done: measuring/tuning pass time on real captures (no real captures), a visible countdown redesign.

### 8e — Reviewer workflow ✅ (2026-10-07)
New table `review`; `backend/reviews.py` (queue rules, validation, history), endpoints `GET /reviews/queue`, `POST /submissions/{id}/review`, `GET /submissions/{id}/reviews`, and `review` / `needs_review` / `review_reasons` on every submission. Dashboard: **Review queue** panel, **Review** section in the case file (name, Approve / Reject / Needs retake, reason required unless approving, history), "reviewed ✓ / rejected / retake" badge in the feed. **Real labels in the report:** section 5 of `accuracy-report.md` = per flag, how often a human upheld it (Wilson CIs) + who reviewed how many; the fraud model is compared with reviewers only at ≥ 200 reviewed cases with ≥ 50 per class (`backend/tools/reviewed_dataset.py` exports the CSV under the same guard and refuses below it); liveness/spoof flags are not classifier features. `REVIEWERS` allowlist (self-declared names are **not authentication**). Tests: 6 API (`test_reviews.py`), 6 report/export (`test_report_reviews.py`), 3 JS (`reviews.test.js`), e2e `review` (a blocked black frame appears in the queue, a reject without a reason is refused, the decision is stored with reviewer and time, the case leaves the queue; screenshot checked by eye). **Honest limits:** no reviews exist yet, so the report's REAL table says "not evaluated"; the report reads your `backend/trust_layer.db` **read-only** (`--db` to change); who the reviewers are and how they authenticate is still your decision.

### 8f — Privacy, retention, access, hardening: mechanisms ✅, decisions ⏳ (2026-10-07)
All **off by default** (your decision): `DASHBOARD_TOKEN` (dashboard/reviewer/photo endpoints need a bearer token; the dashboard asks once), `SUBMISSION_RATE_PER_HOUR` (default 120/worker), `REVIEWERS`, `PHOTO_RETENTION_DAYS` + `tools/purge_photos.py` (dry run by default; deletes photos and liveness timelines, keeps verdicts/flags/hashes/reviews; a file shared with a recent submission is kept). A missing `mediapipe` degrades to `face_unchecked` / `liveness_unverified` (tested, no crash). Consent line on the selfie task (draft wording, needs your approval). `thresholds-changelog.md` + the report prints the sha256 of `thresholds.json`. HTTPS / bundle notes in the README. **Production bundle (measured):** main 971 kB (298 kB gzip), worker 37 kB, MediaPipe wrapper 154 kB (46 kB gzip) loaded **only for face tasks**; the liveness logic itself is small and in the main bundle (not lazy-loaded). Tests: 8 in `test_hardening.py`, 2 in `auth.test.js`. **Your decisions still open:** dashboard auth approach (a shared token vs SSO/gateway), the retention period, who the reviewers are, the consent wording.

### 8g — Real-sample evaluation ⏳ (blocked on samples, by your choice for now)
Tooling is ready and unchanged (`npm run report` is the single command; `focus_diagnose.py` for refused photos; `reviewed_dataset.py`). Nothing new could be measured without `live_selfies/`, `spoof_*`, `good_selfies/`, `camera_rejected_good/`, real glare/overexposed/lens-covered/noisy photos. The README now has the exact capture checklist and a manual device test sheet.

### 8h — Final verification (2026-10-07)
| Suite | Baseline (start of Phase 8) | Final |
|---|---|---|
| Client `npm test` | 178 | **201 passing** (+23: explain 5, softenCropBlur 5, api 5, reviews 3, auth 2, liveness reasons 3) |
| Backend `pytest -q` | 103 | **130 passed** in 5:10 (+27: focus soften 4, liveness retry 3, reviews 6, report reviews 6, hardening 8) |
| Parity JS vs Python | 100% (37/37) | **100%** (37/37, no disagreements) |
| E2E (`npm run e2e`, isolated servers) | 202 | **229 PASS, 0 FAIL, 0 console errors** (isolated servers; UI-thread tick p50 9.4 / p95 13.7 ms, with the mesh p95 15.3 ms). An earlier full run had 227 PASS + 1 FAIL (the outdated replay-attack expectation, fixed) and two runs were spoiled by my editing `client/src` mid-run (harness artefact) |
| `npm run build` | OK | OK |
| `npm run report` | ~4 min | regenerated: blur 96/98 caught, 1/106 false block, block recall 77/98 (unchanged), new section 5 "not evaluated: no reviews yet", thresholds hash `85128bed4e96` |

**Supervisor:** `edge-validator-ai` was **not invocable in this session** (see the top of Phase 8: "Agent type not found"); no milestone of Phase 8 was reviewed by it. I did not substitute a stand-in. Re-run it after `/agents` reloads.

**What works (measured):** the refusal explains itself in numbers; sharp real photos through the real capture are not refused (24/24 shelf in the experiment, 3/3 in the e2e); a blurry capture is refused with a reason; the face-crop sharpness no longer blocks alone; challenge requests are one per attempt, say so when offline and recover; honest retries are not attacks; reviewers can record decisions that become labels; privacy/hardening mechanisms exist and are tested; the whole e2e runs with one command on isolated servers.
**Real vs synthetic:** REAL photos everywhere above (stock/phone sets in `samples/`), but **none is a real worker camera capture**; the *camera* is Chrome's fake device and the live "person" is a labelled mock; Gaussian-softness sweeps and bursts are synthetic degradations of real photos.
**Open (carry to the next iteration):** root cause of the user's own refusals (needs `camera_rejected_good/` or one red-box text); H4 autofocus and H5 burst-metric measurements; real false-block / face false-reject tables; alternative challenge set (decision); all of 7f (real liveness numbers, passive tuning, block-vs-flag); real glare/overexposed/lens-covered/noise validation; auth/retention/reviewer/consent decisions; nonce TTL (180 s issue→submit; a very slow submitter gets `liveness_expired` → block on required tasks; not changed because it is a security trade-off); physical-phone testing (out of scope); supervisor review.
