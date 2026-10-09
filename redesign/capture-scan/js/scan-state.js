/* Capture · AI scan step prototype: state, presets and the live timeline.
   State: { line 1..5 (the active line), phase 'scan' | 'finishing' | 'failed' | 'verdict', failedAt 'scan' | 'finishing',
            slow, notes[], error, returning, reduce, theme, presetId, playing }
   The checklist is time-paced exactly like the React source (a new line every 650 ms); it is not reported by the server. */
(function () {
  var D = window.SCAN_DATA;
  var N = D.NOTES;
  var presets = [], byId = {}, listeners = [], timers = [];

  function base() {
    return { line: 1, phase: 'scan', failedAt: null, slow: false, notes: [], error: null, returning: false, reduce: false, theme: 'dark', presetId: null, playing: null };
  }
  function add(group, id, label, desc, over) {
    var p = { group: group, id: id, label: label, desc: desc, over: over || {} };
    presets.push(p); byId[id] = p;
  }

  add('1 · Progress (the five lines)', 'l1', 'Line 1 active (just started)', 'Nothing done yet', { line: 1 });
  add('1 · Progress (the five lines)', 'l2', 'Line 2 active', 'One done', { line: 2 });
  add('1 · Progress (the five lines)', 'l3', 'Line 3 active (two done)', '', { line: 3 });
  add('1 · Progress (the five lines)', 'l4', 'Line 4 active', 'Three done', { line: 4 });
  add('1 · Progress (the five lines)', 'l5', 'Line 5 active', 'Four done, about 2.6 s in', { line: 5 });
  add('1 · Progress (the five lines)', 'finishing', 'All five done · “Finishing up…”', 'Waiting for the server (addition)', { line: 5, phase: 'finishing' });

  add('2 · Sensor-notes banner (B4)', 'notes1', 'One note', 'GPS unavailable or denied', { line: 3, notes: [N[0]] });
  add('2 · Sensor-notes banner (B4)', 'notes2', 'Two notes', 'GPS + motion', { line: 3, notes: [N[0], N[1]] });
  add('2 · Sensor-notes banner (B4)', 'notes3', 'Three notes', 'GPS + motion + network', { line: 3, notes: [N[0], N[1], N[2]] });

  add('3 · Slow server (more than 8 s)', 'slow', 'Slow server', '“Still working…” line (addition)', { line: 5, phase: 'finishing', slow: true });
  add('3 · Slow server (more than 8 s)', 'slow-notes3', 'Slow server + three notes', 'Longest content, for the layout', { line: 5, phase: 'finishing', slow: true, notes: [N[0], N[1], N[2]] });

  add('4 · Failure (the moment before returning to Photo)', 'fail-503', 'Server error while scanning', 'Stopped on line 3', { line: 3, phase: 'failed', failedAt: 'scan', returning: true, error: D.ERR_503 });
  add('4 · Failure (the moment before returning to Photo)', 'fail-net', 'No connection while finishing', 'Stopped on “Finishing up…”, with notes', { line: 5, phase: 'failed', failedAt: 'finishing', returning: true, error: D.ERR_NET, notes: [N[2]] });

  add('5 · Reduced motion (rings static, lines still change)', 'rm-l3', 'Reduced motion · line 3 active', '', { line: 3, reduce: true });
  add('5 · Reduced motion (rings static, lines still change)', 'rm-finishing', 'Reduced motion · finishing up', 'With two notes', { line: 5, phase: 'finishing', reduce: true, notes: [N[0], N[1]] });

  var S = base();

  function emit() { listeners.forEach(function (f) { f(S); }); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function later(ms, fn) { timers.push(setTimeout(fn, ms)); }

  /** state of one line (1..5): done | active | pending | halt */
  function lineState(i) {
    if (S.phase === 'finishing' || S.phase === 'verdict' || (S.phase === 'failed' && S.failedAt === 'finishing')) return 'done';
    if (i < S.line) return 'done';
    if (i === S.line) return S.phase === 'failed' ? 'halt' : 'active';
    return 'pending';
  }
  function extraState() {
    if (S.phase === 'finishing') return 'active';
    if (S.phase === 'failed' && S.failedAt === 'finishing') return 'halt';
    return 'off';
  }

  var api = {
    presets: presets,
    byId: byId,
    get: function () { return S; },
    subscribe: function (f) { listeners.push(f); },
    lineState: lineState,
    extraState: extraState,
    /** keep theme / motion across preset changes */
    apply: function (id) {
      var p = byId[id]; if (!p) return false;
      clearTimers();
      var keep = { theme: S.theme, reduce: S.reduce };
      S = Object.assign(base(), keep, p.over, { presetId: id });
      if (p.over.reduce === undefined) S.reduce = keep.reduce;
      emit(); return true;
    },
    setTheme: function (t) { S.theme = t; emit(); },
    setReduce: function (v) { S.reduce = !!v; emit(); },
    /** The real timeline. opts: { answerMs (server answer, ms from the start; null = never), failAfterMs, notes, onReturn } */
    play: function (opts) {
      opts = opts || {};
      clearTimers();
      var keep = { theme: S.theme, reduce: S.reduce };
      S = Object.assign(base(), keep, { notes: opts.notes || [], playing: opts.label || 'live' });
      emit();
      for (var k = 1; k < 5; k++) (function (n) { later(n * D.LINE_MS, function () { S.line = n + 1; emit(); }); })(k);
      later(5 * D.LINE_MS, function () { if (S.phase === 'scan') { S.phase = 'finishing'; emit(); } });      // line 5 has run for one more 650 ms
      later(D.SLOW_MS, function () { if (S.phase === 'scan' || S.phase === 'finishing') { S.slow = true; emit(); } });
      if (opts.failAfterMs != null) {
        later(Math.max(D.MIN_MS, opts.failAfterMs), function () {
          S.failedAt = S.phase === 'finishing' ? 'finishing' : 'scan'; S.phase = 'failed'; S.error = opts.error || D.ERR_503; S.returning = true; S.slow = false; emit();
          later(opts.holdMs == null ? 1600 : opts.holdMs, function () { if (opts.onReturn) opts.onReturn(S.error); });
        });
      } else if (opts.answerMs != null) {
        later(Math.max(D.MIN_MS, opts.answerMs), function () { S.phase = 'verdict'; S.slow = false; S.playing = null; emit(); });
      }
    },
    stop: function () { clearTimers(); }
  };
  window.SCAN_STATE = api;
})();
