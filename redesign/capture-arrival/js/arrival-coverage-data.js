/* Inventory ids from the brief (A1-A8, with the parts of A4 numbered) -> where each one lives in the new design.
   [id, what it is, where it lives, state to open it in, component]. tools/verify.mjs checks that every id is in the DOM (data-inv) in at least one state
   and writes coverage-report.js. The shell ids of the Photo step (brand, nav, stepper...) are NOT part of this inventory. */
window.CAP_ARR_COVERAGE = [
  ['A1', 'Eyebrow “Verifying your arrival”', 'Card head, small muted eyebrow with a map-pin icon (same cap-eyebrow as the Photo step cards)', 'acq-all', 'cap-eyebrow'],
  ['A2', 'Title “Sending your location”', 'Card head, card title (20px; 16px on phones)', 'acq-all', 'cap-card__title'],
  ['A3', 'Instruction paragraph (“Your photo is verified. Hold the phone naturally for ~3 seconds…”)', 'First paragraph of the card body, full wording, muted 13px', 'acq-all', 'cap-arr__lead'],
  ['A4', 'Four sensor tiles: icon, title, state label, value line', 'Under the progress summary: a list of four cap-sensor tiles in the order GPS, Motion, Network, Approach trail', 'mid', 'cap-sensor'],
  ['A4.icon', 'Tile icon (satellite, activity, wifi, route)', 'Left of each tile, 40px box (36px on phones); colour follows the state', 'mid', 'cap-sensor__icon'],
  ['A4.states', 'State labels Waiting (muted) · Acquiring (blue, spinner, pulsing icon) · Locked (green, check) · Unavailable (amber, warning icon); tile border + icon colour follow the state', 'State pill on the right of the tile title (cap-pill: skip / info / pass / warn, always word + icon); the 1px tile border and the icon box take the same tone; Acquiring adds a pulsing ring around the icon', 'wait', 'cap-sensor--wait / --acq / --ok / --na'],
  ['A4.gps', 'GPS tile', 'Tile 1', 'mid', 'cap-sensor'],
  ['A4.gps.value', 'GPS value: coordinates with 5 decimals “lat, lng”, or “Location unavailable or denied”', 'Value line under the title; coordinates in mono, the unavailable text in amber', 'mid', 'cap-sensor__value'],
  ['A4.motion', 'Motion tile', 'Tile 2', 'mid', 'cap-sensor'],
  ['A4.motion.value', 'Motion value: “{N} samples · mean {x.xx} m/s²” or “No samples (sensor unavailable or denied)”', 'Value line under the title (empty while Acquiring, as in the app)', 'done', 'cap-sensor__value'],
  ['A4.motion.ring', 'Circular countdown ring 3.0 → 0.0 s with the number in the middle (while Acquiring)', 'Right of the waveform inside the Motion tile; role=meter with a “s left” value text', 'mid', 'cap-ring'],
  ['A4.motion.wave', 'Live waveform of |acceleration| (flat line when there is no sensor)', 'Full-width strip in the Motion tile, the Photo step’s feed waveform; accent while live, grey once not live', 'acq-all', 'cap-feed__wave'],
  ['A4.net', 'Network tile', 'Tile 3', 'mid', 'cap-sensor'],
  ['A4.net.value', 'Network value: “{type} · {downlink} Mbps · {rtt} ms” or “Network info not exposed by this browser”', 'Value line under the title', 'mid', 'cap-sensor__value'],
  ['A4.net.bars', '4-bar signal indicator when Locked (4g = 4, 3g = 2, 2g / slow-2g / slow = 1)', 'Right end of the value row; role=img “Signal strength: n of 4 bars”', 'net-slow', 'cap-signal'],
  ['A4.trail', 'Approach trail tile (Locked = fixes or windows recorded, Acquiring = recording just started, Unavailable = nothing recorded)', 'Tile 4', 'mid', 'cap-sensor'],
  ['A4.trail.value', 'Recording summary “{n} location fix(es) · {distance} · ±{m} m” (+ “no motion sensor” / “motion denied”), or “Not recorded (start the visit recording on the first screen to add the approach)”', 'Value line under the title (wraps on phones)', 'trail-one', 'cap-sensor__value'],
  ['A4.trail.strip', 'Phone-activity strip, last 2 minutes (still, walking, moving, unknown) with an accessible label', 'Under the value inside the Trail tile, the Photo step’s cap-strip; role=img “Phone activity in the last two minutes”; only when there are cells, as in the app', 'mid', 'cap-strip'],
  ['A5', 'Tiles resolve independently (GPS and Motion when their reading returns, Network immediately)', 'Each tile has its own state and re-renders on its own; the summary counts them. See the “mid” state and the Play states', 'play-ok', 'cap-sensors'],
  ['A6', '0.5 s pause after all readings, then the flow moves to AI scan (no buttons on the screen)', 'The “Continuing…” pill next to the summary, the full meter, then a slide to the AI scan step (Arrival becomes ✓). No buttons on the card', 'done', 'cap-pill + cap-view'],
  ['A7', 'Notes when something is unavailable: “GPS unavailable or denied”, “no motion samples (sensor unavailable or denied)”, “network info unavailable in this browser”', 'Quiet inline notice under the tiles (amber icon, divider, role=status), one line per unavailable reading, same wording', 'na-all', 'cap-notice'],
  ['A8', 'Error path: a failed submission returns the user to the Photo step with the error banner (transition only)', 'Slide back to the left, stepper returns to Photo active / Arrival pending, the Photo step’s error banner (role=alert) on top of a placeholder for the Photo screen', 'err-back', 'cap-view + cap-banner--error']
];

/* Things the brief did not list, that the design adds. All are removable without losing any inventory item. */
window.CAP_ARR_ADDITIONS = [
  ['Add.progress', 'Overall progress: “{n} of 4 readings done” + 20-segment meter (role=meter, accent while reading, green when all Locked, amber when any is Unavailable)', 'Asked for in the brief', 'cap-progress'],
  ['Add.thumb', 'Thumbnail of the just-verified photo with a green check badge, top right of the card (role=img “Your verified photo”)', 'Optional addition from the brief (mock image here; the real one is the photo already taken)', 'cap-thumb'],
  ['Add.pill', '“Continuing…” pill (spinner) next to the summary while the 0.5 s pause runs', 'The brief calls this “the continuing… moment”; it is the visible marker of A6', 'cap-pill--info'],
  ['Add.notice', 'Notice wording around A7: lead “Note” and footer “We continue anyway.”. The three notes themselves are the original strings', 'Needed so the note reads as a note; the real app prints “Note: …; Submitted anyway.” after the scan', 'cap-notice'],
  ['Add.legend', 'Legend under the activity strip (still, walking, moving, unknown)', 'Colour is never the only cue; the legend is aria-hidden because the strip has its own label', 'cap-legend'],
  ['Add.waiting', 'Waiting state clock icon in its pill (the app shows the word only)', 'Every state is word + icon', 'cap-pill--skip'],
  ['Add.aria', 'Accessible labels: progress meter, countdown ring (“Motion sampling time left”), waveform (live / recorded / flat), signal bars (“n of 4 bars”); list label “Sensor readings”; card aria-busy while reading', 'Roles preserved: status, alert, meter', 'various'],
  ['Add.stubs', 'Stub screens for AI scan and for the Photo step (with the error banner)', 'Prototype only; those screens are not part of this design', 'cap-stub'],
  ['Add.viewer', 'State switcher, device / theme switches, Play states, gallery, this page and the token sheet', 'Review tools, not part of the app', 'cv-*']
];
