# Capture · AI scan step redesign (prototype, step 3 of 4)

Plain HTML/CSS/JS, mock data, no build step. Only the **AI scan step**, with all its states. It **links** the approved Photo step's `cap-tokens.css`, `cap-components.css` and `cap-page.css` (nothing copied, nothing changed there) and adds `css/scan.css` for the few new components. `client/` is not touched, and nothing here is wired into the real app yet.

## Run it

```
cd trust-layer/redesign
PORT=5181 node serve.mjs
```

| URL | What |
|---|---|
| `/capture-scan/` | **Viewer**: state switcher (15 states in 5 groups), device (desktop / tablet / phone), theme (dark / light), motion (normal / reduced), and **Run it live** (the real timeline: fast server, 12 s server, slow server, server error) |
| `/capture-scan/app.html` | The page itself. `?state=<id>` `&theme=light` `&motion=reduce` `&play=demo\|fast\|slow\|fail` `&return=0` |
| `/capture-scan/frames.html` | Gallery: every state at 1280, 820 and 390 (dark), plus phone in the light theme and reduced motion |
| `/capture-scan/coverage.html` | Inventory B1…B8 → where it lives, plus the Additions table |
| `/capture-scan/tokens.html` | New components: classes, CSS variables, accessibility notes |
| `node tools/verify.mjs` | Automated check (see "What was verified") |

## What the step looks like

One centered card (`cap-flow`, 560px, the same card, head, thumbnail and slide-in as the Arrival prototype in `../capture-arrival/`) under the Photo step's top bar and step indicator (Photo, Arrival = check; AI scan = blue; Verdict = muted).

| Part | What |
|---|---|
| Head | eyebrow “AI analysis”, title “Neural scan in progress” (20px like Arrival's), and top-right the verified-photo thumbnail with its check badge (addition, identical to Arrival's) |
| Top row | the **scan mark** (56px): three thin rings, one slowly turning arc, a softly pulsing core, flat, one hue; to its right a task chip (addition) and the thin indeterminate bar (addition: the 20-segment meter with a travelling highlight, no number) |
| Checklist | the five lines, each with an icon and a word: done (check, “Done”), active (spinner, “Running”, blue tint + border), pending (muted, “Waiting”). The active row moves down every 650 ms. A sixth row “Finishing up…” (addition) takes over when line 5 is done and the server has not answered |
| Quiet lines | slow server (8 s+): “Still working. This can take a moment on a slow connection.”; failure: “Going back to the Photo step…” |
| Banners | sensor notes (B4, amber) and, only on failure, the red “Submission failed: …” alert |

No buttons, links or inputs live in the card (B7). On phones everything fits one screen with the bottom nav; there is no primary action, so nothing needs to be in thumb reach.

## Decisions taken on your behalf (veto any)

| # | Decision | Why |
|---|---|---|
| 1 | The five lines are **all visible** from the start instead of only the latest 4. Done rows are dimmed (that keeps “older lines dimmed”) | A checklist needs all steps visible; nothing is hidden, nothing needs scrolling back |
| 2 | **Blinking cursor and “>” prefixes dropped**; the spinner on the active row marks the latest line | They are terminal syntax; you asked for the checklist |
| 3 | After line 5 has run for its 650 ms, all five show “Done” and a **“Finishing up…”** row waits for the server | The old screen kept line 5 as the latest forever. The checklist is **time-paced, like the React code, not reported by the server**; “Finishing up…” is the honest way to say “the lines are done, the answer is not”. At the 2.6 s floor with a fast server you go straight to the verdict and never see it |
| 4 | **One** hidden polite status region speaks “Step n of 5: <line>” once per line; the visible list is not live | The old terminal re-announced as it grew. Each message is spoken once; verified by a test |
| 5 | The progress bar is `role="progressbar"` **without a value**, not `role="meter"` | Indeterminate by definition; meter is kept for real values on the Photo step |
| 6 | Failure frame is **held about 1.6 s** before the Photo step opens (prototype value) | The real code returns instantly, so the worker would see only a flash. The text then lives on as the Photo step's error banner (E1). This is the only behavioural change; set `holdMs` to 0 to keep it instant |
| 7 | On failure the row where it froze says “Stopped” in red | It marks where the screen froze, not which server check failed (the code does not know) |
| 8 | Sensor banner uses `role="note"` and the shield-alert icon (the old one was a ShieldX) | Static info should not be announced as a status; same family, same meaning |
| 9 | Stepper **left-aligned**, exactly as on the Photo and Arrival steps | Continuity first; see the note below if you want it centered everywhere |
| 10 | Context = Arrival's thumbnail (with badge) and a task chip; no worker/site pills and no “Photo verified” pill | You removed worker/site pills from the Photo step in round 2; the badge already says verified. The task chip is my only context chip (mock label) |

