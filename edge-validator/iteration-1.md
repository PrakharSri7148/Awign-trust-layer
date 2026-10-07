# Edge Validator — Iteration 1

Date: 2026-10-07
Scope: audit of the existing edge validator (`client/src/lib/edgeValidator.js`) and the plan to extend it from a single sharpness check into a full photo-quality engine.

This file contains:

- **Part A**: the audit report (what it is, how it works, where it lacks, how to improve)
- **Part B**: the new multi-check plan (8 quality checks, phases, decisions)
- **Part C**: decisions taken for this iteration

---

# Part A — Audit report

## 1. What it is

- A client-side photo sharpness check. It runs in the browser before a field worker can submit proof of work.
- It detects blur using the variance of the Laplacian, a standard edge-based blur metric. High variance means lots of edges, which means a sharp photo. Low variance means a blurry one.
- It is the first of the project's two checks. The client checks the photo. Then the backend scores GPS, motion and network data with a gradient-boosting model and SHAP.
- It makes a hard pass/fail call, and a blurry photo never reaches the backend.

**Files involved**

- `client/src/lib/edgeValidator.js` is the whole feature, 61 lines.
- `client/src/lib/edgeValidator.test.js` has 3 unit tests, run with `npm test`.
- `client/src/pages/Capture.jsx` is the only caller. It handles the UI, the gating and the submit.
- The backend (`backend/main.py`, `backend/classifier.py`) receives only the boolean `photo_quality_pass`.

## 2. How it's built

- **Two constants:**
  - `SHARPNESS_THRESHOLD = 50`: the score must be above this to pass.
  - `MAX_DIMENSION = 300`: the longest side is shrunk to 300px before analysis.
- **`laplacianVariance(gray, width, height)`** is a pure function with no DOM dependency, so it's testable in Node.
  - For each interior pixel it computes the 4-neighbour Laplacian: `up + down + left + right − 4·center`. This is a second derivative, so it is large at sharp edges and near zero on smooth areas.
  - It accumulates `sum`, `sumSq` and `n` in a single pass, then returns `E[v²] − E[v]²` (variance).
  - It skips the 1px border and returns 0 for images too small to have an interior.
- **`loadImage(file)`** wraps `URL.createObjectURL` and `Image` in a promise and always revokes the object URL. A decode failure rejects with "Could not decode image".
- **`checkPhotoQuality(file)`** is the orchestrator:
  1. Decode the file into an `Image`.
  2. Compute `scale = min(1, 300 / longestSide)`, so it only downsizes and never upsizes.
  3. Draw onto an off-screen `<canvas>` at that size. It uses `willReadFrequently: true` to keep the pixel read on the CPU.
  4. Convert RGBA to grayscale with the BT.601 luma formula `0.299R + 0.587G + 0.114B`, into a `Float32Array`.
  5. Compute the Laplacian variance and return `{ isSharp: score > 50, sharpnessScore }`.

## 3. How it functions end to end

- The user taps the viewfinder, which is a hidden `<input type="file" accept="image/*" capture="environment">`. On phones this opens the rear camera.
- `onPhotoChange` shows a preview and a "Running Laplacian variance on-device…" terminal line with a scanline animation. It then awaits `checkPhotoQuality`.
- **If the photo is sharp:**
  - A green gauge shows the score (`score / (2·threshold)`, capped at 1, with the threshold mark at 50%).
  - The "Photo verified" panel appears with **Submit** and **Retake** buttons.
- **If the photo is blurry:**
  - The panel shakes, turns red and says "Too blurry — submission blocked".
  - There is no Submit button, and Retake becomes the primary button.
  - `onSubmit` also re-checks `if (!quality?.isSharp) return`.
- **If decoding fails:** an error banner appears and the preview is cleared.
- **On submit:** the flow moves to the sensors step (3s of motion, GPS, network), then the analysis step, then the verdict. It sends `photo_quality_pass: true` along with the other signals.
- The README says a blurry photo is blocked in the browser with a score of 0.4 against the threshold of 50, and no request is sent.

## 4. What's good

- **The core function is pure and tested.** It has no DOM or canvas dependency, and the tests cover a sharp pattern, a blurred pattern and a flat image.
- **It's fast and private.** The 300px downscale caps the work at about 90k pixels. The photo never leaves the device for this check, and there's no network round-trip.
- **It's cheap to run.** There are no dependencies, and the single-pass variance avoids storing the Laplacian array.
- **The UI feedback is clear.** The user sees the score, the threshold and what to do next.
- **The cleanup is careful.** Object URLs are revoked and the input is re-keyed on reset.

