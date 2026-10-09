# Verdict step redesign: progress

Implemented 2026-10-09. Prototype only (plain HTML/CSS/JS, mock data). `client/` and `capture-photo/` are untouched. See `README.md`.

| Phase | What | State |
|---|---|---|
| 0 | Read the Photo prototype (tokens, components, shell, verify), the real `Verdict.jsx`, `FetchedPanel.jsx`, `display.js`, `ShapBars`, `Gauge`, the notes banner in `Capture.jsx`, and the server's real `top_reason` wording | done |
| 1 | New CSS (`cap-verdict.css`): badge, burst, gauge, id row, reason, SHAP, fetched rows, layouts at 1000 / 721-999 / 720; no new colour token | done |
| 2 | Data + helpers ported 1:1 (`cap-verdict-data.js`), 15 presets, renderers, app wiring (count-up, copy, Details, menu) | done |
| 3 | Viewer, gallery, Coverage (33 ids + Additions), component sheet | done |
| 4 | `node tools/verify.mjs`: 33/33 ids, 15 states × 4 widths, wording checks, 10 flows, contrast: 0 problems (`verify-output.txt`) | done |
| 5 | README with React mapping, decisions, limits | done |

Bugs found and fixed while testing: flex column shrinking cards/sticky bar on phone; no visible step label on phones when every step is done; tablet card gap; copy button 44×42 on phones; the inherited full-screen toast region swallowing taps on phones; two wrong test expectations.

## Open (needs you)

| Item | What |
|---|---|
| Review and approve | Open `/capture-verdict/`, go through the 5 state groups at the three widths, veto any row in the README decisions table |
| Real devices / screen reader | Not tested |
| Mock wording | Ids, numbers, organisation names are invented (sentence templates and `top_reason` strings are real) |
| Porting | After approval: build the components from the README mapping table (not started) |
| Supervision | `CLAUDE.md` asks for the `edge-validator-ai` subagent after milestones; it is not an available agent type here and this work does not touch edge-validator, so it was not invoked |

## Port to `client/` (2026-10-09, after you approved)

| Phase | What | State |
|---|---|---|
| 6 | CSS appended to `client/src/styles/capture.css`; `FraudGauge`, `VerdictCard`, `WhyCard` (new), `FetchedPanel`, `Verdict`, `Stepper` (all-done) rewritten; `Capture.jsx` verdict branch now in `CapShell` | done |
| 7 | `vite build` passes. Real-backend e2e (`fusion_genuine`, `fusion_teleport`, `fusion_notarrived`, isolated backend): all verdict checks PASS (green / red tones, 5 arrival wording, GPS jump in red, "What was fetched" rows, no console errors) | done |
| 8 | `client/tools/e2e/hud-e2e.mjs` selectors updated (original in `old-verdict-backup/e2e/`) | done |

Not covered by the e2e run: the "New submission" step in `fusion_demo`, and the phone layout of the real app (checked only in the prototype). One e2e check failed in the Arrival step (`arrival: the readings resolve…`), and `fusion_layout` fails "the visit box is a single compact row (<= 70 px)" (215 px) in the Photo step; neither touches the verdict. The e2e needs web port 5173 (the backend's CORS allows only 5173/5174 for IP origins), or `EXTRA_CORS_ORIGINS=http://127.0.0.1:<port>` for another port.
