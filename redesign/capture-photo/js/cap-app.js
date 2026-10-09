/* Capture · Photo step prototype: mounts the page, wires events, ticks the live numbers, talks to the viewer (index.html). */
(function () {
  var D = window.CAP_DATA, R = window.CAP_R, ST = window.CAP_STATE, F = ST.F;
  var root = document.getElementById('cap-root');
  var mqPhone = window.matchMedia('(max-width: 720px)');
  var ctx = { phone: mqPhone.matches };
  var params = new URLSearchParams(location.search);
  var wavePts = [];

  /* ---------- toasts ---------- */
  var toastRegion = document.getElementById('cap-toasts');
  function toast(title, text, kind) {
    if (!toastRegion) return;
    var el = document.createElement('div');
    el.className = 'cap-toast' + (kind === 'error' ? ' cap-toast--error' : '');
    el.innerHTML = window.ic(kind === 'error' ? 'circle-alert' : 'circle-check', 18) + '<div class="cap-toast__body"><div class="cap-toast__title"></div><div class="cap-toast__text"></div></div><button type="button" class="cap-icon-btn" aria-label="Dismiss" style="width:32px;height:32px">' + window.ic('x', 14) + '</button>';
    el.querySelector('.cap-toast__title').textContent = title;
    el.querySelector('.cap-toast__text').textContent = text || '';
    el.querySelector('button').onclick = function () { el.remove(); };
    toastRegion.appendChild(el);
    if (kind !== 'error') setTimeout(function () { el.remove(); }, 5200);
  }
  window.CAP_UI = { toast: toast };

  /* ---------- render ---------- */
  function applyFrame(S) {
    document.documentElement.setAttribute('data-theme', S.theme);
    var imm = ctx.phone && S.step === 'photo' && !S.photo && S.mode === 'camera' && (S.cam === 'live' || S.cam === 'starting');
    document.documentElement.classList.toggle('cap-lock', !!imm);
  }
  function render() {
    var S = ST.get();
    ctx.phone = mqPhone.matches;
    var a = document.activeElement, fid = a && a.dataset && a.dataset.fid;
    var sy = window.scrollY;
    root.innerHTML = R.app(S, ctx);
    applyFrame(S);
    if (fid) { var el = root.querySelector('[data-fid="' + fid + '"]'); if (el && !el.disabled) el.focus({ preventScroll: true }); }
    window.scrollTo(0, sy);
    layoutOverlays();
    tick(true);
    try { parent.postMessage({ cap: 'state', id: S.presetId, task: S.task, theme: S.theme, next: S.outcome }, '*'); } catch (e) { /* not framed */ }
  }

  /* face box / mesh over the cover-fitted scene; result boxes over the contain-fitted photo */
  function layoutOverlays() {
    root.querySelectorAll('.cap-stage').forEach(function (stage) {
      var W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;
      if (stage.dataset.stage === 'camera') {
        var s = Math.max(W / 800, H / 600), ox = (800 * s - W) / 2, oy = (600 * s - H) / 2;
        var mirrored = stage.querySelector('.cap-stage__scene--mirror');
        var k = parseFloat(stage.dataset.faceK) || 1;
        function put(el, x0, y0, x1, y1) {
          x0 = 400 + (x0 - 400) * k; x1 = 400 + (x1 - 400) * k; y0 = 300 + (y0 - 300) * k; y1 = 300 + (y1 - 300) * k;
          var l = x0 * s - ox, r = x1 * s - ox, t = y0 * s - oy, b = y1 * s - oy;
          if (mirrored) { var nl = W - r, nr = W - l; l = nl; r = nr; }
          el.style.left = l + 'px'; el.style.top = t + 'px'; el.style.width = (r - l) + 'px'; el.style.height = (b - t) + 'px';
        }
        stage.querySelectorAll('[data-face-box="box"]').forEach(function (e) { put(e, 280, 120, 520, 420); if (parseFloat(e.style.top) < 36) e.classList.add('cap-facebox--below'); });
        stage.querySelectorAll('[data-face-box="mesh"]').forEach(function (e) { put(e, 292, 128, 508, 412); });
      }
      if (stage.dataset.stage === 'photo') {
        stage.querySelectorAll('[data-box]').forEach(function (e) {
          var f = e.dataset.fit.split('x'), pw = +f[0], ph = +f[1], k = Math.min(W / pw, H / ph), fw = pw * k, fh = ph * k, fx = (W - fw) / 2, fy = (H - fh) / 2, b = e.dataset.box.split(',').map(Number);
          e.style.left = fx + b[0] * fw + 'px'; e.style.top = fy + b[1] * fh + 'px'; e.style.width = (b[2] - b[0]) * fw + 'px'; e.style.height = (b[3] - b[1]) * fh + 'px';
          if (fy + b[1] * fh < 30) e.classList.add('cap-box--lower');
        });
      }
    });
  }
  if (window.ResizeObserver) new ResizeObserver(function () { layoutOverlays(); }).observe(root);
  mqPhone.addEventListener ? mqPhone.addEventListener('change', render) : mqPhone.addListener(render);

  /* ---------- live numbers (text only, no re-render) ---------- */
  function setBind(key, text) { root.querySelectorAll('[data-bind="' + key + '"]').forEach(function (e) { if (e.textContent !== text) e.textContent = text; }); }
  function tick(noAdvance) {
    var S = ST.get();
    if (!noAdvance) S.clock = (S.clock || 0) + 1;
    var f = D.feedModel(S);
    if (!f.running) return;
    setBind('gps.ago', f.gps.ago == null ? '—' : f.gps.ago + ' s');
    setBind('gps.agoFull', f.gps.ago == null ? '-' : f.gps.ago + ' s ago');
    setBind('gps.fixes', f.gps.fixes == null ? '-' : f.gps.fixes);
    setBind('gps.distance', f.gps.distance == null ? '-' : f.gps.distance);
    setBind('session.rec', f.session.recordingS == null ? '-' : f.session.recordingS + ' s');
    var sm = root.querySelector('[data-bind="rec.summary"]'); if (sm) {
      var parts = [f.gps.fixes + ' location fix' + (f.gps.fixes === '1' ? '' : 'es')]; if (f.gps.distance) parts.push(f.gps.distance); if (f.gps.accuracy) parts.push(f.gps.accuracy);
      if (S.visit.motion === 'absent') parts.push('no motion sensor'); else if (S.visit.motion === 'denied') parts.push('motion denied');
      sm.textContent = parts.join(' · ');
    }
  }
  setInterval(function () { if (!document.hidden) tick(false); }, 1000);
  setInterval(function () {
    var S = ST.get(); if (!S.rec.running || S.visit.motion !== 'granted' || S.feed.empty) return;
    var path = root.querySelector('#pnl-motion:not([hidden]) .cap-feed__wave path'); if (!path) return;
    wavePts.push(22 + (Math.sin(Date.now() / 140) * 9 + (Math.random() - 0.5) * 8)); if (wavePts.length > 60) wavePts.shift();
    path.setAttribute('d', wavePts.map(function (y, i) { return (i ? 'L' : 'M') + (i * 240 / 59).toFixed(1) + ' ' + y.toFixed(1); }).join(' '));
  }, 200);

  /* ---------- events ---------- */
  function actOf(t) { return t.closest ? t.closest('[data-act]') : null; }
  root.addEventListener('click', function (e) {
    var S = ST.get();
    if (S.menu && !e.target.closest('.cap-popover') && !e.target.closest('[data-act="menu"]')) { S.menu = false; ST.emit(); }
    var el = actOf(e.target); if (!el) return;
    var act = el.dataset.act, arg = el.dataset.arg;
    if (act === 'file' || act === 'server-val' || act === 'note' || act === 'scenario') return;
    if (el.tagName === 'A') e.preventDefault();
    switch (act) {
      case 'noop': break;
      case 'demo': S.demo = !S.demo; ST.emit(); break;
      case 'menu': S.menu = !S.menu; ST.emit(); break;
      case 'task': F.pickTask(arg); break;
      case 'retry': F.retry(); break;
      case 'voice': S.voice = !S.voice; ST.emit(); break;
      case 'live-retry': F.liveRetry(); break;
      case 'live-review': F.liveReview(); break;
      case 'hud-toggle': F.toggleHud(arg); break;
      case 'open-cam': F.openCamera(); break;
      case 'close-cam': F.closeCamera(); break;
      case 'capture': F.capture(); break;
      case 'retake': F.retake(); break;
      case 'arrive': F.arrive(); break;
      case 'back-photo': F.backToPhoto(); break;
      case 'use-picker': F.usePicker(); break;
      case 'use-live': F.useLiveCamera(); break;
      case 'start-rec': F.startRec(); break;
      case 'stop-rec': F.stopRec(); break;
      case 'acc': { var open = el.getAttribute('aria-expanded') === 'true'; S.accOpen[arg] = !open; if (arg === 'consent') S.visit.consentOpen = !open; ST.emit(); break; }
      case 'feed-open': S.feed.open = !S.feed.open; ST.emit(); break;
      case 'feed-tab': S.feed.tab = arg; ST.emit(); break;
      case 'drawer': S.drawer = arg; ST.emit(); setTimeout(function () { var c = root.querySelector('[data-fid="drawer-close"]'); if (c) c.focus(); }, 0); break;
      case 'drawer-close': { S.drawer = null; ST.emit(); var b = root.querySelector('[data-fid="open-debug"]'); if (b) b.focus(); break; }
      case 'register-here':
        S.visit.siteMsg = 'Finding your location…'; ST.emit();
        ST.later(700, function () { S.visit.siteMsg = 'This spot (±12 m) is now ' + D.SITE_ID + ', radius 80 m (country and label kept).'; ST.emit(); toast('Site registered', 'MOCK: nothing was saved.', 'ok'); });
        break;
      case 'download': toast('Trace ready', 'MOCK: the prototype does not write a file.', 'ok'); break;
      case 'server-test':
        S.feed.serverMsg = { tone: 'muted', text: 'Testing…' }; ST.emit();
        ST.later(600, function () { S.feed.serverMsg = S.shell === 'offline' ? { tone: 'red', text: 'Could not reach the server (Failed to fetch)' } : { tone: 'green', text: 'Connected to ' + (S.feed.serverVal || 'http://localhost:8000') + ' (42 ms)' }; ST.emit(); });
        break;
      case 'server-save': S.feed.serverMsg = { tone: 'muted', text: 'Saved. Reloading…' }; ST.emit(); break;
      default: break;
    }
  });
  root.addEventListener('change', function (e) {
    var el = e.target, S = ST.get();
    if (el.dataset.act === 'file' && el.files && el.files[0]) F.useFilePhoto(URL.createObjectURL(el.files[0]));
    if (el.dataset.act === 'scenario') S.visit.scenario = el.value;
  });
  root.addEventListener('input', function (e) {
    var el = e.target, S = ST.get();
    if (el.dataset.act === 'note') S.visit.note = el.value;
    if (el.dataset.act === 'server-val') S.feed.serverVal = el.value;
  });
  root.addEventListener('keydown', function (e) {
    var tab = e.target.closest && e.target.closest('[role="tab"]');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) {
      var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]')), i = tabs.indexOf(tab);
      i = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : tabs.length - 1;
      ST.get().feed.tab = tabs[i].dataset.arg; ST.emit(); e.preventDefault();
    }
  });
  document.addEventListener('keydown', function (e) {
    var S = ST.get();
    if (e.key === 'Escape') {
      if (S.drawer) { S.drawer = null; ST.emit(); var b = root.querySelector('[data-fid="open-debug"]'); if (b) b.focus(); }
      else if (S.menu) { S.menu = false; ST.emit(); var m = root.querySelector('[data-fid="menu"]'); if (m) m.focus(); }
      else if (ctx.phone && S.cam === 'live' && !S.photo) F.closeCamera();
    }
    if (S.drawer && e.key === 'Tab') { // keep focus inside the drawer
      var d = root.querySelector('#cap-drawer'); if (!d) return;
      var f = d.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])'); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  });

  /* ---------- viewer messages ---------- */
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || !m.cap) return;
    var S = ST.get();
    if (m.cap === 'apply') { ST.apply(m.id, { auto: false }); applyUrlFlags(); }
    if (m.cap === 'theme') { S.theme = m.value === 'light' ? 'light' : 'dark'; ST.emit(); }
    if (m.cap === 'next') { S.outcome = m.value; ST.emit(); }
    if (m.cap === 'reset') { ST.reset(); }
  });

  function applyUrlFlags() {
    var S = ST.get();
    if (params.get('hud') === 'raw') S.diag.raw = true;
    if (params.get('debug') === 'checks') S.diag.debug = true;
    if (params.has('record')) S.diag.record = true;
    if (params.get('demo') === 'tools') S.diag.tools = true;
    if (params.get('theme') === 'light' && !S.themeSet) { S.theme = 'light'; }
  }

  ST.on(render);
  ST.init();
  var theme = params.get('theme') === 'light' ? 'light' : 'dark';
  var id = params.get('state') || 'idle';
  ST.apply(ST.byId[id] ? id : 'idle', { auto: false });
  var S0 = ST.get();
  S0.theme = theme; if (params.get('next')) S0.outcome = params.get('next');
  applyUrlFlags();
  if (!params.get('state')) { S0.auto = true; }
  render();
  window.__cap = { state: ST.get, apply: function (i) { ST.apply(i, { auto: false }); applyUrlFlags(); }, ST: ST };
})();
