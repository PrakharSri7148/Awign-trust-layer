# Edge Validator — Iteration 2: Live metrics on the camera

Date: 2026-10-07
Status: **planned, not started.** Phases 0–5 (see `progress.md`) are complete; this iteration adds **Phase 6**.
Audience: the engineer / subagent who will build it. Everything needed is below; read `README.md` and `progress.md` first for how the current system works.

## 1. What changed since iteration 1

- **Added:** a live metrics HUD on the in-app camera (this document).
- **Dropped from scope (decision, 2026-10-07):** testing on a physical iPhone/Android. It is no longer a "next step". Keep the existing honest note in `progress.md` that the camera has only been exercised with Chrome's fake camera, but do not plan work around it.
- **Unchanged and still pending on the user:** uploading real worker photos to `samples/` and running `npm run calibrate`; the face-blocking policy decision. Do not change any threshold in `thresholds.json` as part of this work.

## 2. The feature

While the worker is framing a shot, the camera screen shows the quality metrics **live**, as numbers and bars, so the system feels alive and the worker can see exactly what to fix: a brightness percentage, a focus percentage, and all 8 quality parameters, plus one overall live quality percentage.

```
┌───────────────────────────────────────────┐
│ ● LIVE                          Metrics ▾ │   toggle (remembered per device)
│                                           │
│            (camera preview)               │
│                 ┌─────┐ face 92%          │   face box already exists
│                 └─────┘                   │
│  Hold still.                              │   headline hint (already exists)
│ ┌───────────────────────────────────────┐ │
│ │ Live quality 74%   ◔                  │ │   overall ring
│ │ Brightness   46% ▕▓▓▓▓▓░░░░░▏  ok     │ │
│ │ Focus        78% ▕▓▓▓▓▓▓▓░░░▏  ok     │ │
│ │ Lens         clear   ▕▓▓▓▓▓▓▓▓▓▓▏ ok   │ │
│ │ Glare        0.4%  ▕▓░░░░░░░░░▏  ok    │ │
│ │ Steadiness   6°/s  ▕▓▓░░░░░░░░▏  ok    │ │
│ │ Noise        σ 2.1 ▕▓▓░░░░░░░░▏  ok    │ │
│ │ Resolution   1920×1080 ▕▓▓▓▓▓▓▓▓▏  ok  │ │
│ │ Face         92% · 21% of frame  ok    │ │   only on face tasks, else "off"
│ │ Compression  checked when you capture  │ │
│ └───────────────────────────────────────┘ │
│               ( shutter )                 │
└───────────────────────────────────────────┘
```

### 2.1 The metrics (what is shown, how it is computed, what it costs)

The 8 quality parameters are the 8 checks in `client/src/lib/photoQuality/checks/`. Live, each gets a **value**, a **0–100% bar**, a **status** (`pass`/`warn`/`fail`, same colours as the existing chips) and **tick marks at its warn/fail thresholds**.

| # | Parameter | Shown as | Computed from (reuse, do not reimplement) | Cost on a 480×270 preview |
|---|---|---|---|---|
| – | **Brightness** (explicitly requested) | `46%` = mean luma ÷ 255, plus clipped-highlights % | `exposureMetrics(gray)` in `checks/exposure.js` | 3 ms |
| 1 | **Blur / focus** (explicitly requested as "% ") | `78%` (see mapping below) | `blurMetrics(...)` in `checks/blur.js` | 25 ms |
| 2 | **Exposure** (too dark / over) | folded into the Brightness row: the bar has a good-zone band; status from `checkExposure` | same call as Brightness | – |
| 3 | **Glare** | `0.4%` of frame blown out (soft-halo blob area) | `glareMetrics(frame, {…THRESHOLDS.glare, cell: live.glareCell})` + `glareStatus` | 1 ms |
| 4 | **Resolution** | `1920×1080` + megapixels | `video.videoWidth/Height` (exact, free) against `thresholds.resolution` tiers | 0 ms |
| 5 | **Lens covered** | `clear` / `partly 18%` / `covered` | `obstructionMetrics(frame)` in `checks/obstruction.js` | 2 ms |
| 6 | **Noise / compression** | `σ 2.1` grey levels | `noiseSigma` on a **256×256 crop read at the video's native resolution** (preview-size also works, 6.14 vs 6.03 true σ=6, but the native crop matches what the capture check measures) | 3 ms |
| 7 | **Shake / steadiness** | `6°/s` gyro rotation (RMS over the last 400 ms); "no sensor" if none | `sensorShake(buf.recent(400))` in `checks/shakeSensor.js` | 0 ms |
| 8 | **Face** | confidence `92%` and `21% of frame height`; "off" when the task has no face; "searching…" before the first detection | `evaluateFace` result already computed every 3rd tick | 0 ms (detector is the existing cost) |