## 5. Where it's lacking

Items marked "(measured)" were confirmed by running synthetic images through the real function.

**Detection accuracy**

- **Noise counts as sharpness (measured).** Pure random noise scored 2,646 and passed. A heavily blurred image with sensor noise added scored 1,517 and passed. Laplacian variance can't tell real edges from noise. This matters because low-light photos are blurry and noisy at the same time, which is the common bad case in the field.
- **Clean, low-detail scenes fail (measured).** A smooth gradient and a plain white sheet both scored 0.0 and were blocked. A legitimate photo of a blank wall, a clean whiteboard or a sky would be rejected as "too blurry". Blur and lack of texture look the same to this metric.
- **The score depends on contrast and scene content (measured).** A perfectly sharp but dim, low-contrast scene scored only 108, barely over the threshold of 50. The same sharp pattern at full contrast scored about 30,000. The threshold is effectively tuned to scene contrast, not focus.
- **It scores the whole frame as one number.** If the subject is blurry but the background is textured, it passes. If the subject is sharp against a smooth background (portrait mode, shallow depth of field), it can fail. There's no region of interest and no center weighting.
- **Downscaling to 300px hides mild blur.** Shrinking acts as a low-pass filter, so slight motion blur or soft focus that matters at full resolution can disappear. The README already admits the threshold depends on this.
- **It doesn't tell motion blur from defocus blur.** It also can't give the user a specific hint, such as "hold steadier" versus "tap to focus".

**Trust and security**

- **The backend trusts the client's boolean.** `photo_quality_pass` is just a JSON field, so anyone can POST `true` with any photo, or none, and skip the check entirely. The client-side check works as UX gating, not as verification.
- **The server never sees the photo or the score.** Only the boolean is sent, so it can't be re-checked, audited or used by the model. The README says the model gives photo quality about 0 importance, so the feature is effectively decorative on the backend.
- **There's no proof the photo is live or relevant.** `capture="environment"` is only a hint. Desktop browsers and many Android devices still let the user pick from the gallery, so a stock photo, a screenshot or an old photo passes if it's sharp. There's no EXIF timestamp check, no GPS-in-EXIF match, no duplicate detection (perceptual hash), and no check that the photo shows the expected subject or site.

**Calibration and robustness**

- **The threshold of 50 is a guess.** It isn't tuned on real field photos. The README itself says "Tune it against real photos from your devices", and no data or evaluation script exists for it.
- **The threshold is one fixed value for all devices and scenes.** Phone cameras differ in sharpening, HDR and noise reduction, which shifts the score. Auto-sharpened but blurry photos can pass.
- **The tests are synthetic only.** They use a checkerboard and a box blur, which is easy for this metric. There are no tests for noise, low contrast, flat scenes or real images.
- **The `checkPhotoQuality` path is untested.** The decode, scale and grayscale code has no coverage because the tests need a canvas. This includes the `scale` and `max(1, …)` edge cases and the image-decode failure path.
- **There is no handling for very large files or memory pressure.** Decoding a 48MP image into an `Image` before downscaling can be slow or fail on low-end phones. `createImageBitmap` with `resizeWidth` would avoid this.
- **It doesn't need EXIF orientation.** The Laplacian variance doesn't depend on rotation, so that's fine. But the displayed preview could differ from what was analysed on older browsers.
- **There is no timeout or cancellation.** If the user retakes during a check, the older `checkPhotoQuality` can finish later and overwrite the newer result (a race in `onPhotoChange`).
- **The gauge saturates at 2× threshold.** Any score above 100 looks identical, which hides how good the photo is.

**Product and UX**

- **There's no live feedback.** The check only runs after the shot is taken. A live viewfinder check (video frames) would help the user fix the problem before capturing.
- **A hard block gives the user no way out.** If the check wrongly rejects a legitimate photo (a blank wall, say), the worker is stuck. There's no manual override with a review flag.
- **There is no analytics or logging.** There's no record of how often photos are rejected, at what scores, or on which devices, which is exactly the data needed to tune the threshold.

## 6. How to improve it

**Quick wins**

