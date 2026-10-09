/* Capture · Photo step prototype: renderers. Pure functions (state -> HTML string). One function per React component it maps to:
   Stepper, VisitPanel, LiveCamera (stage), LivenessOverlay, LiveHud, QualityChecklist, PhotoOverlay, SensorFeed.
   data-inv="A1 …" marks which inventory items an element carries (used by tools/verify.mjs and the Coverage page). */
(function () {
  var D = window.CAP_DATA;
  var R = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function inv() { return ' data-inv="' + Array.prototype.join.call(arguments, ' ') + '"'; }
  function icon(n, s, c) { return window.ic(n, s, c); }
  var UP = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  var kv = function (k, v, o) {
    o = o || {};
    var val = v == null || v === '' ? '-' : v;
    return '<div class="cap-kv__row"' + (o.id ? ' data-inv="' + o.id + '"' : '') + '><dt>' + esc(k) + '</dt><dd class="' + (o.tone ? 'cap-kv__val--' + o.tone + ' ' : '') + (o.mono ? 'cap-mono ' : '') + (v == null || v === '' ? 'cap-kv__val--muted' : '') + '"' + (o.bind ? ' data-bind="' + o.bind + '"' : '') + '>' + esc(val) + '</dd></div>';
  };

  /* ---------- meters ---------- */
  function meter(r, n, label, muted) {
    var pct = muted ? 0 : r.pct, cells = '', lit, zoneLo = -1, zoneHi = -1, at = -1, nw = -1, nf = -1;
    var tone = muted ? 'pass' : r.status;
    if (r.position && r.ticks && r.ticks.lo != null) {
      zoneLo = Math.round(r.ticks.lo / 100 * n); zoneHi = Math.round(r.ticks.hi / 100 * n) - 1;
      at = Math.max(0, Math.min(n - 1, Math.round(pct / 100 * (n - 1))));
    } else {
      lit = Math.round(pct / 100 * n); if (pct > 0 && lit === 0) lit = 1;
      if (r.ticks) { nw = r.ticks.warn != null ? Math.round(r.ticks.warn / 100 * n) : -1; nf = r.ticks.fail != null ? Math.round(r.ticks.fail / 100 * n) : -1; }
    }
    for (var i = 0; i < n; i++) {
      var cls = 'cap-meter__cell';
      if (at >= 0) { if (i >= zoneLo && i <= zoneHi) cls += ' cap-meter__cell--zone'; if (i === at && !muted) cls += ' cap-meter__cell--on'; }
      else { if (i < lit && !muted) cls += ' cap-meter__cell--on'; if (i === nw && nw > 0) cls += ' cap-meter__cell--n-warn'; if (i === nf && nf > 0) cls += ' cap-meter__cell--n-fail'; }
      cells += '<i class="' + cls + '"></i>';
    }
    return '<span class="cap-meter cap-meter--' + tone + (n === 20 ? ' cap-meter--20' : '') + (at >= 0 ? ' cap-meter--position' : '') + (muted ? ' cap-meter--muted' : '') + ' cap-hud__meter" role="meter" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '" aria-valuetext="' + esc(label) + '" data-segments="' + n + '">' + cells + '</span>';
  }
  R.meter = meter;

  var STATUS_WORD = { pass: 'passed', warn: 'warning', fail: 'failed' };
  var STATUS_ICON = { pass: 'check', warn: 'triangle-alert', fail: 'circle-x' };

  /* ---------- A: shell ---------- */
  function logo() { return '<svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true"><path d="M9 11h14M16 11v12" stroke="#fff" stroke-width="2.8" stroke-linecap="round" fill="none"/></svg>'; }

  R.topbar = function (S) {
        var ip = D.IPDB[S.ipdb];
    var h = '<header class="cap-topbar">';
    h += '<a class="cap-brand" href="#" data-act="noop"' + inv('A1') + ' aria-label="Trust Layer, SYS//VERIFY v1.0"><span class="cap-brand__logo">' + logo() + '</span><span class="cap-brand__text"><span class="cap-brand__name">TRUST LAYER</span><span class="cap-brand__sub">SYS//VERIFY v1.0</span></span></a>';
    h += '<nav class="cap-nav" aria-label="Primary"' + inv('A2') + '><a class="cap-nav__tab" href="#" aria-current="page" aria-label="Capture" data-tip="Capture" data-act="noop">' + icon('camera', 18) + '</a><a class="cap-nav__tab" href="#" aria-label="Dashboard" data-tip="Dashboard" data-act="noop">' + icon('layout-grid', 18) + '</a></nav>';
    h += '<div class="cap-topbar__right">';
    h += '<span class="cap-chip cap-chip--worker"' + inv('A3') + '>' + D.WORKER_ID + ' · ' + D.SITE_ID + '</span>';
    if (ip) h += '<span class="cap-chip cap-chip--warn cap-chip--ipdb" tabindex="0" data-tip="' + esc(ip.detail) + '" data-tip-pos="left"' + inv('A5') + '>' + icon('triangle-alert', 14) + esc(ip.label) + '</span>';
    if (ip) h += '<button type="button" class="cap-icon-btn cap-topbar__more" aria-label="Warnings" aria-expanded="' + !!S.menu + '" data-act="menu" data-fid="menu" data-badge="1">' + icon('ellipsis', 18) + '</button>';
    h += '</div>';
    if (S.menu) {
      h += '<div class="cap-popover" role="dialog" aria-label="Warnings">';
      if (ip) h += '<p class="cap-popover__note"' + inv('A5') + '>' + icon('triangle-alert', 14) + '<span><b>' + esc(ip.label) + '.</b> ' + esc(ip.detail) + '</span></p>';
      h += '</div>';
    }
    return h + '</header>';
  };

  R.footer = function (S) {
    return '<footer class="cap-footer"' + inv('A7') + '>' +
      (S.ipdb !== 'missing' ? '<div><a href="' + D.DBIP.url + '" target="_blank" rel="noopener noreferrer">' + D.DBIP.text + '</a> · CC BY 4.0</div>' : '') + '</footer>';
  };
  R.bottomnav = function () {
    return '<nav class="cap-bottomnav" aria-label="Primary (phone)"><a href="#" aria-current="page" data-act="noop">' + icon('camera', 18) + 'Capture</a><a href="#" data-act="noop">' + icon('layout-grid', 18) + 'Dashboard</a></nav>';
  };

  /* ---------- B: Stepper ---------- */
  R.stepper = function (S) {
    var cur = S.step === 'arrival' ? 1 : 0;
    var h = '<ol class="cap-stepper" aria-label="Progress"' + inv('B1') + '>';
    D.STEPS.forEach(function (label, i) {
      var st = i < cur ? 'done' : i === cur ? 'active' : 'pending';
      h += '<li class="cap-stepper__item cap-stepper__item--' + st + '"' + (i === cur ? ' aria-current="step"' : '') + '><span class="cap-stepper__dot">' + (i < cur ? icon('check', 15) : i + 1) + '</span><span class="cap-stepper__label">' + label + '</span></li>';
      if (i < D.STEPS.length - 1) h += '<li class="cap-stepper__bar' + (i < cur ? ' cap-stepper__bar--done' : '') + '" role="presentation" aria-hidden="true"></li>';
    });
    return h + '</ol>';
  };

  /* ---------- C: Mission brief ---------- */
  R.brief = function (S) {
    var t = D.TASKS[S.task];
    var h = '<section class="cap-card cap-brief" aria-label="Task">';
    h += '<div class="cap-brief__tasks" role="group" aria-label="Task type"' + inv('C3') + '>';
    D.TASK_ORDER.forEach(function (k) { h += '<button type="button" class="cap-chip cap-chip--toggle" aria-pressed="' + (k === S.task) + '" data-act="task" data-arg="' + k + '" data-fid="task-' + k + '">' + esc(D.TASKS[k].label) + '</button>'; });
    h += '</div>';
    if (t.face !== 'off') h += '<p class="cap-brief__note"' + inv('C4') + '>' + icon('scan-face', 16) + '<span>' + esc(D.FACE_NOTE[t.face]) + '</span></p>';
    return h + '</section>';
  };

  /* ---------- E: banners ---------- */
  R.banners = function (S) {
    var h = '';
    if (S.error) {
      h += '<div class="cap-banner cap-banner--error" role="alert"' + inv('E1') + '>' + icon('circle-alert', 18) + '<span class="cap-banner__text">' + esc(S.error.text) + '</span>' +
        (S.error.retry ? '<button type="button" class="cap-btn cap-btn--sm cap-btn--danger" data-act="retry" data-fid="retry">' + icon('refresh-cw', 14) + ' Retry</button>' : '') + '</div>';
    }
    if (S.camNote && S.mode === 'file' && !S.photo) {
      var t = D.TASKS[S.task];
      h += '<div class="cap-banner cap-banner--warn" role="status"' + inv('E2') + '>' + icon('circle-alert', 18) + '<span class="cap-banner__text">' + (S.camNote === 'denied' ? D.CAMERA_NOTE.denied : D.CAMERA_NOTE.unavailable) + (t.live ? D.CAMERA_NOTE.live : D.CAMERA_NOTE.other) + '</span></div>';
    }
    return h;
  };

  /* ---------- G5: LivenessOverlay ---------- */
  R.liveness = function (S) {
    var L = S.liveness, offline = S.offlineLive;
    var tone = 'idle', title = 'Position your face in the frame', sub = 'Then follow the on-screen prompt.', steps = '', bar = '', actions = '', running = L.phase === 'running' || L.phase === 'active' || L.phase === 'facelost' || L.phase === 'wait';
    var prompt = L.challenge ? D.PROMPTS[L.challenge] : '';
    if (offline && !running && L.phase !== 'passed') { tone = 'bad'; title = "Can't reach the server"; sub = 'The live check needs a connection. Check your signal; trying again…'; }
    else if (L.phase === 'running') { tone = 'run'; title = prompt; sub = L.secs + 's left'; }
    else if (L.phase === 'active') { tone = 'go'; title = prompt; sub = 'Got it, hold…'; }
    else if (L.phase === 'facelost') { tone = 'run'; title = 'Keep your face in the frame'; sub = L.secs + 's left'; }
    else if (L.phase === 'wait') { tone = 'run'; title = 'Look at the camera'; sub = 'Next: ' + prompt.toLowerCase(); }
    else if (L.phase === 'passed') { tone = 'ok'; title = 'Live check passed'; sub = 'Take your photo now.'; }
    else if (L.phase === 'review') { tone = 'warn'; title = 'Sending for review'; sub = 'The live check could not be completed. You can take the photo; it will be reviewed.'; }
    else if (L.phase === 'failed') { tone = 'bad'; title = 'That did not work'; var canRetry = L.attempts < D.LIVE_MAX_ATTEMPTS; sub = (L.reason + ' ' + (canRetry ? 'Try again (' + L.attempts + ' of ' + D.LIVE_MAX_ATTEMPTS + ' used).' : 'You can send this for review instead.')).trim(); }
    else if (L.phase === 'expired') { tone = 'warn'; title = 'The live check has expired'; sub = 'Do it again before taking the photo.'; }
    if (L.phase === 'running' || L.phase === 'active' || L.phase === 'facelost' || L.phase === 'wait') {
      steps = '<span class="cap-liveness__steps" aria-label="Step ' + (L.idx + 1) + ' of ' + L.total + '">';
      for (var i = 0; i < L.total; i++) steps += '<i class="' + (i < L.idx ? 'is-done' : i === L.idx ? 'is-now' : '') + '"></i>';
      steps += '</span>';
    }
    if (L.phase === 'running' || L.phase === 'facelost') {
      var p = Math.max(0, Math.min(100, L.secs / D.LIVE_TIMEOUT_S * 100));
      bar = '<span class="cap-liveness__bar' + (S.auto ? ' cap-liveness__bar--run' : '') + '" style="--p:' + p + '%;--cap-live-ms:' + (L.secs * 1000) + 'ms"><i></i></span>';
    }
    if (L.phase === 'failed' || L.phase === 'expired') {
      var more = L.attempts < D.LIVE_MAX_ATTEMPTS;
      if (more || L.phase === 'expired') actions += '<button type="button" class="cap-btn cap-btn--sm cap-btn--primary" data-act="live-retry" data-fid="live-retry">' + icon('refresh-cw', 14) + ' Try again</button>';
      if (!more && L.phase === 'failed') actions += '<button type="button" class="cap-btn cap-btn--sm" data-act="live-review" data-fid="live-review">' + icon('send', 14) + ' Send for review</button>';
    }
    var live = (tone === 'idle' ? 'idle' : tone);
    return '<div class="cap-liveness cap-liveness--' + live + '" role="status" data-liveness="' + live + '"' + inv('G5') + '>' +
      '<div class="cap-liveness__row">' + icon(tone === 'ok' ? 'check' : 'scan-face', 18) + '<strong class="cap-liveness__title">' + esc(title) + '</strong>' + steps + '</div>' +
      '<span class="cap-liveness__sub">' + esc(sub) + '</span>' + bar +
      (actions ? '<div class="cap-liveness__actions">' + actions + '</div>' : '') +
      '<button type="button" class="cap-btn cap-btn--sm cap-liveness__voice" aria-pressed="' + !!S.voice + '" data-act="voice" data-fid="voice" data-tip="' + (S.voice ? 'Stop reading aloud' : 'Read prompts aloud') + '">' + icon(S.voice ? 'volume-x' : 'volume-2', 14) + '<span class="cap-liveness__voicetxt">' + (S.voice ? 'Stop reading aloud' : 'Read prompts aloud') + '</span></button></div>';
  };

  /* ---------- H: LiveHud ---------- */
  var RAW = { brightness: 'mean 0.231 · clipped 0.000', focus: 'lapVar 41.200 · tiles 6', lens: 'covered 0.000 · dark 0.000', glare: 'area 0.012 · peak 0.940', steady: 'rms 0.044 · samples 31', noise: 'sigma 2.100', resolution: 'w 1920 · h 1440', face: 'conf 0.920 · height 0.380', liveness: 'phase idle · attempts 0' }; /* MOCK */
  R.hud = function (S, variant, hud) {
    var overlay = variant === 'overlay';
    var mode = overlay ? S.hud.overlay : S.hud.side;
    var expanded = mode === 'expanded';
    var ov = hud.overall;
    var word = ov == null ? '' : ({ pass: 'Good', warn: 'Fair', fail: 'Poor' })[hud.overallStatus];
    var h = '<section class="cap-hud cap-hud--' + mode + (overlay ? ' cap-hud--overlay cap-scrimbox cap-on-camera' : '') + '" aria-label="Live quality metrics" data-mode="' + mode + '"' + inv('H1') + '>';
    h += '<header class="cap-hud__head"><div class="cap-kpi"><span class="cap-kpi__label cap-eyebrow">Live quality</span><div class="cap-kpi__row"><b class="cap-kpi__value" data-testid="hud-overall">' + (ov == null ? '—' : ov + '<small>%</small>') + '</b>' + (ov == null ? '' : '<span class="cap-pill cap-pill--' + hud.overallStatus + '">' + icon(STATUS_ICON[hud.overallStatus], 12) + word + '</span>') + '</div></div>';
    h += '<button type="button" class="cap-hud__toggle" aria-expanded="' + expanded + '" aria-label="' + (expanded ? 'Show fewer live metrics' : 'Show all live metrics') + '" data-act="hud-toggle" data-arg="' + variant + '" data-fid="hud-' + variant + '"' + inv('H2') + '>Metrics ' + icon(expanded ? 'chevron-down' : 'chevron-up', 14) + '</button></header>';
    h += meter({ pct: ov || 0, status: hud.overallStatus }, 20, 'Live quality ' + (ov == null ? 'not available' : ov + '%'), ov == null);
    if (expanded) h += '<span class="cap-hud__note" tabindex="0" data-tip="Live numbers are estimates at preview size; the photo is fully checked after capture."' + inv('H3') + '>' + icon('info', 12) + 'Compression: checked when you capture</span>';
    h += '<ul class="cap-hud__rows"' + inv('H4') + '>';
    hud.rows.forEach(function (r) {
      var text = r.label + ' ' + r.display + (r.status === 'pass' ? '' : ' ' + r.status);
      var showWord = !r.noScore && r.status !== 'pass';
      h += '<li class="cap-hud__row cap-hud__row--' + r.status + (r.noScore ? ' cap-hud__row--muted' : '') + '" data-metric="' + r.id + '" data-status="' + r.status + '" aria-label="' + esc(text) + '">';
      h += '<span class="cap-hud__label">' + r.label + '</span>' + meter(r, D.ROW_N, text, r.noScore);
      h += '<span class="cap-hud__value">' + esc(r.display) + (r.noScore ? '' : icon(STATUS_ICON[r.status], 14) + '<span class="cap-sr">' + STATUS_WORD[r.status] + '</span>') + '</span>';
      if (expanded && (r.reason || showWord)) h += '<span class="cap-hud__reason">' + (showWord ? '<span class="cap-hud__word">' + (r.status === 'fail' ? 'Failed' : 'Warning') + '</span>' + (r.reason ? ' · ' : '') : '') + esc(r.reason || '') + '</span>';
      if (S.diag.raw) h += '<span class="cap-hud__raw"' + inv('H5') + '>' + RAW[r.id] + '</span>';
      h += '</li>';
    });
    return h + '</ul></section>';
  };

  /* ---------- G: LiveCamera (stage) ---------- */
  function sceneClass(S, hud) {
    var s = hud && hud.scene || {};
    return (s.dark ? ' cap-scene--dark' : '') + (s.blur ? ' cap-scene--blur' : '') + (s.shaky ? ' cap-scene--shaky' : '');
  }
  function sceneSvg(S, k) { return D.TASKS[S.task].face === 'off' || S.task === 'worker' ? D.sceneShelf() : D.sceneFace(k); }
  R.stageLive = function (S, ctx) {
    var t = D.TASKS[S.task], needsFace = t.face !== 'off', needsLive = t.face === 'required';
    var hud = D.hudModel(S);
    var starting = S.cam === 'starting', live = S.cam === 'live';
    var imm = ctx.phone && (live || starting);
    var liveOk = !needsLive || S.liveness.phase === 'passed';
    var ready = S.quality === 'ready' && liveOk && !S.busy;
    var mirrored = t.camera === 'user';
    var h = '<div class="cap-stage cap-on-camera' + (imm ? ' cap-stage--immersive' : '') + '" data-stage="camera" data-cam="' + S.cam + '" data-face-k="' + (imm ? 0.6 : 0.85) + '" data-immersive="' + (imm ? 1 : 0) + '"' + inv('G1') + '>';
    if (live) {
      h += '<div class="cap-stage__scene' + (mirrored ? ' cap-stage__scene--mirror' : '') + '"><div class="' + sceneClass(S, hud).trim() + '" style="width:100%;height:100%">' + sceneSvg(S, imm ? 0.6 : 0.85) + '</div></div>';
      if (hud.scene.glare) h += '<div class="cap-stage__glare"></div>';
    }
    if (!live) {
      h += '<button type="button" class="cap-start" data-act="open-cam" data-fid="start"' + (starting ? ' disabled' : '') + inv('F1') + '><span class="cap-start__icon">' + (starting ? icon('loader-circle', 28, 'cap-spin') : icon('camera', 28)) + '</span><strong class="cap-start__title">' + (starting ? 'Opening camera…' : 'Tap to open camera') + '</strong><span class="cap-start__cap">' + (t.camera === 'user' ? 'Front camera' : 'Rear camera') + ' · live guidance</span></button>';
    }
    if (imm) h += '<div class="cap-minisp" role="img" aria-label="Step 1 of 4: Photo"><i></i><i></i><i></i><i></i></div>';
    if (live && needsFace && S.faceFound !== false) {
      h += '<div class="cap-mesh cap-mesh--' + (hud.rows.filter(function (r) { return r.id === 'face'; })[0].status === 'pass' ? 'ok' : '') + '" data-face-box="mesh"' + inv('G2') + '>' + D.faceMesh() + '</div>';
      var fs = hud.rows.filter(function (r) { return r.id === 'face'; })[0].status;
      h += '<div class="cap-facebox cap-facebox--' + (fs === 'pass' ? 'ok' : fs === 'fail' ? 'bad' : 'warn') + '" data-face-box="box"' + inv('G3') + '><span class="cap-facebox__label">face</span></div>';
    }
    if (imm || live) {
      h += '<div class="cap-stage__top"><div class="cap-stage__topline"><div class="cap-chips" aria-label="Live checks"' + inv('G4') + '>';
      if (live && ctx.phone && S.hud.overlay === 'compact') hud.chips.forEach(function (c) { h += '<span class="cap-chk cap-chk--' + c.status + '" data-check="' + c.id + '">' + icon(STATUS_ICON[c.status], 12) + '<span class="cap-chk__txt">' + c.label + '</span><span class="cap-sr"> ' + STATUS_WORD[c.status] + '</span></span>'; });
      h += '</div>';
      if (imm) h += '<button type="button" class="cap-stage__close" aria-label="Close camera" data-act="close-cam" data-fid="close"' + inv('F2') + '>' + icon('x', 20) + '</button>';
      h += '</div>';
      if (live && needsLive) h += R.liveness(S);
      h += '</div>';
    }
    if (live) {
      var hint = S.busy ? 'Hold still…' : !liveOk ? 'Complete the live check to enable the shutter.' : ready ? 'Looks good. Tap to capture.' : (hud.hint || 'Frame your photo.');
      h += '<div class="cap-stage__dock">' + (ctx.phone ? R.hud(S, 'overlay', hud) : '');
      h += '<div class="cap-hint' + (ready ? ' cap-hint--ready' : '') + '" role="status"' + inv('G6') + '>' + hint + '</div>';
      h += '<button type="button" class="cap-shutter' + (ready ? ' cap-shutter--ready' : '') + (S.busy ? ' cap-shutter--busy' : '') + '" data-act="capture" data-fid="shutter"' + (S.busy || !liveOk ? ' disabled' : '') + ' aria-label="' + (liveOk ? 'Take photo' : 'Take photo (complete the live check first)') + '" data-live-ok="' + (liveOk ? 1 : 0) + '"' + inv('G7') + '>' + (S.busy ? icon('loader-circle', 26, 'cap-spin') : '<span class="cap-shutter__core"></span>') + '</button></div>';
    }
    return h + '</div>';
  };

  /* ---------- I: file-picker fallback ---------- */
  R.picker = function (S) {
    var t = D.TASKS[S.task];
    return '<label class="cap-picker"' + inv('I1') + ' data-stage="picker"><input type="file" accept="image/*" capture="' + t.camera + '" data-act="file" data-fid="file" aria-label="Take or choose a photo"/><span class="cap-picker__target"><span class="cap-picker__reticle">' + icon('camera', 30) + '</span><span><span class="cap-picker__title">Tap to capture</span><span class="cap-picker__cap" style="display:block">' + (t.camera === 'user' ? 'Front camera' : 'Rear camera') + ' · photo quality check</span></span></span></label>';
  };

  /* ---------- J1/J2: photo with overlay boxes ---------- */
  R.stagePhoto = function (S) {
    var rep = D.report(S.photo.verdict, S.task), checking = S.photo.phase === 'checking';
    var t = D.TASKS[S.task], needsFace = t.face !== 'off';
    var art = S.fileUrl ? '<img src="' + esc(S.fileUrl) + '" alt="Captured proof"/>' : sceneSvgPhoto(S, rep);
    var h = '<div class="cap-stage cap-on-camera" data-stage="photo" data-verdict="' + rep.verdict + '"><div class="cap-photo"><div class="cap-photo__frame ' + (S.photo.verdict === 'block' ? 'cap-scene--blur' : '') + '" data-photo="1">' + art + '</div></div>';
    if (!checking || true) rep.boxes.forEach(function (b) { h += '<div class="cap-box cap-box--' + b.tone + (b.y0 < 0.1 ? ' cap-box--lower' : '') + '" data-box="' + [b.x0, b.y0, b.x1, b.y1].join(',') + '" data-fit="' + rep.width + 'x' + rep.height + '"' + inv('J1') + '><span class="cap-box__label">' + esc(b.label) + '</span></div>'; });
    if (checking) h += '<div class="cap-scanline" aria-hidden="true"></div><div class="cap-terminal" role="status"' + inv('J2') + '>' + esc(D.TERMINAL(needsFace)).replace('&gt;', '&gt;') + '</div>';
    return h + '</div>';
  };
  function sceneSvgPhoto(S, rep) {
    var svg = sceneSvg(S);
    var extra = '';
    if (rep.verdict === 'warn') extra += '<polygon points="64,84 272,84 220,276 64,276" fill="rgba(255,255,255,0.7)"/>';
    if (rep.verdict === 'block') extra += '<ellipse cx="640" cy="440" rx="150" ry="130" fill="rgba(8,8,10,0.88)"/>';
    return svg.replace('</svg>', extra + '</svg>').replace('aria-label="Camera preview"', 'aria-label="Captured proof"');
  }

  /* ---------- J: QualityChecklist (result panel) ---------- */
  function checkRow(r) {
    var kind = r.status === 'pass' ? 'ok' : r.blocking ? 'bad' : 'warn';
    return '<li class="cap-check cap-check--' + kind + '">' + icon(kind === 'ok' ? 'check' : kind === 'bad' ? 'circle-x' : 'triangle-alert', 18) +
      '<div><div class="cap-check__line"><span class="cap-check__label">' + r.label + '</span><span class="cap-check__val">' + esc(r.value) + '</span></div>' +
      (r.hint ? '<div class="cap-check__hint">' + esc(r.hint) + '</div>' : '') + (r.numbers ? '<div class="cap-check__nums">' + esc(r.numbers) + '</div>' : '') + '</div>' +
      '<span class="cap-sr">' + (kind === 'ok' ? 'passed' : kind === 'bad' ? 'failed' : 'warning') + '</span></li>';
  }
  R.acc = function (id, S, title, meta, inner, defOpen, flat) {
    var open = S.accOpen[id] != null ? S.accOpen[id] : defOpen;
    return '<div class="cap-acc' + (open ? ' is-open' : '') + (flat ? ' cap-acc--flat' : '') + '"><button type="button" class="cap-acc__trigger" aria-expanded="' + open + '" aria-controls="acc-' + id + '" data-act="acc" data-arg="' + id + '" data-def="' + (defOpen ? 1 : 0) + '" data-fid="acc-' + id + '"><span>' + title + (meta ? ' <span class="cap-acc__meta">' + meta + '</span>' : '') + '</span>' + icon('chevron-down', 16, 'cap-acc__chev') + '</button><div class="cap-acc__panel" id="acc-' + id + '"' + (open ? '' : ' hidden') + '>' + inner + '</div></div>';
  };
  R.result = function (S) {
    var rep = D.report(S.photo.verdict, S.task), v = rep.verdict, blocked = v === 'block', warned = v === 'warn';
    var tone = v === 'pass' ? 'ok' : v === 'warn' ? 'warn' : 'fail';
    var attention = rep.rows.filter(function (r) { return r.status !== 'pass'; }), passed = rep.rows.filter(function (r) { return r.status === 'pass'; });
    var h = '<section class="cap-card cap-card--' + tone + ' cap-result cap-result--' + v + (S.shake && blocked ? ' cap-shake' : '') + '" aria-label="Photo result"' + inv('J3') + '>';
    h += '<div class="cap-card__head"><div><div class="cap-eyebrow">Photo result</div><h2 class="cap-result__title">' + icon(v === 'pass' ? 'circle-check' : v === 'warn' ? 'triangle-alert' : 'circle-x', 20) + D.TITLES[v] + '</h2></div>';
    h += '<div class="cap-kpi cap-kpi--sm" style="text-align:right"><span class="cap-kpi__label">Quality</span><b class="cap-kpi__value">' + rep.score + '<small>%</small></b></div></div>';
    h += '<div class="cap-card__body">';
    if (blocked) {
      h += '<div class="cap-why" role="alert"' + inv('J4') + '><strong>' + icon('circle-x', 16) + "Why this photo can't be submitted</strong><ul>";
      rep.blockers.forEach(function (b) { h += '<li><span class="cap-why__label">' + b.label + '</span>' + (b.numbers ? ' · ' + esc(b.numbers) : '') + '</li>'; });
      h += '</ul></div>';
    }
    h += '<div' + inv('J5') + '>';
    if (attention.length) h += '<ul class="cap-checks">' + attention.map(checkRow).join('') + '</ul>';
    if (passed.length) h += R.acc('passed', S, 'Passed checks', '(' + passed.length + ')', '<ul class="cap-checks">' + passed.map(checkRow).join('') + '</ul>', attention.length === 0, true);
    h += '</div>';
    if (S.diag.debug) h += '<button type="button" class="cap-btn cap-btn--sm cap-btn--ghost" data-act="drawer" data-arg="debug" data-fid="open-debug"' + inv('J6') + '>' + icon('bug', 14) + ' Diagnostics: debug checks</button>';
    if (!blocked) {
      h += '<p class="cap-result__hint" data-testid="arrival-hint"' + inv('J7') + '>' + D.ARRIVAL_HINT.replace('{AND}', S.rec.running ? D.ARRIVAL_AND : '') + (S.rec.running ? '' : D.ARRIVAL_NOREC) + '</p>';
    }
    h += '<div class="cap-result__actions cap-result__actions--sticky"' + inv('J8') + '>';
    if (!blocked) h += '<button type="button" class="cap-btn cap-btn--primary cap-btn--lg cap-btn--block" data-act="arrive" data-fid="arrive" data-testid="arrived-btn">' + icon('send', 16) + (warned ? " I've reached the site · send location anyway" : " I've reached the site · send my location") + '</button>';
    h += '<button type="button" class="cap-btn ' + (blocked ? 'cap-btn--primary ' : '') + 'cap-btn--lg cap-btn--block" data-act="retake" data-fid="retake">' + icon('rotate-ccw', 16) + ' Retake</button></div>';
    return h + '</div></section>';
  };
  R.debugDrawer = function (S) {
    var rep = D.report(S.photo ? S.photo.verdict : 'block', S.task);
    var rows = rep.rows.map(function (r) { return '<tr><td>' + r.label.toLowerCase() + '</td><td>' + (r.status === 'pass' ? 'pass' : 'fail') + '</td><td>' + (r.status === 'pass' ? '0.912' : '0.214') + '</td><td>' + esc(r.hint || '') + '</td></tr>'; }).join('');
    var blk = rep.blockers.map(function (b) { return b.label.toLowerCase(); }).join(', ') || 'none';
    return '<div class="cap-scrim" data-act="drawer-close"></div><aside class="cap-drawer" role="dialog" aria-modal="true" aria-label="Debug checks" id="cap-drawer"><div class="cap-drawer__head"><div><div class="cap-eyebrow">Diagnostics</div><h2 class="cap-card__title">Debug: checks</h2></div><button type="button" class="cap-icon-btn" aria-label="Close diagnostics" data-act="drawer-close" data-fid="drawer-close">' + icon('x', 18) + '</button></div><div class="cap-drawer__body" data-testid="checks-debug"' + inv('J6') + '><table class="cap-debug"><thead><tr><th>check</th><th>status</th><th>value</th><th>hint</th></tr></thead><tbody>' + rows + '</tbody></table><div class="cap-mono cap-muted" style="margin-top:12px;display:grid;gap:6px">' + D.DEBUG_LINES.map(function (l) { return '<div>' + esc(l.replace('{V}', rep.verdict).replace('{B}', blk)) + '</div>'; }).join('') + '</div></div></aside>';
  };

  /* ---------- D: VisitPanel ---------- */
  function recSummary(S, f) {
    var parts = [f.gps.fixes + ' location fix' + (f.gps.fixes === '1' ? '' : 'es')];
    if (f.gps.distance) parts.push(f.gps.distance);
    if (f.gps.accuracy) parts.push(f.gps.accuracy);
    if (S.visit.motion === 'absent') parts.push('no motion sensor'); else if (S.visit.motion === 'denied') parts.push('motion denied');
    return parts.join(' · ');
  }
  R.visit = function (S) {
    var f = D.feedModel(S), running = S.rec.running, v = S.visit;
    if (S.loading) return '<section class="cap-card cap-visit" aria-label="Visit recording" aria-busy="true"><div class="cap-loading"><span class="cap-skeleton" style="width:40%;height:14px"></span><span class="cap-skeleton" style="width:80%;height:18px"></span><span class="cap-skeleton" style="height:40px"></span></div></section>';
    var h = '<section class="cap-card cap-visit" aria-label="Visit recording" data-testid="visit-panel"' + inv('D1') + '><div class="cap-card__head"><div class="cap-eyebrow">' + icon('map-pinned', 14) + ' Visit recording</div></div><div class="cap-card__body">';
    if (running) {
      h += '<div class="cap-visit__row"' + inv('D3') + '><span class="cap-visit__live" role="status"><i class="cap-visit__dot" aria-hidden="true"></i><span>Recording · <span data-bind="rec.summary">' + esc(recSummary(S, f)) + '</span></span></span><button type="button" class="cap-btn cap-btn--sm" data-act="stop-rec" data-fid="stop-rec">' + icon('square', 13) + ' Stop</button></div>';
    } else {
      h += '<p class="cap-visit__consent"' + inv('D2') + '><b>' + D.CONSENT_TITLE + '.</b> ' + D.CONSENT_SHORT + '</p>';
      h += '<div class="cap-visit__row"><button type="button" class="cap-btn cap-btn--primary" data-act="start-rec" data-fid="start-rec"' + (S.rec.starting ? ' disabled' : '') + '>' + (S.rec.starting ? 'Starting…' : 'Start recording my visit') + '</button></div>';
      h += R.acc('consent', { accOpen: { consent: v.consentOpen || S.accOpen.consent } }, 'What is recorded?', '', '<p class="cap-visit__consent">' + esc(D.CONSENT_TEXT) + '</p>', false);
    }
    if (running && (v.motion === 'denied' || v.motion === 'absent')) h += '<p class="cap-visit__note" role="note"' + inv('D4') + '>' + icon('triangle-alert', 16) + '<span>' + (v.motion === 'denied' ? D.NOTES.motionDenied : D.NOTES.motionAbsent) + '</span></p>';
    if (v.geo === 'denied') h += '<p class="cap-visit__note" role="note"' + inv('D4') + '>' + icon('triangle-alert', 16) + '<span>' + D.NOTES.geoDenied + '</span></p>';
    if (running && (v.serverDown || S.shell === 'offline')) h += '<p class="cap-visit__note" role="note"' + inv('D4') + '>' + icon('triangle-alert', 16) + '<span>' + D.NOTES.server + '</span></p>';
    if (S.diag.tools || S.diag.record) {
      var tools = '<div class="cap-visit__tools" data-testid="demo-tools">';
      if (S.diag.tools) tools += '<div class="cap-visit__toolrow"' + inv('D5') + '><button type="button" class="cap-btn cap-btn--sm" data-act="register-here" data-fid="register">' + icon('locate-fixed', 13) + ' Register this spot as the site</button>' + (v.siteMsg ? '<span class="cap-visit__consent" role="status">' + esc(v.siteMsg) + '</span>' : '') + '</div>';
      if (S.diag.record) tools += '<div class="cap-visit__toolrow" data-testid="record-mode"' + inv('D6') + '><label class="cap-field"><span class="cap-field__label">Scenario folder</span><select class="cap-select" aria-label="Scenario folder" data-act="scenario">' + D.SCENARIOS.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === v.scenario ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label><label class="cap-field"><span class="cap-field__label">Note</span><input class="cap-input" aria-label="Note" placeholder="phone, OS/browser, what you did" value="' + esc(v.note) + '" data-act="note" data-fid="note"/></label><button type="button" class="cap-btn cap-btn--sm" data-act="download" data-fid="download"' + (running ? '' : ' disabled') + '>' + icon('download', 13) + ' Download trace</button></div>';
      tools += '</div>';
      h += R.acc('tools', S, 'Demo and record tools', '(diagnostics)', tools, true);
    }
    return h + '</div></section>';
  };

  /* ---------- K: SensorFeed ---------- */
  function wave() { return '<svg class="cap-feed__wave" viewBox="0 0 240 44" preserveAspectRatio="none" role="img" aria-label="Live motion waveform"><path d="M0 22 L240 22"/></svg>'; }
  R.feed = function (S) {
    var f = D.feedModel(S), run = f.running;
    if (S.loading) return '<section class="cap-card cap-feed" aria-label="Live sensor feed" aria-busy="true"><div class="cap-loading"><span class="cap-skeleton" style="width:36%;height:14px"></span><div class="cap-feed__heads"><span class="cap-skeleton" style="height:44px"></span><span class="cap-skeleton" style="height:44px"></span><span class="cap-skeleton" style="height:44px"></span></div></div></section>';
    var w = function (v) { return v == null ? 'not started' : (D.STATE_WORD[v] || v); };
    var agoTone = f.gps.ago != null && f.gps.ago > 15 ? 'warn' : null;
    var open = S.feed.open, tab = S.feed.tab;
    var h = '<section class="cap-card cap-feed" aria-label="Live sensor feed" data-testid="sensor-feed"><div class="cap-card__head"><div><div class="cap-eyebrow"' + inv('K1') + '>' + icon('satellite', 14) + ' Sensor feed</div></div>';
    h += run ? '<span class="cap-feed__live"><i aria-hidden="true"></i> live</span>' : '';
    h += '</div><div class="cap-card__body">';
    if (!run) h += '<p class="cap-muted" style="font-size:var(--cap-text-xs)"' + inv('K1') + '>start the visit recording above to see live values</p>';
    if (S.native) h += '<p class="cap-visit__note" role="note"' + inv('K2') + '>' + icon('triangle-alert', 16) + '<span style="color:var(--cap-warn)">' + D.NATIVE_NOTE + '</span></p>';
    h += '<div class="cap-feed__heads">';
    h += '<div class="cap-kpi cap-kpi--sm"><span class="cap-kpi__label">GPS accuracy</span><b class="cap-kpi__value">' + (f.gps.accuracy || '—') + '</b></div>';
    h += '<div class="cap-kpi cap-kpi--sm"><span class="cap-kpi__label">Last fix</span><b class="cap-kpi__value" style="' + (agoTone ? 'color:var(--cap-warn)' : '') + '"><span data-bind="gps.ago">' + (f.gps.ago == null ? '—' : f.gps.ago + ' s') + '</span></b></div>';
    h += '<div class="cap-kpi cap-kpi--sm"><span class="cap-kpi__label">Activity</span><b class="cap-kpi__value" style="' + (f.motion.now === 'walking' ? 'color:var(--cap-ok)' : '') + '">' + (f.motion.now || '—') + '</b></div></div>';
    h += '<button type="button" class="cap-btn cap-btn--block" aria-expanded="' + open + '" aria-controls="cap-feed-panel" data-act="feed-open" data-fid="feed-open">' + (open ? 'Hide sensor feed' : 'Open sensor feed') + icon(open ? 'chevron-up' : 'chevron-down', 16) + '</button>';
    h += '<div id="cap-feed-panel"' + (open ? '' : ' hidden') + '><div class="cap-tabs" role="tablist" aria-label="Sensor feed groups">';
    D.FEED_TABS.forEach(function (t) { h += '<button type="button" class="cap-tab" role="tab" id="tab-' + t[0] + '" aria-selected="' + (t[0] === tab) + '" aria-controls="pnl-' + t[0] + '" tabindex="' + (t[0] === tab ? 0 : -1) + '" data-act="feed-tab" data-arg="' + t[0] + '" data-fid="tab-' + t[0] + '">' + t[1] + '</button>'; });
    h += '</div>';
    var panel = function (id, inner) { return '<div class="cap-feed__panel" role="tabpanel" id="pnl-' + id + '" aria-labelledby="tab-' + id + '"' + (id === tab ? '' : ' hidden') + '>' + inner + '</div>'; };
    // K3 GPS
    h += panel('gps', '<div class="cap-kv__head"' + inv('K3') + '>' + icon('satellite', 14) + 'GPS · ' + w(f.gps.state) + '</div><dl class="cap-kv">' +
      kv('Latitude', f.gps.lat, { mono: 1 }) + kv('Longitude', f.gps.lng, { mono: 1 }) + kv('Accuracy', f.gps.accuracy) + kv('Speed (reported)', f.gps.speed) + kv('Heading', f.gps.heading) + kv('Altitude', f.gps.altitude) + kv('Fixes kept', f.gps.fixes, { bind: 'gps.fixes' }) +
      kv('Last fix', f.gps.ago == null ? null : f.gps.ago + ' s ago', { tone: agoTone, bind: 'gps.agoFull' }) + kv('Distance', f.gps.distance, { bind: 'gps.distance' }) + '</dl>');
    // K4 Motion
    var strip = f.motion.activities.length ? '<div class="cap-strip" role="img" aria-label="Phone activity, last two minutes">' + f.motion.activities.map(function (a) { return '<i class="is-' + a + '" title="' + a + '"></i>'; }).join('') + '</div><div class="cap-legend"><span><i style="background:color-mix(in srgb,var(--cap-text-2) 55%,transparent)"></i>still</span><span><i style="background:var(--cap-ok)"></i>walking</span><span><i style="background:var(--cap-accent-text)"></i>moving</span></div>' : '';
    h += panel('motion', '<div class="cap-kv__head"' + inv('K4') + '>' + icon('activity', 14) + 'Motion · ' + w(f.motion.state) + '</div><dl class="cap-kv">' + kv('|Acceleration|', f.motion.acc) + kv('|Rotation|', f.motion.gyro) + kv('Sensor rate', f.motion.rate) + '</dl>' + wave() + '<dl class="cap-kv">' + kv('Activity now', f.motion.now, { tone: f.motion.now === 'walking' ? 'pass' : null }) + kv('Step rhythm', f.motion.rhythm) + kv('5 s windows', f.motion.windows) + '</dl>' + strip);
    // K5 Session
    h += panel('session', '<div class="cap-kv__head"' + inv('K5') + '>' + icon('gauge', 14) + 'Session</div><dl class="cap-kv">' +
      kv('Visit', f.session.visit, { mono: 1 }) + kv('Server clock offset', f.session.offset) + kv('Recording for', f.session.recordingS == null ? null : f.session.recordingS + ' s', { bind: 'session.rec' }) +
      kv('Screen wake lock', f.session.wake, { tone: f.session.wake === 'not held' ? 'warn' : null }) + kv('Time hidden', f.session.hiddenS + ' s (' + f.session.hiddenN + '×)', { tone: f.session.hiddenS ? 'warn' : null }) + kv('GPS restarts', f.session.restarts) +
      kv('Location permission', w(f.session.geoPerm)) + kv('Camera permission', w(f.session.camPerm)) + '</dl>');
    // K6 Network
    h += panel('network', '<div class="cap-kv__head"' + inv('K6') + '>' + icon('wifi', 14) + 'Network</div><dl class="cap-kv">' + kv('Type', f.network ? f.network.type : 'not exposed by this browser') + kv('Downlink / RTT', f.network ? f.network.downlink + ' · ' + f.network.rtt : null) + '</dl>');
    // K7 Trail
    var T = D.TRAIL;
    var trail = f.running && !f.empty ? '<svg class="cap-trail" viewBox="0 0 ' + T.w + ' ' + T.h + '" role="img" aria-label="Live GPS trail" data-testid="feed-trail"><circle class="cap-trail__site" cx="' + T.site.c[0] + '" cy="' + T.site.c[1] + '" r="' + T.site.r + '"/><path class="cap-trail__path" d="' + T.path + '"/><circle class="cap-trail__start" cx="' + T.start[0] + '" cy="' + T.start[1] + '" r="4"/><circle class="cap-trail__end" cx="' + T.end[0] + '" cy="' + T.end[1] + '" r="4"/></svg><div class="cap-muted" style="font-size:var(--cap-text-xs)">≈ ' + f.trail.span + ' m across · drawn locally, no map service</div>' : '<div class="cap-empty"' + inv('K7') + '>' + icon('route', 24) + '<span>No fixes yet.</span></div>';
    h += panel('trail', '<div class="cap-kv__head"' + inv('K7') + '>' + icon('radio', 14) + 'Trail · site ' + f.trail.siteText + '</div>' + trail);
    // K8 Not available
    h += panel('na', '<div class="cap-kv__head"' + inv('K8') + '>' + icon('ban', 14) + 'Not available here</div><ul class="cap-na" data-testid="feed-na">' + D.NOT_AVAILABLE.map(function (n) { return '<li><b>' + n.label + '</b><span>' + n.reason + '</span></li>'; }).join('') + '</ul>');
    h += '</div>';
    // K9 Server box
    if (S.diag.tools) {
      var inner = '<div class="cap-muted" style="font-size:var(--cap-text-xs)">Now: <span class="cap-mono" data-testid="server-now">http://localhost:8000</span> (default)</div>' +
        '<div class="cap-visit__toolrow"><label class="cap-field"><span class="cap-field__label">Backend address</span><input class="cap-input" aria-label="Backend address" placeholder="http://192.168.1.20:8000" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" value="' + esc(S.feed.serverVal) + '" data-act="server-val" data-fid="server-val"/></label><button type="button" class="cap-btn cap-btn--sm" data-act="server-test" data-fid="server-test">Test connection</button><button type="button" class="cap-btn cap-btn--sm" data-act="server-save" data-fid="server-save">Save</button></div>' +
        (S.feed.serverMsg ? '<div role="status" data-testid="server-msg" style="font-size:var(--cap-text-xs);color:' + ({ muted: 'var(--cap-text-2)', green: 'var(--cap-ok)', red: 'var(--cap-bad)' })[S.feed.serverMsg.tone] + '">' + esc(S.feed.serverMsg.text) + '</div>' : '');
      h += '<div data-testid="server-box"' + inv('K9') + '>' + R.acc('server', S, icon('server', 14) + ' Server', '(demo tools)', inner, S.feed.serverOpen) + '</div>';
    }
    return h + '</div></section>';
  };

  /* ---------- page ---------- */
  R.hudColumn = function (S, ctx) {
    if (S.step !== 'photo') return '';
    if (S.photo && S.photo.phase === 'result') return R.result(S);
    if (S.photo) return '<section class="cap-card" aria-label="Photo check" aria-busy="true"><div class="cap-card__head"><div><div class="cap-eyebrow">Photo result</div><h2 class="cap-card__title">Checking your photo</h2></div></div><div class="cap-card__body"><div class="cap-loading" style="padding:0"><span class="cap-skeleton" style="height:16px"></span><span class="cap-skeleton" style="height:16px;width:80%"></span><span class="cap-skeleton" style="height:16px;width:60%"></span></div></div></section>';
    if (S.mode === 'file') return ctx.phone ? '' : '<section class="cap-card" aria-label="Live quality"><div class="cap-card__head"><div class="cap-eyebrow">Live quality</div></div><div class="cap-card__body"><p class="cap-hud__empty">Live numbers are available with the live camera. Your photo is checked right after you take it.</p></div></section>';
    if (S.cam === 'live') return ctx.phone ? '' : '<section class="cap-card"><div class="cap-card__body" style="padding-top:var(--cap-space-4)">' + R.hud(S, 'side', D.hudModel(S)) + '</div></section>';
    if (ctx.phone) return '';
    var m = D.hudModel(Object.assign({}, S, { hudEmpty: true }));
    return '<section class="cap-card" aria-busy="' + !!S.loading + '"><div class="cap-card__body" style="padding-top:var(--cap-space-4)">' + R.hud(S, 'side', m) + '</div></section>';
  };

  R.app = function (S, ctx) {
    var t = D.TASKS[S.task];
    var h = '<a class="cap-skip-link" href="#cap-main">Skip to content</a>';
    h += '<div class="cap-shell">' + R.topbar(S) + '<main class="cap-main" id="cap-main" tabindex="-1">';
    h += R.stepper(S);
    if (S.step === 'arrival') {
      h += '<section class="cap-card cap-stub"><div class="cap-card__body" style="justify-items:center;text-align:center"><div class="cap-eyebrow" style="justify-content:center">Step 2 · Arrival</div><h2 class="cap-card__title">Not part of this redesign</h2><p class="cap-muted" style="max-width:48ch;font-size:var(--cap-text-sm)">Steps 2–4 (Arrival, AI scan, Verdict) stay as they are. This prototype covers the Photo step only.</p><button type="button" class="cap-btn cap-btn--primary" data-act="back-photo" data-fid="back-photo">Back to the Photo step</button></div></section>';
    } else {
      h += R.brief(S) + R.banners(S);
      var stage = '', after = '';
      if (S.photo) stage = R.stagePhoto(S);
      else if (S.mode === 'camera') {
        stage = R.stageLive(S, ctx);
        if (!t.live) after = '<button type="button" class="cap-link" data-act="use-picker" data-fid="use-picker"' + inv('F3') + '>Use the photo picker instead</button>';
      } else {
        stage = R.picker(S);
        if (S.supported) after = '<button type="button" class="cap-link" data-act="use-live" data-fid="use-live"' + inv('I2') + '>Use the live camera</button>';
      }
      h += '<div class="cap-grid"><div class="cap-grid__stage">' + stage + after + '</div><div class="cap-grid__hud">' + R.hudColumn(S, ctx) + '</div><div class="cap-grid__visit">' + R.visit(S) + '</div><div class="cap-grid__feed">' + R.feed(S) + '</div></div>';
    }
    h += '</main>' + R.footer(S) + '</div>' + R.bottomnav();
    if (S.drawer === 'debug') h += R.debugDrawer(S);
    return h;
  };

  window.CAP_R = R;
})();
