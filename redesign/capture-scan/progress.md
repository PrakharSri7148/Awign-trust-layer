# Capture · AI scan step redesign: progress

Started and implemented 2026-10-09. Prototype only (plain HTML/CSS/JS, mock data). `client/` is untouched; the Photo step's files in `../capture-photo/` are linked, not modified. See `README.md` for how to run it, decisions taken on your behalf and the React mapping.

| Phase | What | State |
|---|---|---|
| 0 | Read the approved Photo step (tokens, components, page CSS, render, viewer, coverage) and the real AI scan code (`Analysis.jsx`, step `analysis` in `Capture.jsx`) | done |
| 1 | `css/scan.css`: flow card, scan mark, indeterminate bar, checklist, thumbnail row, quiet note, reduced-motion rules. No new color token | done |
| 2 | State engine: 15 presets in 5 groups + a real timeline (650 ms lines, 2.6 s floor, 8 s slow line, failure hold) | done |
| 3 | Page (`app.html`), viewer with state/device/theme/motion switchers and live runs, gallery, Coverage (inventory + additions), component sheet | done |
| 4 | `node tools/verify.mjs`: 19/19 inventory ids and 9/9 additions found in the DOM; 15 states × 3 widths with no overflow, no text under 12px, no controls in the card, reduced motion static; wording of lines and notes compared with the React source; live timeline (cadence, floor, each announcement once, slow line at 8 s, failure alert); contrast AA in both themes (output in `verify-output.txt`) | done, 0 problems |
| 5 | README | done |

## Open (needs you)

| Item | What |
|---|---|
| Review and approve | Open `/capture-scan/`, go through the 5 groups at the three widths and both themes; veto any decision in the README table (especially 1, 3, 6, 10) |
| Arrival step | Now exists in `../capture-arrival/`; this step was matched to it (560px, head, thumbnail, slide-in). Re-check both side by side after any change to either |
| Stepper alignment | The Photo CSS never centers its stepper (specificity), so all steps are left-aligned. Left as is for continuity; one-line fix in README if you want it centered |
| Real devices and screen reader | Not tested (iOS Safari, Android Chrome, Firefox, desktop Safari, VoiceOver/TalkBack). The “once per message” claim is verified on the live-region text, not by listening |
| Mock wording | “Photo verified”, the task chip, `Submission failed: Failed to fetch` and “Waiting for the server's answer.” are mine or mock |
| Porting | After approval; not started (approve first, as with the Photo step) |
| CLAUDE.md supervision | It asks for the `edge-validator-ai` subagent after milestones; it is not an available agent type here and this work does not touch edge-validator, so it was not invoked |

## Wired into the real app (2026-10-09, after you approved)

| Phase | What | State |
|---|---|---|
| 7 | `lib/scanProgress.js` + 7 unit tests (`npm test`: 305/305 pass) | done |
| 8 | `ScanCard.jsx`, CSS block in `capture.css`, `Capture.jsx` step `'analysis'` on `CapShell` + `Stepper`, failure hold, old `.neural` / `.terminal` CSS removed, old `Analysis.jsx` saved in `old-analysis-backup/` | done, `vite build` passes |
| 9 | `fusion_genuine` e2e extended with the scan checks (run on API 8011 / web 5183 with `EXTRA_CORS_ORIGINS=http://127.0.0.1:5183`, because 8001 and 5173 were taken by other processes): the 7 scan checks pass, 37 PASS / 1 FAIL in total | done; the 1 FAIL is an Arrival check (see below) |

Open: not tried on a real phone or with a screen reader; the failure hold (1.6 s) is a behaviour change you can set to 0 in `scanProgress.js` (`SCAN_FAIL_HOLD_MS`); the Verdict step still has the old look.

## e2e note (2026-10-09)

The one failing check is `arrival: the readings resolve … and then "Continuing…" shows`. In that run the GPS tile was still “Acquiring” at the end of the check's 7 s watch window (the one-shot GPS fix has a 10 s timeout in `sensors.js`, so with a slow scripted fix the Arrival card is still waiting). It runs before the scan step and touches no file changed for the scan; I did not run a baseline without my changes, so I cannot call it pre-existing, only unrelated. Widening the 7 s window in `hud-e2e.mjs` (about line 500 and in `submitThroughTheUi`) would settle it. A first run on ports 8011/5183 without the CORS override gave extra failures (visit id, trail, verdict) that were only blocked CORS requests; the backend allows web ports 5173/5174 only.
