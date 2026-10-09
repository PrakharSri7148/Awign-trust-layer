/* Inventory of the Verdict step (C1…C5 from the brief, split into one id per element) -> where each one lives in the new design.
   [id, what it is (same wording as the brief), where it lives, state to open it in, component]
   tools/verify.mjs checks that every id is in the DOM (data-inv) in at least one state and writes coverage-report.js.
   B1 (the shared 4-step indicator) is listed because the brief says "all steps are done". */
window.CAP_COVERAGE = [
  ['B1', 'Step indicator: Photo, Arrival, AI scan, Verdict, all done', 'Above the card, same Stepper as the Photo step: every step shows a check and a green connector; on phones the current step (Verdict) keeps its label because no step is “active” any more', 'accepted-full', 'Stepper'],

  ['C1', 'Result card (green emphasis for accepted, red for flagged; border emphasis only, no glow)', 'Desktop: left column (380 px, sticky). Tablet: full width above the two cards. Phone: first card, status + gauge side by side. Tinted 1 px border via cap-card--ok / --fail', 'accepted-full', 'VerdictCard'],
  ['C1a', 'Status icon: shield-check (accepted) / shield-alert (flagged)', 'Inside a 48 px tinted badge (the “status pill”) at the top left of the card; green or red tint, never a glow', 'accepted-full', 'VerdictCard'],
  ['C1b', 'Accepted: one-time subtle celebration (a few small dots, reduced-motion safe); flagged has none', '14 small dots fly out of the badge once (1.1 s); not rendered for flagged; hidden by prefers-reduced-motion and by the viewer’s “Reduced” switch. “Celebration frame” state freezes it mid-burst', 'accepted-celebrate', 'VerdictCard'],
  ['C1c', 'Eyebrow “Verification result”', 'Small muted eyebrow above the title (cap-eyebrow)', 'accepted-full', 'VerdictCard'],
  ['C1d', 'Title “VERIFIED” or “FLAGGED FOR REVIEW” (plain text, no glitch effect)', 'h2, 22 px / 700 (20 px on phones), neutral text colour for both outcomes; the tone is carried by the badge, the border and the gauge', 'flagged-outside', 'VerdictCard'],
  ['C1e', 'Gauge of the fraud probability with the 50% threshold mark, label “Fraud prob.”, value counting up (e.g. “43.2%”), caption “threshold 50%”', '60-segment ring (the Photo step’s segment language) with a white tick at 6 o’clock for 50%; label, value and caption in the middle; role="meter" with aria-valuetext “43.2%, threshold 50%”; counts up 1.4 s (instant with reduced motion). 188 px desktop, 168 tablet, 132 phone', 'accepted-muted', 'FraudGauge'],
  ['C1f', 'Submission ID “ID #{id}”', 'Mono, in a bordered box under the title (phones/tablet) or centred under the gauge (desktop); wraps for long ids', 'accepted-full', 'VerdictCard'],
  ['C1g', 'Copy button (check for 1.5 s when copied; aria-label “Copy submission ID”)', 'Icon button inside the ID box, 40 px (44 px on touch/phones); the icon turns into a green check for 1.5 s. State “Copy button, copied” shows it frozen', 'copy-copied', 'VerdictCard'],

  ['C2', '“Why?” card', 'Desktop: right column, first card. Tablet: left of the two-up row. Phone: second card, right under the result card (and the notes banner)', 'accepted-full', 'WhyCard'],
  ['C2a', 'Eyebrow “Why?”', 'Card eyebrow (an h2, so the page outline is Result → Why? → What was fetched)', 'accepted-full', 'WhyCard'],
  ['C2b', 'The top_reason sentence', 'First thing in the card body, 16 px / 500: the plain-language reason, visible on the first phone screen', 'flagged-network', 'WhyCard'],
  ['C2c', 'Fusion row “Arrival at site” (5 wordings, tone green / amber / red / muted)', 'Row 1 of the fusion list (cap-check pattern of the Photo step: icon, label, sentence). inside = green, outside = red, close = amber, no fix / no site = muted. Open: accepted-full (inside), flagged-outside (outside), accepted-amber (close), flagged-nogps (no fix), accepted-nosite (no site)', 'flagged-outside', 'WhyCard'],
  ['C2d', 'Fusion row “Movement vs GPS” (“The phone’s movement matches the GPS trail”, the server’s reason, or “Not enough sensor data to compare the phone’s movement with the GPS trail”)', 'Row 2; same anatomy and tones', 'flagged-motion', 'WhyCard'],
  ['C2e', 'Fusion row “Network vs area” (“The network fits the claimed area”, the server’s reason, or “Network: not enough history to compare”)', 'Row 3; same anatomy and tones', 'flagged-network', 'WhyCard'],
  ['C2f', 'Eyebrow “SHAP factor breakdown”', 'Second section of the Why? card, under a hairline', 'accepted-full', 'WhyCard'],
  ['C2g', '3 horizontal bars “Photo quality”, “Motion consistency”, “Network vs area”, each with its percentage', '20-segment meters (the Photo step’s cap-meter), percentage right-aligned in tabular figures; role="meter" with aria-valuetext', 'accepted-full', 'ShapBars'],
  ['C2h', 'Tag “TOP DRIVER” and accent on the largest bar', 'Info pill next to the name, blue segments and bold percentage; the others are neutral grey. Different driver in accepted-full (photo), flagged-outside (motion), flagged-network (network)', 'flagged-network', 'ShapBars'],

  ['C3', '“What was fetched” card (only when fusion exists)', 'Desktop: right column under Why?. Tablet: right of the two-up row. Phone: third card, collapsed behind “Details” (the summary pills stay visible). Not rendered when there is no fusion', 'flagged-outside', 'FetchedPanel'],
  ['C3a', 'Eyebrow “What was fetched”', 'Card eyebrow (h2); phones: “Details” button top right (aria-expanded)', 'accepted-full', 'FetchedPanel'],
  ['C3b', 'Row “GPS fixes”: “{n} fixes ({k} accurate enough) over {s} s, {distance} travelled”', 'Row: icon (check = received, dash = not available), label, sentence. Two columns (label | sentence) when the card is ≥ 520 px, stacked below that', 'accepted-full', 'FetchedPanel'],
  ['C3c', 'Row “Motion windows”: “{n} of {m} five-second windows had accelerometer/gyroscope data” or “no accelerometer/gyroscope data arrived”', 'Same row anatomy', 'accepted-muted', 'FetchedPanel'],
  ['C3d', 'Row “Phone activity”: “still {a}% · walking {b}% · moving {c}%” or “not measured”', 'Same row anatomy', 'flagged-motion', 'FetchedPanel'],
  ['C3e', 'Row “GPS jumps”: “none” or “{n} jump(s) faster or farther than a device can move” in red', 'Red sentence and a red alert-triangle icon instead of the check (the only icon exception, listed under Additions)', 'flagged-outside', 'FetchedPanel'],
  ['C3f', 'Row “Site location”: “registered, radius {r} m; trail ended {d} from it” or “not registered: the arrival and outside-the-site checks were skipped”', 'Same row anatomy (dash when not registered)', 'accepted-nosite', 'FetchedPanel'],
  ['C3g', 'Row “IP location”: country · region · city · provider, or why it is unavailable (no IP database / private network address)', 'Same row anatomy (dash when unavailable)', 'accepted-muted', 'FetchedPanel'],
  ['C3h', 'Row “App hidden”: “never” or “{s} s in {n} break(s) (nothing recorded then)”', 'Same row anatomy', 'flagged-outside', 'FetchedPanel'],
  ['C3i', 'Row “GPS restarts”: “none needed” or “{n} (the GPS stalled and was restarted)”', 'Same row anatomy', 'flagged-outside', 'FetchedPanel'],
  ['C3j', 'Row “WiFi networks nearby”: “not available: {reason}”', 'Three trailing rows, always dash + muted text', 'accepted-full', 'FetchedPanel'],
  ['C3k', 'Row “Cell towers”: “not available: {reason}”', 'As above', 'accepted-full', 'FetchedPanel'],
  ['C3l', 'Row Android "mock location" flag: “not available: {reason}”', 'As above', 'accepted-full', 'FetchedPanel'],

  ['C4', 'Sensor-notes banner after the card: “Note: {notes}. Submitted anyway.”', 'cap-banner--warn (role="status") directly under the result card on desktop/tablet and between the result card and Why? on phones; only when there are notes', 'accepted-muted', 'NotesBanner'],
  ['C5', 'Primary action “New submission” (full width on the phone): scrolls to the top, resets the flow, reopens the camera, restarts the visit recording if the worker already agreed', 'Desktop/tablet: inside the result card, below the ID (full width in the 380 px column). Phone: one full-width button in a sticky bar above the bottom nav, so it is on the first screen and under the thumb. Behaviour is unchanged (the prototype shows a toast saying what the real app does)', 'accepted-full', 'NewSubmission']
];

