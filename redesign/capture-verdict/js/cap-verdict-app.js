/* Capture · Verdict step prototype: mounts the page, wires events, counts the gauge up, copies the id, talks to the viewer (index.html). */
(function () {
  var V = window.CAP_V, R = window.CAP_R, ST = window.CAP_VSTATE;
  var root = document.getElementById('cap-root');
  var mqPhone = window.matchMedia('(max-width: 720px)');
  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var ctx = { phone: mqPhone.matches };
  var params = new URLSearchParams(location.search);
  var anim = { raf: 0, token: 0 }, copyTimer = 0, burstTimer = 0;

  function reduced() { return mqReduce.matches || document.documentElement.getAttribute('data-motion') === 'reduce'; }

  /* ---------- toasts (same markup as the Photo step) ---------- */
  var toastRegion = document.getElementById('cap-toasts');
  function toast(title, text) {
    if (!toastRegion) return;
    var el = document.createElement('div');
    el.className = 'cap-toast';
    el.innerHTML = window.ic('circle-check', 18) + '<div class="cap-toast__body"><div class="cap-toast__title"></div><div class="cap-toast__text"></div></div><button type="button" class="cap-icon-btn" aria-label="Dismiss" style="width:32px;height:32px">' + window.ic('x', 16) + '</button>';
    el.querySelector('.cap-toast__title').textContent = title;
    el.querySelector('.cap-toast__text').textContent = text || '';
    el.querySelector('button').onclick = function () { el.remove(); };
    toastRegion.appendChild(el);
    setTimeout(function () { el.remove(); }, 7000);
  }

  /* ---------- gauge: count up once, drive the number and the ring from one clock ---------- */
  function setGauge(g, v, final) {
    var n = +g.dataset.segs, lit = Math.round(Math.max(0, Math.min(1, v)) * n);
    var segs = g.querySelectorAll('.cap-gauge__seg');
    for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('cap-gauge__seg--on', i < lit);
    g.querySelector('[data-bind="gauge"]').textContent = (v * 100).toFixed(1) + '%';
    if (final) g.dataset.done = '1';
  }
  function runGauge(S) {
    cancelAnimationFrame(anim.raf);
    var g = root.querySelector('.cap-gauge'); if (!g) return;
    var final = +g.dataset.final;
    if (!S.animate || reduced() || S.animDone === S.stage) { setGauge(g, final, true); return; }
    var token = ++anim.token, t0 = null, DUR = 1400, DELAY = 150;
    setGauge(g, 0);
    function step(t) {
      if (token !== anim.token) return;
      if (t0 == null) t0 = t;
      var k = Math.max(0, Math.min(1, (t - t0 - DELAY) / DUR)), e = 1 - Math.pow(1 - k, 3);
      setGauge(g, final * e, k >= 1);
      if (k < 1) anim.raf = requestAnimationFrame(step); else S.animDone = S.stage;
    }
    anim.raf = requestAnimationFrame(step);
    setTimeout(function () { if (token === anim.token) { setGauge(g, final, true); S.animDone = S.stage; } }, DELAY + DUR + 400); // a hidden tab pauses rAF
  }

  /* ---------- render ---------- */
  function applyFrame(S) {
    document.documentElement.setAttribute('data-theme', S.theme);
    if (S.motion === 'reduce') document.documentElement.setAttribute('data-motion', 'reduce'); else document.documentElement.removeAttribute('data-motion');
  }
  function render() {
    var S = ST.get();
    ctx.phone = mqPhone.matches;
    var a = document.activeElement, fid = a && a.dataset && a.dataset.fid;
    var sy = window.scrollY;
    applyFrame(S);
    root.innerHTML = R.vapp(S, ctx);
    if (fid) { var el = root.querySelector('[data-fid="' + fid + '"]'); if (el && !el.disabled) el.focus({ preventScroll: true }); }
    window.scrollTo(0, sy);
    runGauge(S);
    clearTimeout(burstTimer);
    if (S.animate && !S.burstDone && S.frame !== 'celebrate') burstTimer = setTimeout(function () { S.burstDone = true; }, 1800);
    try { parent.postMessage({ cap: 'state', id: S.presetId, theme: S.theme, motion: S.motion }, '*'); } catch (e) { /* not framed */ }
  }
  mqPhone.addEventListener ? mqPhone.addEventListener('change', render) : mqPhone.addListener(render);

  /* ---------- copy the submission id (C1: the check shows for 1.5 s) ---------- */
  function copyText(text) {
    function fallback() {
      try {
        var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    return Promise.resolve(fallback());
  }
  function paintCopied(on) {
    var S = ST.get(); S.copied = on;
    var b = root.querySelector('[data-act="copy"]'); if (!b) return;
    b.classList.toggle('is-copied', on); b.classList.toggle('is-tip', on);
    b.setAttribute('data-tip', on ? 'Copied' : V.T.copyLabel);
    b.innerHTML = window.ic(on ? 'check' : 'copy', 18);
    var st = root.querySelector('[data-bind="copy-status"]'); if (st) st.textContent = on ? 'Submission ID copied' : '';
  }
  function copyId() {
    var S = ST.get();
    copyText(String(S.result.id)).then(function (ok) {
      if (!ok) return; // clipboard unavailable (insecure context): nothing changes, like the real app
      paintCopied(true);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { paintCopied(false); }, 1500);
    });
  }

  /* ---------- events ---------- */
  root.addEventListener('click', function (e) {
    var S = ST.get();
    if (S.menu && !e.target.closest('.cap-popover') && !e.target.closest('[data-act="menu"]')) { S.menu = false; ST.emit(); }
    var el = e.target.closest ? e.target.closest('[data-act]') : null; if (!el) return;
    var act = el.dataset.act;
    if (el.tagName === 'A') e.preventDefault();
    switch (act) {
      case 'menu': S.menu = !S.menu; ST.emit(); break;
      case 'copy': copyId(); break;
      case 'fetched': {
        S.fetchedOpen = !S.fetchedOpen;
        var list = root.querySelector('#vfet-list'); if (list) list.hidden = !S.fetchedOpen;
        el.setAttribute('aria-expanded', String(S.fetchedOpen)); el.classList.toggle('is-open', S.fetchedOpen);
        break;
      }
      case 'new':
        window.scrollTo({ top: 0 });
        toast('New submission', 'MOCK: the real app scrolls to the top, resets the flow, reopens the camera and restarts the visit recording if the worker already agreed. This prototype stays on the Verdict step.');
        break;
      default: break;
    }
  });
  document.addEventListener('keydown', function (e) {
    var S = ST.get();
    if (e.key === 'Escape' && S.menu) { S.menu = false; ST.emit(); var m = root.querySelector('[data-fid="menu"]'); if (m) m.focus(); }
  });

  /* ---------- viewer messages ---------- */
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || !m.cap) return;
    var S = ST.get();
    if (m.cap === 'apply') ST.apply(m.id, {});
    if (m.cap === 'replay') ST.apply(S.presetId || 'accepted-full', { animate: true });
    if (m.cap === 'theme') { S.theme = m.value === 'light' ? 'light' : 'dark'; applyFrame(S); }
    if (m.cap === 'motion') { S.motion = m.value === 'reduce' ? 'reduce' : 'normal'; applyFrame(S); render(); }
  });

  ST.on(render);
  ST.init();
  var id = params.get('state') || 'accepted-full';
  var S0 = ST.get();
  S0.theme = params.get('theme') === 'light' ? 'light' : 'dark';
  S0.motion = params.get('motion') === 'reduce' ? 'reduce' : 'normal';
  ST.apply(ST.byId[id] ? id : 'accepted-full', { animate: params.get('static') ? false : null });
  window.__v = { state: ST.get, apply: function (i, o) { ST.apply(i, o || {}); }, ST: ST };
})();