- Send the numeric `sharpness_score` to the backend, not just the boolean. Store it, show it on the dashboard and use it as a model feature.
- Add a noise-robust variant: smooth first (a small Gaussian blur before the Laplacian), or use Tenengrad (Sobel gradient energy). Both are less fooled by noise than the plain Laplacian.
- Normalize by contrast. Divide by image variance or mean intensity, or compare the score to a blurred version of the same image, so dim scenes aren't penalized.
- Compute the score on a grid (for example 3×3 tiles) and require several tiles to pass. This handles partly smooth scenes and detects subject-only blur.
- Add more tests: noise, low contrast, a flat scene, a real blurry and sharp photo pair as fixtures, and a canvas-mocked test for `checkPhotoQuality`.
- Ignore stale results with a request counter so a retake can't be overwritten by a slow older check.
- Add a "needs review" path for flat images (very low score with very low contrast) instead of a hard block.

**Medium effort**

- Calibrate the threshold. Collect a labelled set of real blurry and sharp field photos and plot score distributions. Choose the threshold from the data, ideally per device class.
- Re-verify on the server. Upload the photo, recompute sharpness with Python (OpenCV or scikit-image) and compare it to the client's number. That makes the check hard to fake.
- Add anti-reuse and freshness checks: perceptual hash for duplicates, EXIF capture time and GPS compared with the submitted GPS, and a camera-only capture (`getUserMedia`) instead of the file picker.
- Use `createImageBitmap` to downscale during decode, to avoid memory problems on large images.
- Add a live viewfinder check on video frames, at about 5 fps, with a "steady, in focus" indicator.

**Longer term**

- Replace or supplement the rule with a small ML quality model (a tiny CNN or MobileNet via TensorFlow.js or ONNX) trained on real examples. It could detect blur, darkness and over-exposure, and whether the subject is present, in one pass.
- Log rejections and overrides, then retrain the threshold or model from real outcomes.
- Make the backend feature meaningful. Train on real data where photo quality varies, so the model can use `sharpness_score`. Right now the synthetic data always pairs a bad photo with bad motion, so the model learned to ignore it.

## 7. Bottom line

- The feature is a clean, minimal and well-isolated blur detector. As a UX nudge ("retake, this is blurry") it works for typical textured scenes.
- It is not a trust control. It can be bypassed by anyone sending the API request directly, it is fooled by noise, and it falsely rejects plain surfaces.
- The most valuable next steps are to send the score to the server, re-verify it there, calibrate the threshold on real photos, and make the metric noise-robust.

---

# Part B — The new multi-check plan

## 1. Goal

- Replace the single `photo_quality_pass` boolean with a multi-check photo quality engine covering 8 issues: blur, exposure, glare, low resolution, lens covered, noise/compression, shake / poor capture, face not visible.
- Each check returns a score, a status (`pass`, `warn` or `fail`) and a plain-language hint the worker can act on.
- Severe problems block the submission. Moderate problems are flagged but allowed.
- Flags travel to the backend, appear on the dashboard and feed the classifier.
- The server re-checks the photo itself, so the backend no longer trusts the client.

## 2. Architecture

- **New module:** `client/src/lib/photoQuality/` with one file per check, plus `index.js` as the orchestrator. `edgeValidator.js` stays as a thin wrapper so `Capture.jsx` doesn't break during the migration.
- **Shared preprocessing, done once per photo:**
  - A fast decode with `createImageBitmap`. This fixes the memory problem with 48MP photos.
  - **Analysis frame:** a 640px grayscale frame plus an RGB frame, used for blur, exposure, glare and lens-cover checks.
  - **Native-resolution crops:** noise and JPEG blockiness need native pixels. Downscaling hides both, which is why the old check missed noise.
  - **Metadata:** original width and height, file size, MIME type, and EXIF if present.
- **Every check is a pure function** with the signature `(frame) → { id, score, status, hint, details }`. That keeps them testable in Node, as the current Laplacian function is.
- **Execution:** the checks run in a Web Worker with `OffscreenCanvas` so the UI doesn't freeze. The target is under 400ms for a 12MP photo on a mid-range phone.
- **Output shape:**
  ```
  { version, verdict: 'pass'|'warn'|'block',
    checks: { blur, exposure, glare, resolution, obstruction, noise, shake, face },
    issues: [ordered by severity], metrics: {...} }
  ```
- **Stale results:** each run carries a request id, so a slow earlier check can't overwrite a retake.

## 3. The 8 checks

