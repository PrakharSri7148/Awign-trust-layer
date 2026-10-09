# Capture · Photo step redesign (prototype)

Plain HTML/CSS/JS, mock data, no build step. Only the **Photo step (step 1 of 4)** of the Capture page, with all its states. Steps 2-4 are not redesigned (the "I've reached the site" button goes to a stub). `client/` is not touched.

## Run it

```
cd trust-layer/redesign
PORT=5181 node serve.mjs        # or without PORT: 5180
```

| URL | What |
|---|---|
| `/capture-photo/` | **Viewer**: state switcher (51 states in 12 groups), device width (desktop / tablet / phone), dark / light theme, "next photo result" |
| `/capture-photo/app.html` | The page itself. Open it on a phone to see the real responsive behaviour. `?state=<id>&theme=light&next=warn` |
| `/capture-photo/frames.html` | Gallery: every state at 1280, 820 and 390 (dark), plus phone result and phone immersive camera in the light theme |
| `/capture-photo/coverage.html` | Inventory A1…K9 → where it lives, with the measured "found in N states" |
| `/capture-photo/tokens.html` | Token + component sheet |
| `node tools/verify.mjs` | Automated check (see "What was verified") |

Developer flags from the real app still work on `app.html`: `?hud=raw` (H5), `?debug=checks` (J6), `?record` (D6), `?demo=tools` (D5, K9).

## Files

```
css/cap-tokens.css       every token, prefixed --cap-, dark + light (data-theme="light")
css/cap-components.css   primitives: pill, status, button, chip, card, kpi, kv, meter, tabs, accordion, banner, toast, drawer, inputs, tooltip
css/cap-page.css         page layout + feature components, breakpoints 1000 / 721-999 / 720
js/cap-data.js           all strings (copied from the React source), mock numbers, mock scenes (SVG)
js/cap-state.js          store, 51 presets, flows (open camera, capture, check, result, retake, arrive)
js/cap-render.js         one render function per React component
js/cap-app.js            events, ticking numbers, overlay layout, toasts, viewer messages
js/cap-coverage-data.js  the Coverage table source
tools/verify.mjs         puppeteer verification   tools/shot.mjs  screenshot helper   tools/gen-icons.mjs  lucide icon extractor
```

## Mapping to your React components

| React | Prototype | Notes for the port |
|---|---|---|
| `Stepper` | `R.stepper`, `.cap-stepper` | Same 4 labels; phones show only the active label (others are screen-reader text) |
| `Capture.jsx` brief + banners | `R.brief`, `R.banners` | Brief becomes one compact card; task chips keep `aria-pressed` |
| `VisitPanel` | `R.visit`, `.cap-visit` | Demo / record tools move into an accordion shown only with those flags |
| `LiveCamera` | `R.stageLive`, `R.picker`, `.cap-stage` | Stage keeps the camera ratio via `--cap-ar`; phone immersive = `.cap-stage--immersive` + `html.cap-lock` |
| `LivenessOverlay` | `R.liveness`, `.cap-liveness` | Same states and strings; tone classes map 1:1 (`idle/run/go/ok/warn/bad`) |
| `LiveHud` | `R.hud`, `.cap-hud` | Same `useHudMode` storage keys; `variant` = `side` or `overlay` |
| `QualityChecklist` | `R.result` | Failing rows first, passing rows in an accordion; debug table in a drawer |
| `PhotoOverlay` | `R.stagePhoto`, `.cap-box` | Boxes positioned on the contain-fitted photo (`layoutOverlays` in cap-app.js) |
| `SensorFeed` | `R.feed` | Collapsed card (3 headline numbers) → tabs; every K item is a tab panel or the Server accordion |

## Decisions taken on your behalf (veto any)

