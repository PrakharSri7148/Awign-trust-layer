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
- **JPEG compression cannot be measured on a live video stream** (there are no JPEG blocks in it). The Noise row measures noise only; show a muted "Compression: checked when you capture" line so the 8th parameter is accounted for.
- **Focus % is a relative score, not a physical unit.** Definition: `focusPct = clamp(blurScore / 0.40) × 100`, where 0.40 is roughly what a sharp photo scores at preview size; tick marks at `live.blurBad` (0.20 → 50%) and `live.blurSoft` (0.28 → 70%). Label it "Focus", never "sharpness in %" or "accuracy".
- At 480 px the blur metric only separates **gross** blur (measured in Phase 4). The live numbers are guidance; the full check on the captured photo remains the authority. Add a one-line note in the expanded HUD: "Live numbers are a quick estimate; your photo is fully checked after capture."
- Brightness % is mean luma, so a legitimately bright or dark scene reads high/low. The good zone is derived from the existing exposure thresholds: dark warn `darkMeanWarn` 65 → 25%, over warn `overMeanWarn` 210 → 82%.

**Overall live quality %** = the same formula as the capture report's `qualityScore` (0.5 × worst + 0.5 × mean of the per-metric 0–1 scores), computed from the live scores. Reuse `aggregate`'s formula from `policy.js` (extract a small `combineScores(scores)` helper so there is one definition; the backend's `policy.py` already duplicates it, keep both identical).

Per-metric 0–1 scores for the bars: use the `score` each existing check already derives with `ramp()` (see `schema.js`). For metrics the live path computes with `*Metrics()` functions directly, call the same `ramp` ranges as the matching `check*` function. Do not invent new ranges.

### 2.2 Behaviour

1. **Update rate:** ≤ 5 Hz (the existing 200 ms tick). Never faster; numbers that change every frame are unreadable.
2. **Smoothing:** displayed numbers use an exponential moving average (α ≈ 0.4) so a static scene doesn't jitter. Acceptance: on a static stream, no displayed percentage varies by more than ±3 points after warm-up (≈1 s).
3. **Status hysteresis:** a status changes only after 2 consecutive ticks agreeing, so chips and bars don't flicker at a threshold. (The existing `createReadyTracker` already debounces "ready"; extend the same idea per metric.)
4. **Colours:** reuse `.live__chip--pass/warn/fail` semantics (green/amber/red). Bars have tick marks at warn/fail. Respect `prefers-reduced-motion` (no bar transitions).
5. **Toggle:** a "Metrics" button collapses/expands the panel. Default **expanded** on viewports ≥ 600 px wide, **compact** (overall ring + the 8 status dots/values in a 2-column grid) below that. Remember the choice in `localStorage` inside try/catch (it can throw); the UI must work without it.
6. **Never block the shutter:** the panel sits above the shutter, ≤ 45% of the viewfinder height, `pointer-events` only on its toggle. The existing hint line and face box stay.
7. **Face rows:** on tasks with `face: off`, the Face row reads "off" (muted). On `optional`/`required` tasks show confidence + size once a face is found, "searching…" until then, and "not found" (amber/red per task) after 3 consecutive empty detections.
8. **Accessibility:** the numbers are not an `aria-live` region (it would spam screen readers 5×/s). Only the headline hint keeps `role="status"`. The panel is a labelled group; each row exposes `value, status` as text, not colour alone.
9. **After capture:** the result checklist (`QualityChecklist.jsx`) should show each check's value in the same format as the HUD (e.g. "Focus 82%", "Brightness 46%") so the live and final numbers can be compared. Brightness is not a separate check, so show it in the *Lighting* row.
10. **Developer view:** `?hud=raw` (query string) shows the raw numbers underneath each row (blur score, σ, glare area, mean luma, rotation RMS). It is for calibration/debugging and costs nothing; default off.

### 2.3 Technical design

- **`client/src/lib/photoQuality/liveMetrics.js` (new, pure, no DOM):** `computeLiveMetrics(frame, { motion, face, video, nativeCrop, task, prev })` → `{ metrics: { brightness, focus, lens, glare, steady, noise, resolution, face }, overall, hint }`. Each metric: `{ id, label, value, display, unit, pct (0–100), score (0–1), status, hint, ticks: { warn, fail } | null, raw }`. `prev` carries the EMA/hysteresis state (immutable in, new state out, so it is unit-testable).
- **Extend, don't fork, `live.js`:** `analyzeLive` keeps returning `checks`, `clean`, `hint`, `hintId` (the existing chips and `createReadyTracker` depend on them); add `metrics` and `overall` to its return by calling `computeLiveMetrics`. The existing 5 chips + face stay as they are.
- **`LiveCamera.jsx`:** each tick, additionally (a) read a 256×256 centre crop from the video at native resolution (`drawImage(video, sx, sy, 256, 256, 0, 0, 256, 256)`; do it every 2nd tick to save time), convert to gray, pass as `nativeCrop`; (b) pass `video: { width: v.videoWidth, height: v.videoHeight }`; (c) hold the smoothing state in a `useRef`; (d) render `<LiveHud … />`.
- **`components/capture/LiveHud.jsx` (new):** presentational only. Rows from `metrics`, ring for `overall`, toggle, `?hud=raw` handling. Styles in `styles/global.css` using existing tokens (`--green`, `--amber`, `--red`, `--text-dim`, `.num` for tabular figures).
- **Thresholds/constants:** add a `live.hud` block to `thresholds.json` (`ema: 0.4`, `hysteresisTicks: 2`, `focusFullScale: 0.40`, `nativeCrop: 256`, `cropEvery: 2`). Add them to the threshold table in `edge-validator/README.md`. **No existing threshold changes.**
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
- [ ] `QualityChecklist.jsx`: show each check's value in the same format as the HUD (a small `formatMetric(check)` helper in `lib/format.js` shared by both, with a unit test).

### Phase 6e — Verify, document
- [ ] End-to-end in headless Chrome with the fake camera (recipe in §4). Cases and expected readings:
  - good stream → all rows `pass`; brightness within ±5 points of `meanLuma/255` of the source image; focus % ≥ 70%; noise σ < 1.5; resolution `1920×1080`; steady shows the injected °/s; Compression note present; no jitter > ±3 points over 3 s after warm-up.
  - dark stream → brightness < 25% and red, hint "Too dark…".
  - blurred stream → focus % < 50% and red/amber; noisy stream (σ≈10 added to the MJPEG frames) → noise `warn`/`fail` with σ ≈ 10 ± 2.
  - covered-lens stream → lens row not `clear`.
  - shaky motion (inject `devicemotion` with rotationRate 90) → steady `fail`, number ≈ 156°/s for the injected values.
  - face stream with `Selfie check-in` → face row shows confidence and size; with `Shelf / site photo` → "off".
  - toggling Metrics collapses/expands and persists across reload; shutter still works and the burst still picks the sharp frame (reuse the "alternating" stream; expect ≥ 10 of 12 runs).
  - no browser console errors; `npm run build` passes.
- [ ] Update `progress.md` (Phase 6 section: what was built, measured numbers, bugs found, limits) and tick the boxes above. Update `README.md` in this folder (HUD, `?hud=raw`, new threshold keys).
- [ ] Final run: client tests (≥ 84 + new), backend tests (50), parity 100%.

## 4. Test harness recipe (the scratch scripts from earlier phases were deleted; recreate what you need)

- **Browser:** `puppeteer-core` driving `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `headless: 'new'`. Install with `npm install --no-save puppeteer-core` (it is **not** in `package.json`; any later `npm install` removes it).
- **Fake camera:** launch Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=/path/stream.mjpeg`. An `.mjpeg` file is just JPEG frames concatenated (`Buffer.concat(Array(30).fill(jpegBytes))`); a stream alternating blurry/sharp frames is `i % 5 === 4 ? sharp : blurry`. Encode frames at JPEG quality ≥ 97 (lower quality adds compression artifacts that trigger the noise/compression warning). Build frames with `client/src/lib/photoQuality/testing/synth.js` (`sceneGray`, `boxBlur`, `addNoise`, `adjust`, `paintRect`, `mapChannels`, `toRgba`) and `testing/nodeEnv.js` (`encodeImage`). Face frames: `testing/fixtures/astronaut.png` centred in a 1920×1080 canvas.
- **Fake motion:** `setInterval(() => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: r, beta: r, gamma: r }, acceleration: { x: a, y: a, z: a }, interval: 16 })), 16)`. RMS rotation = r·√3.
- **Isolated backend + frontend for submissions** (never use the user's servers): `TRUST_LAYER_DB=<tmp>/e2e.db PHOTO_DIR=<tmp>/uploads backend/.venv/bin/uvicorn main:app --port 8001` and `VITE_API_URL=http://localhost:8001 npx vite --port 5173 --strictPort`, then browse `http://127.0.0.1:5173/` (**use 127.0.0.1**: `localhost:5173` on this machine is another project). HUD-only checks don't need a backend at all.
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