Honest limits to show in the UI (not hide):
- **JPEG compression cannot be measured on a live video stream** (there are no JPEG blocks in it). The Noise row measures noise only; show a muted "Compression: checked when you capture" line so the noise/compression parameter (#6) is fully accounted for. (Compression is not a ninth parameter: the 8 are blur, exposure, glare, resolution, obstruction, noise/compression, shake, face).
- **Focus % is a relative score, not a physical unit.** One definition, used for both the number and the bar and the overall: `focusScore = ramp(blurScore, 0.05, focusFull)` and `focusPct = focusScore × 100`, with `focusFull = live.hud.focusFull = 0.40` (new constant). Evidence for 0.40: at **preview size (480 px)** the sharp originals scored 0.477 (wall), 0.399 (china) and 0.426 (flower) in the Phase 4 measurement; capture-size (1280 px) sharp photos score 0.30–0.42 (`README.md`). Re-measure sharp preview scores from the fake camera in Phase 6b and adjust `focusFull` only if they disagree. Ticks sit at the **live** thresholds mapped through the same ramp: `live.blurBad` 0.20 → 43%, `live.blurSoft` 0.28 → 66%. **The live thresholds (0.20/0.28) are deliberately more lenient-to-cautious than the capture thresholds (0.14/0.21) because the metric is coarser at preview size; document this in the HUD note so amber live + pass at capture is not a surprise.** Label it "Focus", never "sharpness in %" or "accuracy".
- **Flat scene:** `blurMetrics` returns `score == null` (nothing to judge). Show "—" with a muted bar, status `pass`, and **exclude the row from the overall**.
- At 480 px the blur metric only separates **gross** blur (measured in Phase 4). The live numbers are guidance; the full check on the captured photo remains the authority. Add a one-line note in the expanded HUD: "Live numbers are a quick estimate; your photo is fully checked after capture."
- Brightness % is mean luma, so a legitimately bright or dark scene reads high/low. The good zone is derived from the existing exposure thresholds: dark warn `darkMeanWarn` 65 → 25%, over warn `overMeanWarn` 210 → 82%.

(The overall and the per-row scores are defined precisely in §2.3.)

### 2.2 Behaviour

1. **Update rate:** ≤ 5 Hz (the existing 200 ms tick). Never faster; numbers that change every frame are unreadable.
2. **Smoothing:** displayed numbers use an exponential moving average (α ≈ 0.4) so a static scene doesn't jitter. Acceptance: on a static stream, no displayed percentage varies by more than ±3 points after warm-up (≈1 s).
3. **Status hysteresis:** a status changes only after 2 consecutive ticks agreeing, so chips and bars don't flicker at a threshold. (The existing `createReadyTracker` already debounces "ready"; extend the same idea per metric.)
4. **Colours:** reuse `.live__chip--pass/warn/fail` semantics (green/amber/red). Bars have tick marks at warn/fail. Respect `prefers-reduced-motion` (no bar transitions).
5. **Toggle:** a "Metrics" button collapses/expands the panel. Default **expanded** on viewports ≥ 600 px wide, **compact** (overall ring + the 8 status dots/values in a 2-column grid) below that. Remember the choice in `localStorage` inside try/catch (it can throw); the UI must work without it.
6. **Layout (existing CSS):** today `.live__chips` is at the top, `.live__hint` at `bottom: 92px` and `.live__shutter` at `bottom: 16px` (`styles/global.css`). In the **expanded** HUD the existing 6 chips are **replaced** by the HUD rows (they carry the same statuses); in **compact** mode the chips stay as they are and only the ring + values are added. The HUD panel sits **above the headline hint**, which moves up with it; it must not overlap `.live__hint` or `.live__shutter`. **Never block the shutter:** the panel sits above the shutter, ≤ 45% of the viewfinder height, `pointer-events` only on its toggle. The existing hint line and face box stay.
7. **Face row:** states and the miss counter are defined in §2.3 ("Undefined states").
8. **Accessibility:** the numbers are not an `aria-live` region (it would spam screen readers 5×/s). Only the headline hint keeps `role="status"`. The panel is a labelled group; each row exposes `value, status` as text, not colour alone.
9. **After capture:** the result checklist (`QualityChecklist.jsx`) should show each check's value in the same format as the HUD (e.g. "Focus 82%", "Brightness 46%") so the live and final numbers can be compared. Brightness is not a separate check, so show it in the *Lighting* row.
10. **Developer view:** `?hud=raw` (query string) shows the raw numbers underneath each row (blur score, σ, glare area, mean luma, rotation RMS). It is for calibration/debugging and costs nothing; default off.

### 2.3 Technical design

- **`client/src/lib/photoQuality/liveMetrics.js` (new, pure, no DOM):** `computeLiveMetrics(inputs, prev)` → `{ metrics, overall, state }` where `inputs` = the metrics `analyzeLive` has **already computed** (`{ exposure, blur, lens, glare, face, resolution, noise, steady }`, see below) so **no pixel metric is computed twice** (the tick budget is ~31 ms; recomputing would double it). `prev` is the previous `state` (EMA values, per-metric hysteresis counters, the face miss counter); state is immutable in/out so it is unit-testable.
- **`analyzeLive` stays byte-compatible:** it keeps returning `checks`, `clean`, `hint`, `hintId` exactly as today (the 6 chip ids Lens/Light/Face/Steady/Focus/Glare, Face only on face tasks, and `createReadyTracker` depend on them; `camera.test.js` covers the shape and must pass unchanged). It computes each pixel metric once, passes the raw results to `computeLiveMetrics`, and adds `metrics` and `overall` to its return.
- **Metric shape (every row):** `{ id, label, value, display, unit, pct, score, status, reason, ticks, raw }`.
  - `pct` = **bar fill 0–100 = `score × 100`** for every row (so the bar always means "how good", full = good; this also makes the bars consistent with the overall). `display` is the natural-unit text (`46%`, `6°/s`, `σ 2.1`, `0.4%`, `1920×1080`).
  - `ticks` marks where status changes, **in bar (`pct`) coordinates**, and is two-sided where the metric is: `{ warn: number | [lo, hi], fail: number | [lo, hi] } | null`.
  - `reason` = a short text for *why* a status is not pass when the display alone doesn't show it (e.g. "highlights clipped 18%", "acceleration 2.1 m/s²").
- **Per-row definitions** (`score` uses the matching check's `ramp` ranges from `schema.js`, except Focus which is defined above):

  | Row | `display` | `score` / `pct` | Tick positions | `reason` examples |
  |---|---|---|---|---|
  | Brightness | mean luma ÷ 255 as `%`, plus clipped % | `checkExposure`'s score | two-sided: dark fail/warn at mean 40/65 → 15.7%/25.5% of luma; over warn/fail 210/235 → 82.4%/92.2% (drawn on a luma axis band, not the score axis: this row's bar is a **position** bar with a green good-zone between 25.5% and 82.4%; document this exception) | "highlights clipped 18%", "washed out" (flat range) |
  | Focus | `78%` | `focusScore` | 43% / 66% | – |
  | Lens | `clear` / `partly 18%` / `covered` | `checkObstruction`'s score | warn 10%, fail 35% of frame area | – |
  | Glare | `0.4%` of frame | `ramp(area (soft ? area : area×0.4), failArea×1.5, 0)` as in `checkGlare` | warn 1%, fail 4% | "hard-edged white area" |
  | Steadiness | `6°/s` | `sensorShake().score` | rot warn/fail 25/60 °/s | **"acceleration 2.1 m/s²" when status comes from acceleration** (`sensorShake` also reacts to accel 1.2/3.0 m/s²; the row must never read "warn" with no visible reason) |
  | Noise | `σ 2.1` | `ramp(σ, sigmaFail+5, 1)` as in `checkNoise` | σ 5 / 10 | – |
  | Resolution | `1920×1080` (+ MP in raw) | `ramp(MP, 0.3, 2)` as in `checkResolution` | tiers: fail short side <480 or long <640, warn <0.75 MP | – |
  | Face | `92% · 21%` (confidence · height of frame) | `evaluateFace` score | confidence 50/70, height 8/15 | the face problem hint |
- **Undefined states (must be implemented and tested):**
  - **Face:** `off` (task has no face) and `searching…` (no detection yet) have no score and are **excluded from the overall**. `evaluateFace` returns FAIL/score 0 on the *first* empty detection list and detections run every 3rd tick (~0.6 s), so show "searching…" until `prev.faceMisses ≥ 3` consecutive empty results, then "not found" (amber on `optional`, red on `required`, scored 0 and included). The miss counter lives in `state`; a detection resets it.
  - **Focus on a flat scene:** see above (excluded). **Steadiness with no sensor / <3 samples:** `display` "no sensor", excluded from the overall. **Compression:** never part of the overall.
- **Overall live quality %** is `combineScores` (0.5·min + 0.5·mean) over the included rows' scores. It is the *live* overall: because Focus uses the live ramp it can differ slightly from the capture report's `qualityScore`; that is expected and said in the HUD note. Add a **shared fixture test** that `combineScores([0.2, 0.6, 1.0])` equals the same value in `backend/tests` (`policy.aggregate` quality), and a comment in both `policy.js` and `policy.py` pointing at each other, so the two definitions cannot drift.

- **`LiveCamera.jsx`:** each tick, additionally (a) read a 256×256 centre crop from the video at native resolution (`drawImage(video, sx, sy, 256, 256, 0, 0, 256, 256)` into a **second, dedicated 256×256 canvas** created once with `willReadFrequently: true`, reusing one `ImageData`/`Float32Array` per tick; **do not reuse `readSmall`'s canvas**, which is resized on every call and resets its context; every 2nd tick); convert to gray, pass as `nativeCrop`. The 3 ms figure covers `noiseSigma` only: measure the whole crop path (`drawImage` from a video that can be up to 3840×2160 + `getImageData`) in 6b and record it; (b) pass `video: { width: v.videoWidth, height: v.videoHeight }`; (c) hold the smoothing state in a `useRef`; (d) render `<LiveHud … />`.
- **`components/capture/LiveHud.jsx` (new):** presentational only. Rows from `metrics`, ring for `overall`, toggle, `?hud=raw` handling. Styles in `styles/global.css` using existing tokens (`--green`, `--amber`, `--red`, `--text-dim`, `.num` for tabular figures).
- **Thresholds/constants:** add a `live.hud` block to `thresholds.json` (`ema: 0.4`, `hysteresisTicks: 2`, `focusFull: 0.40`, `nativeCrop: 256`, `cropEvery: 2`, `faceMissesBeforeNotFound: 3`). Add them to the threshold table in `edge-validator/README.md`. **No existing threshold changes.**
- **Performance budget:** one live tick (all metrics) ≤ 50 ms on a mid-range laptop CPU, measured in Chrome. Today the pixel part is ~31 ms (blur 25 ms). If the p95 tick time exceeds 50 ms after adding the HUD, move the pixel metrics into the existing worker (`worker.js`; add a `type: 'live'` message that takes the small frame and returns metrics; face stays on the main thread). Measure first; do not offload speculatively.
- **No server/backend changes.** Live metrics are display-only and are not sent anywhere. JS↔Python parity is unaffected (live metrics are client-only); `node tools/parity.mjs` must still show 100%.

## 3. Tasks (do in this order; keep all tests green at each step)

**Baseline before you start:** `cd client && npm test` → 84 passing; `cd backend && .venv/bin/python -m pytest -q` → 50 passing (takes ~2 min); `node tools/parity.mjs` → 100%.

### Phase 6a — Metrics model (pure, tested first)
- [ ] Extract `combineScores(scores)` (0.5·min + 0.5·mean) used by both `policy.js` and the live overall; leave behaviour identical (existing policy tests must pass unchanged).
- [ ] Write `liveMetrics.js` per §2.3, including EMA + hysteresis state and the focus/brightness mappings in §2.1.
- [ ] Add `live.hud` constants to `thresholds.json` and the README threshold table.
- [ ] Tests (`client/src/lib/photoQuality/liveMetrics.test.js`): sharp scene → all pass and plausible values; dark → brightness % < 25 and `fail`; heavy blur → focus % low; noise σ=6 added → noise row shows ≈6 (±1) and `warn`; covered lens → lens `fail`; synthetic motion samples → steady shows RMS °/s; face off/searching/found/not-found states; resolution tiers (640×360 fail, 960×640 warn, 1920×1080 pass); EMA converges and damps jitter (±3 points on a noisy static input); hysteresis needs 2 ticks to flip; overall equals `combineScores` of the metric scores; compression is reported as `n/a` and excluded from the overall.

### Phase 6b — Wire inputs in the camera
- [ ] `LiveCamera.jsx`: native-resolution 256×256 crop every 2nd tick, video dimensions, smoothing state ref; keep the burst/capture path exactly as is.
- [ ] Measure tick time in Chrome (see §4); record p50/p95 in `progress.md`. Offload to the worker only if p95 > 50 ms.

### Phase 6c — The HUD
- [ ] `LiveHud.jsx` + CSS: ring, 8 rows (+ compression note), threshold ticks, toggle with `localStorage` try/catch, compact mode on narrow screens, `?hud=raw`, reduced-motion, accessible text.
- [ ] Make sure the panel never covers the shutter or the hint, at 420 px and 1440 px widths.

### Phase 6d — Consistency after capture
- [ ] `QualityChecklist.jsx`: show each check's value in the same format as the HUD via one shared `formatMetric(checkId, check)` in `lib/format.js` (with a unit test per row). Value sources (the reports are not uniform, so the helper must read these exact fields):
  | Check | Display from |
  |---|---|
  | blur | `value` (null on a flat scene → "—"), as `focusPct` with the same ramp |
  | exposure | `value` = mean luma → `%` of 255; `details.clippedFrac` |
  | resolution | `details.width × details.height` (`value` is megapixels) |
  | noise | `value` = σ → `σ 2.1` |
  | obstruction | `value` = area → `clear` / `partly N%` / `covered` (`details.fullCover`) |
  | glare | `value` = area → `N%` |
  | shake | `details.sensor.rotRms` → `°/s`, else "no sensor" (absent for file picks); image `value` is the anisotropy ratio |
  | face | `details.score` (confidence) and `details.heightFrac`; `value` is only the height |
  Also unify the ring's "Live quality NN%" and the checklist's "quality NN/100" format in this helper.

### Phase 6e — Verify, document
- [ ] End-to-end in headless Chrome with the fake camera (recipe in §4). Cases and expected readings:
  - good stream → all rows `pass`; brightness within ±5 points of `meanLuma/255` of the source image; focus % ≥ 70%; noise σ < 1.5; resolution `1920×1080`; steady shows the injected °/s; Compression note present; no jitter > ±3 points over 3 s after warm-up.
  - dark stream with source mean luma < 40 → brightness < 16% and red (`fail`), hint "Too dark…"; a stream with mean luma 40–65 → `warn` (amber).
  - blurred stream → focus % < 50% and red/amber; noisy stream (σ≈10 added to the MJPEG frames) → noise `warn`/`fail` with σ ≈ 10 ± 2.
  - covered-lens stream → lens row not `clear`.
  - shaky motion (inject `devicemotion` with rotationRate 90) → steady `fail`, number ≈ 156°/s for the injected values.
  - face stream with `Selfie check-in` → face row shows confidence and size; with `Shelf / site photo` → "off".
  - toggling Metrics collapses/expands and persists across reload; shutter still works and the burst still picks the sharp frame (reuse the "alternating" stream; expect ≥ 10 of 12 runs).
  - **layout assertion** at 420×900 and 1440×900: via `getBoundingClientRect()`, the HUD panel does not intersect `.live__hint` or `.live__shutter`, and the shutter is clickable (`elementFromPoint` at its centre returns the shutter);
  - no browser console errors; `npm run build` passes.
- [ ] Update `progress.md` (Phase 6 section: what was built, measured numbers, bugs found, limits) and tick the boxes above. Update `README.md` in this folder (HUD, `?hud=raw`, new threshold keys).
- [ ] Final run: client tests (≥ 84 + new), backend tests (50), parity 100%.

## 4. Test harness recipe (the scratch scripts from earlier phases were deleted; recreate what you need)

- **Browser:** `puppeteer-core` driving `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `headless: 'new'`. **Do not run `npm install` inside `client/` while the user's Vite (5174) is up**: it rewrites `node_modules`, which can trigger dependency re-optimisation and page reloads for the user (and a later install prunes a `--no-save` package). `puppeteer-core` currently happens to be present in `client/node_modules` (not in `package.json`); preferably install it in a scratch directory (`npm install --prefix <scratch> puppeteer-core`) and import it by absolute path.
- **Fake camera:** launch Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=/path/stream.mjpeg`. An `.mjpeg` file is just JPEG frames concatenated (`Buffer.concat(Array(30).fill(jpegBytes))`); a stream alternating blurry/sharp frames is `i % 5 === 4 ? sharp : blurry`. Encode frames at JPEG quality ≥ 97 (lower quality adds compression artifacts that trigger the noise/compression warning). Build frames with `client/src/lib/photoQuality/testing/synth.js` (`sceneGray`, `boxBlur`, `addNoise`, `adjust`, `paintRect`, `mapChannels`, `toRgba`) and `testing/nodeEnv.js` (`encodeImage`). Face frames: `testing/fixtures/astronaut.png` centred in a 1920×1080 canvas.
- **Fake motion:** `setInterval(() => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: r, beta: r, gamma: r }, acceleration: { x: a, y: a, z: a }, interval: 16 })), 16)`. RMS rotation = r·√3.
- **Isolated backend + frontend for submissions** (never use the user's servers): `TRUST_LAYER_DB=<tmp>/e2e.db PHOTO_DIR=<tmp>/uploads backend/.venv/bin/uvicorn main:app --port 8001` and `VITE_API_URL=http://localhost:8001 npx vite --port 5173 --strictPort --config <tmp>/vite.e2e.config.js` where that config re-exports `client/vite.config.js` with `cacheDir` set **outside the repo** (a second Vite from the same `client/` otherwise shares `node_modules/.vite` with the user's server), then browse `http://127.0.0.1:5173/` (**use 127.0.0.1**: `localhost:5173` on this machine is another project). HUD-only checks don't need a backend at all.
- **Measuring UI stalls:** a 5 ms `setInterval` gap recorder is only correct if you `await` a ~40 ms timeout *before* reading the gaps (otherwise the stall is recorded after you've read it). `requestAnimationFrame` gaps in headless Chrome are not trustworthy.
- **Time one live tick:** `performance.now()` around the whole tick inside `LiveCamera`'s interval (temporary `console.debug`, remove or keep behind `?hud=raw`), collect ~100 ticks, report p50/p95.

## 5. Pitfalls already hit in this codebase (do not repeat)

- React **StrictMode** runs effects twice in dev: any `getUserMedia`/stream start must be cancellable (see the `attempt` ref in `LiveCamera.jsx`). Don't add effects that start work without a cancel path.
- Vite does a **full page reload the first time it discovers a lazily imported dependency** (e.g. `@mediapipe/tasks-vision`) in a fresh cache; retry once in scripts.
- The port **5173 on `localhost` belongs to another project**; the user's own servers are on **8000 (backend, `--reload`) and 5174 (Vite)**. Don't kill or POST to them; their database must not receive test submissions.
- Don't derive thresholds from small samples or change them here; they are calibrated later with real photos.
- Percentile code strides large arrays (`stats.js`); keep new per-tick code allocation-light (reuse typed arrays) because it runs 5×/s.
- `checkResult`/`ramp` live in `schema.js`; the Python port in `backend/photo_quality/` mirrors the JS checks exactly. This iteration must not change check logic, so no Python changes are expected. If you do touch a check, you must port it and re-run parity.

## 6. Decisions I made so you don't have to ask (the user can veto)

- Percentages shown are **Brightness %** (mean luma) and **Focus %** (relative score) with the definitions above; other metrics show their natural unit (°/s, σ, % of frame, pixels).
- **Compression is shown as "checked when you capture"** because it cannot be measured live.
- HUD is expanded on wide screens, compact on narrow ones, user-toggleable; raw numbers behind `?hud=raw`.
- No change to thresholds, the server, the database or the classifier.


---

## 7. Addendum (2026-10-07, after the first Phase 6 delivery): face mesh overlay + Steadiness fix

### 7.1 Face mesh ("dots analysis") overlay
Requested with a reference image: when a face is on the camera, draw a **face-analysis mesh over it: glowing blue dots at key facial points (brow ends and middles, eye corners, nose bridge/tip/nostrils, cheeks, mouth corners and centre, jaw and chin) joined by thin white lines forming a triangulated network**, like the reference.
- **Model:** MediaPipe **FaceLandmarker** (478 landmarks), `public/mediapipe/face_landmarker.task` (3.7 MB, hosted locally like the other model, loaded lazily, only for tasks with `face` ≠ `off`). The existing BlazeFace detector keeps doing the scoring; the landmarker only draws.
- **Which points:** a curated set of ~28 landmark indices and ~45 edges (`face/meshGraph.js`), not all 478 (the reference is sparse). The graph is data, unit-tested (indices in range, edges only between defined dots, no duplicate edges, symmetric left/right).
- **Rendering:** a `<canvas>` over the preview (`components/capture/FaceMesh.jsx`), drawn every animation frame with the points **interpolated** toward the newest landmarks (the landmarker itself runs ~8×/s), white glowing lines, blue dots with a white ring, a short fade-in when a face appears and fade-out when lost. Mirrored for the front camera. Colour stays blue; problems are still reported by the Face row and hint.
- **Cost:** landmarker runs on its own ~120 ms loop with a busy guard (never queued), face tasks only; must not push the UI-thread tick cost above the 50 ms budget (re-measure).
- **Limits:** CPU/WASM; not run on a physical phone; one face (the largest).

### 7.2 Steadiness fix
Diagnosis: the row read **"no sensor"** whenever the device exposes no `rotationRate`/linear `acceleration` (every laptop; phones over plain HTTP; browsers that only give `accelerationIncludingGravity`). So it was *configured* but had nothing to measure.
- **Image-based motion (works on any camera):** compare consecutive live frames (160×90 thumbnails, global shift by block matching with sub-pixel refinement) → camera motion as **% of frame width per tick (200 ms)**. New thresholds `shake.optical: { warnPct, failPct }` (starting values, uncalibrated).
- **Sensor path improved:** use `accelerationIncludingGravity` with gravity removed (low-pass) when linear `acceleration` is missing; keep gyro `rotationRate`.
- **Row logic:** sensor and optical are combined as the *worse of the two*; display = sensor °/s when a sensor exists, otherwise `motion N%`; the `reason` says which one is driving a warning ("image moving", "acceleration …"). The row is only "no sensor" if neither exists, which can no longer happen once two frames have been seen ("measuring…" before that).
- Tests: synthetic shifted frames (known pixel shift → known %), static scene → ~0, sensor-only, optical-only, both; e2e with a moving fake camera stream.
- Capture-time `shake` check is unchanged (image anisotropy + the sensor window).
