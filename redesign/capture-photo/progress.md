# Capture · Photo step redesign: progress

Started and implemented 2026-10-09. Prototype only (plain HTML/CSS/JS, mock data). `client/` is untouched. See `README.md` for how to run it, the React mapping and the decisions taken on your behalf.

| Phase | What | State |
|---|---|---|
| 0 | Read the real Photo step (Capture.jsx, LiveCamera, LiveHud, LivenessOverlay, VisitPanel, SensorFeed, QualityChecklist, PhotoOverlay, Shell, strings, consent text) | done |
| 1 | Tokens (`--cap-*`, dark + light), primitives, all classes prefixed `cap-` | done |
| 2 | Page: shell, stepper, brief, banners, stage, HUD, liveness, visit, sensor feed, result, picker | done |
| 3 | State engine: 51 presets in 12 groups + working flows (open camera, capture, check, result, retake, arrive, liveness replay) | done |
| 4 | Viewer (state switcher, device, theme), gallery, Coverage page, token + component sheet | done |
| 5 | `node tools/verify.mjs`: 54/54 inventory ids found in the DOM; no horizontal overflow at 1280 / 820 / 390 in all 51 states; phone touch targets ≥ 44px; shutter on screen; 7 click-through flows; token contrast AA (output in `verify-output.txt`) | done, 0 problems |
| 6 | README with React mapping and decisions | done |

## Open (needs you)

| Item | What |
|---|---|
| Review and approve the design | Open `/capture-photo/`, go through the 12 state groups at the three widths; veto any "decision taken on your behalf" in README |
| Real devices | Not tested on iOS Safari / Android Chrome / Firefox / desktop Safari |
| Screen reader | Not tested (ARIA roles kept: meter, status, alert, note, tablist, dialog) |
| Mock wording | Live hint sentences, reasons and measured numbers are invented (marked MOCK in `js/cap-data.js`); swap for the real ones when porting |
| Porting | After approval: build the React components from the mapping table (not started, as agreed: approve first) |

## Round 2 (2026-10-09, on your request)

| Change | State |
|---|---|
| Removed the DEMO ON/OFF chip (A4) and the system status chip (A6) from the top bar | done |
| Removed the worker · / site · pills (C2) | done |
| Removed “Mission brief” + “Capture proof of work” (C1); the task picker (C3) and face note (C4) stay as a plain row under the stepper | done |
| Removed the “Edge validation → Sensor fusion → Explainable AI” line; kept the DB-IP credit (CC BY needs it) | done |

The 4 removed ids are marked `removed` in `js/cap-coverage-data.js`; `verify.mjs` now also fails if a removed id is still in the DOM. The phone “more” menu now appears only when there is an IP-database warning.
