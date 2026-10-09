# Redesign progress

Started and implemented 2026-10-09. The prototype lives in `trust-layer/redesign/`. **Round 3 (below) wired the redesigned dashboard into the React app in `client/` (the `/dashboard` route only).** See `README.md` for how to run the prototype and the decisions taken on your behalf.

## Done

| Phase | What | State |
|---|---|---|
| 0 | Read the existing app (routes `/` and `/dashboard`, tokens, Capture and CaseFile components) to keep content and features | done |
| 1 | Tokens (dark + light), base, shared components, Inter self-hosted, lucide icon set generated | done |
| 2 | Mock data: 40 cases over 9 Indian city sites + 2 outliers (Dubai, Singapore), reviews, SHAP drivers, trails | done |
| 3 | Reviewer console: top bar, 4 KPI tabs driving queue + map, review queue, hex-dot map with tooltip card and legend chips, Needs review accordion + Refresh, Top flagged sources, All submissions (sort, status, search, date range, pagination, kebab), Settings (hosts the network-profile reset) | done |
| 4 | Case file: 520px slide-over, `#case/412` deep link, focus trap, Esc, focus return, 4 tabs, pinned decision bar, prev/next | done |
| 5 | Capture flow: camera-first, consent sheet, visit pill, HUD, liveness ring, 72px shutter, quality checklist with quiet confirm, real status list, offline state, plain verdict, Diagnostics | done |
| 6 | Frames page and design-system page | done |
| 7 | Scripted Chrome test, screenshots at 1440 / 1100 / 390, contrast check; bugs found and fixed (see below) | done |

## Round 2 (2026-10-09): every missing section added

Compared the redesign against the existing React sections one by one (see the table in `README.md`). Added: Accepted KPI, the three charts, Photo quality panel, photo-issue filter, fraud % in the table, token and error banners, Sites + Site location in Settings (with the learned network, forget, old → new confirm and change log), the full case-file Photo and Sensor-fusion detail, reviewer name field, review history, review reasons. About 90 scripted checks pass.

## Round 3 (2026-10-09): wired into the real app, `/dashboard` only

The Capture page, its components and its styles were not touched. The old dashboard files are backed up in `redesign/old-dashboard-backup/` (no git here), together with the original `hud-e2e.mjs`.

| Part | What changed in `client/` |
|---|---|
| Page | `src/pages/Dashboard.jsx` rewritten: top bar, 5 KPI tabs, review queue, map, Needs review, All submissions, Top flagged sources, charts, Photo quality, Settings, case file slide-over |
| Components | `src/components/dashboard/`: TopBar, KpiStrip, ReviewQueue, SubmissionMap, NeedsReview, TopSources, Submissions, Insights, CaseFile, FusionSection, DecisionBar, Settings, SiteLocation, Popover, ui, hooks. Old Charts, Feed, Kpis, QualityPanel, ReviewSection, SiteLocationPanel, SitesPanel removed; unused `ui/PhotoBadge`, `StatusBadge`, `Spark` removed |
| Logic | `src/lib/dashboard/model.js` (severity, status, KPI lenses, sorting, filters, needs-review, top sources, chart numbers, map markers) with 12 unit tests; `mapData.js` (hex-dot land masks) |
| Styles | `src/styles/dashboard.css`: every class has an `rd-` prefix and every selector sits under `.rd`, so nothing leaks into Capture (and nothing from the old global CSS leaks in). Inter is self-hosted in `public/fonts/` under the name "Trust Inter" so Capture's font is unchanged |
| Shell | `Shell.jsx` renders `/dashboard` without the old header and footer (the console has its own); every other route is unchanged. The DEMO chip lives on Capture's header and in Settings → Demo data |
| Data | Real: `/submissions` (polled every 5 s), `/submissions/{id}`, `/reviews`, `/sites*`, `/health`. The map puts markers at each submission's registered site (a submission row has no coordinates of its own) |
| e2e | `tools/e2e/hud-e2e.mjs` updated for the new structure (same assertions): newest-first rows come from `[data-testid=subs-table]`, queue rows are `[data-testid=queue-row]`, review form fields have `review-*` test ids, fusion and live-check sections are opened through their tabs, the site panel is under `?view=settings` |

