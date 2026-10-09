/* Capture · Arrival step prototype: strings, mock values, the state model and the presets.
   Every user-facing string that exists in today's Arrival step is copied from client/src/pages/Capture.jsx, SensorTile.jsx, TrailTile.jsx
   and lib/sensorFusion/display.js (recordingSummary). Anything marked MOCK is an invented VALUE (never a label). Additions are listed in
   the Coverage page. */
(function () {
  var A = {};

  /* ---------- Strings (A1-A4, A7, A8) ---------- */
  A.EYEBROW = 'Verifying your arrival';                                                                   // A1
  A.TITLE = 'Sending your location';                                                                      // A2
  A.LEAD = 'Your photo is verified. Hold the phone naturally for ~3 seconds while we send your GPS location and the movement recorded on the way, and check you reached the site.'; // A3
  A.STATE_WORD = { wait: 'Waiting', acq: 'Acquiring', ok: 'Locked', na: 'Unavailable' };                  // A4 states
  A.STATE_ICON = { wait: 'clock', acq: 'loader-circle', ok: 'check', na: 'triangle-alert' };
  A.NOTES = { gps: 'GPS unavailable or denied', motion: 'no motion samples (sensor unavailable or denied)', net: 'network info unavailable in this browser' }; // A7
  A.NA_VALUE = { gps: 'Location unavailable or denied', motion: 'No samples (sensor unavailable or denied)', net: 'Network info not exposed by this browser', trail: 'Not recorded (start the visit recording on the first screen to add the approach)' };
  A.ERROR_PREFIX = 'Submission failed: ';                                                                  // A8 (real prefix)
  A.ERROR_MOCK = 'Server responded 503: Service Unavailable';                                             // MOCK message
  A.MOTION_MS = 3000;                                                                                     // A4 countdown 3.0 -> 0.0
  A.PAUSE_MS = 500;                                                                                       // A6
  A.STEPS = ['Photo', 'Arrival', 'AI scan', 'Verdict'];
  A.TILES = [
    { id: 'gps', title: 'GPS', icon: 'satellite' },
    { id: 'motion', title: 'Motion', icon: 'activity' },
    { id: 'net', title: 'Network', icon: 'wifi' },
    { id: 'trail', title: 'Approach trail', icon: 'route' }
  ];

  /* ---------- Value formatters (same shapes as the React code) ---------- */
  A.BARS = { slow: 1, '3g': 2, '2g': 1, 'slow-2g': 1, '4g': 4 };                                          // A4 network bars
  A.bars = function (type) { return A.BARS[type] != null ? A.BARS[type] : 0; };
  A.fmtDistance = function (m) { return m == null ? '-' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; };
  A.gpsValue = function (lat, lng) { return lat.toFixed(5) + ', ' + lng.toFixed(5); };
  A.motionValue = function (n, mean) { return n + ' samples · mean ' + mean.toFixed(2) + ' m/s²'; };
  A.netValue = function (n) { return n.type + ' · ' + n.downlink + ' Mbps · ' + n.rtt + ' ms'; };
  A.trailValue = function (s) {                                                                           // = recordingSummary()
    var p = [s.fixes + ' location fix' + (s.fixes === 1 ? '' : 'es')];
    if (s.distanceM) p.push(A.fmtDistance(s.distanceM));
    if (s.accuracyM != null) p.push('±' + Math.round(s.accuracyM) + ' m');
    if (s.motion === 'null_events' || s.motion === 'absent') p.push('no motion sensor'); else if (s.motion === 'denied') p.push('motion denied');
    return p.join(' · ');
  };
  /* MOCK values */
  var MOCK = {
    lat: 12.97164, lng: 77.59462, samples: 181, mean: 0.42,
    net: { '4g': { type: '4g', downlink: 10, rtt: 50 }, '3g': { type: '3g', downlink: 1.4, rtt: 270 }, 'slow-2g': { type: 'slow-2g', downlink: 0.05, rtt: 2000 } },
    trail: { fixes: 14, distanceM: 182, accuracyM: 9, motion: 'ok' },
    acts: ('still,still,still,still,still,still,walking,walking,walking,walking,walking,walking,walking,walking,walking,moving,moving,moving,walking,walking,walking,walking,unknown,unknown').split(',')
  };
  A.MOCK = MOCK;

  /* ---------- Tile model ---------- */
  function tile(st, extra) { var t = { st: st }; for (var k in extra) t[k] = extra[k]; return t; }
  var T = {
    wait: function (id) { return id === 'trail' ? tile('wait', { value: '' }) : tile('wait', { value: '' }); },
    gpsOk: function () { return tile('ok', { value: A.gpsValue(MOCK.lat, MOCK.lng) }); },
    gpsNa: function () { return tile('na', { value: A.NA_VALUE.gps }); },
    motionOk: function () { return tile('ok', { value: A.motionValue(MOCK.samples, MOCK.mean), left: 0 }); },
    motionNa: function () { return tile('na', { value: A.NA_VALUE.motion, left: 0 }); },
    motionAcq: function (left, flat) { return tile('acq', { value: '', left: left, flat: !!flat }); },
    netOk: function (k) { var n = MOCK.net[k || '4g']; return tile('ok', { value: A.netValue(n), type: n.type }); },
    netNa: function () { return tile('na', { value: A.NA_VALUE.net }); },
    trailOk: function (o) { var s = Object.assign({}, MOCK.trail, o || {}); return tile('ok', { value: A.trailValue(s), acts: o && o.noActs ? [] : MOCK.acts }); },
    trailAcq: function () { return tile('acq', { value: A.trailValue({ fixes: 0 }), acts: [] }); },
    trailNa: function () { return tile('na', { value: A.NA_VALUE.trail, acts: [] }); }
  };
  A.T = T;

  /** Everything the page shows is derived from the tiles: the count, the meter, the A7 notes and the phase. */
  A.derive = function (S) {
    var t = S.tiles, ids = ['gps', 'motion', 'net', 'trail'];
    var done = ids.filter(function (k) { return t[k].st === 'ok' || t[k].st === 'na'; }).length;
    var partial = t.motion.st === 'acq' ? Math.max(0, Math.min(0.9, 1 - (t.motion.left || 0) / A.MOTION_MS)) : 0;
    var pct = Math.round((done + partial) / 4 * 100);
    var notes = [];
    if (t.gps.st === 'na') notes.push(A.NOTES.gps);
    if (t.motion.st === 'na') notes.push(A.NOTES.motion);
    if (t.net.st === 'na') notes.push(A.NOTES.net);
    var anyNa = ids.some(function (k) { return t[k].st === 'na'; });
    return { done: done, pct: done === 4 ? 100 : pct, notes: notes, anyNa: anyNa, all: done === 4 };
  };

  function mk(tiles, over) { var S = { tiles: tiles, phase: 'reading', frozen: true, step: 'arrival' }; for (var k in over) S[k] = over[k]; return S; }
  function four(g, m, n, t, over) { return mk({ gps: g, motion: m, net: n, trail: t }, over); }

  /* ---------- Presets: the state switcher ---------- */
  var P = [];
  function add(group, id, label, desc, S, extra) { var p = { group: group, id: id, label: label, desc: desc, S: S }; for (var k in extra) p[k] = extra[k]; P.push(p); }

  add('0 · Before the readings', 'wait', 'All four tiles Waiting', 'Muted tiles, nothing started yet (the instant after the tap)', four(T.wait(), T.wait(), T.wait(), T.wait(), { ring: 3000 }));
  add('1 · All Acquiring', 'acq-all', 'All four Acquiring', 'Ring at 3.0, waveform moving, trail just started', four(tile('acq', { value: '' }), T.motionAcq(3000), tile('acq', { value: '' }), T.trailAcq()));
  add('2 · Mid-way', 'mid', 'GPS, Network, Trail Locked · Motion Acquiring', 'Ring at 1.4 s, “3 of 4 readings done”', four(T.gpsOk(), T.motionAcq(1400), T.netOk('4g'), T.trailOk()));
  add('3 · All Locked', 'done', 'All Locked, “Continuing…”', 'The 0.5 s pause before AI scan', four(T.gpsOk(), T.motionOk(), T.netOk('4g'), T.trailOk(), { phase: 'continuing' }));
  add('4 · Unavailable', 'na-all', 'GPS, Motion, Network, Trail Unavailable', 'Desktop with no sensor; visit recording never started; amber notes', four(T.gpsNa(), T.motionNa(), T.netNa(), T.trailNa(), { phase: 'continuing' }));
  add('4 · Unavailable', 'na-acq', 'Desktop with no sensor, still Acquiring', 'Motion is acquiring but the waveform is a flat line', four(tile('acq', { value: '' }), T.motionAcq(1400, true), T.netNa(), T.trailNa()));
  add('4 · Unavailable', 'na-gps', 'Only GPS Unavailable', 'Everything else Locked', four(T.gpsNa(), T.motionOk(), T.netOk('4g'), T.trailOk(), { phase: 'continuing' }));
  add('4 · Unavailable', 'na-motion', 'Only Motion Unavailable', 'Flat waveform kept, amber note', four(T.gpsOk(), T.motionNa(), T.netOk('4g'), T.trailOk({ motion: 'denied' }), { phase: 'continuing' }));
  add('5 · Network signal', 'net-4g', 'Network 4g: 4 bars', 'All Locked', four(T.gpsOk(), T.motionOk(), T.netOk('4g'), T.trailOk(), { phase: 'continuing' }));
  add('5 · Network signal', 'net-3g', 'Network 3g: 2 bars', 'All Locked', four(T.gpsOk(), T.motionOk(), T.netOk('3g'), T.trailOk(), { phase: 'continuing' }));
  add('5 · Network signal', 'net-slow', 'Slow network: 1 bar', 'slow-2g · 0.05 Mbps · 2000 ms', four(T.gpsOk(), T.motionOk(), T.netOk('slow-2g'), T.trailOk(), { phase: 'continuing' }));
  add('Approach trail variants', 'trail-acq', 'Trail Acquiring (recording just started)', '0 location fixes, no strip yet', four(T.gpsOk(), T.motionAcq(2100), T.netOk('4g'), T.trailAcq()));
  add('Approach trail variants', 'trail-one', 'Trail Locked, 1 fix, no motion sensor', '“1 location fix · … · no motion sensor”', four(T.gpsOk(), T.motionOk(), T.netOk('4g'), tile('ok', { value: A.trailValue({ fixes: 1, distanceM: 0, accuracyM: 14, motion: 'null_events' }), acts: [] }), { phase: 'continuing' }));
  add('Approach trail variants', 'trail-denied', 'Trail Locked, “motion denied”', 'Long value wraps; the strip is the 2-minute activity', four(T.gpsOk(), T.motionOk(), T.netOk('4g'), T.trailOk({ distanceM: 1240, accuracyM: 22, motion: 'denied' }), { phase: 'continuing' }));
  add('6 · Light theme, phone', 'light-acq', 'Light · all Acquiring', 'Opens at 390 px, light theme', P[1].S, { view: { dev: 'phone', theme: 'light' } });
  add('6 · Light theme, phone', 'light-mid', 'Light · mid-way', 'Opens at 390 px, light theme', P[2].S, { view: { dev: 'phone', theme: 'light' } });
  add('6 · Light theme, phone', 'light-done', 'Light · all Locked', 'Opens at 390 px, light theme', P[3].S, { view: { dev: 'phone', theme: 'light' } });
  add('6 · Light theme, phone', 'light-na', 'Light · Unavailable', 'Opens at 390 px, light theme', P[4].S, { view: { dev: 'phone', theme: 'light' } });
  add('Play the real 3 seconds', 'play-ok', 'Play: everything works', 'Waiting → Acquiring → GPS at 1.1 s, Motion at 3.0 s → 0.5 s → AI scan', mk({}, {}), { play: 'ok' });
  add('Play the real 3 seconds', 'play-desktop', 'Play: desktop, no sensors', 'GPS denied, no motion, no network info, no recording', mk({}, {}), { play: 'desktop' });
  add('Play the real 3 seconds', 'play-slow', 'Play: slow network', 'Same as “everything works” with slow-2g', mk({}, {}), { play: 'slow' });
  add('Transitions', 'to-scan', 'After the pause: Arrival → AI scan', 'Plays: all Locked, 0.5 s, slide to AI scan (stub)', P[3].S, { play: 'to-scan' });
  add('Transitions', 'scan-end', 'AI scan reached (end state)', 'Stepper: Photo ✓ Arrival ✓ AI scan active', mk({}, { step: 'scan' }));
  add('Transitions', 'err-back', 'Submission fails: back to the Photo step', 'Plays: slide back, Photo active, error banner (A8)', P[3].S, { play: 'error' });
  add('Transitions', 'err-end', 'Back on the Photo step (end state)', 'Stepper: Photo active, Arrival pending, banner role=alert', mk({}, { step: 'photo', error: A.ERROR_PREFIX + A.ERROR_MOCK }));

  A.presets = P;
  A.byId = {}; P.forEach(function (p) { A.byId[p.id] = p; });

  /* ---------- Scenarios for the live "play" mode: [ms, patch] ---------- */
  A.scenarios = {
    ok: [[0, { wait: 1 }], [250, { gps: 'acq', motion: 'acq', net: 'ok', trail: 'acq' }], [700, { trail: 'ok' }], [1100, { gps: 'ok' }], [3000, { motion: 'ok' }]],
    slow: [[0, { wait: 1 }], [250, { gps: 'acq', motion: 'acq', net: 'ok-slow', trail: 'acq' }], [700, { trail: 'ok' }], [1900, { gps: 'ok' }], [3000, { motion: 'ok' }]],
    desktop: [[0, { wait: 1 }], [250, { gps: 'acq', motion: 'acq-flat', net: 'na', trail: 'na' }], [1200, { gps: 'na' }], [3000, { motion: 'na' }]],
    'to-scan': [], error: []
  };

  window.CAP_ARR = A;
})();
