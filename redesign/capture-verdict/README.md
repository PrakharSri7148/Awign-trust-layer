# Capture · Verdict step redesign (prototype)

Step 4 of 4 of the Capture page: the result screen ("what the system decided and why"). Plain HTML/CSS/JS, mock data, no build step. It reuses the **Photo step's tokens, primitives, shell and top bar as they are** (it links `../capture-photo/css/*` and `js/cap-render.js`); only `css/cap-verdict.css` and `js/cap-verdict-*.js` are new. `client/` is not touched.

## Run it

```
cd trust-layer/redesign
PORT=5181 node serve.mjs
```

| URL | What |
|---|---|
| `/capture-verdict/` | **Viewer**: 15 states in 5 groups, device (desktop / tablet / phone), theme (dark / light), motion (normal / reduced), "Replay count-up and celebration" |
| `/capture-verdict/app.html` | The page itself. `?state=<id>&theme=light&motion=reduce&static=1` (`static=1` = final values at once, no animation) |
| `/capture-verdict/frames.html` | Gallery: every state at 1280, 820 and 390 (dark), plus phone and desktop in light and the reduced-motion variant |
| `/capture-verdict/coverage.html` | Inventory → where it lives, the measured "found in N states", and the **Additions** table |
| `/capture-verdict/tokens.html` | Component sheet: live demos, class names, CSS variables, React mapping |
| `node tools/verify.mjs` | Automated check (see "What was verified") |

## Layout

| Width | Layout |
|---|---|
| Desktop ≥ 1000 | Centered, max 1080: left column 380 px (result card with the action inside, then the notes banner; sticky), right column: Why? then What was fetched |
| Tablet 721-999 | One column: the result card full width (title, ID and action left, gauge right), banner, then Why? and What was fetched side by side |
| Phone ≤ 720 | One column: result card (status left, gauge right), banner, Why?, What was fetched collapsed behind "Details" (summary pills visible). "New submission" in a sticky full-width bar above the bottom nav. Status, reason sentence and action are on the first screen at 390×844 |

## The states (switcher)

1 Accepted (full fusion + celebration, the celebration frame, muted fusion + notes banner, close-to-site amber, no site registered) · 2 Flagged (outside the site + GPS jump, by the network/VPN with a different TOP DRIVER, by movement, photo + no GPS fix) · 3 Older server (accepted / flagged without fusion) · 4 Copy button (default, copied) · 5 Stress (long id, long reason, 4 notes, 97.3%) and the IP-database warning in the top bar. Phone / desktop, dark / light and reduced motion are switches, not presets.

## Mapping to React (to port after approval)

| React today | Prototype | Notes |
|---|---|---|
| `Capture.jsx` verdict branch + `LegacyStepper` | `R.vstepper`, `cap-verdict`, `cap-banner` | Use the new `Stepper` with every step done (the last one keeps `aria-current="step"`); wrap in `CapShell` like the Photo step |
| `Verdict.jsx` | `R.vresult` → `cap-vres`, `cap-badge`, `cap-burst`, `cap-idrow` | Keep `useState(copied)` + the 1500 ms timeout; drop the `glitch` span and `panel--glow-*`; no framer-motion needed (CSS burst) |
| `ui/Gauge.jsx`, `ui/CountUp.jsx` | `R.vgauge` → `cap-gauge` (60 `<line>` segments) | Same props (`value`, `mark`); keep one `useCountUp` clock for the number and the lit segments; skip it when reduced motion |
| `ui/ShapBars.jsx` | `R.vshap` → `cap-shap` + `cap-meter--20` | Top driver = first max (`reduce` with `>`), as today |
| `verdictSummary()` | `R.vwhy` → `cap-fused` (`cap-check` rows) | `display.js` is unchanged and was ported 1:1 into `js/cap-verdict-data.js` |
| `FetchedPanel.jsx` | `R.vfetched` → `cap-vfet`, `cap-frow` | `fetchedSummary()` + `NOT_AVAILABLE` unchanged; "Details" only below 721 px (`useLayoutMode() === 'overlay'`) |
| `New submission` button | `R.vaction` | Render it inside the card when `layout !== 'overlay'`, in the sticky `cap-vaction` bar otherwise (one control at a time). `onReset` is unchanged |

## Decisions taken on your behalf (veto any)

