/* Capture · Arrival step prototype: renderers (state -> HTML string). One function per React piece it maps to:
   Stepper, SensorTile, TrailTile, Waveform, signalBars, the Sensors step in Capture.jsx. The shell (top bar, footer, bottom nav) is the
   Photo step's own renderer (../capture-photo/js/cap-render.js), reused as is.
   data-inv="A4.gps …" marks which inventory items an element carries (used by tools/verify.mjs and the Coverage page). */
(function () {
  var A = window.CAP_ARR, D = window.CAP_DATA, PR = window.CAP_R, R = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function inv() { return ' data-inv="' + Array.prototype.join.call(arguments, ' ') + '"'; }
  function icon(n, s, c) { return window.ic(n, s, c); }

  /* ---------- Stepper (same markup as Stepper.jsx / the Photo prototype) ---------- */
  R.stepper = function (cur) {
    var h = '<ol class="cap-stepper" aria-label="Progress">';
    A.STEPS.forEach(function (label, i) {
      var st = i < cur ? 'done' : i === cur ? 'active' : 'pending';
      h += '<li class="cap-stepper__item cap-stepper__item--' + st + '"' + (i === cur ? ' aria-current="step"' : '') + '><span class="cap-stepper__dot">' + (i < cur ? icon('check', 15) : i + 1) + '</span><span class="cap-stepper__label">' + label + '</span></li>';
      if (i < A.STEPS.length - 1) h += '<li class="cap-stepper__bar' + (i < cur ? ' cap-stepper__bar--done' : '') + '" role="presentation" aria-hidden="true"></li>';
    });
    return h + '</ol>';
  };

  /* ---------- pieces ---------- */
  var stateIcon = function (st) { return icon(A.STATE_ICON[st], 12, st === 'acq' ? 'cap-spin' : ''); };
  var PILL = { wait: 'skip', acq: 'info', ok: 'pass', na: 'warn' };
  R.statePill = function (st, id) { return '<span class="cap-pill cap-pill--' + PILL[st] + '"' + (id ? ' data-bind="state-' + id + '"' : '') + inv('A4.states') + '>' + stateIcon(st) + A.STATE_WORD[st] + '</span>'; };

  /** Wave path from a buffer of |acceleration| values (same zig-zag oscilloscope as Waveform.jsx, drawn as an SVG path). */
  R.wavePath = function (buf) {
    var n = buf.length, W = 240, H = 44, d = '';
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * W, y = H / 2 - Math.min(1, buf[i] / 3) * (H / 2 - 3) * (i % 2 ? 1 : -1);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  };
  R.wave = function (buf, label) { return '<svg class="cap-feed__wave" viewBox="0 0 240 44" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '"' + inv('A4.motion.wave') + '><path class="cap-wave__base" d="M0 22 L240 22"/><path class="cap-wave__line" data-wave="1" d="' + R.wavePath(buf) + '"/></svg>'; };

  R.ring = function (left) {
    var p = Math.max(0, Math.min(1, 1 - left / A.MOTION_MS));
    return '<div class="cap-ring" role="meter" aria-label="Motion sampling time left" aria-valuemin="0" aria-valuemax="3" aria-valuenow="' + (left / 1000).toFixed(1) + '" aria-valuetext="' + (left / 1000).toFixed(1) + ' s left" data-ring="1"' + inv('A4.motion.ring') + ' style="--p:' + p.toFixed(3) + '">' +
      '<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="cap-ring__track" cx="26" cy="26" r="20" pathLength="100"/><circle class="cap-ring__bar" cx="26" cy="26" r="20" pathLength="100"/></svg>' +
      '<span class="cap-ring__num" data-bind="ring-num" aria-hidden="true">' + (left / 1000).toFixed(1) + '</span></div>';
  };

  R.signal = function (type) {
    var n = A.bars(type), h = '<span class="cap-signal" role="img" aria-label="Signal strength: ' + n + ' of 4 bars"' + inv('A4.net.bars') + '>';
    for (var i = 0; i < 4; i++) h += '<i' + (i < n ? ' class="is-on"' : '') + '></i>';
    return h + '</span>';
  };

  R.strip = function (acts) {
    if (!acts || !acts.length) return '';
    return '<div class="cap-strip" role="img" aria-label="Phone activity in the last two minutes"' + inv('A4.trail.strip') + '>' + acts.map(function (a) { return '<i class="is-' + a + '" title="' + a + '"></i>'; }).join('') + '</div>' +
      '<div class="cap-legend" aria-hidden="true"><span><i style="background:color-mix(in srgb,var(--cap-text-2) 55%,transparent)"></i>still</span><span><i style="background:var(--cap-ok)"></i>walking</span><span><i style="background:var(--cap-accent-text)"></i>moving</span><span><i class="is-unknown"></i>unknown</span></div>';
  };

  /** One sensor tile. `aside` goes in the right column, `extra` spans under the text. */
  R.sensor = function (def, t, S, bufs) {
    var invMain = { gps: 'A4.gps', motion: 'A4.motion', net: 'A4.net', trail: 'A4.trail' }[def.id];
    var valueCls = def.id === 'gps' && t.st === 'ok' ? ' cap-mono' : '';
    var aside = '', extra = '';
    if (def.id === 'motion') {
      var live = t.st === 'acq' && !t.flat;
      extra = '<div class="cap-sensor__live">' + R.wave(bufs.motion, live ? 'Live motion waveform' : t.st === 'ok' ? 'Motion waveform, recorded' : 'Motion waveform, flat: no motion sensor reading') + (t.st === 'acq' ? R.ring(t.left) : '') + '</div>';
    }
    if (def.id === 'net' && t.st === 'ok') aside = R.signal(t.type);
    if (def.id === 'trail') extra = R.strip(t.acts);
    return '<li class="cap-sensor cap-sensor--' + t.st + '" data-tile="' + def.id + '" data-st="' + t.st + '"' + inv(invMain, 'A4', 'A5') + '>' +
      '<span class="cap-sensor__icon" aria-hidden="true"' + inv('A4.icon') + '>' + icon(def.icon, 20) + '</span>' +
      '<div class="cap-sensor__body"><div class="cap-sensor__head"><h3 class="cap-sensor__title">' + def.title + '</h3>' + R.statePill(t.st, def.id) + '</div>' +
      '<div class="cap-sensor__main"><div class="cap-sensor__value' + valueCls + '"' + inv(invMain + '.value') + '>' + esc(t.value || '') + '</div>' + aside + '</div></div>' +
      (extra ? '<div class="cap-sensor__extra">' + extra + '</div>' : '') + '</li>';
  };

  R.progress = function (S) {
    var d = A.derive(S), tone = d.all ? (d.anyNa ? 'warn' : 'pass') : 'info';
    var cells = '', lit = Math.round(d.pct / 100 * 20);
    for (var i = 0; i < 20; i++) cells += '<i class="cap-meter__cell' + (i < lit ? ' cap-meter__cell--on' : '') + '"></i>';
    return '<div class="cap-progress"' + inv('Add.progress') + '><div class="cap-progress__row"><p class="cap-progress__count" role="status"><b data-bind="done">' + d.done + '</b> of 4 readings done</p>' +
      (S.phase === 'continuing' ? '<span class="cap-pill cap-pill--info"' + inv('A6') + '>' + icon('loader-circle', 12, 'cap-spin') + 'Continuing…</span>' : '') + '</div>' +
      '<span class="cap-meter cap-meter--20 cap-meter--' + tone + '" role="meter" aria-label="Readings progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + d.pct + '" aria-valuetext="' + d.done + ' of 4 readings done" data-segments="20">' + cells + '</span></div>';
  };

  R.notice = function (S) {
    var d = A.derive(S);
    if (!d.notes.length) return '';
    return '<div class="cap-notice" role="status"' + inv('A7') + '>' + icon('triangle-alert', 16) + '<div><div class="cap-notice__lead">Note</div><ul>' + d.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul><p class="cap-notice__foot">We continue anyway.</p></div></div>';
  };

  R.thumb = function () {
    var svg = D.sceneFace(1).replace(' role="img" aria-label="Camera preview"', ' aria-hidden="true"');
    return '<figure class="cap-thumb" role="img" aria-label="Your verified photo"' + inv('Add.thumb') + ' style="margin:0 6px 6px 0"><div class="cap-thumb__img">' + svg + '</div><span class="cap-thumb__badge" aria-hidden="true">' + icon('check', 12) + '</span></figure>';
  };

  /** The Arrival card. */
  R.arrival = function (S, bufs) {
    var h = '<section class="cap-card cap-arr" aria-labelledby="arr-title" aria-busy="' + (S.phase !== 'continuing') + '" data-testid="arrival"><div class="cap-card__head"><div><div class="cap-eyebrow"' + inv('A1') + '>' + icon('map-pin', 14) + A.EYEBROW + '</div><h2 class="cap-card__title" id="arr-title"' + inv('A2') + '>' + A.TITLE + '</h2></div>' + R.thumb() + '</div>';
    h += '<div class="cap-card__body"><p class="cap-arr__lead"' + inv('A3') + '>' + A.LEAD + '</p>' + R.progress(S);
    h += '<ul class="cap-sensors" aria-label="Sensor readings"' + inv('A4', 'A5') + '>' + A.TILES.map(function (def) { return R.sensor(def, S.tiles[def.id], S, bufs); }).join('') + '</ul>';
    return h + R.notice(S) + '</div></section>';
  };

  /* ---------- Stubs for what this prototype does not design ---------- */
  R.scanStub = function () {
    return '<section class="cap-card cap-stub"><div class="cap-card__body" style="justify-items:center;text-align:center"><div class="cap-eyebrow" style="justify-content:center">Step 3 · AI scan</div><h2 class="cap-card__title">Not part of this design</h2><p class="cap-muted" style="max-width:48ch;font-size:var(--cap-text-sm)">The AI scan and Verdict steps stay as they are. This prototype covers the Arrival step only.</p><button type="button" class="cap-btn cap-btn--primary" data-act="replay" data-fid="replay">Replay the Arrival step</button></div></section>';
  };
  R.photoStub = function (S) {
    return '<div class="cap-banner cap-banner--error" role="alert"' + inv('A8') + '>' + icon('circle-alert', 18) + '<span class="cap-banner__text">' + esc(S.error) + '</span></div>' +
      '<section class="cap-card cap-stub"><div class="cap-card__body" style="justify-items:center;text-align:center"><div class="cap-eyebrow" style="justify-content:center">Step 1 · Photo</div><h2 class="cap-card__title">The Photo step appears here</h2><p class="cap-muted" style="max-width:48ch;font-size:var(--cap-text-sm)">Only the transition and the banner are designed on this page. The Photo screen itself is the approved capture-photo design.</p><button type="button" class="cap-btn cap-btn--primary" data-act="replay" data-fid="replay">Replay the Arrival step</button></div></section>';
  };

  /* ---------- page: the Photo step's shell around this view ---------- */
  var STRIP = ' data-inv="[^"]*"';
  R.app = function (S, bufs, viewCls) {
    var cur = S.step === 'photo' ? 0 : S.step === 'scan' ? 2 : 1;
    var shellS = { ipdb: S.ipdb, menu: false, step: 'arrival' };
    var top = PR.topbar(shellS).replace(new RegExp(STRIP, 'g'), '');                  // the shell's ids belong to the Photo inventory
    var foot = PR.footer(shellS).replace(new RegExp(STRIP, 'g'), '');
    var h = '<a class="cap-skip-link" href="#cap-main">Skip to content</a><div class="cap-shell">' + top + '<main class="cap-main" id="cap-main" tabindex="-1">' + R.stepper(cur);
    h += '<div class="cap-view' + (viewCls ? ' ' + viewCls : '') + '" id="cap-view">';
    if (S.step === 'photo') h += R.photoStub(S);
    else if (S.step === 'scan') h += R.scanStub();
    else h += R.arrival(S, bufs);
    return h + '</div></main>' + foot + '</div>' + PR.bottomnav().replace(new RegExp(STRIP, 'g'), '');
  };

  window.CAP_ARR_R = R;
})();
