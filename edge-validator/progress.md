# Edge Validator — Progress

Plan: see `iteration-1.md`. Updated after every phase. How to use the result: see `README.md`.

**Status (2026-10-07): phases 0–5 complete. Phase 6 (live metrics HUD) is planned and ready to build: the full spec, task list, acceptance criteria, test recipe and pitfalls are in [`iteration-2.md`](iteration-2.md); the checklist is in the "Phase 6" section at the bottom of this file.** Still pending on the user, independent of Phase 6: drop real worker photos into `samples/` and run `cd client && npm run calibrate`.

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation: `photoQuality/` structure, shared frame + decode, result schema, policy, request-id guard, test env | ✅ done |
| 1 | Pixel checks: blur, exposure, resolution, noise/compression, lens obstruction + checklist UI + policy | ✅ done |
| 2 | Glare, image-based shake, "Submit anyway", backend schema + upload + server recheck | ✅ done |
| 3 | Face check (MediaPipe) + per-task config | ✅ done |
| 4 | In-app camera, live feedback, burst best-frame, sensor-synced shake, Web Worker | ✅ done |
| 5 | Calibration tool, classifier retrain, dashboard | ✅ done |
| 6 | **Live metrics HUD on the camera** (brightness %, focus %, all 8 parameters, overall live quality %) — plan in `iteration-2.md` | 📋 planned, not started |

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

## Phase 6 — Live metrics HUD on the camera 📋 PLANNED (handoff for the implementing agent)

Requested 2026-10-07: while the worker is on the camera screen, show the quality metrics **live**: a brightness percentage, a focus percentage and all 8 quality parameters, plus an overall live quality percentage, to give a real live feel and let the worker see exactly what to fix. **Read [`iteration-2.md`](iteration-2.md) first: it is the spec.** Summary here so this file stands alone.

### Starting state (verified 2026-10-07)
- Client tests **84 passing** (`cd client && npm test`); backend **50 passing** (`cd backend && .venv/bin/python -m pytest -q`, ~2 min); JS↔Python parity **100%** (`cd client && node tools/parity.mjs <photo>`).
- The camera already has live guidance: `client/src/lib/photoQuality/live.js` (`analyzeLive`, 5 chips: Lens/Light/Face/Steady/Focus/Glare + headline hint + ready tracker), `components/capture/LiveCamera.jsx` (5 Hz loop on a 480 px frame, burst, sensor window, face box). There are **no numbers** yet, and two of the 8 parameters (resolution, noise/compression) are not shown live.
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
- [ ] **6a** Extract `combineScores`; write `lib/photoQuality/liveMetrics.js` (pure, EMA + hysteresis state in/out); add `live.hud` constants to `thresholds.json` + README threshold table; `liveMetrics.test.js` (all cases listed in iteration-2 §3, 6a)
- [ ] **6b** `LiveCamera.jsx`: native 256×256 crop every 2nd tick, video dims, smoothing ref; measure p50/p95 tick time in Chrome and record it here; offload to the worker only if p95 > 50 ms
- [ ] **6c** `components/capture/LiveHud.jsx` + CSS (ring, 8 rows + compression note, ticks, toggle, compact mode, `?hud=raw`, reduced motion, accessible text); verify at 420 px and 1440 px that it never covers the shutter or hint
- [ ] **6d** `QualityChecklist.jsx` shows values in the HUD format via a shared `formatMetric` helper in `lib/format.js` (+ unit test)
- [ ] **6e** Headless-Chrome fake-camera e2e for every case in iteration-2 §3 6e (good / dark / blurred / noisy / covered / shaky / face vs no-face task / toggle persistence / burst still ≥10 of 12); no console errors; `npm run build` passes; client tests ≥ 84 + new, backend 50, parity 100%
- [ ] Fill in a **"Phase 6 — results"** section here (what was built, measured numbers, bugs found, honest limits) and update `edge-validator/README.md`

### Constraints
- **Display-only:** no server, database, classifier or threshold changes; no existing threshold may change (calibration needs real photos first). No Python changes expected; if a check's logic is touched, port it to `backend/photo_quality/` and re-run parity.
- Don't use or POST to the user's servers (backend **8000**, Vite **5174**); use an isolated backend (`TRUST_LAYER_DB`, `PHOTO_DIR`, port 8001) and Vite on 5173 via **127.0.0.1** (`localhost:5173` is another project). HUD-only tests need no backend.
- Pitfalls already hit (details in iteration-2 §5): StrictMode double effects need cancellable starts; Vite reloads once on first lazy import; `puppeteer-core` is installed `--no-save` and vanishes on `npm install`; measure UI stalls with a timer gap recorder read *after* awaiting ~40 ms.
- Out of scope: physical-phone testing (dropped by the user), calibration (waiting on photos), face-policy change (user decision pending).

### Supervision
`CLAUDE.md` in the project root requires invoking the `edge-validator-ai` subagent after every completed milestone, before starting a new phase, and whenever tests fail twice in a row; if it returns **STOP**, halt and follow its prompts. Record each invocation's outcome in this file.

### Milestone log
- 2026-10-07: Iteration 2 plan written (`iteration-2.md`), progress file updated, iPhone testing removed from scope.
- 2026-10-07: **Supervisor invocation FAILED: the `edge-validator-ai` subagent is not registered** (the tool reported "Agent type 'edge-validator-ai' not found"; only claude, claude-code-guide, Explore, general-purpose, Plan and statusline-setup exist). No supervisor verdict (GO/STOP) was obtained for this milestone. Nothing was implemented, so there is nothing to stop yet, but the implementing agent must not treat the absence of a STOP as a GO: define the subagent (e.g. `.claude/agents/edge-validator-ai.md`) or tell the user, and obtain a verdict before starting Phase 6a.
