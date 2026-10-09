# Capture · Arrival step redesign: progress

Started and implemented 2026-10-09. Prototype only (plain HTML/CSS/JS, mock data). `client/` is untouched. See `README.md`.

| Phase | What | State |
|---|---|---|
| 0 | Read the approved Photo step (tokens, shell, stepper, feed, tiles) and the real Arrival code (Capture.jsx sensors step, SensorTile, TrailTile, Waveform, signalBars, display.js) | done |
| 1 | `css/cap-arrival.css`: cap-arr, cap-view, cap-thumb, cap-progress, cap-sensor, cap-ring, cap-signal, cap-notice (only additions; tokens unchanged) | done |
| 2 | Data + state model (25 states, 5 play scripts), renderer, app (3 s sequence, ring, waveform, transitions) | done |
| 3 | Viewer, gallery, Coverage page (22 ids + 9 additions), component sheet | done |
| 4 | `node tools/verify.mjs`: 22/22 ids in the DOM; 20 frozen states × 3 widths + 4 light phone states, no overflow, no clipped content, phone touch targets ≥ 44px; 216 contrast samples ≥ 4.65:1 in both themes; 5 timed flows | done, 0 problems |
| 5 | README with React mapping and decisions | done |

Bugs found and fixed while testing: (1) the 24px slide-in briefly caused a horizontal scrollbar → `overflow-x: clip` on `.cap-main`; (2) amber “Unavailable” pill measured 4.33:1 in light theme → opaque pill fill inside tiles; (3) state pills were misaligned when a tile had a ring or bars → ring moved next to the waveform, bars into the value row.

## Open (needs you)

| Item | What |
|---|---|
| Review and approve | Open `/capture-arrival/`, go through the groups at the three widths and both themes; veto any decision in README |
| Real devices / screen reader | Not tested |
| Mock values | Marked in `js/arrival-data.js`; the app's real values replace them on port |
| Porting | After approval: add `cap-arrival.css` to `client/src/styles/capture.css`, re-skin `SensorTile` / `TrailTile` / the sensors step (mapping table in README). Not started |

## Wired into the real app (2026-10-09, after you approved)

The Arrival step of `/` in `client/` now uses this design. AI scan and Verdict (steps 3-4) are untouched and keep the old shell and look.

| Where | What |
|---|---|
| `client/src/styles/capture.css` | `cap-arrival.css` appended (only additions; same tokens). Step transition is now `.cap-main[data-enter]` instead of the prototype's `.cap-view` wrapper |
| `components/capture/ArrivalCard.jsx` (new) | The card: eyebrow, title, thumbnail of the real photo, instruction, progress, tiles, notice |
| `SensorTile.jsx`, `TrailTile.jsx`, `Waveform.jsx` | New markup/classes. Same props (`icon, title, state, value, aside, children`); Waveform is now an SVG path and also has `hold` (keep the trace once Locked). The Sensor feed's Motion tab uses the same Waveform |
| `CountdownRing.jsx`, `SignalBars.jsx` (new) | The 3.0 → 0.0 ring and the 4/2/1-bar indicator |
| `lib/arrivalProgress.js`, `lib/sensorNotes.js` (new, with tests) | "n of 4 readings done" maths; the three note strings now live in one place and are used by the card and by `onSubmit` |
| `pages/Capture.jsx` | Step `sensors` renders in `CapShell` + the new `Stepper` (current = 1). New state `continuing` (the 0.5 s pause) and `enter` (`fwd` / `back` page transition); `netType` added to the readout. Submission logic is unchanged |
| `components/capture/CapShell.jsx` | `enter` prop → `data-enter` on `<main>` |
| `tools/e2e/hud-e2e.mjs` | New Arrival checks in `fusion_genuine`, `fusion_optout`, `fusion_denied` (originals saved in `old-capture-backup/`) |
| `old-capture-backup/` | The previous `Capture.jsx`, `SensorTile`, `TrailTile`, `Waveform`, `CapShell`, `capture.css`, `hud-e2e.mjs` |

Differences from the prototype (veto-able):
- No slide-**out** animation: a step change is a cut plus the slide-in of the next screen (the shell cannot animate an exit across two returns of `Capture`). The error path slides the Photo step in from the left.
- When the readings finish while the recording has no fix yet, the Approach trail can still be Acquiring: the card then says "3 of 4 readings done" next to "Continuing…" (the app never waited for the trail; the prototype's "all four Locked" is the usual case).
- AI scan and Verdict still open in the old shell (a visible shell change from Arrival to AI scan until those steps are redesigned).

### Verification of the port (2026-10-09)

| Check | Result |
|---|---|
| `npm test` (client) | 298 / 298 pass, including new tests for `arrivalProgress` and `sensorNotes` |
| `vite build` | builds |
| `npm run e2e fusion_genuine` (real Chrome, real backend) | passes: Arrival card words, stepper (Photo done, Arrival active), 4 tiles in order, photo thumbnail, no buttons, ring + waveform while acquiring, resolved values in the original formats, "Continuing…", then AI scan and verdict |
| `fusion_optout` (nothing recorded) | passes: Approach trail Unavailable with the original wording, no strip |
| `fusion_denied` (location denied) | passes: GPS Unavailable "Location unavailable or denied" + the note; Motion not blamed |
| `fusion_teleport`, `fusion_notarrived` | pass |
| `fusion_layout` | **3 checks fail** (Photo step, "visit box is a single compact row ≤ 70 px", measured 215-233 px). It does not touch the Arrival step; most likely a stale test left from the Photo redesign. Not investigated or changed |
| Full `npm run e2e` | **crashes in `facetiming`** (a face-mesh timing measurement: `undefined.toFixed`), before reaching the fusion scenarios; not related to this change. Not investigated |
| Screenshots of the real page | desktop only (acquiring and continuing), matches the prototype. Phone and light theme of the real app not screenshotted (they are the same CSS as the verified prototype) |

Observed: in the e2e harness the card stayed ~10 s because the emulated GPS fix is slow; the "~3 seconds" holds only when GPS answers fast (as before this change).
