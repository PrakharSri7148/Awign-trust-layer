# Edge Validator — Iteration 3: anti-spoofing, ML accuracy report, camera UI redesign

Date: 2026-10-07
Status: **planned, not started.** Phases 0–6 (+ the Phase 6 addendum) are complete; this iteration is **Phase 7**.
Audience: the engineer / agent who will implement it in a fresh session. Read first, in this order: `CLAUDE.md` (project root), `edge-validator/README.md`, `edge-validator/progress.md` (all of it, especially Phase 6 and its addendum), then this file.

## 0. What the user asked for (verbatim intent)

1. A plan for iteration 3.
2. It includes an **ML model accuracy report**, and a **bug**: *"when you show a person's picture through your phone [to the camera] it still detects the face and allows you to submit"*. Fix it.
3. **UI redesign:** make the camera frame **much bigger** (it is very compact now), and show the metrics as **small, discrete green bars, about 10 segments each, that light up and go dark as the value rises and falls** (instead of today's continuous bars).
4. A markdown file for all of it, plus a ready-to-paste prompt for starting the implementation in a new chat (see `iteration-3-prompt.md`).

Defaults I chose where the user did not specify are listed in §7 so they can be vetoed.

## 1. Where things stand (verified facts, so you don't have to re-discover them)

- Client engine: `client/src/lib/photoQuality/` (pure checks, `live.js`, `liveMetrics.js`, `face/`, worker). Server re-check: `backend/photo_quality/` (Python port, same `thresholds.json`). Dashboard + capture UI: `client/src/pages/`, `client/src/components/`.
- Tests: client `cd client && npm test` → **123 passing**; backend `cd backend && .venv/bin/python -m pytest -q` (~1–2 min) → **48 + calibration tests**; JS↔Python parity `cd client && node tools/parity.mjs <photo>` → **100%**; HUD end-to-end harness `client/tools/e2e/` (`mkstreams.mjs`, `hud-e2e.mjs`) → **94 checks passing**.
- **The face check only asks "is there a face-shaped thing?"** (BlazeFace detector + FaceLandmarker for drawing the mesh). Nothing asks "is it a real, live person?". A phone screen, a printed photo or a video of a face passes `evaluateFace` and the submission is allowed. `capture_source: 'camera'` is self-reported by the device and cannot prove liveness.
- **Why the camera frame is small:** the Capture page uses `.page--narrow` (`max-width: 520px`, `client/src/styles/global.css:155`) and the viewfinder is a fixed `aspect-ratio: 4 / 5` box (`.viewfinder`, line ~213) with the video letter-boxed inside it (`object-fit: contain`), so a 16:9 laptop webcam shows as a small strip with black bars. The shutter is also **below the fold** on load (known open item from Phase 6).
- Metrics today: `components/capture/LiveHud.jsx` draws continuous bars (`.hud__fill`, `.hud__tick`) with a ring for the overall. Numbers come from `analyzeLive(...).metrics` (rows: brightness, focus, lens, glare, steady, noise, resolution, face) and must keep working.
- MediaPipe FaceLandmarker (already loaded for face tasks, `public/mediapipe/face_landmarker.task`) can also output **blendshapes** (eye blink, smile, jaw open…) and a **facial transformation matrix** (head pose): `outputFaceBlendshapes` / `outputFacialTransformationMatrixes` exist in `@mediapipe/tasks-vision` 1.1. They are not enabled yet.
- Samples: `edge-validator/samples/` (see `progress.md` "Calibration run 2" for what each folder really contains and the data problems). `ffmpeg` is **not installed** (relevant for video test material, see §6).

## 2. Workstream A: liveness / anti-spoofing (the bug)

### 2.1 Problem statement
A face shown on another screen, a photo or a video must **not** pass a face-required task. Today it does.

### 2.2 Honest scope
No single on-device check stops every attack. Presentation-attack detection (PAD) is a layered, probabilistic problem: the goal is to stop the *casual* attacks (phone screen showing a photo, printed photo, a replayed video) with a defensible false-reject rate for real workers, flag the rest for review, and **measure** it (ISO/IEC 30107-3 metrics, §3). Do not claim "unspoofable". Deep-fake / injected-camera attacks (virtual cameras) are out of scope; record that limit.

### 2.3 Design: three layers + server
Layers are independent signals combined by a small policy; each produces `{ status, score, reason, evidence }` and shows up as a **new check id `liveness`** (and in the HUD as a **Liveness** row + a prompt on screen).

**Layer 1: passive screen/print detection (every frame, cheap, on device).** Heuristics aimed at "a photo of a screen / paper":
- **Moiré / pixel-grid periodicity:** a camera filming a display shows periodic high-frequency patterns. Detect narrow spectral peaks in the 2-D FFT (or a Goertzel/autocorrelation scan) of the gray image in the face and background regions, ignoring natural texture; score = peak-to-median ratio.
- **Screen rectangle / bezel:** a bright, uniformly lit quadrilateral with rounded corners and a dark border inside the frame, especially if the face is entirely inside it (a phone/monitor showing the face), found by edge+contour on the preview frame.
- **Flicker / banding:** display refresh and PWM backlights produce horizontal luminance bands that drift across consecutive frames; measure row-profile banding energy and its temporal drift.
- **Specular glare and colour cast** typical of glass/LCD (extends the existing glare check: a soft-halo blob *on the face*).
- **Planarity (when the phone/face moves):** a flat photo's landmarks move as one homography between frames; a real 3-D face does not. Fit a homography to the landmark motion over ~1 s and use the residual (needs small natural movement).
These are *evidence*, not verdicts: combine into one `passiveScore`. Expect false positives on real faces in front of windows/monitors; calibrate (§3).

**Layer 2: active challenge-response (the strong signal, required for `face: required` tasks).** Show a short random instruction and verify it with the landmarker:
- Challenges: **blink**, **turn head left/right**, **smile**, **open mouth**, picked at random, 2 per attempt, each with a time limit (e.g. 4 s) and a visible countdown. Verified from blendshapes (`eyeBlinkLeft/Right`, `mouthSmile*`, `jawOpen`) and head yaw from the transformation matrix, with hysteresis (needs the state to go neutral → active → neutral, not just exceed a threshold once).
- A static photo or a printed picture cannot blink or turn; a *video* replay can, but the **random order and the short time window** make a pre-recorded clip unlikely to match, and the layer-1/planarity signals still apply.
- Challenge state machine = a **pure module** (`face/liveness.js`) driven by a timeline of `{ t, blendshapes, yaw, faceBox }` samples, so it is fully unit-testable without a camera.
- UX: the on-screen text and the mesh react ("Blink now", mesh dots pulse green when the action is detected), the shutter stays disabled until liveness passes on required tasks.

**Layer 3 (optional, evaluate before adopting): a small ML PAD model.** A lightweight face-anti-spoofing network run in the browser (candidate: MiniFASNet-class models via `onnxruntime-web`; **verify the model licence, size and accuracy yourself before adding it; do not assume**). Only adopt it if the accuracy report (§3) shows it beats layers 1–2 on the user's own spoof samples. Otherwise leave it out and document why.

**Server re-check (trust control).** The server never trusts "liveness passed" from the device. The client sends the **evidence** with the submission: the challenge list, per-challenge pass/fail with timestamps, and a compact landmark/blendshape timeline (~1–2 s, a few KB), plus the final photo. The server (a) re-runs layer-1 screen/moiré detection on the uploaded photo (Python port of the passive checks; same thresholds file), (b) validates the challenge evidence is internally consistent (timestamps within the window, challenge ids match what was issued, a blink actually appears in the blendshape series, yaw crosses the threshold) and (c) flags `liveness_unverified` / `liveness_failed` / `spoof_suspected`. To prevent replay of old evidence, the server issues a **nonce + challenge list** (`POST /liveness/challenge` → `{ id, challenges, expires }`) that must come back with the submission (single use, short TTL, stored in the DB). Document that this stops casual replay but not an attacker who injects video into the camera.

### 2.4 Policy
- `face: required` (selfie check-in): liveness is **blocking**: no `liveness` pass → no submit. Honest failure → "Try again" with the reason; after N failed attempts offer "send for review" (flagged) rather than stranding the worker.
- `face: optional`: liveness runs passively; a failure is a flag, not a block.
- `face: off`: nothing runs (and no extra model cost).
- New policy keys in `thresholds.json` (`policy.liveness.blockOnFail`, per-layer thresholds). Backend policy mirrors it. Decide block-vs-flag defaults with the fairness note below.
- **Fairness / accessibility:** blink/turn challenges exclude some people (eye conditions, mobility); provide an alternative challenge set and a fallback path to review. Face-model accuracy varies by skin tone and lighting: report the PAD error rates per available slice (§3) and do not ship `blocking` defaults without that evidence.

### 2.5 Acceptance criteria (Workstream A)
1. A phone/monitor/print showing a face to the camera **does not pass** a `Selfie check-in` task end to end (UI blocks submit; if the client is bypassed the server verdict is `block`/flagged).
2. A real live person completing the challenges **passes** within ~10 s on the user's real samples; false-reject rate on the live samples is reported (§3) and within an agreed target (default ≤ 5% APCER-side/BPCER-side trade-off documented, see §3).
3. The challenge state machine has unit tests with scripted timelines (success, timeout, wrong order, held-open eyes, photo with no motion, replayed evidence, expired nonce).
4. Server tests: valid evidence accepted; stale/forged/mismatched evidence rejected and flagged; JSON-only (no evidence) client flagged; nonce single-use.
5. No regression: client 123+, backend 48+, parity 100%, HUD e2e 94 passing.

## 3. Workstream B: the ML model accuracy report

### 3.1 What "the ML models" are here (the report must cover each, separately and honestly)
| # | Model / classifier | What it decides | Current evidence |
|---|---|---|---|
| 1 | **Fraud classifier** (`backend/fraud_classifier.pkl`, GradientBoosting on `[photo_quality_score, motion_score, ambient_score]`, SHAP) | accepted vs flagged | trained **and** evaluated on synthetic data (≈96% "accuracy" is meaningless for real fraud) |
| 2 | **Photo-quality checks** treated as classifiers (blur, exposure, glare, resolution, obstruction, noise, shake) | each: issue vs no issue | calibration runs on real folders (blur/shake/dark real; others synthetic) |
| 3 | **Face detector + landmarker** (MediaPipe BlazeFace, FaceLandmarker) | face present / quality / mesh | 9 `face_not_visible` photos, no good selfies |
| 4 | **Liveness / PAD** (new, §2) | live vs spoof | none yet: needs real spoof captures |

### 3.2 The report (deliverables)
- **`backend/tools/accuracy_report.py`** (reproducible, seeded, no network) writing **`edge-validator/reports/accuracy-report.md`** and `accuracy-report.json`, runnable via `cd client && npm run report`. Re-running with new samples regenerates it. Also publish a readable HTML version as an Artifact **only if the user asks** (it may contain sample file names).
- **Contents per model/check:**
  - Dataset inventory: counts per folder, formats, resolutions, device mix, **duplicates across folders (hash)**, synthetic vs real flagged on every number, and how each sample was labelled.
  - Confusion matrix, **precision, recall, F1, specificity, AUC (ROC) with 95% confidence intervals** (Wilson for proportions, bootstrap for AUC). Small samples (<30 per class) must be marked "indicative only".
  - **Threshold sweep tables** (the blur/shake style tables used in calibration run 2) and the operating point currently deployed, with false-block rate on good photos called out.
  - **Error analysis:** list the false positives/negatives with file names and the reason the check gave (so a human can look), grouped by cause.
  - **Latency:** per check and end to end on this machine; client vs server numeric agreement (extends `tools/parity.mjs`).
  - **Fraud classifier specifics:** metrics on a *held-out* synthetic set generated with a different seed and different generator parameters than training (to show sensitivity to the data assumptions, not just memorisation); calibration curve (reliability) and Brier score; SHAP importance stability across seeds; the probe grid from Phase 5; explicit leakage notes (train/test come from the same generator; photo-quality dependence is an *assumption*); a "what would change if the assumption is wrong" sensitivity run.
  - **Liveness (PAD):** ISO/IEC 30107-3 metrics: **APCER** (attacks accepted) per attack type (screen replay, print, video), **BPCER** (live rejected), **ACER**, plus the live-challenge completion rate and median time to pass; per device and per lighting condition where the samples allow.
  - **Fairness slices** where metadata exists (device, lighting, glasses/hijab/beard if the user tags them); otherwise state that no slice evidence exists.
  - **"What this does and does not tell you"** section in plain language, and a ranked list of the weakest areas.
- The report must **never** present synthetic-data numbers as real-world accuracy; every table says `real` or `synthetic` in its title.

### 3.3 Data the user needs to provide for the liveness part (put in `samples/`, one photo/video per file, one folder each)
| Folder (new) | What | Min |
|---|---|---|
| `live_selfies/` | real people, real cameras, varied light, glasses etc. (consent!) | 40+ |
| `spoof_screen/` | the **same people's** photos/videos shown on a phone/laptop screen and filmed by the app's camera | 40+ |
| `spoof_print/` | printed photos held to the camera | 20+ |
| `spoof_video/` | a video of a face played on a screen (so blinking/turning is "present") | 20+ |
Document the capture protocol in `samples/README.md`. For the in-app camera path the e2e harness needs `.mjpeg`/`.y4m` streams (Chrome fake-camera); **ffmpeg is not installed**: either `brew install ffmpeg` (ask first) or capture stills/frames and build `.mjpeg` files with the existing `mkstreams.mjs` approach.

### 3.4 Acceptance criteria (Workstream B)
1. `npm run report` produces the Markdown + JSON from the current samples in under ~10 minutes and is deterministic (same inputs → same numbers).
2. Every number is labelled real/synthetic; CIs present; small-sample warnings present; duplicates reported.
3. A reviewer can find, for each check, the **false positives/negatives with file names**.
4. The fraud-classifier section includes the held-out/different-seed evaluation, calibration, SHAP stability and the leakage statement.
5. Tests for the report's maths (Wilson interval, bootstrap, AUC, APCER/BPCER on a toy set) and for dataset-inventory duplicate detection.

## 4. Workstream C: camera UI redesign

### 4.1 Bigger camera frame
- Today: 520 px column, fixed 4:5 box, letterboxed video, shutter below the fold. Target:
  - **Phones (≤ 720 px wide): immersive camera.** Opening the camera makes the viewfinder fill the visible viewport (`100dvh`, safe-area insets respected), hiding the page header/stepper/mission brief while it is open. A close (✕) button returns to the page. The shutter, hint and a compact metrics strip are overlaid; the shutter is **always visible** (fixes the below-the-fold issue).
  - **Desktop / tablet: a large stage.** The Capture page widens (drop `.page--narrow` for the camera step), the viewfinder is sized to the **camera's own aspect ratio** (set from `videoWidth/videoHeight` once the stream starts, so there are no black bars) up to about `min(100%, 1100px)` wide and `80dvh` high; the **metrics panel sits beside the preview** (a right-hand column ~300 px) instead of covering it, collapsing under the preview on narrow screens.
  - Idle state (before the camera is opened) and the file-picker fallback keep a sensible size (≥ 4:3, never a tiny box).
  - After capture, the preview + checklist use the same larger layout.
- The face mesh and face box keep working with the new fit (they use `useContainFit`; if the preview becomes `object-fit: cover` on phones, the projection must account for cropping, otherwise keep `contain` and size the container to the stream aspect).
- Keep: HUD data contract, hint line, shutter behaviour, burst capture, `?hud=raw`.

### 4.2 Segmented green metric bars
Replace the continuous bars with **discrete segment meters**:
- **10 small segments per metric** (configurable constant `hud.segments = 10`), tightly spaced, small and rounded, in a row. The number of lit segments is `round(score × 10)` from the **smoothed** score (use the existing EMA output), so the bar rises and falls step by step as the value changes; a segment lights/unlights with a short (~120 ms) fade, no animation under `prefers-reduced-motion`.
- **Colour (default, see §7):** lit segments are **green**. When a metric's status is `warn`/`fail`, its lit segments turn **amber/red** so a bad reading never looks like a good one; unlit segments are dark grey. Brightness keeps its special "position" meaning: show the lit segment at the mean-luma position with the good-zone segments outlined/dimly green (so too dark and too bright are visibly out of zone).
- Threshold tick marks become **small notches between segments** at the warn/fail positions (same `ticks` data, mapped to segment indices); optional faint "peak hold" segment for the recent maximum can be added if it reads well, not required.
- Per-metric rows keep: label, the number (`46%`, `6°/s`, `σ 0.4`, `1920×1080`…), the segment meter, and the reason line. The overall "Live quality" becomes a larger **segmented meter (20 segments)** or a ring (decide visually; keep the number).
- **Accessibility:** each meter is `role="meter"` with `aria-valuemin/max/now` and the text value; colour is never the only status signal (status word/icon remains).
- Reuse, don't fork, the model: add a pure helper `toSegments(score, n, status)` and `segmentTicks(ticks, n)` in `lib/photoQuality/` with unit tests; `LiveHud.jsx` only renders.
- Add the Liveness row (and challenge prompt) to the HUD for face tasks.

### 4.3 Acceptance criteria (Workstream C)
1. At 390×844 (phone), 768×1024 (tablet), 1440×900 (desktop): the camera area is at least ~90% of the viewport width on phones, never has black side-bars from a 16:9 stream, the shutter is visible without scrolling, and the HUD never overlaps the shutter or covers the face.
2. Every metric row renders 10 segments; a scripted ramp (e.g. brightness 0→100%) lights segments monotonically; `aria-valuenow` matches; statuses colour correctly; reduced motion removes the fade.
3. Existing HUD e2e scenarios updated to the new markup still pass (selectors in `client/tools/e2e/hud-e2e.mjs`: `.hud`, `[data-metric]`, `.hud__value` etc. must be preserved or the harness updated in the same change).
4. Layout assertions (no overlap, shutter clickable and in viewport) at the three viewport sizes; screenshots attached to `progress.md`.

## 5. Task breakdown (do in this order; keep every suite green at each step; update `progress.md` after each milestone)

**Baseline first:** run the full client/backend/parity/e2e suites and record the numbers (expected above).

- **7a: Accuracy report foundation.** Dataset inventory + metrics library (Wilson, bootstrap AUC, confusion, threshold sweeps) with tests; report skeleton and `npm run report`; photo-quality checks section on current real+synthetic samples; fraud-classifier section.
- **7b: UI redesign.** `toSegments` helpers + tests; segmented meters; immersive/large camera layout; Liveness row placeholder; update e2e harness and run it. (Do this before liveness so the new prompt UI has a home.)
- **7c: Liveness core.** Enable blendshapes + transformation matrix in the landmarker wrapper; pure `face/liveness.js` state machine + tests; on-screen challenge UI; policy + `thresholds.json` keys; submit gating for required face tasks.
- **7d: Passive screen/print detection.** Moiré/bezel/flicker/planarity heuristics as pure functions with synthetic tests (a synthetic moiré grid, a drawn bezel, banded frames); wire into the live loop (face tasks) as evidence; Python port for the server re-check + parity test.
- **7e: Server evidence + nonce.** `POST /liveness/challenge`, DB table, evidence validation, new flags, tests; dashboard shows liveness result and evidence in the case file.
- **7f: Real-sample evaluation.** With the user's `live_selfies/` + `spoof_*` folders: run the PAD evaluation, add the Liveness section to the report (APCER/BPCER/ACER with CIs), tune thresholds *from that evidence only*, decide block-vs-flag defaults, and (optionally) evaluate a pre-trained ML PAD model (§2.3 layer 3).
- **7g: Verify + document.** All suites, e2e (incl. a spoof scenario), screenshots, `progress.md` results, `README.md`, memory file.

## 6. Test strategy notes
- **Pure-first:** liveness challenges, segment mapping, report maths, passive heuristics are pure functions with unit tests (Node). Real MediaPipe only runs in Chrome (headless works, see Phase 3/6 notes).
- **E2E with the fake camera:** existing recipe in `iteration-2.md` §4 and `client/tools/e2e/`. Synthetic spoof streams (a face image with a drawn bezel/moiré/banding) can test that the heuristics *fire*, but they **cannot prove real-world accuracy**; only the user's real spoof captures can. A fake-camera stream cannot blink: test the challenge logic with scripted timelines, and, for the full-stack path, inject a mock landmarker output in the page for the e2e (clearly labelled as a mock).
- Run a second dev server on `127.0.0.1:5173` with its own `cacheDir` (recipe in `iteration-2.md` §4); never use the user's servers.

## 7. Decisions made on the user's behalf (veto any)
1. **Green bars:** lit segments are green, turning amber/red when the metric is in a warn/fail state (so "too dark" cannot look good). If the user wants strictly-green always, drop the colour change and rely on the status word/icon.
2. **10 segments** per metric, 20 for the overall meter.
3. **Liveness blocks only `face: required` tasks**; `optional` flags; `off` untouched. Active challenge = 2 random actions out of blink / turn head / smile / open mouth.
4. **No ML PAD model is added** unless the evidence in §3 says it beats the heuristic + challenge approach.
5. The accuracy report is a **Markdown + JSON file** (not a dashboard page); an HTML artifact only on request.
6. Phone testing stays out of scope (as decided earlier), but the immersive layout is designed for phone viewports and tested at phone-sized viewports in headless Chrome.

## 8. Risks / things to flag honestly in the results
- PAD without a trained model has real error rates; report them, don't hide them. Challenge-response stops photos and most casual replays, not virtual-camera injection.
- The spoof/live samples must be collected with consent; faces are personal data (storage, retention, review access).
- Face and PAD models can perform unequally across skin tones, lighting and head coverings; the report must say which slices were and were not measured.
- Heavier per-frame work (FFT/contours/landmark timeline) must stay inside the existing budget (UI-thread cost per tick ≤ 50 ms; measured with `?hud=raw`); offload to the worker if not.
- The immersive layout changes page structure: re-test the file-picker fallback and the result/checklist screens.