| # | Decision | Why |
|---|---|---|
| 1 | **Live quality column** also shows a muted (no-score) HUD before the camera opens (desktop/tablet), and a one-line note when the picker is used | The panel keeps its place, "muted row when no score yet" is visible |
| 2 | **Phone nav** moves to a bottom bar with labels; DEMO and the IP-database warning go in a "more" menu (44px button, amber dot when there is a warning) | The top bar cannot hold brand + status + 3 chips at 390px with 44px targets. A3 is hidden below 1000px as you asked |
| 3 | **Overall score** gets a word pill (Good ≥ 75, Fair ≥ 50, Poor) next to the number | Rule "never colour only". Thresholds copied from the current HUD |
| 4 | **Result rows**: passing checks collapse into a "Passed checks (n)" accordion unless everything passed | Keeps the card short; nothing removed |
| 5 | **Sensor feed** opens inline (accordion + tabs), not in a drawer; the drawer is used for the debug checks table | Fits the 380px column; tabs scroll horizontally on phones |
| 6 | Status chips keep the exact upper-case strings (`SYSTEM ONLINE`, `DEMO OFF`) with normal tracking | "Same wording" |
| 7 | The voice toggle is icon-only on phones (text kept for screen readers, tooltip) | Space inside the liveness card |
| 8 | Added a slim 4-bar progress strip at the top of the immersive camera | The full stepper is behind the camera on phones |
| 9 | Result/hint strings that depend on measurements (e.g. "Too dark. Move to a brighter spot.", numbers, reasons) are **mock** wording | Labels, titles and structure are the real ones; check `MOCK` comments in `cap-data.js` |

## Not done / limits

| Item | State |
|---|---|
| Real camera, face detection, GPS, motion | Not used: the stage is a mock SVG scene, numbers are simulated |
| Real devices (iOS Safari, Android Chrome), Firefox/Safari desktop | **Not tested**; only Chrome headless at 1280 / 820 / 390 |
| Screen reader pass, real outdoor glare test of the light theme | Not done. ARIA roles are kept (meter, status, alert, note, tablist) |
| Contrast | Token pairs checked by script (see verify); not every rendered pixel pair |
| Steps 2-4 | Not redesigned |

## Wired into the real app (2026-10-09, after you approved)

The Photo step of `/` in `client/` now uses this design. Steps 2-4 (Arrival, AI scan, Verdict) are untouched and keep the old shell and look.

| Where | What |
|---|---|
| `client/src/styles/capture.css` | The three prototype stylesheets merged. Tokens live on `.cap`; every class `cap-`; nothing global except `html.cam-lock` (already existed) |
| `client/src/components/capture/CapShell.jsx` | New top bar (brand, icon nav, IP-database warning, theme switch), credit footer, phone bottom nav |
| `Stepper.jsx` (new) / `LegacyStepper.jsx` (the old one, used by steps 2-4) | |
| `LiveCamera.jsx` | **Only the render part changed.** All camera, HUD, face-mesh, liveness and burst logic is as before. Now returns the stage cell and (side/under layouts) the HUD cell of the page grid |
| `LiveHud.jsx`, `LivenessOverlay.jsx`, `VisitPanel.jsx`, `SensorFeed.jsx`, `QualityChecklist.jsx`, `PhotoOverlay.jsx`, `ChecksDebug.jsx` | New markup/classes, same props and logic (QualityChecklist now also holds the arrival hint and the send / Retake buttons) |
| `FilePicker.jsx`, `ui.jsx` (Accordion), `useCapTheme.js` | New small pieces |
| `pages/Capture.jsx` | Photo step renders in `CapShell`; later steps wrap themselves in `ChromeShell` (now exported from `Shell.jsx`, which renders `/` bare) |
| `client/tools/e2e/hud-e2e.mjs`, `focus-capture.mjs` | Selectors updated to the new class names (originals saved in `old-capture-backup/e2e/`) |
| `old-capture-backup/` | The previous components, `Capture.jsx`, `Shell.jsx` and e2e files |

**Additions that were not in the prototype (veto-able):** a sun/moon theme switch in the top bar (the light theme had no way to be turned on in the real app; it remembers the choice in `tl.capture.theme`, and `?theme=light` also works).
**Intentionally not in the Photo step any more (your round-2 request):** DEMO chip, system-status chip, worker/site pills, "Mission brief" heading, the pipeline footer line. They still exist on the other steps and the dashboard.