/* Everything in the new design that was not in the inventory. */
window.CAP_ADDITIONS = [
  ['Phone-only summary pills in “What was fetched”', '“{n} received” (green) and “{m} not available” (grey), counted from the rows', 'Lets a collapsed card still say something; derived from the same rows'],
  ['“Details” button on the fetched card', 'Phones only: expands the 11 rows. Desktop and tablet always show them', 'Keeps the first phone screen to status + reason + action; nothing is removed'],
  ['Alert-triangle icon on the red GPS-jumps row', 'Replaces the check on that one row', 'A check next to “1 jump faster or farther…” would read as good news'],
  ['Screen-reader-only words in the fusion and fetched rows', 'Passed / Warning / Problem / No data and Received / Not available / Problem', 'Colour is never the only carrier'],
  ['“Copied” tooltip and live region on the copy button', 'Visible tooltip “Copied” for the 1.5 s and a polite status “Submission ID copied”', 'The check icon alone is easy to miss and silent for screen readers'],
  ['Hover/focus tooltip “Copy submission ID” on the copy button', 'Same pattern as the top-bar icons', 'The aria-label is unchanged'],
  ['Status badge around the shield icon', 'A 48 px tinted rounded square (the “status pill”)', 'Gives the icon the red/green emphasis without colouring the title'],
  ['Sticky action bar on phones', 'The same button, pinned above the bottom nav', 'The primary action must be reachable without scrolling'],
  ['The Verdict step label stays visible on phones', 'The Photo step shows only the active label; here none is active', 'Otherwise the phone shows four dots and no text'],
  ['Prototype-only controls (not in the product)', 'Viewer: Motion switch, “Replay count-up and celebration”, state list; the toast after “New submission”', 'Review tooling']
];