Verification (all on an isolated backend and Vite on spare ports, never your 8000 / 5174): `npm test` 293 pass (281 before + 12 new); `npm run build` ok; full `npm run e2e` 360 checks pass except one phone-size site-panel step, fixed and re-run (43 pass); `npm run e2e:public` 43 pass (token prompt, no third-party request, case files). Bugs found on the way: the fixed bottom tab bar can sit on top of a button at the starting scroll position (added `scroll-padding-bottom` so scrolled-to and tabbed-to elements stay clear of it; the test now scrolls before tapping), and the Sensor fusion wrapper had no box so it could not be screenshotted.

Differences from the prototype that come from real data: severity bars in the case file show the model's three signal groups (the real model returns those, not per-case SHAP features), Needs review and the queue use the server's `needs_review` and `review_reasons`, status Open means "needs a decision", the notification settings and the fake reviewer email were dropped (nothing behind them), and the 7-day change pills compare with the real previous 7 days (no pill when there is nothing to compare).

## Bugs found while testing (all fixed)

- Case file Photo tab: the photo frame overlapped the section below it (grid sizing quirk); now a fixed height.

- Success toasts sat on top of the decision bar and blocked "Submit"; toasts now move to the other side (top on phones) while a case is open.
- Light theme OK and High pills were 4.3:1; darkened to 5.2:1+.
- After a decision re-sorted the lists, closing the case lost focus; it now falls back to the page.

## Not done / limits

| Item | Why |
|---|---|
| Real devices, Safari, Firefox | only Chrome desktop (headless) was run |
| Screen reader pass | roles, labels, live regions and keyboard paths are in, but nobody listened to them |
| Real photos in the case file | prototype shows an illustration |
| Real upload / model / auth | all mock; "Diagnostics" simulates scenarios |
| Light theme for the console | tokens work (Settings → Appearance), but only the Capture page was designed and checked for it |
| `edge-validator-ai` supervision agent from `CLAUDE.md` | not available in this session's agent list, so it was not invoked |
| Porting into `client/` | not started, waiting for your approval of the redesign |
| Real data wiring | the prototype uses mock data; the existing `lib/api.js`, `sensorFusion/*` and `photoQuality/*` helpers are not connected yet |

## What you need to do next

| Ask | Why |
|---|---|
| Run `node serve.mjs` in `redesign/` and click through `/dashboard` and `/` | judge the look against the reference |
| Tell me which of the "decisions on your behalf" in the README to change | KPI lens meanings and Low = gray are the likeliest |
| Say when to port it into `client/` (React) | I held off so the existing app and its e2e tests stay working |

## Round 4 (2026-10-09): Arrival, AI scan and Verdict: failures reviewed, one combined e2e, UI check finished

Everything below is in `client/` (the real app). The Arrival, AI scan and Verdict steps were already wired in; this round reproduced the e2e failures, fixed them, and added one test that runs the three pages as a single flow.

### What failed, and why

First full `npm run e2e` (isolated backend on 8001 / web 5173, your 8000 / 5174 untouched): 6 failing checks. The two crashes recorded in the older logs (`facetiming` `undefined.toFixed`, `liveness` ".cap-shutter not found") did **not** reproduce: both passed; they happened while the Photo selectors were being changed.

| Failure | Cause | Kind | Fix |
|---|---|---|---|
| `fusion_layout` x3: "visit box is a single compact row (<= 70 px)", measured 215-233 px | The test was written for the old one-line box; the approved Photo design made it a card. The invariants that matter (shutter in view without scrolling, camera >= 45% of the window) pass | stale test | bound is now <= 260 px, with the reason in the check name |
| `segments`: "cells fade over ~120 ms", got 0 s | The redesign dropped the 120 ms fade on the live HUD meter cells that the old segment meter had (the HUD updates ~5x a second, so cells snapped) | **app regression** | `.cap-hud .cap-meter__cell { transition: background-color 120ms linear }`, motion-safe only (`capture.css`) |
| `?debug=checks` panel not found | The panel is now behind a "Diagnostics: debug checks" button (a drawer) | stale test | the test clicks the button first |
| Site location change log "newest first" | A race, only in a full run: earlier scenarios leave rows in the log, so "wait for >= 2 rows" was already true before this save's row arrived | racy test | waits for this save's row (`moved 2xx km`) at the top |

