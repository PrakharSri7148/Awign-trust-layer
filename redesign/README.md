# Trust Layer redesign prototype

A working, responsive prototype of the redesigned Trust Layer. Plain HTML, CSS and JavaScript, no build step, mock data only. It sits next to your React app and does not touch it (`client/` is unchanged).

## Run it

```
cd trust-layer/redesign
node serve.mjs          # http://localhost:5180
```

| URL | What it is |
|---|---|
| `/` | Capture, the worker app (mobile-first, 390px; centered in a phone-width column on desktop) |
| `/dashboard` | Reviewer console. `?view=queue\|submissions\|map\|settings` opens a tab directly |
| `/dashboard#case/412` | Case file slide-over deep link |
| `/frames` | Every capture state side by side in 390 × 844 frames, plus the light theme |
| `/design-system` | Color tokens, type scale, buttons, inputs, pills, cards, table, tooltip, toast |

You can also open the `.html` files directly from disk; the server only adds the clean routes.

## Files

```
css/tokens.css       all design tokens, dark default + light theme (data-theme="light")
css/base.css         reset, type, focus ring, reduced motion
css/components.css   pill, status, btn, input, segmented, panel/card, table, tooltip, popover/menu, tabs, accordion, toast, skeleton, empty-state, dialog, driver bars
css/dashboard.css    app shell, top bar, grid, KPI tabs, queue, map, right column, submissions, settings, responsive (1280 / 1100 / 900 / 720)
css/case-file.css    slide-over, tabs, decision bar
css/capture.css      worker app
js/data.js           40 mock submissions (seeded), sites, workers, reviews
js/data-detail.js    photo checks, live check, sensor-fusion report, importances, flags, site profiles, change log
js/insights.js       the three charts + Photo quality panel (hand-drawn SVG)
js/site-settings.js  Settings: Sites list/add and Site location (edit, confirm, learned network, change log)
js/ui.js             formatting, severity/status, toasts, focus trap, popover menus, theme
js/map.js            hex-dot map + markers + tooltip card
js/case-file.js      case file slide-over
js/dashboard.js      reviewer console
js/capture.js        capture flow
js/icons.js          generated from lucide (inline SVG, 16px, 1.6 stroke)
js/map-data.js       generated hex-dot land masks (Natural Earth 110m)
assets/fonts/        Inter variable woff2 (SIL OFL), self-hosted
```

## Where every existing section went

| Existing section | In the redesign |
|---|---|
| Header, LIVE status | Top bar "System online"; "Updated just now" in Needs review |
| KPIs: Total, Flagged, Accepted, Flag rate, Avg fraud | 5 KPI tabs (Accepted restored); each drives the queue and map |
| Chart: Fraud probability over time (threshold 50%) | Overview → Insights. Hover or arrow keys for a tooltip; "View data" table |
| Chart: Accepted vs flagged | Overview → Insights (thin ring) |
| Chart: Signal importance | Overview → Insights. **Radar became three horizontal bars** (clearer with 3 signals, readable by screen readers) |
| Photo quality panel (verdicts, stats, common flags) | Overview → Photo quality, same four stats and the flag chart with its three kinds |
| Review queue (reasons, count) | Review queue card with count badge; "Why it is here" in Needs review and the case file |
| Live submissions feed: status filter, search, **photo-issue filter**, load more, token prompt, error + Retry | All submissions: status, search, photo-issue filter, date range, pagination; token prompt and Retry banners (try `?auth=required` and `?error=1`) |
| Feed columns incl. fraud probability | Severity pill with the percentage beside it (the tiny SHAP column stays dropped) |
| Site location panel (edit, current-location, old → new confirm, learned network, forget, change log) | Settings → Site location, all of it |
| Sites panel (list + add) | Settings → Sites |
| Case file: why, SHAP | Summary tab |
| Case file: Photo section (checks server vs device, flags, live check, capture info, quality score) | Photo tab |
| Case file: Sensor fusion (two scores, trail, GPS vs phone strips, network checks, flags, evidence) | Sensors & trail tab |
| Case file: Review (name, decision, reason, history) | Pinned decision bar (name field restored) + "Earlier decisions" in Summary |
| Case file: Timeline | Timeline tab (all original steps plus review events) |
| Case file: Reset site network profile | Settings → Sites ("Reset network profile") and Site location ("Forget the learned network") |
| Demo buttons (Simulate flagged / accepted) | Left out on purpose, as your brief asked |

## Porting into the React/Vite app

- Copy `css/tokens.css`, `base.css`, `components.css` as they are, plus the page CSS. Class names are semantic (`.pill--critical`, `.kpi-tab`, `.slide-over`, `.decision-bar`, `.hud`, `.checklist`), and every color, radius and size is a variable.
- The `js/*.js` files build HTML strings from state; each `render…` function maps one-to-one onto a React component (`KpiTabs`, `ReviewQueue`, `SubmissionMap`, `NeedsReview`, `TopSources`, `SubmissionsTable`, `CaseFile`, `CaptureCamera`, `QualityResult`, `SendingStatus`, `Verdict`).
- Replace `TL_DATA` with `lib/api.js`. Field names already follow your model (`fraud_probability`, `top_reason`, `photo_verdict`, `quality_flags`, `review`, `gps`, `trail`).
- Lucide: use `lucide-react` with `size={16} strokeWidth={1.6}`; the names used are listed in `js/icons.js`.
- Light theme: `document.documentElement.dataset.theme = 'light'`.

## Decisions made on your behalf (veto any of these)

- **Low severity is gray**, as in the reference; green is used for OK / Resolved / Photo OK / improving deltas.
- **Status words**: Open = flagged and no decision; Resolved = a reviewer decided; Accepted = auto-accepted. The decision (approved / rejected / retake) shows in the case file.
- **KPI cards drive the views** as lenses: Submissions = all, Flagged = flagged only, Flag rate = submissions from sites with an above-average flag rate, Avg fraud probability = submissions at or above the average.
- **Map**: South Asia by default so the India sites are readable, World on a toggle; both outliers (Dubai, Singapore) are visible in their views. Several submissions at one site are fanned out a few pixels so each stays clickable. "Show as table" is the text alternative.
- **Time ranges** are presets (24 hours / 7 days / all), not a calendar picker.
- Prototype only: no upload, no real model. The capture camera is simulated; "Diagnostics → Camera → This device" tries the real camera.
- The photo in the case file is an illustration, since no real photos ship with the prototype.
- Deltas on the KPI cards compare with hard-coded "previous 7 days" mock numbers.
- The top-bar notification dot and unread count are static.
- The access-token prompt and error banner are simulated with `?auth=required` / `?error=1`; any non-empty token unlocks.
- "Use my current location" uses the browser's real geolocation (needs permission; HTTPS on phones).

## Tested

Two scripted Chrome runs (puppeteer, about 90 checks) covering the new sections too (charts, photo filter, banners, sites, site-location edit flow, case-file tabs, reviewer name), plus KPI selection, legend toggles, tooltip, sorting, filters and empty state, accordion, Refresh, deep link (warm and cold, plus a bad id), focus trap, Esc and focus return, decision validation, Settings reset dialog, no horizontal scroll at 1100 / 720 / 390, and the full capture flow (consent, shoot, send, verdict, warning confirm, offline).

Not tested: real phones, Safari/Firefox, screen readers (labels and roles are in place but not heard), real camera permission flows.
