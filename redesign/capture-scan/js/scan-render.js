/* Capture · AI scan step prototype: renderers (state -> HTML string). Reuses the Photo step's topbar, footer and bottom nav unchanged
   (../capture-photo/js/cap-render.js). data-inv="B1a …" marks the inventory items an element carries (see js/scan-coverage-data.js). */
(function () {
  var D = window.SCAN_DATA, ST = window.SCAN_STATE, P = window.CAP_R;
  var R = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function inv() { return ' data-inv="' + Array.prototype.join.call(arguments, ' ') + '"'; }
  function icon(n, s, c) { return window.ic(n, s, c); }

  /* ---------- B5a: the step indicator (same markup as the Photo step; Photo + Arrival done, AI scan active) ---------- */
  R.stepper = function (cur) {
    var h = '<ol class="cap-stepper" aria-label="Progress"' + inv('B5a') + '>';
    D.STEPS.forEach(function (label, i) {
      var st = i < cur ? 'done' : i === cur ? 'active' : 'pending';
      h += '<li class="cap-stepper__item cap-stepper__item--' + st + '"' + (i === cur ? ' aria-current="step"' : '') + '><span class="cap-stepper__dot">' + (i < cur ? icon('check', 15) : i + 1) + '</span><span class="cap-stepper__label">' + label + '</span></li>';
      if (i < D.STEPS.length - 1) h += '<li class="cap-stepper__bar' + (i < cur ? ' cap-stepper__bar--done' : '') + '" role="presentation" aria-hidden="true"></li>';
    });
    return h + '</ol>';
  };

  /* ---------- B2: the scan mark (decorative). Three thin rings, one slow rotation, a soft pulsing core. No glow. ---------- */
  R.mark = function (S) {
    return '<span class="cap-scanmark' + (S.phase === 'failed' ? ' cap-scanmark--stopped' : '') + '" aria-hidden="true"' + inv('B2') + '>' +
      '<svg class="cap-scanmark__svg" viewBox="0 0 64 64" width="64" height="64" focusable="false">' +
      '<circle class="cap-scanmark__ring" cx="32" cy="32" r="30"/>' +
      '<circle class="cap-scanmark__arc" cx="32" cy="32" r="24" pathLength="100"/>' +
      '<circle class="cap-scanmark__ring cap-scanmark__ring--in" cx="32" cy="32" r="18"/></svg>' +
      '<span class="cap-scanmark__core">' + icon('brain-circuit', 18) + '</span></span>';
  };

  /* ---------- X6: thin indeterminate bar in the Photo step's segmented-meter style (20 cells). Never a number. ---------- */
  R.bar = function (S) {
    var stopped = S.phase === 'failed';
    var cells = '';
    for (var i = 0; i < 20; i++) cells += '<i class="cap-meter__cell" style="--i:' + i + '"></i>';
    return '<span class="cap-meter cap-meter--20 cap-meter--busy' + (stopped ? ' cap-meter--fail is-stopped' : '') + '" role="progressbar" aria-label="' + (stopped ? 'Scan stopped' : 'Scan in progress') + '"' + (stopped ? '' : ' aria-busy="true"') + inv('X6') + '>' + cells + '</span>';
  };

  /* ---------- B3: the checklist. Same five lines, same wording. ---------- */
  function stepIcon(state) {
    if (state === 'done') return '<span class="cap-step__icon">' + icon('check', 14) + '</span>';
    if (state === 'active') return '<span class="cap-step__icon"><span class="cap-step__spin">' + icon('loader-circle', 16, 'cap-spin') + '</span><span class="cap-step__still">' + icon('circle-dot', 16) + '</span></span>';
    if (state === 'halt') return '<span class="cap-step__icon">' + icon('circle-alert', 16) + '</span>';
    return '<span class="cap-step__icon"></span>';
  }
  function stepRow(text, state, extra) {
    var tag = extra ? ' data-extra="1"' : '';
    return '<li class="cap-step cap-step--' + state + (extra ? ' cap-step--extra' : '') + '"' + (state === 'active' ? ' aria-current="step"' : '') + tag + '>' + stepIcon(state) +
      '<span class="cap-step__body"><span class="cap-step__text">' + esc(text) + '</span>' + (extra && state === 'active' ? '<span class="cap-step__sub">' + esc(D.FINISHING_SUB) + '</span>' : '') + '</span>' +
      '<span class="cap-step__word"' + inv('X7') + '>' + D.WORD[state === 'off' ? 'pending' : state] + '</span></li>';
  }
  R.steps = function () {
    var h = '';
    D.LINES.forEach(function (t, i) { var st = ST.lineState(i + 1); h += stepRow(t, st).replace('<li ', '<li data-inv="B3 B3.' + (i + 1) + ' B3.s' + (st === 'active' || st === 'halt' ? ' B3.h' : '') + '" '); });
    var ex = ST.extraState();
    h += ex === 'off'
      ? '<li class="cap-step cap-step--off cap-step--extra" aria-hidden="true" data-extra="1"><span class="cap-step__icon"></span><span class="cap-step__body"><span class="cap-step__text">' + esc(D.FINISHING) + '</span><span class="cap-step__sub">' + esc(D.FINISHING_SUB) + '</span></span><span class="cap-step__word"></span></li>'
      : stepRow(D.FINISHING, ex, true).replace('<li ', '<li data-inv="X1" ');
    return h;
  };

  /* ---------- X2: the quiet "still working" line under the list ---------- */
  R.aux = function (S) {
    if (S.slow && S.phase !== 'failed' && S.phase !== 'verdict') return '<p class="cap-scan__note"' + inv('X2') + '>' + icon('clock', 16) + '<span>' + esc(D.SLOW) + '</span></p>';
    return '';
  };

  /* ---------- failure moment: the Photo step's error banner without its Retry action (this step has no actions), then X3 ---------- */
  R.fail = function (S) {
    if (!S.error) return '';
    return '<div class="cap-banner cap-banner--error" role="alert"' + inv('B8') + '>' + icon('circle-alert', 18) + '<span class="cap-banner__text">' + esc(S.error) + '</span></div>' +
      (S.returning ? '<p class="cap-scan__note"' + inv('X3') + '>' + icon('arrow-left', 16) + '<span>' + esc(D.RETURNING) + '</span></p>' : '');
  };

  /* ---------- B4: sensor-notes banner ---------- */
  R.notes = function (S) {
    if (!S.notes.length) return '';
    return '<div class="cap-banner cap-banner--warn" role="note"' + inv('B4 B4.' + S.notes.map(function (n) { return D.NOTES.indexOf(n) + 1; }).join(' B4.')) + '>' + icon('shield-alert', 18) + '<span class="cap-banner__text">' + esc(D.noteText(S.notes)) + '</span></div>';
  };

  /* ---------- X4: the verified-photo thumbnail, same markup and slot as the Arrival step's head ---------- */
  R.thumb = function () {
    var svg = (window.CAP_DATA.sceneShelf()).replace(' role="img" aria-label="Camera preview"', ' aria-hidden="true"');
    return '<figure class="cap-thumb" role="img" aria-label="Your verified photo"' + inv('X4') + ' style="margin:0 6px 6px 0"><div class="cap-thumb__img">' + svg + '</div><span class="cap-thumb__badge" aria-hidden="true">' + icon('check', 12) + '</span></figure>';
  };

  /* ---------- the card ---------- */
  R.card = function (S) {
    var failed = S.phase === 'failed';
    return '<section class="cap-card cap-flow cap-scan' + (failed ? ' cap-card--fail' : '') + '"' + inv('X9' + (failed ? ' X8' : '')) + ' id="scan-card" aria-labelledby="scan-title"' + (failed ? '' : ' aria-busy="true"') + '>' +
      '<div class="cap-card__head"><div><div class="cap-eyebrow"' + inv('B1a') + '>' + icon('brain-circuit', 14) + esc(D.EYEBROW) + '</div><h2 class="cap-card__title" id="scan-title"' + inv('B1b') + '>' + esc(D.TITLE) + '</h2></div>' + R.thumb() + '</div>' +
      '<div class="cap-card__body"><div class="cap-scan__top">' + R.mark(S) + '<div class="cap-scan__topbody"><span class="cap-chip"' + inv('X5') + '>' + esc(D.TASK_LABEL) + '</span>' + R.bar(S) + '</div></div>' +
      '<ol class="cap-steps" id="scan-steps" aria-label="Scan steps"' + inv('B3') + '>' + R.steps(S) + '</ol>' +
      '<div class="cap-scan__aux" id="scan-aux">' + R.aux(S) + '</div>' +
      '<div class="cap-scan__fail" id="scan-fail">' + R.fail(S) + '</div>' +
      '<div class="cap-scan__notes" id="scan-notes">' + R.notes(S) + '</div></div></section>';
  };

  /* Step 4 is not part of this design: a plain stand-in so the live run has somewhere to land. */
  R.verdictStub = function () {
    return '<section class="cap-card cap-flow cap-stub"><div class="cap-card__body" style="justify-items:center;text-align:center"><div class="cap-eyebrow" style="justify-content:center">Step 4 · Verdict</div><h2 class="cap-card__title">Not part of this design</h2><p class="cap-muted" style="font-size:13px">The server answered, so the real app moves to the Verdict step here.</p><button type="button" class="cap-btn" data-act="replay">' + icon('rotate-ccw', 14) + ' Run the scan again</button></div></section>';
  };

  /* ---------- the page (shell, top bar, footer and bottom nav come from the Photo step) ---------- */
  R.app = function (S) {
    var S0 = { ipdb: null, menu: false };
    var verdict = S.phase === 'verdict';
    var h = '<a class="cap-skip-link" href="#cap-main">Skip to content</a>';
    h += '<div class="cap-shell"' + inv('B5b') + '>' + P.topbar(S0) + '<main class="cap-main" id="cap-main" tabindex="-1">';
    h += R.stepper(verdict ? 3 : 2);
    h += '<div class="cap-view" id="cap-view">' + (verdict ? R.verdictStub() : R.card(S)) + '</div>';
    return h + '</main>' + P.footer(S0) + '</div>' + P.bottomnav();
  };

  /* what a screen reader hears, once per change (B3.a). The checklist itself is not a live region. */
  R.announce = function (S) {
    if (S.phase === 'failed' || S.phase === 'verdict') return '';
    if (S.slow) return D.SLOW;
    if (S.phase === 'finishing') return D.FINISHING + ' ' + D.FINISHING_SUB;
    return 'Step ' + S.line + ' of ' + D.LINES.length + ': ' + D.LINES[S.line - 1];
  };

  window.SCAN_R = R;
})();