| # | Issue | How it's detected | Starting thresholds (to be calibrated) |
|---|---|---|---|
| 1 | **Blurry / out of focus** | Gaussian pre-smooth, then Laplacian variance, divided by local contrast. Computed on a 3×3 grid of tiles; a photo passes only if enough textured tiles are sharp. Flat tiles are marked "no texture" and are not counted as blur. | Block below a normalized score, warn in a band above it |
| 2 | **Too dark / overexposed** | Luminance histogram: mean, percent of pixels below 25, percent above 240, and the p5–p95 range. | Dark if mean < 50 or more than 40% of pixels are crushed. Over if more than 25% of pixels are clipped. |
| 3 | **Glare / reflection** | Find connected blobs of near-saturated, low-saturation (HSV) pixels with a smooth falloff around them. Report the blob area and bounding box so the UI can draw it. | Warn at a 2% blob area, fail at 6% |
| 4 | **Low resolution** | Read the native width and height from the original file, before downscaling. Optionally detect upscaled images from missing high-frequency content. | Block under 640×480, warn under ~1 MP |
| 5 | **Lens partly covered** | Tile statistics: a contiguous, border-touching region of very low variance that is either dark or a blurred skin-tone/pink (finger). A full cover is when every tile is flat and dark. Also a global haze check for a smudged lens. | Block if more than 15% of the frame is an obstructed region |
| 6 | **Noise / compression** | **Noise:** Immerkaer noise-variance estimate on flat native-resolution patches. **Compression:** 8×8 blockiness ratio, plus bytes-per-pixel as a cheap proxy. | Warn and fail on blockiness and noise sigma |
| 7 | **Shaky / poorly captured** | **From the image:** gradient anisotropy (blur in one direction means motion). **From sensors:** gyro/accelerometer energy in a ~700ms window around the shutter. **Framing:** extreme tilt, empty or flat frame. | Tied to the blur result plus a sensor energy threshold |
| 8 | **Face not clearly visible** | On-device face detector (MediaPipe Face Detector via WASM, lazy-loaded, cross-browser). Checks: a face is found, its size is above ~15% of frame height, it is not cropped by the frame edge, both eyes are visible, and the sharpness and exposure of the face crop pass. Warn on multiple faces. | Face required only for tasks that need it |

- All thresholds are starting guesses, to be calibrated on real photos.
- Glare and obstruction are heuristics. A real white object or a hand in frame can resemble them. That's why they are flagged and borderline cases go to "submit anyway".

## 4. Decision policy: block or flag

| Severity | Issues | What happens |
|---|---|---|
| **Block** (cannot submit) | Severe blur, lens covered, very dark or fully blown out, resolution below minimum, face missing on a face-required task | Red state, specific hint, Retake is the main button |
| **Warn** (can submit, flagged) | Moderate blur, moderate glare, noise or compression, shake, multiple faces, borderline exposure | Amber state. The worker can Retake or **Submit anyway**. The override is recorded. |
| **Pass** | Everything clean | Green, as today |

- "Submit anyway" is the way out for wrongly rejected photos, and the override is recorded so it can be reviewed.
- The policy lives in one config file, so changing it needs no code changes in the checks.

## 5. UI changes

- **A checklist replaces the single gauge.** There are 8 rows, each with a ✓, ⚠ or ✗, a score and a one-line hint. The worst issue is shown first.
- **Specific, actionable hints.** Examples: "Too dark, move to better light or turn on the flash", "Glare on the upper right, change your angle", "Lens looks blocked, clean it or move your finger".
- **Overlays on the preview:** a glare box, a face box and the obstructed region.
- **Verdict screen** also shows the quality flags.
- **The dashboard** gets quality flags per submission, a filter by issue and a chart of rejection reasons. The case file shows each check's score, and thumbnails if photos are stored.

## 6. Calibration and testing

- **Dataset.** Collect roughly 300–500 real photos from the phones workers use, labelled per issue (multi-label). Bootstrap with synthetic degradations of good photos: Gaussian and motion blur, darkening and brightening, a painted glare blob, downscaling, added noise, JPEG quality 10, a dark or pink occluder, and a cropped face. Public sets such as CERTH (blur) and WIDER FACE (faces) can fill gaps.
- **Calibration script** (`tools/calibrate`). Runs every check over the dataset, prints precision/recall per issue and picks each threshold for a target. The default target is that no more than about 3% of good photos get rejected.
- **Regression tests from the failures measured in Part A.** Pure noise must not pass as sharp, a flat white sheet must not be called blurry, and a dim sharp scene must pass.
- **Real decode-path tests.** A canvas-capable test environment with golden image fixtures. This covers the scaling, grayscale and decode-error code that has no tests today.
- **Unit tests per check**, an orchestrator test and a policy test.
- **Telemetry.** Log each check's metrics, the verdict, overrides and the user agent to a `/photo-quality-events` endpoint, so thresholds can be tuned on real traffic.

