/* Capture · Arrival step prototype: mounts the page, runs the 3-second sequence, animates the countdown ring and the waveform,
   plays the step transitions and talks to the viewer (index.html). */
(function () {
  var A = window.CAP_ARR, R = window.CAP_ARR_R, T = A.T;
  var root = document.getElementById('cap-root');
  var params = new URLSearchParams(location.search);
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var S = null, presetId = null, timers = [], N = 90, bufs = { motion: new Array(N).fill(0) }, t0 = 0, tMotion = 0, noSensor = false;

  /* ---------- the mock |acceleration| signal (a phone held naturally: small tremor, now and then a bigger move) ---------- */
  var phase = Math.random() * 100;
  function sample(i) { phase += 0.35; var v = 0.45 + 0.3 * Math.abs(Math.sin(phase * 0.9)) + 0.18 * Math.sin(phase * 2.7) + (Math.random() - 0.5) * 0.28; if (Math.random() < 0.05) v += 0.9 * Math.random(); return Math.max(0.02, v); }
  function fillBuf() {
    var m = S && S.tiles && S.tiles.motion;
    bufs.motion = new Array(N).fill(0);
    if (m && (m.st === 'ok' || (m.st === 'acq' && !m.flat))) for (var i = 0; i < N; i++) bufs.motion[i] = sample(i);
  }

  function clear() { timers.forEach(clearTimeout); timers = []; }
  function later(ms, fn) { timers.push(setTimeout(fn, ms)); }

  /* ---------- render ---------- */
  function render(viewCls) {
    document.documentElement.setAttribute('data-theme', S.theme);
    root.innerHTML = R.app(S, bufs, viewCls);
    try { parent.postMessage({ cap: 'state', id: presetId, theme: S.theme }, '*'); } catch (e) { /* not framed */ }
  }
  function leftNow() { var m = S.tiles.motion; if (m.st !== 'acq') return m.left || 0; return S.frozen ? m.left : Math.max(0, A.MOTION_MS - (performance.now() - tMotion)); }

  /* ---------- live bits (no re-render): ring, countdown number, waveform ---------- */
  function tick() {
    if (!S || S.step !== 'arrival' || !S.tiles || !S.tiles.motion) return;
    var m = S.tiles.motion;
    if (m.st !== 'acq') return;
    if (!S.frozen) m.left = leftNow();
    bufs.motion.push(m.flat ? 0 : sample()); bufs.motion.shift();
    var path = root.querySelector('[data-wave]'); if (path) path.setAttribute('d', R.wavePath(bufs.motion));
    var ring = root.querySelector('[data-ring]');
    if (ring) {
      ring.style.setProperty('--p', Math.max(0, Math.min(1, 1 - m.left / A.MOTION_MS)).toFixed(3));
      ring.setAttribute('aria-valuenow', (m.left / 1000).toFixed(1)); ring.setAttribute('aria-valuetext', (m.left / 1000).toFixed(1) + ' s left');
      var num = ring.querySelector('[data-bind="ring-num"]'); if (num) num.textContent = (m.left / 1000).toFixed(1);
    }
    if (!S.frozen) {
      var d = A.derive(S), meter = root.querySelector('.cap-progress .cap-meter');
      if (meter) {
        var lit = Math.round(d.pct / 100 * 20); meter.setAttribute('aria-valuenow', d.pct);
        meter.querySelectorAll('.cap-meter__cell').forEach(function (c, i) { c.classList.toggle('cap-meter__cell--on', i < lit); });
      }
    }
  }
  setInterval(tick, reduced ? 250 : 66);

  /* ---------- step transitions: slide out, swap, slide in (Photo -> Arrival style, 220 ms; none under reduced motion) ---------- */
  function go(step, back, extra) {
    var view = document.getElementById('cap-view');
    var swap = function () { S.step = step; if (extra) for (var k in extra) S[k] = extra[k]; if (step === 'arrival') fillBuf(); render(back ? 'cap-view--back' : ''); };
    if (!view || reduced) return swap();
    view.classList.add('cap-view--out'); if (back) view.classList.add('cap-view--out-back');
    later(230, swap);
  }

  /* ---------- the real 3-second sequence (A4, A5, A6) ---------- */
  function patch(p) {
    var t = S.tiles;
    if (p.wait) { S.tiles = { gps: T.wait(), motion: T.wait(), net: T.wait(), trail: T.wait() }; return; }
    if (p.gps) t.gps = p.gps === 'acq' ? { st: 'acq', value: '' } : p.gps === 'ok' ? T.gpsOk() : T.gpsNa();
    if (p.motion) {
      if (p.motion === 'acq' || p.motion === 'acq-flat') { tMotion = performance.now(); t.motion = T.motionAcq(A.MOTION_MS, p.motion === 'acq-flat'); fillBuf(); }
      else if (p.motion === 'ok') { var keep = bufs.motion; t.motion = T.motionOk(); bufs.motion = keep; }
      else { t.motion = T.motionNa(); bufs.motion = new Array(N).fill(0); }
    }
    if (p.net) t.net = p.net === 'ok' ? T.netOk('4g') : p.net === 'ok-slow' ? T.netOk('slow-2g') : T.netNa();
    if (p.trail) t.trail = p.trail === 'acq' ? T.trailAcq() : p.trail === 'ok' ? T.trailOk() : T.trailNa();
  }
  function afterPatch(onAll) {
    if (A.derive(S).all && S.phase !== 'continuing') { S.phase = 'continuing'; render(); later(A.PAUSE_MS, onAll); } else render();
  }
  function play(name) {
    clear(); S.frozen = false; S.phase = 'reading'; S.step = 'arrival';
    var script = A.scenarios[name];
    S.tiles = { gps: T.wait(), motion: T.wait(), net: T.wait(), trail: T.wait() };
    bufs.motion = new Array(N).fill(0);
    render('');
    script.forEach(function (ev) { later(ev[0], function () { patch(ev[1]); afterPatch(function () { go('scan', false); }); }); });
  }

  /* ---------- apply a preset ---------- */
  function apply(id, keepTheme, viewCls) {
    var p = A.byId[id] || A.byId.wait; clear();
    presetId = p.id;
    var theme = keepTheme || (S && S.theme) || params.get('theme') || 'dark';
    S = JSON.parse(JSON.stringify(p.S)); S.theme = theme;
    if (p.view && p.view.theme && !keepTheme) S.theme = p.view.theme;
    if (S.step === 'arrival' && !Object.keys(S.tiles).length) S.tiles = { gps: T.wait(), motion: T.wait(), net: T.wait(), trail: T.wait() };
    S.frozen = !p.play || p.play === 'to-scan' || p.play === 'error';
    tMotion = performance.now();
    if (S.step === 'arrival' && S.tiles && S.tiles.motion) fillBuf();
    render(viewCls || '');
    if (p.play === 'ok' || p.play === 'slow' || p.play === 'desktop') play(p.play);
    else if (p.play === 'to-scan') later(A.PAUSE_MS, function () { go('scan', false); });
    else if (p.play === 'error') later(900, function () { go('photo', true, { error: A.ERROR_PREFIX + A.ERROR_MOCK }); });
  }

  /* ---------- events ---------- */
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'replay') apply('play-ok', S.theme, 'cap-view--back');
  });
  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.cap === 'apply') apply(m.id);
    else if (m.cap === 'theme' && S) { S.theme = m.value; document.documentElement.setAttribute('data-theme', m.value); }
  });

  /* start: ?state=<id> (a fixed state) or, with no state, the live 3-second sequence */
  S = { theme: params.get('theme') === 'light' ? 'light' : 'dark', tiles: null };
  apply(params.get('state') || 'play-ok', S.theme);
  window.__arr = { A: A, apply: apply, get S() { return S; } };
})();
