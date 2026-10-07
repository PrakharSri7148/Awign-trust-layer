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
- Use originals straight from the camera app where possible. Do not re-save or screenshot them.
- Mix phones (cheap Android, mid-range, iPhone) and lighting conditions.
- A photo can have more than one problem. Put it in the folder of the worst one, and optionally add a line `filename: issue1, issue2` to `labels.txt` in the sample root.
- Do not commit photos containing real people's faces without consent.

When the photos are in, run the calibration tool (added in Phase 5):

```bash
cd client && npm run calibrate
```