## Found in the Photo CSS (not changed)

`.cap ol { margin: 0 }` (specificity 0,1,1) beats `.cap-stepper { margin: 0 auto }` (0,1,0), so the stepper is left-aligned on the Photo and Arrival steps although the CSS says centered. I kept it left here so the three steps match. If you would rather have it centered above the centered cards, one line in `cap-page.css` does it for all steps: `.cap .cap-stepper { margin: 0 auto }`.

## Matched to the Arrival prototype

`../capture-arrival/` now exists, so this step copies its card instead of guessing: 560px column, 20px title (16px on phones), thumbnail + check badge in the head's top-right slot, the `cap-view` slide-in, `aria-busy` card. **Shared classes:** `.cap-thumb` (+ `__img`, `__badge`) and `.cap-view` are the same rules in `scan.css` and `cap-arrival.css`; keep one copy when the CSS is merged. The Arrival meter's off-cells use `--cap-border-2`; the busy bar does the same. Arrival's own notice (“Note … We continue anyway.”) stays on Arrival; this step keeps the original “Note: …. Submitted anyway.” sentence (B4).

## Mapping to your React components (for the later port)

| React today | New |
|---|---|
| `Capture.jsx` step `'analysis'` (motion.div `.panel`) | `cap-card cap-flow cap-scan`; keep the `MIN_ANALYSIS_MS` logic untouched |
| `Analysis.jsx` (`.neural`, `.terminal`) | `ScanMark` + `cap-steps` checklist; `LINES` and the 650 ms interval stay; add `phase` (`scan` / `finishing`) |
| `sensorNotes` banner | `cap-banner--warn`, same sentence |
| `setError('Submission failed: …')` + `setStep('photo')` | optional hold, then the Photo step's E1 banner (already designed) |
| `LegacyStepper` | the Photo step's `Stepper` with `current = 2` |
| Thumbnail | Arrival's `cap-thumb` figure, reused |

## What was verified

`node tools/verify.mjs` (Chrome headless, 1280 / 820 / 390): see `verify-output.txt`. Not tested: real devices, a screen reader, the light theme outdoors, Firefox/Safari.

## Wired into the real app (2026-10-09, after you approved)

Step 3 of `/` in `client/` now uses this design. Steps 1 (Photo) and 2 (Arrival) were already redesigned; step 4 (Verdict) is untouched and keeps the old shell and look.

| Where | What |
|---|---|
| `client/src/lib/scanProgress.js` (+ `.test.js`) | The five lines, the 650 ms cadence, the 8 s slow mark, the 1.6 s failure hold, `scanStage`, `lineState`, `finishingState`, `scanAnnouncement`, the note sentence. Pure and unit-tested (7 tests) |
| `client/src/components/capture/ScanCard.jsx` | New. Replaces `Analysis.jsx` and the old `.panel` block in `Capture.jsx`. One timeout per mark (no polling); one polite status region rendered empty and filled after mount |
| `client/src/pages/Capture.jsx` | Step `'analysis'` renders `CapShell` + `Stepper current=2` + `ScanCard` (thumbnail = the captured photo, chip = the task label, notes = `sensorNotes`). **Behaviour change (decision 6):** a failure *after* the scan has appeared is shown on the card for `SCAN_FAIL_HOLD_MS` (1.6 s) before the Photo step opens with the same “Submission failed: …” banner; a failure earlier (during the Arrival step) still returns at once. `MIN_ANALYSIS_MS` (2.6 s) and the request logic are unchanged |
| `client/src/styles/capture.css` | Appended block: `cap-scan`, `cap-scanmark`, `cap-meter--busy`, `cap-steps`/`cap-step`, `cap-scan__note`. The card is a `.cap-arr` column, so width, head, thumbnail and slide-in come from the Arrival port. The viewer-only `data-motion` switch and the duplicate `.cap-thumb` / `.cap-view` rules were left out (the app already has them) |
| `client/src/styles/global.css` | Deleted the now unused `.neural*` and `.terminal*` rules (the keyframes stay: other code may use them) |
| `client/tools/e2e/hud-e2e.mjs` | `fusion_genuine` now also checks the scan card: step indicator, exact wording and order of the five lines, thumbnail, no controls, starts on line 1, moves down, one live region, indeterminate bar, no note when every sensor worked |
| `old-analysis-backup/` | The previous `Analysis.jsx` and a note on the old markup |

Not carried over on purpose: the viewer's forced reduced-motion switch (the real app uses only `prefers-reduced-motion`).