## 7. Backend changes

- **API shape.** Replace `photo_quality_pass` with a `photo_quality` object: version, verdict, per-check scores and statuses, overrides, resolution and device info. Keep `photo_quality_pass` derived from it, so old clients keep working.
- **Server-side recheck, the real trust control.**
  - Accept the photo as a multipart upload, or at least a 640px thumbnail.
  - Recompute blur, exposure, resolution, noise and glare with OpenCV and Pillow (`opencv-python-headless`, `Pillow`, `python-multipart`).
  - If the server's numbers disagree with the client's, add a "client report inconsistent" flag.
- **Storage.** Save photos to disk or object storage and keep the path in the database.
- **Database.** Add columns or a JSON field for the check results, the verdict and the issue list. Because `models.py` uses `create_all`, existing tables won't get new columns. The local `trust_layer.db` needs a small migration, or a reset in dev.
- **Classifier.**
  - Replace the one boolean feature with an aggregate `photo_quality_score` (0–1) and an issue count. This needs retraining.
  - Fix the training data in `generate_synthetic_data.py` so photo quality varies independently of fraud. Today it is perfectly tied to bad motion, which is why the model learned to ignore it.
  - Reason text gets specific, for example "Photo flagged: glare".
  - The classifier is trained on synthetic data, so how much photo quality really predicts fraud is an assumption until there are real labels.
- **Alternative (recommended):** keep quality as a separate `quality_flags` field and `needs_review` state, and give the model only the aggregate. Bad photos are often honest mistakes and shouldn't read as fraud.

## 8. Phased rollout

Effort figures are rough estimates.

- **Phase 0 (~0.5 day): foundation.** Refactor into the `photoQuality/` structure, add the shared preprocessing, result schema and request-id fix, and set up the test environment. The old UI keeps working.
- **Phase 1 (~2–3 days): pixel checks.** Improved blur, exposure, resolution, noise/compression and lens-obstruction, plus the checklist UI and the policy engine.
- **Phase 2 (~2 days): glare, image-based shake, "Submit anyway" and backend.** Include the new schema, photo upload and the server recheck.
- **Phase 3 (~2–3 days): faces.** MediaPipe integration, task config and the face-crop checks.
- **Phase 4 (~3–4 days): in-app camera.** Replace the file input with `getUserMedia`, live feedback at about 5 fps, burst capture that picks the sharpest of about 5 frames, sensor-synced shake measurement, and the worker.
- **Phase 5 (ongoing): calibration, retrain and dashboard.** Dataset, thresholds, classifier retrain and the dashboard views.

## 9. Open decisions (as asked)

1. **Faces.** Do proof photos include a person, or are they site photos?
2. **Block versus flag.** Is the policy table right?
3. **Photo storage.** The server recheck needs the photo or a thumbnail stored.
4. **Real photos.** Can samples from real workers' phones be provided for calibration?
5. **Camera approach.** File picker first, or straight to the in-app camera?

## 10. Risks

- **False rejections** are the biggest product risk. A wrongly blocked worker stops working, hence the "Submit anyway" path and the calibration target.
- **Heuristics have limits.** Glare, obstruction and shake detection will have both false positives and misses. A small on-device ML quality model is the longer-term upgrade.
- **Bundle size.** MediaPipe's WASM and model are a few MB, so they are lazy-loaded only when a task needs faces.
- **iOS Safari.** Motion permission and camera access need a user tap and HTTPS, and EXIF is stripped when the photo passes through a canvas.
- **Client checks can still be bypassed.** Only the server recheck fixes that.

---

# Part C — Decisions for this iteration

- **Go with the defaults** from section 9 above:
  - Faces: configurable per task (`required`, `optional`, `off`), off by default, front camera for face tasks.
  - Policy: as in the block/flag table.
  - Photo storage: server stores photos for the recheck (retention and consent to be decided before production).
  - Camera: file picker first (Phases 0–3), in-app camera in Phase 4. All phases to be completed now.
- **Real sample photos:** will be provided later by the user. The folder `edge-validator/samples/` is reserved with one sub-folder per issue. Calibration (Phase 5) is built to run the moment the photos are dropped in, and the thresholds in this iteration remain starting values until then.
- **Progress tracking:** `edge-validator/progress.md` is updated after every phase.
