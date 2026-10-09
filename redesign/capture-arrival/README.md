# Capture · Arrival step redesign (prototype)

Step 2 of 4, plain HTML/CSS/JS, mock data, no build step. It **reuses the approved Photo step** instead of copying it: tokens, primitives, shell, top bar, stepper, card, pills, meter, strip, banner, skeleton all come from `../capture-photo/css/*` and `../capture-photo/js/cap-render.js`. Only `css/cap-arrival.css` adds components. `client/` is not touched.

## Run it

```
cd trust-layer/redesign
PORT=5181 node serve.mjs
```

| URL | What |
|---|---|
| `/capture-arrival/` | **Viewer**: state switcher (25 states in 10 groups), device (desktop / tablet / phone), theme (dark / light), “Replay the current state” |
| `/capture-arrival/app.html` | The page. With no query it plays the real 3-second sequence and ends on an AI scan stub. `?state=<id>&theme=light` |
| `/capture-arrival/frames.html` | Gallery: every frozen state at 1280, 820 and 390 (dark) + the phone in the light theme |
| `/capture-arrival/coverage.html` | Inventory A1…A8 (A4 split into parts) → where it lives, measured “found in N states”, plus **Additions** |
| `/capture-arrival/tokens.html` | The new components, live, with class names and CSS variables |
| `node tools/verify.mjs` | Automated check, output in `verify-output.txt` |

## What the page is

One calm card (max 560px, centered; full width on the phone) under the Photo step's top bar and stepper (Photo ✓, Arrival active):
eyebrow + title + thumbnail of the verified photo → instruction → “n of 4 readings done” + 20-segment meter (+ “Continuing…” pill during the 0.5 s pause) → four sensor tiles → quiet amber notice when something is unavailable. No buttons on the card.

Each **tile** is the live version of a Sensor-feed group: icon box + title + state pill (Waiting / Acquiring / Locked / Unavailable, always word + icon) + value line; border and icon take the state's tone. Motion adds the live waveform and the 3.0 → 0.0 s ring; Network adds the 4-bar signal; Trail adds the 2-minute activity strip with its legend.

## Mapping to your React code

| React | Prototype | Notes for the port |
|---|---|---|
| `Capture.jsx` step `sensors` | `R.arrival`, `.cap-arr` | Render inside `CapShell` + the new `Stepper` (current = 1) instead of `ChromeShell` + `LegacyStepper` |
| `SensorTile.jsx` | `R.sensor`, `.cap-sensor` | Same props; states `wait/acq/ok/na` become modifier classes. `aside` → ring goes next to the waveform, bars next to the value |
| `TrailTile.jsx` | same tile + `R.strip` | `fz-strip` → `cap-strip` (+ `is-unknown`, legend) |
| `Waveform.jsx` | `.cap-feed__wave` | Keep the canvas or draw the SVG path (`R.wavePath`); colour from tokens, no glow |
| `signalBars` | `.cap-signal` | Same 4/2/1 mapping; now `role=img` with a label |
| `Gauge` (countdown) | `.cap-ring` | `--p` = elapsed / 3000 |
| `sensorNotes` | `.cap-notice` | Shown as each reading resolves unavailable; the next two steps keep their own note |
| AnimatePresence slide | `.cap-view` | 24px + fade, 220 ms, none under reduced motion |

## Decisions taken on your behalf (veto any)

| # | Decision | Why |
|---|---|---|
| 1 | Worker / site chips are **not** added next to the thumbnail | You removed them from the Photo step in round 2; the thumbnail alone gives the context |
| 2 | The meter counts the four tiles, with the Motion countdown adding partial progress (up to 90% of its quarter) | “3 of 4 readings done” must match the bar; it never reaches 100% before the last reading returns |
| 3 | Meter tone: blue while reading, green when all Locked, amber when any is Unavailable | Status colours stay tied to a word (the tile pills and the notice) |
| 4 | Motion waveform stays in the tile after Locked (frozen, grey) and is a flat line when Unavailable | No layout jump; the app flattens it too |
| 5 | The A7 notice appears as each reading resolves Unavailable (not only at the end); the trail has no note, as in the app (its value line already says it) | “Preview” asked for; the final text is the app's own |
| 6 | “Waiting” tiles show the clock icon; “Acquiring” tiles have an empty value line (as in the app) | Word + icon on every state |
| 7 | Tile pill fill is opaque inside tiles | A tinted tile under a tinted pill measured 4.33:1 in light amber; opaque gives ≥ 4.65:1 |
| 8 | A8 shows the transition (slide back, stepper back to Photo, banner) over a placeholder for the Photo screen | You asked for the transition only |

## Not done / limits

| Item | State |
|---|---|
| Real GPS, motion, network | Not used: values and the |acceleration| signal are simulated (MOCK values: coordinates, 181 samples, 0.42 m/s², network speeds, trail numbers, the 503 message) |
| Real devices (iOS Safari, Android Chrome, Firefox, desktop Safari) | **Not tested**; Chrome headless at 1280 / 820 / 390 only |
| Screen reader | Not tested (roles kept: status, alert, meter; the ring and waveform have labels) |
| Contrast | Measured on the rendered tile / pill / notice text in 6 states × 2 themes (216 samples, minimum 4.65:1) |
| Steps 3-4 and the Photo screen | Stubs only |
| Porting to `client/` | Not started: approve first |
