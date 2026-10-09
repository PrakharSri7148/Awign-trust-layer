/* Capture · AI scan step prototype: mounts the page, patches it as the state changes, talks to the viewer (index.html).
   Query: ?state=<preset id>  ?theme=light  ?motion=reduce  ?play=demo|fast|slow|fail  ?return=0 (do not leave for the Photo step on failure) */
(function () {
  var D = window.SCAN_DATA, ST = window.SCAN_STATE, R = window.SCAN_R;
  var root = document.getElementById('cap-root');
  var live = document.getElementById('scan-live');
  var params = new URLSearchParams(location.search);
  var lastKey = null, lastSig = null, lastMsg = '', lastFail = null;

  function frame(S) {
    var h = document.documentElement;
    h.setAttribute('data-theme', S.theme);
    if (S.reduce) h.setAttribute('data-motion', 'reduce'); else h.removeAttribute('data-motion');
  }
  function sig(S) {
    var a = []; for (var i = 1; i <= 5; i++) a.push(ST.lineState(i)); return a.join(',') + '|' + ST.extraState();
  }
  /* B3.a: one polite status region for the whole list; it speaks each message once, and only when the message changes */
  function announce(S) {
    var m = R.announce(S);
    if (m && m !== lastMsg) live.textContent = m;
    lastMsg = m || lastMsg;
  }
  function full(S) {
    root.innerHTML = R.app(S);
    lastKey = (S.presetId || '') + '|' + (S.playing || '') + '|' + (S.phase === 'verdict');
    lastSig = sig(S);
    lastMsg = ''; live.textContent = '';
    announce(S);
  }
  function patch(S) {
    var card = document.getElementById('scan-card'); if (!card) return full(S);
    var failed = S.phase === 'failed';
    card.classList.toggle('cap-card--fail', failed);
    if (failed) card.removeAttribute('aria-busy'); else card.setAttribute('aria-busy', 'true');
    var mark = card.querySelector('.cap-scanmark'); if (mark) mark.classList.toggle('cap-scanmark--stopped', failed);
    var bar = card.querySelector('.cap-meter--busy');
    if (bar && bar.classList.contains('is-stopped') !== failed) bar.outerHTML = R.bar(S);
    var s = sig(S);
    if (s !== lastSig) { document.getElementById('scan-steps').innerHTML = R.steps(S); lastSig = s; }
    document.getElementById('scan-aux').innerHTML = R.aux(S);
    var f = S.error || '';
    if (f !== lastFail) { document.getElementById('scan-fail').innerHTML = R.fail(S); lastFail = f; }
    document.getElementById('scan-notes').innerHTML = R.notes(S);
    announce(S);
  }
  function render(S) {
    frame(S);
    var key = (S.presetId || '') + '|' + (S.playing || '') + '|' + (S.phase === 'verdict');
    if (key !== lastKey || !document.getElementById('scan-card')) { lastFail = S.error || ''; full(S); } else patch(S);
    try { parent.postMessage({ cap: 'state', id: S.presetId, phase: S.phase, line: S.line, theme: S.theme, reduce: S.reduce }, '*'); } catch (e) { /* not framed */ }
  }
  ST.subscribe(render);

  /* ---------- runs ---------- */
  var RUNS = {
    demo: { label: 'demo', answerMs: 12000 },
    fast: { label: 'fast', answerMs: 2600 },
    slow: { label: 'slow', answerMs: 14000, notes: [D.NOTES[0]] },
    fail: { label: 'fail', failAfterMs: 4200, error: D.ERR_503 }
  };
  function toPhoto(err) {
    if (params.get('return') === '0') return;
    var q = new URLSearchParams({ state: 'error-submit', theme: ST.get().theme });
    location.href = '../capture-photo/app.html?' + q.toString();
  }
  function run(name) {
    var r = Object.assign({}, RUNS[name] || RUNS.demo, { onReturn: toPhoto });
    var n = parseInt(params.get('notes'), 10); if (n > 0 && !r.notes) r.notes = D.NOTES.slice(0, n);
    ST.play(r);
  }

  root.addEventListener('click', function (e) { if (e.target.closest('[data-act="replay"]')) run('demo'); });
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || !m.cap) return;
    if (m.cap === 'apply') ST.apply(m.id);
    else if (m.cap === 'theme') ST.setTheme(m.value === 'light' ? 'light' : 'dark');
    else if (m.cap === 'motion') ST.setReduce(m.value === 'reduce');
    else if (m.cap === 'play') run(m.mode);
  });

  /* ---------- boot ---------- */
  if (params.get('theme') === 'light') ST.setTheme('light');
  if (params.get('motion') === 'reduce') ST.setReduce(true);
  if (params.get('play')) run(params.get('play'));
  else ST.apply(params.get('state') && ST.byId[params.get('state')] ? params.get('state') : 'l3');
  window.__scan = { ST: ST, run: run };
})();