### New: one test for the three pages together

`npm run e2e:steps` (scenario `capture_steps` in `tools/e2e/hud-e2e.mjs`). One real submission goes Arrival -> AI scan -> Verdict while a per-frame recorder logs what is on screen. Six runs: desktop dark; tablet 820 light + reduced motion; phone 390 dark (touch); phone light with a flagged result (the server's answer is rewritten in the page, so the numbers are not the server's); location denied; a dropped connection on the first submission, then Retry. 345 checks:

- Order and transitions: Arrival -> AI scan -> Verdict, once each, no frame of another page in between; the scan stays at least 2.5 s; the stepper reads Arrival 1 done / AI scan 2 done / Verdict 4 done; the top bar and theme never change; Arrival and AI scan cards have the same left edge and width; the four sensor tiles never move while readings resolve; no sideways scroll; each page opens at the top.
- Per page (Photo result, Arrival acquiring and resolved, AI scan, Verdict): no overflow, no text under 12 px, AA contrast measured on real backgrounds, 44 px touch targets on the phone (24 px elsewhere), nothing clipped or past the edge, no broken images, duplicate ids or dangling aria references, one `<main>`.
- Verdict against the server's stored record: status, title, id, fraud probability and count-up, the reason sentence, three fusion lines, three SHAP rows with one TOP DRIVER, all 8 + 3 "What was fetched" rows (behind Details on phones), the title takes focus, copy-id feedback, "New submission" back to Photo (theme kept, camera ready). Notes: the same sentence on all three pages when GPS is denied, none when every sensor worked.
- Failure path: the scan card shows the failure once (role=alert, stopped row, aria-busy false), then the Photo step returns with the same message and a Retry that completes the flow.

### App bugs it found (all fixed)

| Bug | Where | Fix |
|---|---|---|
| Every step opened at the old scroll position: the Verdict opened ~220 px down with the top bar and progress bar out of view; on phones Arrival opened partway down | `Capture.jsx` | `scrollTo(0, 0)` whenever the step changes |
| Primary button text was the page colour, not white: 4.06:1 (dark) and 3.33:1 (light), below AA. Cause: `.cap button { font: inherit; color: inherit }` (specificity 0,1,1) outranked `.cap-btn--primary` (0,1,0). Same rule also made every button ignore its size and weight, and ghost / danger buttons ignore their colours | `capture.css` | the reset is now `.cap :where(button, input, select)`, so the button classes win. Buttons now follow the approved design (larger / bolder text than before) |
| On phones a keyboard-focused control (e.g. "Details" on the Verdict) scrolled in underneath the bottom nav and the sticky "New submission" bar | `capture.css` | `scroll-padding-bottom` on `html` (76 px, 148 px with the sticky bar), the same fix the dashboard already uses |

### Verification

| Check | Result |
|---|---|
| `npm test` | 305 / 305 pass |
| `npm run build` | builds |
| `npm run e2e capture_steps` | ALL CHECKS PASSED, 345 checks |
| full `npm run e2e` (all scenarios, `capture_steps` included, isolated backend on 8001 / web 5173) | **ALL CHECKS PASSED, 719 checks**. Before this round the same suite had 6 failing checks |

### Open / not covered

- Real phones, iOS Safari, Firefox, a screen reader: not tested (headless Chrome only).
- The Arrival card can stay up for about 10 s, not "~3 seconds": the one-shot GPS request has a 10 s timeout and only then falls back to the visit recording's fresh fix (`getGPS()` in `sensors.js`, used in `Capture.jsx`). Seen in the e2e with the scripted GPS. The new test asserts it hands over within 12 s. A real fix would use the recording's fix straight away when it is fresh (a behaviour change, not made here).
- The `edge-validator-ai` supervision agent from `CLAUDE.md` is not an available agent type in this session, so it was not invoked.
