/* Inventory ids from the brief -> where each one lives in the new design. [id, what it is, where, state to open it in, component, kind]
   kind: 'inv' (inventory item), 'beh' (behaviour from the step description, no DOM of its own unless data-inv says so), 'add' (addition).
   tools/verify.mjs checks that every id marked with a DOM presence is found (data-inv) in at least one state and writes coverage-report.js. */
window.SCAN_COVERAGE = [
  ['B1a', 'Eyebrow “AI analysis”', 'Card head, small muted eyebrow with a brain-circuit icon (same anatomy as every card on the Photo step)', 'l1', 'cap-card__head, cap-eyebrow', 'inv'],
  ['B1b', 'Title “Neural scan in progress”', 'Card head, h2 in the same style as the Arrival step’s title (20px, 16px on phones). Wording unchanged; the head is left-aligned like the other cards (the old head was centered)', 'l1', 'cap-card__title', 'inv'],
  ['B2', 'Decorative scanning animation (aria-hidden): 4 concentric rotating arcs around a pulsing brain-circuit icon', 'Left of the first row of the card body, 56px (48px on phones). Three thin rings, ONE slow rotating arc (9 s per turn), a soft pulsing core with the brain-circuit icon. Flat: no glow, no gradient, one hue. Still aria-hidden. Reduced motion: arc and core static. Failure: the arc turns red and stops', 'l1', 'cap-scanmark', 'inv'],
  ['B3', 'The “terminal” log, redesigned as a vertical checklist of the five lines', 'Card body, ordered list “Scan steps” under the progress bar', 'l3', 'cap-steps, cap-step', 'inv'],
  ['B3.1', 'Line 1 “Comparing the GPS trail with the phone’s movement…”', 'Row 1 of the checklist, wording unchanged', 'l1', 'cap-step', 'inv'],
  ['B3.2', 'Line 2 “Checking the network against the site…”', 'Row 2', 'l2', 'cap-step', 'inv'],
  ['B3.3', 'Line 3 “Re-checking the photo on the server…”', 'Row 3', 'l3', 'cap-step', 'inv'],
  ['B3.4', 'Line 4 “Running gradient-boosting classifier…”', 'Row 4', 'l4', 'cap-step', 'inv'],
  ['B3.5', 'Line 5 “Computing SHAP explanation…”', 'Row 5', 'l5', 'cap-step', 'inv'],
  ['B3.s', 'Line states: done (check), active (spinner), pending (muted)', 'Every row carries an icon and a word: check + “Done”, spinner + “Running”, empty circle + “Waiting” (colour is never the only signal). Reduced motion: the spinner becomes a still ring-dot', 'l3', 'cap-step--done / --active / --pending', 'inv'],
  ['B3.h', '“Latest line is highlighted”, older lines dimmed', 'The active row has a blue tint, a thin blue border and full-strength text; finished rows are dimmed (muted text) and pending rows muted. On failure the row where it stopped turns red with “Stopped”', 'l3', 'cap-step--active, cap-step--halt', 'inv'],
  ['B3.t', 'Lines appear one after another, 650 ms apart', 'Same cadence: the active row moves down every 650 ms (line 1 at 0 s … line 5 at 2.6 s). Open “Run it live” in the viewer to watch it. Timing constants are in scan-data.js (LINE_MS)', 'l1', 'scan-state.js', 'beh'],
  ['B3.v', 'Only the latest 4 lines visible', 'Now ALL five are visible at all times (nothing is hidden, so nothing needs scrolling back); “older lines dimmed” is kept by dimming the done rows', 'l5', 'cap-steps', 'beh'],
  ['B3.c', 'Blinking cursor', 'Replaced by the spinner on the active row, which does the same job (marks the latest line). The “>” prompt characters of the terminal are dropped with the terminal', 'l3', 'cap-step__spin', 'beh'],
  ['B3.a', 'The log is an aria-live “polite” status region', 'One visually hidden polite status region (role=status, aria-atomic) that speaks “Step n of 5: <line>” once when a line becomes active, then “Finishing up…” and the slow line once each. The visible checklist is NOT live, so the lines are never read twice', 'l3', '#scan-live', 'inv'],
  ['B4', 'Warning banner when sensors were unavailable: “Note: {notes joined by ‘; ’}. Submitted anyway.”', 'Bottom of the card, the Photo step’s warning banner (amber border + tint, shield-alert icon, full sentence in text). One banner whatever the number of notes', 'notes1', 'cap-banner--warn', 'inv'],
  ['B4.1', 'Note “GPS unavailable or denied”', 'Inside the banner sentence, first position', 'notes1', 'cap-banner', 'inv'],
  ['B4.2', 'Note “no motion samples (sensor unavailable or denied)”', 'Inside the banner sentence', 'notes2', 'cap-banner', 'inv'],
  ['B4.3', 'Note “network info unavailable in this browser”', 'Inside the banner sentence', 'notes3', 'cap-banner', 'inv'],
  ['B5a', 'Step indicator: Photo and Arrival done, AI scan active', 'Above the card, same component as the Photo step (check, blue, muted)', 'l1', 'cap-stepper', 'inv'],
  ['B5b', 'Same app shell', 'Top bar (brand, nav), footer credit and phone bottom nav, reused unchanged from the Photo step', 'l1', 'cap-shell, cap-topbar, cap-footer, cap-bottomnav', 'inv'],
  ['B6', 'Behaviour: the screen shows progress for at least 2.6 s and stays until the server answers', 'Timeline in scan-state.js (MIN_MS). The checklist never claims the server is done: after line 5 it shows “Finishing up…” and waits. “Run it live” → Fast server shows the 2.6 s floor', 'finishing', 'scan-state.js', 'beh'],
  ['B7', 'Behaviour: no user actions', 'The card has no button, link or input. (The shell’s top bar and bottom nav remain, as on every step.)', 'l3', 'cap-flow', 'beh'],
  ['B8', 'Behaviour: on failure, return to Photo with “Submission failed: …”', 'The moment before: the card gets a red border, the scan stops, a role=alert banner shows the exact message; then it returns to the Photo step, whose error banner (E1) shows the same text', 'fail-503', 'cap-banner--error', 'inv'],

  ['X1', 'ADDITION: “Finishing up…” row with “Waiting for the server’s answer.”', 'A sixth row under the five, active style. Its space is reserved from the start so nothing jumps', 'finishing', 'cap-step--extra', 'add'],
  ['X2', 'ADDITION: slow-server line “Still working. This can take a moment on a slow connection.”', 'Quiet muted line with a clock icon under the list, appears after 8 s, no colour alarm; announced once through the live region', 'slow', 'cap-scan__note', 'add'],
  ['X3', 'ADDITION: “Going back to the Photo step…”', 'Quiet line under the failure banner', 'fail-503', 'cap-scan__note', 'add'],
  ['X4', 'ADDITION: verified-photo thumbnail with a check badge', 'Top-right slot of the card head, exactly as on the Arrival step (52px, 44px on phones; role=img, label “Your verified photo”), so the head does not change between steps', 'l1', 'cap-thumb', 'add'],
  ['X5', 'ADDITION: task chip', 'Chip with the task label (“Shelf / site photo”) above the bar, right of the scan mark. Mock content', 'l1', 'cap-chip', 'add'],
  ['X6', 'ADDITION: thin indeterminate progress bar', 'Right of the scan mark, under the task chip: the Photo/Arrival 20-segment meter with a travelling highlight, role=progressbar without a value (no number, no percentage). Reduced motion: static dashes', 'l1', 'cap-meter--busy', 'add'],
  ['X7', 'ADDITION: a state word on every row (Done / Running / Waiting / Stopped)', 'Right side of each row, 12px', 'l3', 'cap-step__word', 'add'],
  ['X8', 'ADDITION: failure styling', 'Red card border, red stopped bar and arc, “Stopped” on the row where it froze (marks where the screen froze, not which server check failed)', 'fail-503', 'cap-card--fail', 'add'],
  ['X9', 'ADDITION: centered flow card (560px)', 'One shared width for Arrival, AI scan and Verdict, the same as the Arrival prototype; the slide-in is the same too (560px, the Arrival card’s width). Defined as .cap-flow so Arrival can reuse it', 'l1', 'cap-flow', 'add']
];
