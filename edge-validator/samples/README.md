# Sample photos for calibration

Drop real photos from the workers' phones into the folder that matches the **main** problem in the photo.

| Folder | What goes in it |
|---|---|
| `good/` | Clean, acceptable photos. These are the most important: they measure false rejections. Aim for 100+ |
| `blurry/` | Out of focus or soft photos |
| `dark/` | Too dark / underexposed |
| `overexposed/` | Blown-out highlights / washed out |
| `glare/` | Reflection or glare spots |
| `low_resolution/` | Small or upscaled photos |
| `lens_covered/` | Finger, cloth or dirt over part or all of the lens |
| `noisy_compressed/` | Grainy low-light shots, or heavily compressed (WhatsApp-forwarded style) |
| `shaky/` | Motion blur, tilted or badly framed |
| `face_not_visible/` | Face cut off, turned away, covered or too small (only for face tasks) |

Guidelines:

- Aim for **30–50 photos per bad folder** and **100+ in `good/`**.
- Use originals straight from the camera app where possible. Do not re-save, screenshot or downscale them: **resolution matters** (the blur score depends on image size, and photos under 0.75 MP are warned), so a `good/` folder of small PNGs cannot show how full-size photos behave. HEIC (iPhone) files are fine.
- **A photo must be in exactly one folder.** Do not copy the same file into several (a blurry photo also in `shaky/` counts twice and distorts the results).
- What each bad folder should contain: `glare/` = reflections on glass, plastic or a shiny shelf that hide content (not lens flare or bokeh art); `overexposed/` = visibly blown-out, washed-out photos; `lens_covered/` = a finger/cloth over part of the lens.
- Selfies: put clear selfies in `good_selfies/` (separate from `good/`, which is analysed as a normal photo task) and bad ones in `face_not_visible/`.
- Mix phones (cheap Android, mid-range, iPhone) and lighting conditions.
- A photo can have more than one problem. Put it in the folder of the worst one, and optionally add a line `filename: issue1, issue2` to `labels.txt` in the sample root.
- Do not commit photos containing real people's faces without consent.

When the photos are in, run the calibration tool (added in Phase 5):

```bash
cd client && npm run calibrate
```

## Liveness / anti-spoofing samples (Phase 7f)

These four folders measure the live check (APCER / BPCER / ACER in `reports/accuracy-report.md`). **Faces are personal data: get written consent, keep them out of git and out of shared drives, and delete them when the evaluation is done.** The report only prints file names.

| Folder | What goes in it | Minimum |
|---|---|---|
| `live_selfies/` | Real people photographed live by the app's camera (or the same phone's camera app), many lighting conditions, with and without glasses / hijab / beard, several phones. **One photo per person per condition**, no duplicates | 40+ |
| `spoof_screen/` | The **same people's** photos shown full-screen on a phone or laptop and photographed by the app's camera at arm's length. Vary the screen (phone / tablet / monitor), brightness, angle, distance | 40+ |
| `spoof_print/` | A printed photo (paper, glossy, A4 / wallet size) held in front of the camera | 20+ |
| `spoof_video/` | A video of a face played on a screen, photographed by the app's camera (a still frame is fine; also keep the number of frames you took) | 20+ |

Capture protocol:
1. Use the same camera path the workers use (the in-app camera on the `Selfie check-in` task) so spoof and live files share the camera pipeline. For a quick start, a phone camera at a similar distance is fine.
2. Name files `<person>_<condition>_<n>.jpg` (the person id can be a code, not a name). The report groups by the first token for per-person slices.
3. Optional `labels.txt` next to a folder: `filename: light=low, glasses=yes, device=pixel7` for slice analysis.
4. Do **not** include the people's names or ids in the file names; do not mix a person's live selfie and their spoof of the same photo in one folder.

Until these exist the Liveness section of the report says "not evaluated".
