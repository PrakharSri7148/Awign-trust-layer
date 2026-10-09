/* Worker capture flow: camera -> quality check -> sending -> verdict.
   Everything is simulated (no upload). "Diagnostics" holds the raw sensor feed and the scenario switches used to demo each state.
   URL params for static frames: ?state=camera|camera-selfie|camera-dark|consent|review-pass|review-warn|review-blocked|sending|offline|verified|sent-review  &embed=1  &theme=light */
(function () {
  'use strict';
  var TL = window.TL, D = window.TL_DATA, I = window.icon, esc = TL.esc, $ = TL.$, $$ = TL.$$;
  var params = new URLSearchParams(location.search);
  var EMBED = params.get('embed') === '1';
  TL.initTheme('dark');
  if (EMBED) document.body.classList.add('is-embed');
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var SITE = D.siteById['site_blr_01'];
  var TASKS = [{ short: 'Shelf', full: 'Shelf / site photo', face: false }, { short: 'Selfie', full: 'Selfie check-in', face: true }];
  var CONSENT_KEY = 'tl.consent';
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var S = {
    screen: 'camera', task: 0, scene: 'good', hudOpen: false, diagOpen: false, net: 'online', outcome: 'auto', camera: 'sim',
    live: 0, consent: store(CONSENT_KEY) === '1' ? 'on' : store(CONSENT_KEY) === '0' ? 'off' : 'unset',
    visitStart: Date.now() - 134000, shot: null, confirming: false, send: null, verdict: null, shots: 0, queued: 0, sheet: null,
  };
  var timers = { live: null, send: null, visit: null }, stream = null, releaseSheet = null;

  /* ---------- Quality rules (HUD and the post-capture checklist share these) ---------- */
  function hud() {
    var face = TASKS[S.task].face, sc = S.scene;
    var list = [
      { key: 'focus', label: 'Focus', state: sc === 'blurry' ? 'bad' : sc === 'shaky' ? 'warn' : 'ok', short: 'Hold steady',
        fix: { bad: 'The picture is blurry. Hold still and tap the screen to focus.', warn: 'Slightly soft. Hold still for a second.', ok: 'Sharp.' } },
      { key: 'light', label: 'Light', state: sc === 'dark' ? 'warn' : 'ok', short: 'More light needed',
        fix: { warn: 'A bit dark. Move closer to a light or turn on a flashlight.', ok: 'Good light.' } },
      { key: 'glare', label: 'Glare', state: sc === 'glare' ? 'warn' : 'ok', short: 'Tilt to cut glare',
        fix: { warn: 'There is a shiny reflection. Tilt the phone a little.', ok: 'No glare.' } },
      { key: 'steady', label: 'Steady', state: sc === 'shaky' ? 'bad' : 'ok', short: 'Hold still',
        fix: { bad: 'The phone is moving. Hold it still for a second.', ok: 'Steady.' } },
    ];
    if (face) {
      var done = S.live >= 1;
      list.push({ key: 'face', label: 'Face', state: sc === 'noface' ? 'bad' : done ? 'ok' : 'warn', short: done ? '' : 'Follow the face prompt',
        fix: { bad: 'We cannot see your face. Look at the camera, with your whole face in the oval.', warn: 'Follow the on-screen prompt.', ok: 'Face is clear.' } });
    }
    return list;
  }
  function readiness() {
    var h = hud(), bad = h.filter(function (c) { return c.state === 'bad'; })[0], warn = h.filter(function (c) { return c.state === 'warn'; })[0];
    var faceWait = TASKS[S.task].face && S.live < 1 && S.scene !== 'noface';
    if (faceWait) return { ok: false, hint: 'Follow the face prompt', disabled: true };
    if (TASKS[S.task].face && S.scene === 'noface') return { ok: false, hint: 'Face not found', disabled: true };
    if (bad) return { ok: false, hint: bad.short };
    if (warn) return { ok: false, hint: warn.short };
    return { ok: true, hint: 'Ready' };
  }
  function checks() {
    var out = hud().map(function (c) {
      var name = { focus: 'Sharp photo', light: 'Lighting', glare: 'No glare', steady: 'Steady hand', face: 'Face is clear' }[c.key];
      return { name: name, state: c.state === 'ok' ? 'pass' : c.state === 'warn' ? 'warn' : 'blocked', fix: c.state === 'ok' ? null : c.fix[c.state], key: c.key };
    });
    out.push(S.scene === 'duplicate'
      ? { name: 'New photo', state: 'blocked', fix: 'This photo was already sent on 3 Oct. Take a new one.', key: 'dup' }
      : { name: 'New photo', state: 'pass', fix: null, key: 'dup' });
    out.push({ name: 'At the site', state: 'pass', fix: null, key: 'loc', note: 'Within 40 m of ' + SITE.name });
    return out;
  }

  /* ---------- Rendering ---------- */
  var root = $('#cap-main'), app = $('#app');
  function say(msg) { $('#live').textContent = msg; }

  function header(opts) {
    opts = opts || {};
    if (opts.back) {
      return '<header class="cap-head"><span style="display:flex;align-items:center;gap:4px;min-width:0"><button class="icon-btn back" data-act="retake" aria-label="Back to camera">' + I('chevron-left') + '</button><span class="site-chip">' + I('map-pin') + '<span>' + esc(SITE.name) + '</span></span></span><span class="text-sm text-2" style="white-space:nowrap">' + esc(TASKS[S.task].full) + '</span></header>';
    }
    return '<header class="cap-head"><span class="site-chip">' + I('map-pin') + '<span>' + esc(SITE.name) + '</span></span>' +
      '<div class="segmented" role="radiogroup" aria-label="Task">' + TASKS.map(function (t, i) {
        return '<button class="segmented__item" role="radio" aria-checked="' + (S.task === i) + '" aria-label="' + t.full + '" data-task="' + i + '">' + t.short + '</button>';
      }).join('') + '</div></header>';
  }

  function sceneHtml(row) {
    if (S.camera === 'device') return '<video autoplay playsinline muted aria-label="Live camera"></video>';
    return TL.photoArt(row, { label: 'Simulated camera view' });
  }
  function sceneRow() {
    return { id: 7001 + S.task, task: TASKS[S.task].full, quality_flags: (S.scene === 'dark' ? ['Lighting'] : []).concat(S.scene === 'blurry' ? ['Blurry'] : []) };
  }
  function visitPill() {
    var on = S.consent === 'on';
    return '<button class="visit-pill ' + (on ? 'is-rec' : 'is-off') + '" data-act="visit" aria-haspopup="dialog">' + (on ? 'Recording visit · <span class="t">' + clock() + '</span>' : 'Visit not recorded') + '</button>';
  }
  function clock() { var s = Math.max(0, Math.floor((Date.now() - S.visitStart) / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  var ICON = { ok: 'check', warn: 'triangle-alert', bad: 'circle-x' }, WORD = { ok: 'good', warn: 'check this', bad: 'problem' };

  function hudHtml() {
    var h = hud(), open = S.hudOpen;
    return '<div class="hud' + (open ? ' is-open' : '') + '" role="group" aria-label="Photo quality">' +
      '<button class="hud__bar" data-act="hud" aria-expanded="' + open + '" aria-controls="hud-detail" aria-label="Photo quality details"><span class="hud__chips">' + h.map(function (c) {
        return '<span class="hud-chip hud-chip--' + c.state + '">' + I(ICON[c.state]) + c.label + '<span class="sr-only">: ' + WORD[c.state] + '</span></span>';
      }).join('') + '</span><span class="hud__toggle">' + I('chevron-up') + '</span></button>' +
      '<div class="hud__detail" id="hud-detail"' + (open ? '' : ' hidden') + '>' + h.map(function (c) {
        return '<div class="hud__row hud__row--' + c.state + '"><b>' + I(ICON[c.state]) + c.label + '</b><span>' + esc(c.fix[c.state]) + '</span></div>';
      }).join('') + '</div></div>';
  }

  function livenessHtml() {
    var p = S.live, stepsText = ['Look straight at the camera', 'Slowly turn your head left', 'Now turn right'], i = Math.min(2, Math.floor(p * 3));
    var done = p >= 1, nof = S.scene === 'noface';
    return '<div class="liveness' + (nof ? ' is-warn' : '') + '"><div class="liveness__prompt" role="status" aria-live="polite"><strong>' + (done ? 'Face verified' : nof ? 'Move your face into the oval' : stepsText[i]) + '</strong><small>' + (done ? 'You can take the photo now' : nof ? 'We cannot see you yet' : 'Step ' + (i + 1) + ' of 3') + '</small></div>' +
      '<svg viewBox="0 0 200 240" aria-hidden="true"><path class="ring-bg" d="M100 10 A80 110 0 0 1 100 230 A80 110 0 0 1 100 10"/>' +
      '<path class="ring" pathLength="100" stroke-dasharray="' + (p * 100).toFixed(1) + ' 100" d="M100 10 A80 110 0 0 1 100 230 A80 110 0 0 1 100 10"/></svg></div>';
  }

  function diagHtml() {
    var g = SITE;
    function sel(id, label, opts, val) { return '<div class="field"><label class="field__label" for="' + id + '">' + label + '</label><select class="select" id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>'; }
    return '<section class="diag" id="diag" aria-label="Diagnostics"><h3>Sensor feed</h3><dl class="diag__feed">' +
      '<dt>GPS</dt><dd class="mono">' + g.lat.toFixed(5) + ', ' + g.lng.toFixed(5) + '</dd><dt>Accuracy</dt><dd>±9 m</dd>' +
      '<dt>Motion</dt><dd class="num">1.12 m/s²</dd><dt>Network</dt><dd>' + (S.net === 'online' ? '4G, 38 Mbps' : 'Offline') + '</dd><dt>Clock offset</dt><dd class="num">+1 s</dd></dl>' +
      '<h3>Demo controls</h3><div class="diag__grid">' +
      sel('d-scene', 'Camera scene', [['good', 'Good'], ['dark', 'Low light'], ['glare', 'Glare'], ['shaky', 'Shaky'], ['blurry', 'Blurry'], ['noface', 'No face (selfie)'], ['duplicate', 'Duplicate photo']], S.scene) +
      sel('d-net', 'Network', [['online', 'Online'], ['offline', 'Offline']], S.net) +
      sel('d-out', 'Result', [['auto', 'Automatic'], ['verified', 'Verified'], ['review', 'Sent for review']], S.outcome) +
      sel('d-theme', 'Theme', [['dark', 'Dark'], ['light', 'Light (outdoors)']], document.documentElement.getAttribute('data-theme')) +
      sel('d-cam', 'Camera', [['sim', 'Simulated'], ['device', 'This device']], S.camera) + '</div></section>';
  }

  function cameraHtml() {
    var r = readiness(), face = TASKS[S.task].face;
    return header() + '<div class="cap-body">' +
      (S.net === 'offline' ? '<div class="net-banner" role="status">' + I('wifi-off') + 'You are offline. Photos are saved and sent when you are back online.</div>' : '') +
      '<div class="viewfinder"><div class="vf-scene' + (S.scene === 'shaky' ? ' is-shaky' : '') + '" style="filter:' + (S.scene === 'dark' && S.camera === 'sim' ? 'brightness(1)' : 'none') + '">' + sceneHtml(sceneRow()) + (S.scene === 'glare' ? '<div class="vf-glare"></div>' : '') + '</div>' +
      '<div class="vf-grid" aria-hidden="true"></div>' +
      '<div class="vf-top">' + visitPill() + '</div>' + (face ? livenessHtml() : '') + hudHtml() + '</div>' +
      (S.diagOpen ? '<div style="height:12px;flex:none"></div>' + diagHtml() : '') + '</div>' +
      '<div class="cap-controls"><div class="cap-controls__side"><button class="icon-btn icon-btn--bordered diag-btn" data-act="diag" aria-expanded="' + S.diagOpen + '" aria-controls="diag" aria-label="Diagnostics" data-tip="Diagnostics">' + I('activity') + '</button></div>' +
      '<div class="shutter-wrap"><button class="shutter' + (r.ok ? ' is-ready' : '') + '" data-act="shoot" aria-label="Take photo"' + (r.disabled ? ' disabled' : '') + '></button><span class="shutter-hint' + (r.ok ? ' is-ready' : '') + '" id="shutter-hint">' + (r.ok ? I('check') : '') + esc(r.hint) + '</span></div>' +
      '<div class="cap-controls__side cap-controls__side--end"></div></div>';
  }

  function reviewHtml() {
    var sh = S.shot, blocked = sh.checks.some(function (c) { return c.state === 'blocked'; }), warn = sh.checks.filter(function (c) { return c.state === 'warn'; });
    var title = blocked ? 'This photo cannot be sent' : warn.length ? (warn.length === 1 ? '1 thing to check' : warn.length + ' things to check') : 'Photo looks good';
    var sub = blocked ? 'Fix the item below and retake.' : warn.length ? 'You can still send it, but a reviewer may take a closer look.' : 'Everything checks out.';
    var order = { blocked: 0, warn: 1, pass: 2 };
    var list = sh.checks.slice().sort(function (a, b) { return order[a.state] - order[b.state]; });
    var label = { pass: 'Pass', warn: 'Check', blocked: 'Blocked' }, icon = { pass: 'circle-check', warn: 'triangle-alert', blocked: 'circle-x' }, pill = { pass: 'ok', warn: 'warn', blocked: 'bad' };
    var actions;
    if (blocked) actions = '<button class="btn btn--primary btn--lg btn--block" data-act="retake">' + I('rotate-ccw') + 'Retake photo</button>';
    else if (S.confirming) actions = '<div class="confirm-card" role="alertdialog" aria-labelledby="cf-t"><strong id="cf-t">Send with a warning?</strong><p>A reviewer may ask you to retake it, which can delay this task.</p></div>' +
      '<button class="btn btn--primary btn--lg btn--block" data-act="send-anyway">Send anyway</button><button class="btn btn--lg btn--block" data-act="retake">Retake photo</button>';
    else actions = '<button class="btn btn--primary btn--lg btn--block" data-act="send">' + I('send') + 'Send for verification</button><button class="btn btn--ghost btn--lg btn--block" data-act="retake">Retake photo</button>';
    return header({ back: true }) + '<div class="cap-body"><div class="preview">' + (sh.img ? '<img src="' + sh.img + '" alt="Photo you took" />' : TL.photoArt(sh.row, { label: 'Photo you took (illustration)' })) + '</div>' +
      '<div class="review"><div class="review__summary"><h1 id="screen-title" tabindex="-1">' + title + '</h1><p class="text-2 text-sm">' + sub + '</p></div>' +
      '<ul class="checklist" aria-label="Photo checks">' + list.map(function (c) {
        return '<li class="check check--' + c.state + '">' + I(icon[c.state]) + '<span class="check__name">' + c.name + '</span><span class="pill pill--' + pill[c.state] + '">' + label[c.state] + '</span>' +
          (c.fix ? '<span class="check__fix">' + esc(c.fix) + '</span>' : c.note ? '<span class="check__fix">' + esc(c.note) + '</span>' : '') + '</li>';
      }).join('') + '</ul></div></div><div class="cap-actions">' + actions + '</div>';
  }

  function sendingHtml() {
    var s = S.send, names = ['Uploading photo', 'Checking location', 'Verifying'];
    var state = function (i) { return i < s.step ? 'done' : i === s.step ? (s.offline && i === 0 ? 'failed' : 'active') : 'pending'; };
    var steps = names.map(function (n, i) {
      var st = state(i), ic = { done: 'circle-check', failed: 'cloud-off', active: 'loader-circle', pending: 'circle-dot' }[st];
      var txt = { done: 'Done', failed: 'Saved', active: i === 0 ? s.pct + '%' : 'Working', pending: 'Waiting' }[st];
      return '<li class="step step--' + st + '"><span class="step__icon' + (st === 'active' ? ' spin' : '') + '">' + I(ic === 'circle-dot' ? 'circle-dot' : ic) + '</span><span class="step__name">' + n + '</span><span class="step__state">' + txt + '</span>' +
        (i === 0 && st === 'active' ? '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + s.pct + '" aria-label="Upload progress"><span style="width:' + s.pct + '%"></span></div>' : '') + '</li>';
    }).join('');
    return header({ back: false }).replace(/<div class="segmented"[\s\S]*<\/div><\/header>/, '<span class="text-sm text-2">' + esc(TASKS[S.task].full) + '</span></header>') +
      '<div class="cap-body"><div class="sending"><div><h1 id="screen-title" tabindex="-1" style="font-size:20px">' + (s.offline ? 'Saved on this phone' : 'Sending your photo') + '</h1><p class="text-2 text-sm" style="margin-top:4px">' + (s.offline ? 'Waiting for a connection.' : 'This usually takes a few seconds.') + '</p></div>' +
      '<ol class="steps" aria-label="Progress">' + steps + '</ol>' +
      (s.offline ? '<div class="offline-card" role="status"><div class="offline-card__head">' + I('cloud-off') + 'You are offline</div><p>Your photo is saved. We will send it automatically when you are back online. You do not need to do anything.</p><p><strong style="color:var(--color-text)">1 photo waiting to send</strong></p><button class="btn btn--block" data-act="retry">' + I('refresh-cw') + 'Try again now</button></div>' : '') + '</div></div>' +
      (s.offline ? '<div class="cap-actions"><button class="btn btn--primary btn--lg btn--block" data-act="next">Take another photo</button></div>' : '');
  }

  function verdictHtml() {
    var v = S.verdict, ok = v.kind === 'verified';
    return '<div class="cap-body"><div class="verdict verdict--' + (ok ? 'ok' : 'review') + '"><div class="verdict__badge">' + I(ok ? 'badge-check' : 'clock') + '</div>' +
      '<h1 id="screen-title" tabindex="-1">' + (ok ? 'Verified' : 'Sent for review') + '</h1><p class="verdict__reason">' + esc(v.reason) + '</p>' +
      '<p>' + (ok ? 'Nothing else is needed for this photo.' : 'You can keep working. We will let you know if a retake is needed.') + '</p></div></div>' +
      '<div class="cap-actions"><button class="btn btn--primary btn--lg btn--block" data-act="next">' + I('camera') + 'Take next photo</button></div>';
  }

  function render() {
    stopLive(); app.querySelectorAll('.sheet,.sheet-scrim').forEach(function (n) { n.remove(); }); if (releaseSheet) { releaseSheet(); releaseSheet = null; }
    root.innerHTML = { camera: cameraHtml, review: reviewHtml, sending: sendingHtml, verdict: verdictHtml }[S.screen]();
    wire();
    if (S.screen === 'camera') { if (S.camera === 'device') attachStream(); if (TASKS[S.task].face) startLive(); }
    var t = $('#screen-title'); if (t && !EMBED) t.focus();
  }

  /* ---------- Behaviour ---------- */
  function wire() {
    $$('[data-act]', root).forEach(function (b) { b.addEventListener('click', function () { act(b.dataset.act, b); }); });
    $$('[data-task]', root).forEach(function (b) { b.addEventListener('click', function () { var i = +b.dataset.task; if (i === S.task) return; S.task = i; S.live = 0; S.hudOpen = false; render(); var n = $('[data-task="' + i + '"]'); if (n) n.focus(); say(TASKS[i].full + ' selected'); }); });
    var seg = $('.segmented[role=radiogroup]', root);
    if (seg) seg.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = $('[data-task="' + (1 - S.task) + '"]'); if (n) n.click(); } });
    [['d-scene', 'scene'], ['d-net', 'net'], ['d-out', 'outcome'], ['d-theme', 'theme'], ['d-cam', 'camera']].forEach(function (p) {
      var el = $('#' + p[0]); if (!el) return;
      el.addEventListener('change', function () {
        if (p[1] === 'theme') { TL.setTheme(el.value); return; }
        S[p[1]] = el.value;
        if (p[1] === 'scene' && S.scene === 'noface') S.live = Math.min(S.live, 0.2);
        if (p[1] === 'net') onNet();
        if (p[1] === 'camera') { if (S.camera === 'sim') stopStream(); }
        render(); var n = $('#' + p[0]); if (n) n.focus();
      });
    });
  }
  function act(a, el) {
    if (a === 'hud') { S.hudOpen = !S.hudOpen; var h = $('.hud'); h.classList.toggle('is-open', S.hudOpen); el.setAttribute('aria-expanded', S.hudOpen); $('#hud-detail').hidden = !S.hudOpen; }
    else if (a === 'diag') { S.diagOpen = !S.diagOpen; render(); var d = $('[data-act=diag]'); if (d) d.focus(); if (S.diagOpen) { var dg = $('#diag'); if (dg) dg.scrollIntoView({ block: 'nearest' }); } }
    else if (a === 'visit') openSheet(S.consent === 'on' ? 'manage' : 'consent');
    else if (a === 'shoot') shoot();
    else if (a === 'retake' || a === 'next') { S.screen = 'camera'; S.shot = null; S.confirming = false; S.send = null; S.live = 0; render(); var sh = $('.shutter'); if (sh && !EMBED) sh.focus(); }
    else if (a === 'send') { if (S.shot.checks.some(function (c) { return c.state === 'warn'; })) { S.confirming = true; render(); $('[data-act=send-anyway]').focus(); } else startSend(); }
    else if (a === 'send-anyway') { S.shot.sentAnyway = true; startSend(); }
    else if (a === 'retry') { if (S.net === 'offline') TL.toast({ type: 'error', title: 'Still offline', text: 'Your photo is saved. It will send as soon as you have a connection.' }); else onNet(); }
  }

  function shoot() {
    var r = readiness(); if (r.disabled) return;
    S.shots++;
    var ck = checks(), flags = (S.scene === 'dark' ? ['Lighting'] : []).concat(S.scene === 'blurry' || S.scene === 'shaky' ? ['Blurry'] : []);
    var shot = { checks: ck, row: { id: 7100 + S.shots, task: TASKS[S.task].full, quality_flags: flags }, img: null };
    if (S.camera === 'device') { var v = $('.vf-scene video'); if (v && v.videoWidth) { var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); shot.img = c.toDataURL('image/jpeg', 0.8); } }
    S.shot = shot; S.screen = 'review'; S.confirming = false; render(); say('Photo taken. Review the checks.');
  }

  /* Sending: a real status list. Upload progress is driven by time here; in the product it follows the actual request. */
  function startSend() {
    clearTimers(); S.screen = 'sending'; S.send = { step: 0, pct: 0, offline: false }; render(); runStep();
  }
  function runStep() {
    var s = S.send; if (!s || S.screen !== 'sending') return;
    if (s.step === 0) {
      if (S.net === 'offline') { s.offline = true; update(); return; }
      s.offline = false; s.pct = 0;
      timers.send = setInterval(function () {
        if (S.net === 'offline') { clearInterval(timers.send); s.offline = true; update(); return; }
        s.pct = Math.min(100, s.pct + 7); partial();
        if (s.pct >= 100) { clearInterval(timers.send); s.step = 1; update(); timers.send = setTimeout(function () { s.step = 2; update(); timers.send = setTimeout(finish, 1300); }, 1000); }
      }, 110);
    }
  }
  function update() { if (S.screen === 'sending') { root.innerHTML = sendingHtml(); wire(); say(S.send.offline ? 'You are offline. Photo saved on this phone.' : S.send.step === 1 ? 'Checking location' : 'Verifying'); } }
  function partial() { var bar = $('.progress > span'), st = $('.step--active .step__state'); if (bar) bar.style.width = S.send.pct + '%'; if (st) st.textContent = S.send.pct + '%'; var pb = $('.progress'); if (pb) pb.setAttribute('aria-valuenow', S.send.pct); }
  function finish() {
    var warns = S.shot.checks.filter(function (c) { return c.state === 'warn'; });
    var kind = S.outcome === 'auto' ? (warns.length ? 'review' : 'verified') : S.outcome;
    var why = { light: 'Your photo was a bit dark, so a reviewer will take a quick look.', glare: 'There was a reflection in the photo, so a reviewer will take a quick look.', focus: 'The photo was slightly soft, so a reviewer will take a quick look.', face: 'The face prompt was not fully completed, so a reviewer will take a quick look.' };
    S.verdict = { kind: kind, reason: kind === 'verified' ? 'Your photo and location match ' + SITE.name + '.' : (warns[0] && why[warns[0].key]) || 'A reviewer will take a quick look to confirm your photo.' };
    S.screen = 'verdict'; render(); say(kind === 'verified' ? 'Verified' : 'Sent for review');
  }
  function onNet() {
    if (S.screen === 'sending' && S.send && S.send.step === 0 && S.send.offline && S.net === 'online') { S.send.offline = false; update(); TL.toast({ title: 'Back online', text: 'Sending your saved photo.' }); runStep(); }
  }
  window.addEventListener('online', function () { if (S.net !== 'online') { S.net = 'online'; onNet(); } });
  window.addEventListener('offline', function () { S.net = 'offline'; if (S.screen === 'camera') render(); });
  function clearTimers() { clearInterval(timers.send); clearTimeout(timers.send); }

  /* Liveness: progress ring fills as the (simulated) head-turn steps are completed. */
  function startLive() {
    if (S.live >= 1 || EMBED && params.get('p')) { return; }
    timers.live = setInterval(function () {
      var cap = S.scene === 'noface' ? 0.2 : 1;
      if (S.live >= cap) return;
      S.live = Math.min(cap, S.live + 0.017);
      var ring = $('.liveness .ring'); if (ring) ring.setAttribute('stroke-dasharray', (S.live * 100).toFixed(1) + ' 100');
      var i = Math.min(2, Math.floor(S.live * 3)), prompt = $('.liveness__prompt'), steps = ['Look straight at the camera', 'Slowly turn your head left', 'Now turn right'];
      if (prompt && S.live < 1) { prompt.querySelector('strong').textContent = steps[i]; prompt.querySelector('small').textContent = 'Step ' + (i + 1) + ' of 3'; }
      if (S.live >= 1) { stopLive(); render(); say('Face verified. You can take the photo.'); }
    }, 90);
  }
  function stopLive() { clearInterval(timers.live); timers.live = null; }

  /* Device camera (optional, via Diagnostics) */
  function attachStream() {
    var v = $('.vf-scene video'); if (!v) return;
    if (stream) { v.srcObject = stream; return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fail('This browser cannot open the camera.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: TASKS[S.task].face ? 'user' : 'environment' }, audio: false }).then(function (s) { stream = s; var vv = $('.vf-scene video'); if (vv) vv.srcObject = s; }, function () { fail('Camera permission was not given. Allow camera access in your browser settings, or use the simulated camera.'); });
    function fail(msg) { S.camera = 'sim'; TL.toast({ type: 'error', title: 'Could not open the camera', text: msg }); render(); }
  }
  function stopStream() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } }

  /* Consent / visit recording bottom sheet */
  function openSheet(kind) {
    closeSheet();
    var scrim = document.createElement('div'); scrim.className = 'sheet-scrim';
    var sh = document.createElement('div'); sh.className = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-labelledby', 'sheet-t');
    sh.innerHTML = '<div class="sheet__grab" aria-hidden="true"></div>' + (kind === 'manage'
      ? '<h2 id="sheet-t">Visit recording is on</h2><p>We are noting your location and movement during this visit so reviewers can confirm you reached the site.</p><div class="sheet__actions"><button class="btn btn--primary btn--lg" data-s="keep">Keep recording</button><button class="btn btn--lg" data-s="stop">Stop recording</button></div>'
      : '<h2 id="sheet-t">Record your visit?</h2><p>This helps your photos get verified faster.</p><ul class="sheet__list"><li>' + I('map-pin') + '<span>We note your location and movement while this page is open.</span></li><li>' + I('shield-check') + '<span>Only the review team sees it, and only to check your visit.</span></li><li>' + I('x') + '<span>You can turn it off any time from the recording pill.</span></li></ul><div class="sheet__actions"><button class="btn btn--primary btn--lg" data-s="allow">Allow</button><button class="btn btn--ghost btn--lg" data-s="deny">Not now</button></div>');
    app.append(scrim, sh);
    function done(v) {
      if (v === 'allow') { S.consent = 'on'; store(CONSENT_KEY, '1'); S.visitStart = Date.now(); }
      if (v === 'deny') { S.consent = 'off'; store(CONSENT_KEY, '0'); }
      if (v === 'stop') { S.consent = 'off'; store(CONSENT_KEY, '0'); }
      closeSheet(); render(); var p = $('.visit-pill'); if (p && !EMBED) p.focus();
    }
    $$('[data-s]', sh).forEach(function (b) { b.addEventListener('click', function () { done(b.dataset.s); }); });
    scrim.addEventListener('click', function () { done(kind === 'manage' ? 'keep' : 'deny'); });
    releaseSheet = TL.trapFocus(sh, function () { done(kind === 'manage' ? 'keep' : 'deny'); });
    sh.querySelector('button').focus();
  }
  function closeSheet() { app.querySelectorAll('.sheet,.sheet-scrim').forEach(function (n) { n.remove(); }); if (releaseSheet) { releaseSheet(); releaseSheet = null; } }

  /* ---------- Boot (with static frame states for the frames page) ---------- */
  function applyState(st) {
    var M = {
      'camera': function () {},
      'camera-selfie': function () { S.task = 1; S.live = +(params.get('p') || 0.55); },
      'camera-dark': function () { S.scene = 'dark'; S.hudOpen = true; },
      'review-pass': function () { S.shot = { checks: checks(), row: { id: 7101, task: TASKS[S.task].full, quality_flags: [] } }; S.screen = 'review'; },
      'review-warn': function () { S.scene = 'dark'; S.shot = { checks: checks(), row: { id: 7102, task: TASKS[S.task].full, quality_flags: ['Lighting'] } }; S.screen = 'review'; },
      'review-blocked': function () { S.scene = 'duplicate'; S.shot = { checks: checks(), row: { id: 7103, task: TASKS[S.task].full, quality_flags: [] } }; S.screen = 'review'; },
      'sending': function () { S.shot = { checks: checks(), row: { id: 7104, task: TASKS[S.task].full, quality_flags: [] } }; S.screen = 'sending'; S.send = { step: 0, pct: 62, offline: false }; },
      'offline': function () { S.net = 'offline'; S.shot = { checks: checks(), row: { id: 7105, task: TASKS[S.task].full, quality_flags: [] } }; S.screen = 'sending'; S.send = { step: 0, pct: 0, offline: true }; },
      'verified': function () { S.screen = 'verdict'; S.verdict = { kind: 'verified', reason: 'Your photo and location match ' + SITE.name + '.' }; },
      'sent-review': function () { S.screen = 'verdict'; S.verdict = { kind: 'review', reason: 'Your photo was a bit dark, so a reviewer will take a quick look.' }; },
      'consent': function () { S.consent = 'unset'; },
    };
    if (M[st]) M[st]();
  }
  var st = params.get('state');
  if (st) { if (st !== 'consent') S.consent = 'on'; applyState(st); }
  else if (EMBED) S.consent = 'on';
  render();
  if (st === 'consent' || (!st && S.consent === 'unset' && !EMBED)) openSheet('consent');
  if (!EMBED || !st) timers.visit = setInterval(function () { var t = $('.visit-pill .t'); if (t) t.textContent = clock(); }, 1000);
  window.TL_CAPTURE = { state: S };
})();
