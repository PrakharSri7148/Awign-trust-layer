/* Capture · Verdict step prototype: renderers (state -> HTML string). Adds to the Photo prototype's window.CAP_R, which supplies the app shell
   (topbar, footer, bottomnav). One function per React component the port needs:
     vstepper -> Stepper (all four done)   vresult -> VerdictCard   vgauge -> FraudGauge   vwhy -> WhyCard (+ ShapBars)
     vfetched -> FetchedPanel              vbanner -> notes banner  vaction -> NewSubmission button
   data-inv="C1a …" marks which inventory ids an element carries (used by tools/verify.mjs and the Coverage page). */
(function () {
  var V = window.CAP_V, D = window.CAP_DATA, R = window.CAP_R, T = V.T;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function icon(n, s, c) { return window.ic(n, s, c); }
  function inv() { return ' data-inv="' + Array.prototype.join.call(arguments, ' ') + '"'; }

  /* ---------- B1: stepper, every step done ---------- */
  R.vstepper = function () {
    var h = '<ol class="cap-stepper" aria-label="Progress"' + inv('B1') + '>';
    V.STEPS.forEach(function (label, i) {
      var last = i === V.STEPS.length - 1;
      h += '<li class="cap-stepper__item cap-stepper__item--done"' + (last ? ' aria-current="step"' : '') + '><span class="cap-stepper__dot">' + icon('check', 15) + '</span><span class="cap-stepper__label">' + label + '</span></li>';
      if (!last) h += '<li class="cap-stepper__bar cap-stepper__bar--done" role="presentation" aria-hidden="true"></li>';
    });
    return h + '</ol>';
  };

  /* ---------- C1: fraud gauge (60-segment ring, same segment language as the quality meters) ---------- */
  var SEGS = 60;
  R.vgaugeFill = function (value) { return Math.round(Math.max(0, Math.min(1, value)) * SEGS); };
  R.vgauge = function (value, tone) {
    var lit = R.vgaugeFill(value), svg = '';
    for (var i = 0; i < SEGS; i++) {
      var a = ((i + 0.5) / SEGS) * 2 * Math.PI - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
      svg += '<line class="cap-gauge__seg' + (i < lit ? ' cap-gauge__seg--on' : '') + '" x1="' + (50 + 40 * c).toFixed(2) + '" y1="' + (50 + 40 * s).toFixed(2) + '" x2="' + (50 + 48 * c).toFixed(2) + '" y2="' + (50 + 48 * s).toFixed(2) + '"/>';
    }
    var shown = V.pct(value, 1);
    // the 50% threshold: a line across the ring at 6 o'clock (the arc starts at 12 o'clock and runs clockwise)
    svg += '<line class="cap-gauge__mark" x1="50" y1="86" x2="50" y2="100.5"/>';
    return '<div class="cap-gauge cap-gauge--' + tone + '" role="meter" aria-label="' + T.fraudLabel + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (value * 100).toFixed(1) + '" aria-valuetext="' + shown + ', ' + T.threshold + '" data-final="' + value + '" data-segs="' + SEGS + '"' + inv('C1e') + '>' +
      '<svg class="cap-gauge__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' + svg + '</svg>' +
      '<div class="cap-gauge__center"><span class="cap-gauge__label">' + T.fraudLabel + '</span><b class="cap-gauge__value cap-num" data-bind="gauge">' + shown + '</b><span class="cap-gauge__cap">' + T.threshold + '</span></div></div>';
  };

  /* ---------- C1: celebration dots (accepted only) ---------- */
  function burst(S) {
    var n = 14, h = '';
    for (var i = 0; i < n; i++) {
      var a = (i / n) * 2 * Math.PI + 0.2, d = 34 + (i % 3) * 9;
      h += '<i class="cap-burst__dot" style="--dx:' + (Math.cos(a) * d).toFixed(1) + 'px;--dy:' + (Math.sin(a) * d).toFixed(1) + 'px;--c:' + (i % 2 ? 'var(--cap-ok)' : 'var(--cap-accent-text)') + '"></i>';
    }
    var cls = S.frame === 'celebrate' ? ' cap-burst--frame' : (S.animate && !S.burstDone ? '' : ' cap-burst--done');
    return '<span class="cap-burst' + cls + '" aria-hidden="true"' + inv('C1b') + '>' + h + '</span>';
  }

  /* ---------- C1: submission id + copy ---------- */
  R.vid = function (S) {
    var id = S.result.id, c = S.copied;
    return '<span class="cap-idrow"' + inv('C1f') + '><span class="cap-idrow__id cap-mono" data-testid="submission-id">' + T.idPrefix + esc(id) + '</span>' +
      '<button type="button" class="cap-icon-btn cap-idrow__btn' + (c ? ' is-copied is-tip' : '') + '" aria-label="' + T.copyLabel + '" data-act="copy" data-fid="copy" data-tip="' + (c ? 'Copied' : T.copyLabel) + '" data-tip-pos="left"' + inv('C1g') + '>' + icon(c ? 'check' : 'copy', 18) + '</button>' +
      '<span class="cap-sr" role="status" aria-live="polite" data-bind="copy-status">' + (c ? 'Submission ID copied' : '') + '</span></span>';
  };

  R.vaction = function (cls) {
    return '<button type="button" class="cap-btn cap-btn--primary cap-btn--lg cap-btn--block' + (cls ? ' ' + cls : '') + '" data-act="new" data-fid="new"' + inv('C5') + '>' + icon('rotate-ccw', 18) + T.action + '</button>';
  };

  /* ---------- C1: result card ---------- */
  R.vresult = function (S, ctx) {
    var r = S.result, flagged = r.status === 'flagged', tone = flagged ? 'fail' : 'ok';
    var h = '<section class="cap-card cap-card--' + tone + ' cap-vres" aria-labelledby="vres-title" data-testid="verdict-card" data-status="' + r.status + '"' + inv('C1') + '>';
    h += '<div class="cap-vres__grid">';
    h += '<div class="cap-vres__head"><span class="cap-badge cap-badge--' + tone + '"' + inv('C1a') + '>' + icon(flagged ? 'shield-alert' : 'shield-check', 26) + (flagged ? '' : burst(S)) + '</span>';
    h += '<div class="cap-vres__text"><div class="cap-eyebrow"' + inv('C1c') + '>' + T.eyebrow + '</div><h2 class="cap-vres__title" id="vres-title"' + inv('C1d') + '>' + (flagged ? T.flagged : T.verified) + '</h2></div></div>';
    h += '<div class="cap-vres__gauge">' + R.vgauge(r.fraud_probability, tone) + '</div>';
    h += '<div class="cap-vres__id">' + R.vid(S) + '</div>';
    if (!ctx.phone) h += '<div class="cap-vres__foot">' + R.vaction('cap-vres__btn') + '</div>';
    return h + '</div></section>';
  };

  /* ---------- C2: SHAP bars (the Photo step's segmented meter, 20 segments) ---------- */
  function shapMeter(v, label, top) {
    var n = 20, pct = v * 100, lit = Math.round(v * n), cells = '';
    if (pct > 0 && lit === 0) lit = 1;
    for (var i = 0; i < n; i++) cells += '<i class="cap-meter__cell' + (i < lit ? ' cap-meter__cell--on' : '') + '"></i>';
    return '<span class="cap-meter cap-meter--20 cap-meter--' + (top ? 'accent' : 'neutral') + '" role="meter" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct.toFixed(1) + '" aria-valuetext="' + V.pct(v, 1) + '" data-segments="' + n + '">' + cells + '</span>';
  }
  R.vshap = function (imp) {
    var rows = V.FACTORS.map(function (f) { return { key: f.key, label: f.label, v: (imp && imp[f.key]) || 0 }; });
    var top = rows.reduce(function (a, b) { return b.v > a.v ? b : a; }, rows[0]);
    var h = '<div class="cap-shap"><h3 class="cap-eyebrow"' + inv('C2f') + '>' + T.shap + '</h3><div class="cap-shap__rows">';
    rows.forEach(function (r) {
      var isTop = r.key === top.key && r.v > 0;
      h += '<div class="cap-shap__row' + (isTop ? ' cap-shap__row--top' : '') + '"' + inv('C2g') + '><div class="cap-shap__head"><span class="cap-shap__name">' + r.label + (isTop ? '<span class="cap-pill cap-pill--info cap-shap__tag"' + inv('C2h') + '>' + T.topDriver + '</span>' : '') + '</span><span class="cap-shap__val cap-num">' + V.pct(r.v, 1) + '</span></div>' + shapMeter(r.v, r.label, isTop) + '</div>';
    });
    return h + '</div></div>';
  };

  /* ---------- C2: Why? card ---------- */
  var TONE = { green: ['ok', 'circle-check', 'Passed'], amber: ['warn', 'triangle-alert', 'Warning'], red: ['bad', 'circle-x', 'Problem'], muted: ['muted', 'minus', 'No data'] };
  var FUSED_INV = { arrival: 'C2c', motion: 'C2d', network: 'C2e' };
  R.vwhy = function (S) {
    var r = S.result, lines = V.verdictSummary(r.fusion);
    var h = '<section class="cap-card cap-vwhy" aria-labelledby="vwhy-h" data-testid="why-card"' + inv('C2') + '>';
    h += '<div class="cap-card__head"><h2 class="cap-eyebrow" id="vwhy-h"' + inv('C2a') + '>' + T.why + '</h2></div>';
    h += '<div class="cap-card__body"><p class="cap-reason" data-testid="top-reason"' + inv('C2b') + '>' + esc(r.top_reason) + '</p>';
    if (lines.length) {
      h += '<ul class="cap-checks cap-fused" aria-label="Fusion summary" data-testid="fusion-verdict">';
      lines.forEach(function (l) {
        var t = TONE[l.tone] || TONE.muted;
        h += '<li class="cap-check cap-check--' + t[0] + '" data-tone="' + l.tone + '" data-testid="fusion-' + l.id + '"' + inv(FUSED_INV[l.id]) + '>' + icon(t[1], 18) + '<div><div class="cap-check__line"><span class="cap-check__label">' + esc(l.label) + '<span class="cap-sr">: ' + t[2] + '</span></span></div><p class="cap-check__hint">' + esc(l.text) + '</p></div></li>';
      });
      h += '</ul>';
    }
    h += R.vshap(r.feature_importances);
    return h + '</div></section>';
  };

  /* ---------- C3: What was fetched ---------- */
  var FET_INV = { fixes: 'C3b', windows: 'C3c', activity: 'C3d', jumps: 'C3e', site: 'C3f', ip: 'C3g', hidden: 'C3h', restarts: 'C3i', wifi: 'C3j', cell: 'C3k', mock: 'C3l' };
  function frow(id, label, ok, text, tone) {
    var kind = tone === 'red' ? 'bad' : ok ? 'ok' : 'na';
    var ic = kind === 'bad' ? 'triangle-alert' : ok ? 'check' : 'minus';
    var word = kind === 'bad' ? 'Problem' : ok ? 'Received' : 'Not available';
    return '<li class="cap-frow cap-frow--' + kind + '" data-testid="fetched-' + id + '"' + inv(FET_INV[id]) + '><span class="cap-frow__ic">' + icon(ic, 16) + '</span><b class="cap-frow__label">' + esc(label) + '<span class="cap-sr">: ' + word + '</span></b><span class="cap-frow__text">' + esc(text) + '</span></li>';
  }
  R.vfetched = function (S, ctx) {
    var rows = V.fetchedSummary(S.result.fusion);
    if (!rows) return '';
    var open = !ctx.phone || S.fetchedOpen;
    var got = rows.filter(function (r) { return r.ok; }).length, na = rows.length - got + V.NOT_AVAILABLE.length;
    var h = '<section class="cap-card cap-vfet" aria-labelledby="vfet-h" data-testid="fetched-panel"' + inv('C3') + '>';
    h += '<div class="cap-card__head"><h2 class="cap-eyebrow" id="vfet-h"' + inv('C3a') + '>' + T.fetched + '</h2>';
    h += '<button type="button" class="cap-btn cap-btn--sm cap-vfet__toggle' + (open ? ' is-open' : '') + '" aria-expanded="' + open + '" aria-controls="vfet-list" data-act="fetched" data-fid="fetched">Details' + icon('chevron-down', 16, 'cap-vfet__chev') + '</button></div>';
    h += '<div class="cap-card__body"><div class="cap-vfet__sum"><span class="cap-pill cap-pill--pass">' + icon('check', 12) + got + ' received</span><span class="cap-pill cap-pill--skip">' + icon('minus', 12) + na + ' not available</span></div>';
    h += '<ul class="cap-frows" id="vfet-list"' + (open ? '' : ' hidden') + '>';
    rows.forEach(function (r) { h += frow(r.id, r.label, r.ok, r.text, r.tone); });
    V.NOT_AVAILABLE.forEach(function (n) { h += frow(n.id, n.label, false, 'not available: ' + n.reason); });
    return h + '</ul></div></section>';
  };

  /* ---------- C4: sensor notes banner ---------- */
  R.vbanner = function (S) {
    if (!S.notes || !S.notes.length) return '';
    return '<div class="cap-banner cap-banner--warn" role="status" data-testid="sensor-notes"' + inv('C4') + '>' + icon('circle-alert', 18) + '<span class="cap-banner__text">Note: ' + esc(S.notes.join('; ')) + '. Submitted anyway.</span></div>';
  };

  /* ---------- page ---------- */
  R.vapp = function (S, ctx) {
    var h = '<a class="cap-skip-link" href="#cap-main">Skip to content</a>';
    h += '<div class="cap-shell">' + R.topbar(S) + '<main class="cap-main" id="cap-main" tabindex="-1">';
    h += R.vstepper();
    h += '<div class="cap-verdict cap-verdict--' + S.result.status + '" data-fusion="' + (V.fetchedSummary(S.result.fusion) ? 'yes' : 'no') + '">';
    h += '<div class="cap-verdict__side">' + R.vresult(S, ctx) + R.vbanner(S) + '</div>';
    h += '<div class="cap-verdict__main">' + R.vwhy(S) + R.vfetched(S, ctx) + '</div>';
    if (ctx.phone) h += '<div class="cap-vaction">' + R.vaction() + '</div>';
    h += '</div></main>' + R.footer(S) + '</div>' + R.bottomnav();
    return h;
  };
})();
