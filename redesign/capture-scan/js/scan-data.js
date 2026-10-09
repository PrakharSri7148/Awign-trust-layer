/* Capture · AI scan step prototype: strings and timing.
   Every user-facing string that exists in today's AI scan step is copied from the React source (client/src/components/capture/Analysis.jsx and
   the 'analysis' block of client/src/pages/Capture.jsx). Strings marked ADDITION are new and are listed on the Coverage page under "Additions". */
(function () {
  var S = {};

  /* B1 */
  S.EYEBROW = 'AI analysis';
  S.TITLE = 'Neural scan in progress';

  /* B3: the five lines, exact text (Analysis.jsx LINES) */
  S.LINES = [
    "Comparing the GPS trail with the phone's movement…",
    'Checking the network against the site…',
    'Re-checking the photo on the server…',
    'Running gradient-boosting classifier…',
    'Computing SHAP explanation…'
  ];

  /* B4: the three notes, exact text (Capture.jsx, sensor step) and the banner wording */
  S.NOTES = [
    'GPS unavailable or denied',
    'no motion samples (sensor unavailable or denied)',
    'network info unavailable in this browser'
  ];
  S.noteText = function (notes) { return 'Note: ' + notes.join('; ') + '. Submitted anyway.'; };

  /* Step indicator (same labels as the Photo step) */
  S.STEPS = ['Photo', 'Arrival', 'AI scan', 'Verdict'];

  /* Timing, from Analysis.jsx / Capture.jsx */
  S.LINE_MS = 650;          // a new line becomes the active one every 650 ms
  S.MIN_MS = 2600;          // MIN_ANALYSIS_MS: the screen stays at least this long
  S.SLOW_MS = 8000;         // the brief: "slow server" = more than 8 s

  /* ADDITIONS (new wording) */
  S.FINISHING = 'Finishing up…';
  S.FINISHING_SUB = 'Waiting for the server’s answer.';
  S.SLOW = 'Still working. This can take a moment on a slow connection.';
  S.RETURNING = 'Going back to the Photo step…';
  S.WORD = { done: 'Done', active: 'Running', pending: 'Waiting', halt: 'Stopped' };
  S.TASK_LABEL = 'Shelf / site photo';     // MOCK: the chosen task; same label as the Photo step
  S.ERR_503 = 'Submission failed: Server responded 503: upstream unavailable';   // same text as the Photo step's error-submit state
  S.ERR_NET = 'Submission failed: Failed to fetch';                              // MOCK: what a dropped connection reads like

  window.SCAN_DATA = S;
})();
