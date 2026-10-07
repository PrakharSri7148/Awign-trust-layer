# Edge validator

The photo-quality engine behind the Capture screen: it decides, on the worker's phone, whether a photo is good enough to submit, and the backend re-checks the same photo so the device's word is never taken on trust.

| File / folder | What it is |
|---|---|
| [iteration-1.md](iteration-1.md) | The audit of the original single-check validator and the plan for this work |
| [progress.md](progress.md) | What was built in each of the 6 phases, how it was verified, and the honest limits |
| `samples/` | **Where real worker photos go** for calibration (one folder per issue, see its README) |
| `backups/` | The database and classifier as they were before phases 2 and 5 |

## How it fits together

```
 phone (client/src/lib/photoQuality)                       server (backend/photo_quality)
 ┌──────────────────────────────────────────┐              ┌────────────────────────────────┐
 │ in-app camera ─ live guidance (5 fps)     │              │ decode photo (Pillow)          │
 │      └ burst of 8 frames → sharpest kept  │   photo +    │ same 7 checks, same thresholds │
 │ or file picker                            │  device's    │ + face (MediaPipe, optional)   │
 │      ↓                                    │  own report  │ compare with the device report │
 │ decode → frame (1280px + native patches)  │ ───────────► │ hash / near-duplicate / EXIF   │
 │      ↓ Web Worker                         │              │ store photo, verdict, flags    │
 │ 7 pixel checks   + face (MediaPipe, WASM) │              │      ↓                         │
 │ + sensor shake (gyro/accel)               │              │ photo_quality_score → fraud    │
 │      ↓                                    │              │ model (+ SHAP) → status        │
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
| **glare** | blown-out region with a soft, surrounding, monotone halo | flag only |
| **shake** | edge steepness *per orientation* (directional blur) + gyro/accelerometer around the shutter | flag only |
| **noise** | robust noise σ on native patches + JPEG 8×8 blockiness | flag only |

"Blocks" means a `fail` stops the submission; otherwise a `fail` is a flag the worker can override with *Submit anyway* (recorded). Change this in `policy` in `thresholds.json`, no code needed.

## Thresholds (`client/src/lib/photoQuality/thresholds.json`)

All values are **starting points**, tuned on synthetic degradations of a few real photographs. Re-tune with real photos (below).

| Group | Key | Meaning |
|---|---|---|
| blur | `failBelow` 0.14 / `warnBelow` 0.21 | edge-steepness score at a 1280px analysis size; sharp photos score about 0.3–0.4. `minTileRange` 20 = a tile with less contrast than this is "no texture", not "blurry"; `grid` 3 = 3×3 tiles, the 66th-percentile tile counts |
| exposure | `darkMeanFail/Warn` 40/65, `overMeanFail/Warn` 235/210 | mean luma 0–255. `crushedFrac*` share of pixels <25; `clippedFrac*` share >245; `flatRangeWarn` 45 = p95−p5 below this looks hazy |
| resolution | `failShortSide` 480, `failLongSide` 640, `warnMegapixels` 0.75 | native size |
| noise | `sigmaWarn/Fail` 5/10 | grey levels (0–255) on native-resolution flat-ish pixels. `blockWarn/Fail` 1.15/1.45 = JPEG boundary/interior gradient ratio (~q75 / ~q45); `blockMinExcess` 0.5 = the step must also be this many grey levels |
| obstruction | `warnArea` 0.10, `failArea` 0.35, `fullCoverArea` 0.85 | share of the frame. `flatTileStd`, `flatRelative`, `coverFlatStd` define "texture-less"; `darkTileMean` 50 |
| glare | `warnArea` 0.01, `failArea` 0.04, `hardWarnArea` 0.10 | share of the frame. `haloMin` 10 grey levels, `haloSurround` 0.6, `cell` 8 px |
| shake | `warnAniso` 1.4, `failAniso` 1.8 | sharpest ÷ softest orientation (sharp photos 1.0–1.2, defocus ≤1.25). `sensor.rotWarn/Fail` 25/60 °/s, `accWarn/Fail` 1.2/3 m/s² |
| face | `minScoreWarn/Fail` 0.7/0.5, `minHeightWarn/Fail` 0.15/0.08, `visibleWarn/Fail` 0.95/0.75, `yawWarn/Fail` 0.35/0.7, `rollWarn` 25° | see `face/facecheck.js` |
| live | `size` 480, `blurBad/Soft` 0.2/0.28, `readyFrames` 3, `burst.frames` 8 | live guidance + burst; deliberately coarse |
| tasks | `face` `off\|optional\|required`, `camera` `environment\|user`, `live` | per-task requirements |

## Calibrating with real photos

1. Drop photos into `samples/<issue>/` (see [samples/README.md](samples/README.md)): ≥100 in `good/`, ≥30 in each issue folder.
2. `cd client && npm run calibrate`
   - shows, per folder, how many photos pass / warn / block and how many are caught by the expected check;
   - shows how many **good** photos the current thresholds wrongly reject (the number that matters most);
   - for each check, the separation (AUC) between good and issue photos and a **suggested** threshold in the gap between them (or at your false-reject target if the groups overlap).
   - `npm run calibrate -- --demo` shows the format using bundled photos before you have any; `--max-false-reject 0.02` changes the target; `--write` saves `thresholds.suggested.json` (the real file is never modified).
3. Review the suggestions, copy the numbers you accept into `thresholds.json`, then run the tests and `node tools/parity.mjs`.

Treat anything based on fewer than 30 photos per group as indicative only (the tool says so).

## Running the tests and tools

```bash
cd client  && npm test                      # 84 tests: checks, face logic, camera logic, merge, dashboard helpers
cd backend && .venv/bin/python -m pytest    # 50 tests: engine, API, spoofing, duplicates, EXIF, face, classifier, migration, calibration
cd client  && node tools/parity.mjs [photo] # JS engine vs Python engine on 37 degraded variants of one photo
```

## Adding a new check

1. `client/src/lib/photoQuality/checks/<name>.js`: a pure `(frame, ctx) → checkResult(...)`; register it in `checks/index.js`; add its id to `schema.js` (`CHECK_IDS`, `CHECK_LABELS`) and thresholds + policy to `thresholds.json`.
2. Port it to `backend/photo_quality/checks/<name>.py`, register it in `checks/__init__.py`.
3. Add a flag description to `FLAG_META` in `client/src/lib/format.js`.
4. Tests in both languages, then `node tools/parity.mjs` must still show 100% agreement.
