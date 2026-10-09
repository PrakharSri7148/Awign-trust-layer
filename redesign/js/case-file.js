/* Case file slide-over (520px): header, tabs (Summary · Photo · Sensors & trail · Timeline), decision bar pinned at the bottom.
   Focus is trapped while open; Esc closes; the caller restores focus. Deep link handling (#case/412) lives in dashboard.js. */
(function () {
  'use strict';
  var TL = window.TL, D = window.TL_DATA, I = window.icon, esc = TL.esc;

  var REASON_TITLE = {
    gps_far: 'Location far from site', dup: 'Duplicate photo', screen: 'Photo of a screen', still: 'No travel trail',
    jump: 'Location jump', net: 'Unusual network', clock: 'Clock mismatch', face: 'Liveness not passed', ok: 'Routine check',
  };
  TL.REASON_TITLE = REASON_TITLE;

  var TABS = [
    { key: 'summary', label: 'Summary' },
    { key: 'photo', label: 'Photo' },
    { key: 'sensors', label: 'Sensors & trail' },
    { key: 'timeline', label: 'Timeline' },
  ];

  var cur = null; // { row, el, scrim, release, opts, tab, decision }

  function statusPill(row) {
    var s = TL.statusOf(row), cls = { open: 'medium', resolved: 'ok', accepted: 'neutral' }[s.key];
    return '<span class="pill pill--' + cls + '">' + s.label + '</span>';
  }

  function headHtml(row) {
    var site = D.siteById[row.site_id], sev = TL.severity(row.fraud_probability), list = cur.opts.list || [];
    var i = list.indexOf(row.id);
    return '<div class="case-head__top">' +
      '<span class="case-head__id">Case #' + row.id + '</span>' + statusPill(row) +
      '<div class="case-head__nav">' +
      '<button class="icon-btn" data-nav="-1" aria-label="Previous case"' + (i <= 0 ? ' disabled' : '') + '>' + I('chevron-up') + '</button>' +
      '<button class="icon-btn" data-nav="1" aria-label="Next case"' + (i < 0 || i >= list.length - 1 ? ' disabled' : '') + '>' + I('chevron-down') + '</button>' +
      '<button class="icon-btn" data-close aria-label="Close case file">' + I('x') + '</button></div></div>' +
      '<div class="case-head__title"><h2 id="case-title" tabindex="-1">' + esc(row.task) + '</h2>' +
      '<div class="case-head__score"><strong style="color:' + sev.color + '">' + TL.pct(row.fraud_probability) + '</strong><small>fraud probability</small></div></div>' +
      '<div class="case-head__pills">' + TL.sevPill(row.fraud_probability) + TL.photoPill(row.photo_verdict) + '</div>' +
      '<p class="case-head__meta"><span class="mono">' + row.worker_id + '</span> · ' + esc(site.name) + ', ' + esc(site.city) + ' · ' + TL.fmtDateTime(row.timestamp) + '</p>';
  }

  function reviewBanner(row) {
    if (!row.review) return '';
    var d = TL.DECISION[row.review.decision];
    return '<div class="review-banner review-banner--' + d.cls + '">' + I(d.icon) + '<div><strong>' + d.label + '</strong> by ' + esc(row.review.reviewer) + ' · ' + TL.relTime(row.review.at) +
      (row.review.reason ? '<div class="text-2">“' + esc(row.review.reason) + '”</div>' : '') + '</div></div>';
  }

  function whySentence(row) {
    var sev = TL.severity(row.fraud_probability), r = D.reasons[row.reason_key] || D.reasons.ok;
    var second = row.shap.filter(function (s) { return s.note; })[0];
    if (row.fraud_probability < 0.4) return 'Low risk. ' + r.sentence + (second ? ' ' + second.note : '');
    return sev.label + ' risk, mainly because: ' + r.sentence.charAt(0).toLowerCase() + r.sentence.slice(1) + (second ? ' ' + second.note : '');
  }

  function driversHtml(row) {
    var max = Math.max.apply(null, row.shap.map(function (s) { return Math.abs(s.value); }));
    return row.shap.slice(0, 3).map(function (s) {
      var up = s.value > 0, w = Math.round((Math.abs(s.value) / max) * 100);
      return '<div class="driver' + (up ? '' : ' driver--down') + '">' +
        '<div class="driver__label"><span>' + esc(s.label) + '</span></div>' +
        '<div class="driver__track"><span class="driver__fill" style="width:' + w + '%"></span></div>' +
        '<span class="driver__value">' + (up ? '+' : '−') + Math.abs(s.value).toFixed(2) + ' ' + (up ? 'raises' : 'lowers') + '</span></div>';
    }).join('');
  }

  function historyHtml(row) {
    var h = (row.review_history || []).slice().reverse();
    if (!h.length) return '';
    return '<section class="case-section"><h3>Earlier decisions</h3><ul class="history">' + h.map(function (r) {
      var d = TL.DECISION[r.decision];
      return '<li><span class="pill pill--' + d.cls + '">' + d.label + '</span> by ' + esc(r.reviewer) + ' \u00b7 ' + TL.fmtDateTime(r.at) + (r.reason ? '<div class="text-2">\u201c' + esc(r.reason) + '\u201d</div>' : '') + '</li>';
    }).join('') + '</ul></section>';
  }
  function whyInQueue(row) {
    if (!row.review_reasons || !row.review_reasons.length || row.review) return '';
    return '<div class="review-banner review-banner--warn">' + I('clipboard-list') + '<div><strong>Waiting for a reviewer</strong><div class="text-2">' + row.review_reasons.map(function (r) { return esc(D.REVIEW_WHY[r] || r); }).join(' \u00b7 ') + '</div></div></div>';
  }

  function summaryHtml(row) {
    var site = D.siteById[row.site_id];
    return reviewBanner(row) + whyInQueue(row) +
      '<section class="case-section"><h3>Why this score</h3><div class="why"><p class="why__sentence">' + esc(whySentence(row)) + '</p>' +
      '<div class="drivers" role="list" aria-label="Top 3 factors">' + driversHtml(row) + '</div>' +
      '<p class="drivers__legend">Top 3 factors behind the score. Each bar shows how much the factor raised or lowered it.</p></div></section>' +
      '<section class="case-section"><h3>Details</h3><dl class="kv">' +
      '<dt>Main signal</dt><dd>' + esc(row.top_reason) + '</dd>' +
      '<dt>Worker</dt><dd class="mono">' + row.worker_id + ' <span class="text-2" style="font-family:var(--font-ui)">(' + esc(D.workerById[row.worker_id].name) + ')</span></dd>' +
      '<dt>Site</dt><dd>' + esc(site.name) + ', ' + esc(site.city) + ' <span class="mono text-2">' + site.id + '</span></dd>' +
      '<dt>Submitted</dt><dd>' + TL.fmtDateTime(row.timestamp) + ' <span class="text-2">(' + TL.relTime(row.timestamp) + ')</span></dd>' +
      '<dt>Distance</dt><dd>' + TL.fmtDistance(row.distance_m) + ' from the site' + (row.gps.place ? ', in ' + esc(row.gps.place) : '') + '</dd>' +
      '<dt>Task</dt><dd class="mono">' + row.task_id + '</dd>' +
      '<dt>Photo</dt><dd><div class="flag-list">' + TL.photoPill(row.photo_verdict) + row.quality_flags.map(function (f) { return '<span class="pill pill--plain">' + esc(f) + '</span>'; }).join('') + '</div></dd>' +
      '</dl></section>' + historyHtml(row);
  }

  var ST_PILL = { pass: 'ok', warn: 'warn', fail: 'bad', skip: 'neutral' };
  var ST_WORD = { pass: 'Pass', warn: 'Warning', fail: 'Failed', skip: 'Skipped' };

  function checksTable(row) {
    var ids = D.CHECKS.filter(function (c) { return row.checks[c.id]; });
    if (!ids.length) return '';
    return '<div class="table-wrap"><table class="table"><caption class="sr-only">Photo checks, server and device</caption><thead><tr><th scope="col">Check</th><th scope="col">Server</th><th scope="col">Value</th><th scope="col">Device</th></tr></thead><tbody>' + ids.map(function (c) {
      var k = row.checks[c.id], dev = k.client, differs = dev && k.status !== dev && k.status !== 'skip';
      return '<tr' + (differs ? ' class="is-differs"' : '') + ' title="' + esc(c.hint) + '"><td>' + c.label + '</td><td><span class="pill pill--' + ST_PILL[k.status] + '">' + ST_WORD[k.status] + '</span></td><td class="num text-2">' + (k.value == null ? '-' : k.value.toFixed(2)) + '</td><td>' + (dev ? '<span class="pill pill--' + ST_PILL[dev] + '">' + ST_WORD[dev] + '</span>' : '<span class="text-2">-</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' + (ids.some(function (c) { var k = row.checks[c.id]; return k.client && k.status !== k.client && k.status !== 'skip'; }) ? '<p class="text-xs text-2">Highlighted rows: the device and the server disagree.</p>' : '');
  }

  function liveHtml(row) {
    var lv = row.liveness, ck = row.checks.liveness;
    if (!lv || !ck) return '';
    return '<section class="case-section"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Live check</h3><span class="pill pill--' + ST_PILL[ck.status] + '">' + ST_WORD[ck.status] + '</span></div>' +
      '<dl class="kv"><dt>Challenges</dt><dd>' + lv.challenges.map(function (c) { return D.CHALLENGE_WORDS[c]; }).join(' + ') + ' \u00b7 attempt' + (lv.attempts > 1 ? 's ' : ' ') + lv.attempts + '</dd>' +
      '<dt>Device says</dt><dd>' + lv.results.map(function (r) { return D.CHALLENGE_WORDS[r.id] + ': ' + r.status + ' (' + r.secs.toFixed(1) + ' s)'; }).join(', ') + '</dd>' +
      '<dt>Server replay</dt><dd>' + esc(lv.replay) + '</dd><dt>Nonce</dt><dd>' + esc(lv.nonce) + '</dd>' +
      '<dt>Screen / print</dt><dd>' + lv.passive.status + ' \u00b7 score ' + lv.passive.score.toFixed(2) + ', recomputed on the stored photo</dd></dl></section>';
  }

  function photoHtml(row) {
    var photoFlags = row.quality_flags.filter(function (f) { return !D.flagMeta(f).fusion; });
    var q = row.photo_quality_score;
    return '<div class="photo-frame">' + TL.photoArt(row, { label: 'Photo submitted for case ' + row.id + ' (illustration)' }) + '<span class="photo-frame__caption">Illustration. The submitted photo appears here.</span></div>' +
      '<section class="case-section"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3>Photo check</h3><span class="flag-list"><span class="text-xs text-2 num">quality ' + (q == null ? '-' : Math.round(q * 100)) + '/100</span>' + TL.photoPill(row.photo_verdict) + '</span></div>' +
      (photoFlags.length ? '<div class="flag-list">' + photoFlags.map(function (f) { return '<span class="pill pill--plain">' + esc(f) + '</span>'; }).join('') + '</div><ul class="help-list">' + photoFlags.map(function (f) { return '<li><b>' + esc(f) + '.</b> ' + esc(D.flagMeta(f).help) + '</li>'; }).join('') + '</ul>' : '<span class="text-2 text-sm">No quality flags</span>') +
      checksTable(row) + '</section>' + liveHtml(row) +
      '<section class="case-section"><h3>Capture</h3><dl class="kv">' +
      '<dt>Source</dt><dd>' + (row.task === D.tasks[1] ? 'In-app live camera \u00b7 live face prompt' : 'In-app live camera') + '</dd>' +
      '<dt>Camera</dt><dd>' + (row.exif ? esc(row.exif.make + ' ' + row.exif.model) : 'unknown') + '</dd>' +
      '<dt>EXIF time</dt><dd>' + (row.exif ? TL.fmtDateTime(row.exif.taken_at) : 'none') + '</dd>' +
      '<dt>Steadiness</dt><dd class="num">' + row.steadiness.rotation_rms + '\u00b0/s rotation \u00b7 ' + row.steadiness.accel_rms + ' m/s\u00b2 <span class="text-2">(device-reported)</span></dd>' +
      '<dt>Size</dt><dd class="num">' + row.photo.w + ' \u00d7 ' + row.photo.h + ' \u00b7 sharpness ' + row.photo.sharpness.toFixed(2) + ' \u00b7 brightness ' + row.photo.brightness.toFixed(2) + '</dd>' +
      '<dt>Duplicate check</dt><dd>' + (row.quality_flags.indexOf('Duplicate photo') >= 0 ? esc(row.top_reason) : 'No earlier match') + '</dd></dl></section>';
  }

  function trailSvg(row) {
    var site = D.siteById[row.site_id], pts = row.trail, far = row.distance_m > 5000, radius = row.fusion.site.radius_m;
    var all = pts.map(function (p) { return [p.lat, p.lng]; });
    if (!far) all.push([site.lat, site.lng]);
    var lats = all.map(function (a) { return a[0]; }), lngs = all.map(function (a) { return a[1]; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats), minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var W = 440, H = 220, pad = 28;
    var kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    var spanX = Math.max((maxLng - minLng) * kx, 0.002), spanY = Math.max(maxLat - minLat, 0.002);
    var s = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    var ox = (W - spanX * s) / 2, oy = (H - spanY * s) / 2;
    function P(lat, lng) { return [ox + (lng - minLng) * kx * s, H - oy - (lat - minLat) * s]; }
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Approach trail: ' + pts.length + ' location points' + (far ? '' : ' ending ' + TL.fmtDistance(row.distance_m) + ' from the site') + '. Full data in the table below.">';
    if (!far) {
      var sp = P(site.lat, site.lng), rr = (radius / 111320) * s;
      out += '<circle cx="' + sp[0].toFixed(1) + '" cy="' + sp[1].toFixed(1) + '" r="' + Math.max(rr, 8).toFixed(1) + '" fill="none" stroke="var(--color-text-2)" stroke-dasharray="3 3" opacity=".7"/>';
    }
    var xy = pts.map(function (p) { return P(p.lat, p.lng); });
    for (var i = 1; i < xy.length; i++) {
      var jump = pts[i].speed_kmh > 100;
      out += '<line x1="' + xy[i - 1][0].toFixed(1) + '" y1="' + xy[i - 1][1].toFixed(1) + '" x2="' + xy[i][0].toFixed(1) + '" y2="' + xy[i][1].toFixed(1) + '" stroke="' + (jump ? 'var(--color-crit)' : 'var(--color-accent-text)') + '" stroke-width="1.6"' + (jump ? ' stroke-dasharray="4 3"' : '') + '/>';
    }
    out += '<circle cx="' + xy[0][0].toFixed(1) + '" cy="' + xy[0][1].toFixed(1) + '" r="4.5" fill="var(--color-shell)" stroke="var(--color-accent-text)" stroke-width="1.6"/>';
    var e = xy[xy.length - 1];
    out += '<circle cx="' + e[0].toFixed(1) + '" cy="' + e[1].toFixed(1) + '" r="5" fill="' + TL.severity(row.fraud_probability).color + '"/>';
    return out + '</svg>';
  }

  function scoreCard(label, sc, note) {
    var w = D.scoreWord(sc.score);
    return '<div class="fz-score fz-score--' + w.tone + '"><span class="text-xs text-2">' + label + '</span><b class="num">' + Math.round(sc.score * 100) + '</b><span class="pill pill--' + (w.tone === 'ok' ? 'ok' : w.tone === 'warn' ? 'warn' : 'bad') + '">' + w.word + '</span><small>' + note + '</small></div>';
  }

  function fusionHtml(row) {
    var f = row.fusion, m = f.motion, e = f.environment, ev = f.evidence, far = row.distance_m > 5000;
    var flags = row.quality_flags.filter(function (x) { return D.flagMeta(x).fusion; });
    var reasons = [m.reason, e.reason].filter(Boolean);
    var h = '<section class="case-section"><h3>Sensor fusion</h3><div class="fz-scores">' + scoreCard('Motion vs GPS trail', m, m.sensor_used ? 'GPS + accelerometer / gyroscope' : 'GPS only (no motion data)') + scoreCard('Network vs claimed area', e, 'IP / provider / profile') + '</div>' +
      '<ul class="help-list">' + reasons.map(function (r) { return '<li>' + esc(r) + '.</li>'; }).join('') + '</ul></section>';
    h += '<section class="case-section"><h3>Approach trail</h3><div class="trail"><p class="text-xs text-2 num" style="margin-bottom:6px">' + ev.fixes + ' fixes \u00b7 ' + TL.fmtDistance(ev.distance_m) + ' \u00b7 ' + ev.duration_s + ' s</p>' + trailSvg(row) +
      '<div class="trail__legend"><span><i style="background:var(--color-shell);border:1.5px solid var(--color-accent-text)"></i>Start</span><span><i style="background:' + TL.severity(row.fraud_probability).color + '"></i>End (capture point)</span>' + (far ? '' : '<span><i style="border:1.5px dashed var(--color-text-2);background:none"></i>Site radius (' + f.site.radius_m + ' m)</span>') + (row.reason_key === 'jump' ? '<span><i style="background:var(--color-crit)"></i>GPS jump (dashed)</span>' : '') + '</div>' +
      (far ? '<p class="text-sm text-2" style="margin-top:8px">The assigned site is ' + TL.fmtDistance(row.distance_m) + ' away, outside this view.</p>' : '') + '<p class="text-xs text-2" style="margin-top:6px">Drawn locally; no map service is contacted.</p></div>' +
      '<details class="data-table"><summary>Trail data (' + row.trail.length + ' points)</summary><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Time</th><th scope="col">Latitude, longitude</th><th scope="col">Speed</th></tr></thead><tbody>' +
      row.trail.map(function (p) { return '<tr><td class="num">' + (p.t === 0 ? 'Capture' : p.t + ' s') + '</td><td class="mono">' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + '</td><td class="num">' + p.speed_kmh + ' km/h</td></tr>'; }).join('') + '</tbody></table></div></details></section>';
    h += '<section class="case-section"><h3>What the GPS said vs what the phone felt</h3><div class="fz-strips" role="img" aria-label="Timeline of GPS speed class against phone activity, every 5 seconds. Mismatches are outlined: ' + ev.rows.filter(function (c) { return c.mismatch; }).length + ' of ' + ev.rows.length + '.">' +
      '<div class="fz-strip"><span class="fz-strip__label">GPS</span>' + ev.rows.map(function (c) { return '<i class="fz-cell fz-gps--' + c.gps + (c.mismatch ? ' fz-bad' : '') + '" title="' + esc(c.title) + '"></i>'; }).join('') + '</div>' +
      '<div class="fz-strip"><span class="fz-strip__label">Phone</span>' + ev.rows.map(function (c) { return '<i class="fz-cell fz-act--' + c.activity + (c.mismatch ? ' fz-bad' : '') + '" title="' + esc(c.title) + '"></i>'; }).join('') + '</div></div>' +
      '<div class="fz-legend"><span><i class="fz-cell fz-gps--still"></i>GPS still</span><span><i class="fz-cell fz-gps--moving"></i>GPS walking speed</span><span><i class="fz-cell fz-gps--vehicle"></i>GPS vehicle speed</span><span><i class="fz-cell fz-act--still"></i>Phone still</span><span><i class="fz-cell fz-act--walking"></i>Phone walking</span><span><i class="fz-cell fz-bad fz-act--still"></i>Mismatch</span></div></section>';
    h += '<section class="case-section"><h3>Network checks</h3><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead><tbody>' + e.components.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td class="text-2">' + esc(c.status) + '</td><td class="num text-2">' + esc(c.detail) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    if (flags.length) h += '<section class="case-section"><h3>Sensor flags</h3><div class="flag-list">' + flags.map(function (x) { return '<span class="pill pill--plain">' + esc(x) + '</span>'; }).join('') + '</div><ul class="help-list">' + flags.map(function (x) { return '<li><b>' + esc(x) + '.</b> ' + esc(D.flagMeta(x).help) + '</li>'; }).join('') + '</ul></section>';
    h += '<section class="case-section"><h3>Evidence</h3><dl class="kv">' +
      '<dt>Evidence</dt><dd>recorded trail \u00b7 task policy: ' + f.policy + '</dd>' +
      '<dt>Phone sensors</dt><dd>location ' + f.sensors.geo + ' \u00b7 motion ' + f.sensors.motion + ' \u00b7 gyroscope \u00b7 ' + f.sensors.hz_median + ' Hz</dd>' +
      '<dt>Network</dt><dd>' + esc([f.ip.city, f.ip.region, f.ip.country].filter(Boolean).join(', ')) + ' \u00b7 ' + esc(f.ip.org) + ' \u00b7 <span class="mono">' + f.ip.ip + '</span></dd>' +
      '<dt>IP data</dt><dd>DB-IP lite \u00b7 data from Sep 2026 <span class="text-2">(23 days old at the time)</span></dd>' +
      '<dt>Site network</dt><dd>' + (e.profile.visits >= e.profile.needed ? 'learned from ' + e.profile.visits + ' accepted visits' : 'site has fewer than ' + e.profile.needed + ' accepted visits: \u201cnew network\u201d checks are off') + '</dd>' +
      '<dt>Site</dt><dd>radius ' + TL.fmtDistance(f.site.radius_m) + ' \u00b7 ended ' + TL.fmtDistance(ev.end_m) + ' away</dd></dl></section>';
    return h;
  }

  function sensorsHtml(row) {
    var s = row.sensors;
    return fusionHtml(row) +
      '<section class="case-section"><h3>Signals at capture</h3><dl class="kv">' +
      '<dt>GPS</dt><dd><span class="mono">' + row.gps.lat.toFixed(5) + ', ' + row.gps.lng.toFixed(5) + '</span> <span class="text-2">\u00b1' + row.gps.accuracy_m + ' m</span></dd>' +
      '<dt>Distance</dt><dd>' + TL.fmtDistance(row.distance_m) + ' from site</dd>' +
      '<dt>Network</dt><dd>' + esc(s.network) + (row.reason_key === 'net' ? ' <span class="pill pill--high">Unusual</span>' : '') + '</dd>' +
      '<dt>Motion</dt><dd class="num">mean ' + s.motion_mean + ' m/s\u00b2 \u00b7 variance ' + s.motion_var + (row.reason_key === 'still' ? ' <span class="pill pill--high">Still</span>' : '') + '</dd>' +
      '<dt>Clock offset</dt><dd class="num">' + (s.clock_offset_s > 0 ? '+' : '') + s.clock_offset_s + ' s vs server</dd></dl></section>';
  }

  function timelineHtml(row) {
    var t = new Date(row.timestamp).getTime(), at = function (sec) { return new Date(t + sec * 1000).toISOString(); };
    var verdict = row.photo_verdict, vword = { 'Photo OK': 'OK', warning: 'warning', poor: 'poor', unverified: 'not run' }[verdict];
    var ev = [
      ['route', 'Visit recording started', 'GPS trail and phone sensors recorded on the way in', at(-190)],
      ['send', 'Submitted', TL.fmtDateTime(row.timestamp), at(0)],
      ['camera', 'Photo checked on device', 'focus, light, lens, glare, shake, noise, face' + (row.quality_flags.indexOf('Submitted anyway') >= 0 ? ' \u00b7 worker sent anyway' : ''), at(2)],
      ['image', 'Photo re-checked by server', verdict === 'unverified' ? 'no photo to check' : 'verdict: ' + vword + (row.client_mismatch ? ' \u00b7 device report contradicted' : ''), at(7)],
      ['satellite', 'Sensors read', 'GPS trail \u00b7 accelerometer / gyroscope \u00b7 network', at(8)],
      ['activity', 'Scored by classifier', 'p = ' + TL.pct(row.fraud_probability) + ' (' + TL.severity(row.fraud_probability).label + ')', at(9)],
      [row.status === 'flagged' ? 'shield-alert' : 'shield-check', row.status === 'flagged' ? 'Flagged for review' : 'Accepted automatically', row.review_reasons && row.review_reasons.length ? row.review_reasons.map(function (r) { return D.REVIEW_WHY[r]; }).join(' \u00b7 ') : '', at(9)],
    ];
    (row.review_history || []).forEach(function (r) { ev.push([TL.DECISION[r.decision].icon, TL.DECISION[r.decision].label + ' by ' + r.reviewer, r.reason || '', r.at]); });
    if (row.review) ev.push([TL.DECISION[row.review.decision].icon, TL.DECISION[row.review.decision].label + ' by ' + row.review.reviewer, row.review.reason || '', row.review.at]);
    return '<ol class="timeline">' + ev.map(function (e) {
      return '<li><span class="timeline__icon">' + I(e[0]) + '</span><div><div class="timeline__title">' + esc(e[1]) + '</div>' + (e[2] ? '<div class="timeline__sub">' + esc(e[2]) + '</div>' : '') + '<div class="timeline__time">' + TL.fmtDateTime(e[3]) + '</div></div></li>';
    }).join('') + '</ol>';
  }

  var PANELS = { summary: summaryHtml, photo: photoHtml, sensors: sensorsHtml, timeline: timelineHtml };

  var NAME_KEY = 'tl.reviewer';
  function readName() { try { return localStorage.getItem(NAME_KEY) || 'Anita Rao'; } catch (e) { return 'Anita Rao'; } }
  function saveName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* storage blocked: the name just is not remembered */ } }

  function decisionHtml(row) {
    var d = cur.decision;
    var choices = [['approve', 'Approve', 'circle-check'], ['reject', 'Reject', 'circle-x'], ['retake', 'Needs retake', 'rotate-ccw']];
    return '<div class="decision-bar__choices" role="radiogroup" aria-label="Decision">' + choices.map(function (c) {
      var on = d === c[0];
      return '<button type="button" class="decision-choice" role="radio" data-decision="' + c[0] + '" aria-checked="' + on + '" tabindex="' + (on || (!d && c[0] === 'approve') ? 0 : -1) + '">' + I(c[2]) + c[1] + '</button>';
    }).join('') + '</div>' +
      '<div class="decision-bar__row"><div class="field" style="flex:0 0 36%"><label class="sr-only" for="decision-name">Your name</label><input class="input" id="decision-name" placeholder="Your name" maxlength="60" autocomplete="name" value="' + esc(readName()) + '" /></div>' +
      '<div class="field"><label class="sr-only" for="decision-reason">Reason</label>' +
      '<textarea class="textarea" id="decision-reason" rows="1" placeholder="Reason (required for reject and retake)" aria-describedby="decision-error"></textarea></div></div>' +
      '<div class="field__error" id="decision-error" hidden></div>' +
      '<button type="button" class="btn btn--primary btn--block" id="decision-submit">' + (row.review ? 'Record another decision' : 'Record decision') + '</button>';
  }

  function render() {
    var row = cur.row;
    cur.el.querySelector('.case-head').innerHTML = headHtml(row);
    renderTabs();
    cur.el.querySelector('.decision-bar').innerHTML = decisionHtml(row);
    wireHead(); wireDecision();
  }
  function renderTabs() {
    var tabs = cur.el.querySelector('.tabs');
    tabs.innerHTML = TABS.map(function (t) {
      var on = t.key === cur.tab;
      return '<button class="tab" role="tab" id="case-tab-' + t.key + '" aria-controls="case-panel" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-tab="' + t.key + '">' + t.label + '</button>';
    }).join('');
    var body = cur.el.querySelector('.case-body');
    body.setAttribute('aria-labelledby', 'case-tab-' + cur.tab);
    body.innerHTML = PANELS[cur.tab](cur.row);
    body.scrollTop = 0;
    TL.$$('.tab', tabs).forEach(function (b) {
      b.addEventListener('click', function () { cur.tab = b.dataset.tab; renderTabs(); cur.el.querySelector('#case-tab-' + cur.tab).focus(); });
      b.addEventListener('keydown', function (e) {
        var i = TABS.findIndex(function (t) { return t.key === cur.tab; });
        var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
        if (n === null) return;
        e.preventDefault(); cur.tab = TABS[(n + TABS.length) % TABS.length].key; renderTabs(); cur.el.querySelector('#case-tab-' + cur.tab).focus();
      });
    });
  }
  function wireHead() {
    cur.el.querySelector('[data-close]').addEventListener('click', function () { close(); });
    TL.$$('[data-nav]', cur.el).forEach(function (b) {
      b.addEventListener('click', function () {
        var list = cur.opts.list, i = list.indexOf(cur.row.id) + +b.dataset.nav;
        if (list[i] != null && cur.opts.onNavigate) cur.opts.onNavigate(list[i]);
      });
    });
  }
  function wireDecision() {
    var bar = cur.el.querySelector('.decision-bar');
    var radios = TL.$$('.decision-choice', bar), reason = bar.querySelector('#decision-reason'), err = bar.querySelector('#decision-error');
    function choose(b, focus) {
      cur.decision = b.dataset.decision;
      radios.forEach(function (r) { var on = r === b; r.setAttribute('aria-checked', on); r.tabIndex = on ? 0 : -1; });
      if (focus) b.focus();
      clearErr();
    }
    function clearErr() { err.hidden = true; reason.removeAttribute('aria-invalid'); }
    radios.forEach(function (b, i) {
      b.addEventListener('click', function () { choose(b); });
      b.addEventListener('keydown', function (e) {
        var n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : null;
        if (n === null) return; e.preventDefault(); choose(radios[(n + 3) % 3], true);
      });
    });
    reason.addEventListener('input', clearErr);
    reason.addEventListener('focus', function () { reason.style.height = '72px'; });
    reason.addEventListener('blur', function () { if (!reason.value) reason.style.height = ''; });
    bar.querySelector('#decision-submit').addEventListener('click', function () {
      if (!cur.decision) { err.innerHTML = I('circle-alert') + 'Choose Approve, Reject or Needs retake.'; err.hidden = false; radios[0].focus(); return; }
      var text = reason.value.trim(), who = bar.querySelector('#decision-name').value.trim();
      if (!who) { err.innerHTML = I('circle-alert') + 'Enter your name so the decision is recorded against you.'; err.hidden = false; bar.querySelector('#decision-name').focus(); return; }
      if (cur.decision !== 'approve' && text.length < 3) {
        err.innerHTML = I('circle-alert') + 'Say why, in a few words, so the worker knows what to fix.'; err.hidden = false;
        reason.setAttribute('aria-invalid', 'true'); reason.focus(); return;
      }
      var row = D.setReview(cur.row.id, { decision: cur.decision, reviewer: who, reason: text || null, at: new Date().toISOString() });
      TL.toast({ title: 'Case #' + row.id + ': ' + TL.DECISION[cur.decision].label.toLowerCase(), text: cur.decision === 'approve' ? 'The worker has been notified.' : 'The worker has been notified with your reason.' });
      saveName(who); cur.decision = null; cur.row = row; render();
      if (cur.opts.onDecided) cur.opts.onDecided(row);
    });
  }

  function open(row, opts) {
    opts = opts || {};
    if (cur) { cur.row = row; cur.opts = Object.assign(cur.opts, opts); cur.tab = 'summary'; cur.decision = opts.decision || null; render(); cur.el.querySelector('#case-title').focus(); return; }
    var root = document.getElementById('case-root');
    var scrim = document.createElement('div'); scrim.className = 'scrim';
    var el = document.createElement('aside');
    el.className = 'slide-over'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'case-title');
    el.innerHTML = '<header class="case-head"></header><div class="tabs" role="tablist" aria-label="Case sections"></div>' +
      '<div class="case-body" id="case-panel" role="tabpanel" tabindex="0"></div><div class="decision-bar" role="group" aria-label="Decision"></div>';
    root.appendChild(scrim); root.appendChild(el);
    scrim.addEventListener('click', function () { close(); });
    cur = { row: row, el: el, scrim: scrim, opts: opts, tab: 'summary', decision: opts.decision || null };
    cur.release = TL.trapFocus(el, function () { if (!document.querySelector('.popover')) close(); });
    document.body.style.overflow = 'hidden';
    render();
    if (opts.decision && opts.decision !== 'approve') el.querySelector('#decision-reason').focus();
    else el.querySelector('#case-title').focus();
  }

  function close() {
    if (!cur) return;
    var c = cur; cur = null;
    c.release(); c.el.remove(); c.scrim.remove();
    document.body.style.overflow = '';
    if (c.opts.onClose) c.opts.onClose(c.row);
  }

  TL.CaseFile = { open: open, close: close, isOpen: function () { return !!cur; }, currentId: function () { return cur && cur.row.id; } };
})();