| # | Decision | Why |
|---|---|---|
| 1 | The title is neutral text for both outcomes; the tone lives in the 48 px badge (the "status pill"), the card border and the gauge | "Flagged must feel neutral, red only on pill/border/gauge" |
| 2 | Gauge is a 60-segment ring (same cell language as the Photo step's meters) instead of a smooth arc; the 50% mark is a tick at 6 o'clock | Visual family; the exact value is always in the centre text |
| 3 | Notes banner sits directly under the result card (phone too), not at the very bottom | "After the card"; it explains the muted rows below it |
| 4 | Phone: "What was fetched" is collapsed behind **Details**; Why? and SHAP stay open | Keeps the first screen short; nothing removed |
| 5 | Phone: the action is a sticky bar, not a button at the end of the page | Reachable with the thumb without scrolling |
| 6 | Alert-triangle icon on the red GPS-jumps row (the brief says check/dash only) | A check next to a problem reads as good news |
| 7 | Fusion rows colour the label for amber/red and keep the sentence in normal text; muted rows use a dash | Colour plus icon plus word |
| 8 | Neutral grey segments for the non-top SHAP bars, accent blue for the top driver | "The largest has an accent" |
| 9 | Result wording (ids, numbers, example organisations) is mock; `top_reason` and all sentence templates are the server's real ones | Marked MOCK in `cap-verdict-data.js` |

## What was verified (`node tools/verify.mjs`, output in `verify-output.txt`)

Chrome headless, 15 presets × 4 widths (1280, 820, 390, 360): all 33 inventory ids in the DOM; no horizontal overflow; touch targets ≥ 44 px on phones; exactly one visible "New submission"; on phones the status title, the reason sentence and the action fit the first screen (the stress state and 360×740 may need a scroll, listed as notes); the five arrival wordings, the muted/fetched sentences, TOP DRIVER per state, the no-fusion hiding, the notes banner text, the gauge's `role="meter"` text; flows: count-up, one-time celebration, reduced motion (OS and viewer switch), copy (check for 1.5 s), Details toggle, sticky bar, menu + Esc, layout switch; WCAG contrast of the token pairs in both themes (text 4.5:1, segments 3:1).

## Not done / limits

| Item | State |
|---|---|
| Real devices (iOS Safari, Android Chrome), Firefox / Safari desktop | **Not tested**; Chrome headless only |
| Screen reader pass | Not done. Roles kept: `meter` (gauge, SHAP bars), `status` (notes banner, copy confirmation); card titles are h2 (the page has no h1, as on the Photo step) |
| Focus on arrival | The real app should move focus to the result title (`#vres-title`, add `tabindex="-1"`) when the step appears; the prototype does not |
| Real server data | Mock results only; copy button needs a secure context (falls back to `execCommand`) |
| Parallel work | `serve.mjs` is shared with the other step prototypes (Arrival, AI scan); only my routes were added |

## Heads-up about the Photo prototype

`capture-photo/app.html` has the same empty `.cap-toast-region` that inherits `.cap { min-height: 100dvh }`; on phones it covers the whole screen and swallows taps for real pointers (its verify script clicks via JS, so it did not notice). I fixed it only in `css/cap-verdict.css` and did not touch the approved folder. If the real client's toast region is built the same way, give it `pointer-events: none`.

## Wired into the real app (2026-10-09, after you approved)

The Verdict step of `/` in `client/` now uses this design. Steps 1-3 were already ported; the Capture page no longer uses `ChromeShell` or `LegacyStepper` at all.

| Where | What |
|---|---|
| `client/src/styles/capture.css` | The verdict CSS appended (tokens stay on `.cap`; `--cap-gauge` is set on `.cap`; the prototype-only viewer/toast bits were left out) |
| `components/capture/Verdict.jsx` | Rewritten: composition + layout (`useLayoutMode`), notes banner, sticky action bar on phones, moves focus to the result title |
| `components/capture/VerdictCard.jsx` (new) | C1: badge, celebration dots, title, gauge, ID + copy (1.5 s check, "Copied" tooltip, live region), `NewSubmission` button |
| `components/capture/FraudGauge.jsx` (new) | The 60-segment ring; one count-up clock for number and segments; final value at once with reduced motion |
| `components/capture/WhyCard.jsx` (new) | C2: reason, fusion rows (`verdictSummary()` unchanged), SHAP meters with TOP DRIVER |
| `components/capture/FetchedPanel.jsx` | Rewritten (same `fetchedSummary()` / `NOT_AVAILABLE`); phones collapse behind Details |
| `components/capture/Stepper.jsx` | `current={4}` = every step done; the last step keeps `aria-current` and its label on phones |
| `pages/Capture.jsx` | The verdict branch renders in `CapShell` + `Stepper current={4}`; unused imports removed |
| `client/tools/e2e/hud-e2e.mjs` | Selectors updated: `[data-testid=verdict-card]`, `[data-testid=top-reason]`, `[data-testid=new-submission]`; tone read from `data-tone`, red jump from `cap-frow--bad` (original saved in `old-verdict-backup/e2e/`) |
| `old-verdict-backup/` | The previous `Verdict.jsx`, `FetchedPanel.jsx`, `Stepper.jsx`, `Capture.jsx` and the e2e file |

Kept test ids: `fusion-verdict`, `fusion-arrival|motion|network`, `fetched-panel`, `fetched-<id>`. Left in place but no longer used by the Capture page: `components/ui/Gauge.jsx`, `CountUp.jsx`, `ShapBars.jsx`, `LegacyStepper.jsx`, the old `.verdict` / `.fz-vsum` / `.fetched` rules in `global.css`.
