/* Capture · Verdict step prototype: strings, the display helpers and the mock results.
   fmtDistance, scoreWord, arrivalLine, verdictSummary, fetchedSummary and NOT_AVAILABLE are ported 1:1 from client/src/lib/sensorFusion/display.js
   (same wording, same tones), so the prototype shows exactly the sentences the real server data produces.
   Everything marked MOCK is invented for the prototype (ids, numbers, example organisations); labels and sentence templates are the real ones.
   top_reason sentences are the ones backend/classifier.py and backend/fusion/*.py write. */
(function () {
  var V = {};

  /* ---------- strings ---------- */
  V.T = {
    eyebrow: 'Verification result',
    verified: 'VERIFIED',
    flagged: 'FLAGGED FOR REVIEW',
    fraudLabel: 'Fraud prob.',
    threshold: 'threshold 50%',
    idPrefix: 'ID #',
    copyLabel: 'Copy submission ID',
    why: 'Why?',
    shap: 'SHAP factor breakdown',
    topDriver: 'TOP DRIVER',
    fetched: 'What was fetched',
    action: 'New submission'
  };
  V.THRESHOLD = 0.5;
  V.FACTORS = [
    { key: 'photo_quality', label: 'Photo quality' },
    { key: 'motion_consistency', label: 'Motion consistency' },
    { key: 'ambient_fingerprint', label: 'Network vs area' }
  ];
  V.STEPS = ['Photo', 'Arrival', 'AI scan', 'Verdict'];

  /* ---------- helpers ported from display.js ---------- */
  function fmtDistance(m) {
    if (m == null) return '-';
    return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
  }
  function scoreWord(score, known) {
    if (!known) return { word: 'not enough data', tone: 'muted' };
    if (score >= 0.85) return { word: 'consistent', tone: 'green' };
    if (score >= 0.6) return { word: 'some doubt', tone: 'amber' };
    return { word: 'inconsistent', tone: 'red' };
  }
  function arrivalLine(fusion) {
    var label = 'Arrival at site';
    var ev = fusion && fusion.motion && fusion.motion.evidence;
    var s = (ev && ev.site) || null;
    if (!fusion || !fusion.site) return { id: 'arrival', label: label, tone: 'muted', text: 'The company has not registered a location for this site, so arrival could not be checked' };
    if (!s || s.end_m == null) return { id: 'arrival', label: label, tone: 'muted', text: 'No reliable GPS fix was received, so arrival could not be confirmed' };
    var d = fmtDistance(s.end_m);
    var r = fmtDistance(s.radius_m != null ? s.radius_m : fusion.site.radius_m);
    if (s.end_inside) return { id: 'arrival', label: label, tone: 'green', text: 'GPS places you at the site: ' + d + ' from its centre (site radius ' + r + ')' };
    if (s.end_outside) return { id: 'arrival', label: label, tone: 'red', text: 'GPS places you ' + d + ' from the site (site radius ' + r + '): arrival not confirmed, sent for review' };
    return { id: 'arrival', label: label, tone: 'amber', text: 'Close to the site but not clearly inside: ' + d + ' away (site radius ' + r + ', GPS accuracy ±' + Math.round(s.end_acc_m != null ? s.end_acc_m : 0) + ' m)' };
  }
  function verdictSummary(fusion) {
    if (!fusion || !fusion.motion) return [];
    var m = fusion.motion, e = fusion.environment || {};
    var mw = scoreWord(m.score, m.known);
    var ew = scoreWord(e.score != null ? e.score : 0.5, e.known);
    var motionText = !m.known || !m.sensor_used
      ? "Not enough sensor data to compare the phone's movement with the GPS trail"
      : (m.reason != null ? m.reason : "The phone's movement matches the GPS trail");
    var envText = !e.known ? 'Network: not enough history to compare' : (e.reason != null ? e.reason : 'The network fits the claimed area');
    return [
      arrivalLine(fusion),
      { id: 'motion', label: 'Movement vs GPS', tone: m.known && m.sensor_used ? mw.tone : 'muted', text: motionText },
      { id: 'network', label: 'Network vs area', tone: e.known ? ew.tone : 'muted', text: envText }
    ];
  }
  var NOT_AVAILABLE = [
    { id: 'wifi', label: 'WiFi networks nearby', reason: 'browsers do not expose WiFi names; only a native app can read them' },
    { id: 'cell', label: 'Cell towers', reason: 'browsers do not expose cell tower IDs; only a native app can read them' },
    { id: 'mock', label: 'Android "mock location" flag', reason: 'only native Android code can see it; the web page infers a fake from the GPS trail instead' }
  ];
  function pctShare(n, d) { return d ? Math.round((100 * n) / d) : 0; }
  function fetchedSummary(fusion) {
    if (!fusion || !fusion.motion) return null;
    var ev = fusion.motion.evidence || {};
    var rows = ev.rows || [];
    var acts = rows.map(function (r) { return r.activity; }).filter(function (a) { return a && a !== 'unknown'; });
    function share(k) { return pctShare(acts.filter(function (a) { return a === k; }).length, acts.length); }
    var s = fusion.sensors || {};
    var ip = fusion.ip;
    var ipComp = ((fusion.environment && fusion.environment.components) || []).filter(function (c) { return c.id === 'ip_location'; })[0];
    var ipLine = !ip
      ? { ok: false, text: 'IP database not available on the server (or a private/local address)' }
      : ip.private
        ? { ok: false, text: 'a private / local network address (laptop or LAN demo): no IP location' }
        : { ok: true, text: [ip.country, ip.region, ip.city].filter(Boolean).join(' · ') + (ip.org ? ' · ' + ip.org : '') + (ipComp && ipComp.detail ? ' (' + ipComp.detail + ')' : '') };
    var jumps = ev.jumps || [];
    var fixes = ev.fixes || 0, wd = ev.windows_with_data || 0;
    var hc = s.hidden_count != null ? s.hidden_count : 1;
    return [
      { id: 'fixes', label: 'GPS fixes', ok: fixes > 0, text: fixes + ' fixes (' + (ev.reliable_fixes || 0) + ' accurate enough) over ' + Math.round(ev.duration_s || 0) + ' s, ' + fmtDistance(ev.distance_m || 0) + ' travelled' },
      { id: 'windows', label: 'Motion windows', ok: wd > 0, text: wd > 0 ? wd + ' of ' + (ev.windows || 0) + ' five-second windows had accelerometer/gyroscope data' : 'no accelerometer/gyroscope data arrived' },
      { id: 'activity', label: 'Phone activity', ok: acts.length > 0, text: acts.length ? 'still ' + share('still') + '% · walking ' + share('walking') + '% · moving ' + share('moving') + '%' : 'not measured' },
      { id: 'jumps', label: 'GPS jumps', ok: true, tone: jumps.length ? 'red' : null, text: jumps.length ? jumps.length + ' jump' + (jumps.length > 1 ? 's' : '') + ' faster or farther than a device can move' : 'none' },
      { id: 'site', label: 'Site location', ok: !!fusion.site, text: fusion.site ? 'registered, radius ' + fusion.site.radius_m + ' m' + (ev.site && ev.site.end_m != null ? '; trail ended ' + fmtDistance(ev.site.end_m) + ' from it' : '') : 'not registered: the arrival and outside-the-site checks were skipped' },
      { id: 'ip', label: 'IP location', ok: ipLine.ok, text: ipLine.text },
      { id: 'hidden', label: 'App hidden', ok: true, text: s.hidden_s ? s.hidden_s + ' s in ' + hc + ' break' + (hc > 1 ? 's' : '') + ' (nothing recorded then)' : 'never' },
      { id: 'restarts', label: 'GPS restarts', ok: true, text: s.watch_restarts ? s.watch_restarts + ' (the GPS stalled and was restarted)' : 'none needed' }
    ];
  }
  V.fmtDistance = fmtDistance;
  V.arrivalLine = arrivalLine;
  V.verdictSummary = verdictSummary;
  V.fetchedSummary = fetchedSummary;
  V.NOT_AVAILABLE = NOT_AVAILABLE;
  V.pct = function (v, d) { return ((v == null ? 0 : v) * 100).toFixed(d == null ? 1 : d) + '%'; };

  /* ---------- MOCK results ---------- */
  function rows(c) { var out = []; Object.keys(c).forEach(function (k) { for (var i = 0; i < c[k]; i++) out.push({ activity: k }); }); return out; }
  function site(end, o) { return Object.assign({ end_m: end, radius_m: 120, end_inside: true, end_outside: false, end_acc_m: 9 }, o || {}); }
  function fusion(o) {
    var f = {
      site: { lat: 12.97164, lng: 77.59462, radius_m: 120 },
      motion: { known: true, sensor_used: true, score: 0.93, reason: null,
        evidence: { fixes: 46, reliable_fixes: 41, duration_s: 118, distance_m: 640, windows: 24, windows_with_data: 24, rows: rows({ still: 3, walking: 19, moving: 2 }), jumps: [], site: site(38) } },
      environment: { known: true, score: 0.91, reason: null, components: [] },
      ip: { country: 'IN', region: 'Karnataka', city: 'Bengaluru', org: 'Bharti Airtel', private: false },
      sensors: { hidden_s: 0, hidden_count: 0, watch_restarts: 0 }
    };
    return o ? merge(f, o) : f;
  }
  function merge(a, b) {
    Object.keys(b).forEach(function (k) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]);
      else a[k] = b[k];
    });
    return a;
  }
  var MUTED = function () {
    return fusion({
      motion: { known: false, sensor_used: false, score: 0.5, evidence: { fixes: 0, reliable_fixes: 0, duration_s: 0, distance_m: 0, windows: 0, windows_with_data: 0, rows: [], jumps: [], site: null } },
      environment: { known: false, score: 0.5 },
      ip: { private: true }
    });
  };
  var M = {};
  M.acceptedFull = { id: 4821, status: 'accepted', fraud_probability: 0.062, top_reason: 'No issues detected',
    feature_importances: { photo_quality: 0.46, motion_consistency: 0.31, ambient_fingerprint: 0.23 }, fusion: fusion() };
  M.acceptedMuted = { id: 4823, status: 'accepted', fraud_probability: 0.432, top_reason: 'Elevated risk from combined signals',
    feature_importances: { photo_quality: 0.58, motion_consistency: 0.24, ambient_fingerprint: 0.18 }, fusion: MUTED() };
  M.acceptedMutedNotes = ['GPS unavailable or denied', 'no motion samples (sensor unavailable or denied)', 'network info unavailable in this browser'];
  M.acceptedAmber = { id: 4822, status: 'accepted', fraud_probability: 0.187, top_reason: 'No issues detected',
    feature_importances: { photo_quality: 0.41, motion_consistency: 0.34, ambient_fingerprint: 0.25 },
    fusion: fusion({ motion: { score: 0.88, evidence: { site: site(138, { end_inside: false, end_outside: false, end_acc_m: 24 }) } } }) };
  M.acceptedNoSite = { id: 4824, status: 'accepted', fraud_probability: 0.121, top_reason: 'No issues detected',
    feature_importances: { photo_quality: 0.44, motion_consistency: 0.33, ambient_fingerprint: 0.23 },
    fusion: (function () { var f = fusion(); f.site = null; f.motion.evidence.site = null; return f; })() };
  M.flaggedOutside = { id: 4830, status: 'flagged', fraud_probability: 0.718, top_reason: 'GPS jumped 3.4 km in 4 s while the phone stayed still',
    feature_importances: { photo_quality: 0.17, motion_consistency: 0.61, ambient_fingerprint: 0.22 },
    fusion: fusion({
      site: { radius_m: 100 },
      motion: { score: 0.22, reason: 'GPS jumped 3.4 km in 4 s while the phone stayed still',
        evidence: { fixes: 52, reliable_fixes: 44, duration_s: 131, distance_m: 3860, windows: 26, windows_with_data: 25, rows: rows({ still: 14, walking: 9, moving: 2 }),
          jumps: [{ dist_m: 3400, dt_s: 4 }], site: site(412, { radius_m: 100, end_inside: false, end_outside: true, end_acc_m: 11 }) } },
      sensors: { hidden_s: 14, hidden_count: 2, watch_restarts: 1 }
    }) };
  M.flaggedNetwork = { id: 4831, status: 'flagged', fraud_probability: 0.644, top_reason: 'The request comes from a hosting/VPN network (Hetzner Online GmbH)',
    feature_importances: { photo_quality: 0.19, motion_consistency: 0.12, ambient_fingerprint: 0.69 },
    fusion: fusion({
      environment: { score: 0.18, reason: 'The request comes from a hosting/VPN network (Hetzner Online GmbH)', components: [{ id: 'hosting', status: 'hosting_or_vpn', detail: 'Hetzner Online GmbH' }, { id: 'ip_location', status: 'other_country', detail: 'DE vs site IN' }] },
      ip: { country: 'DE', region: 'Saxony', city: 'Falkenstein', org: 'Hetzner Online GmbH', private: false }
    }) };
  M.flaggedMotion = { id: 4832, status: 'flagged', fraud_probability: 0.571, top_reason: 'GPS says the phone was moving for 14 windows but its sensors showed it still in 86% of them',
    feature_importances: { photo_quality: 0.21, motion_consistency: 0.55, ambient_fingerprint: 0.24 },
    fusion: fusion({
      motion: { score: 0.31, reason: 'GPS says the phone was moving for 14 windows but its sensors showed it still in 86% of them',
        evidence: { fixes: 58, reliable_fixes: 55, duration_s: 140, distance_m: 910, windows: 28, windows_with_data: 28, rows: rows({ still: 24, walking: 3, moving: 1 }) } }
    }) };
  M.flaggedNoGps = { id: 4833, status: 'flagged', fraud_probability: 0.538, top_reason: 'Photo quality problem: blurry, glare',
    feature_importances: { photo_quality: 0.57, motion_consistency: 0.18, ambient_fingerprint: 0.25 },
    fusion: fusion({
      motion: { known: false, sensor_used: false, score: 0.5, evidence: { fixes: 0, reliable_fixes: 0, duration_s: 0, distance_m: 0, windows: 6, windows_with_data: 0, rows: [], jumps: [], site: null } }
    }) };
  M.flaggedNoGpsNotes = ['GPS unavailable or denied'];
  M.noFusionAccepted = { id: 4840, status: 'accepted', fraud_probability: 0.081, top_reason: 'No issues detected',
    feature_importances: { photo_quality: 0.5, motion_consistency: 0.27, ambient_fingerprint: 0.23 } };
  M.noFusionFlagged = { id: 4841, status: 'flagged', fraud_probability: 0.664, top_reason: 'Phone movement does not match the GPS trail',
    feature_importances: { photo_quality: 0.2, motion_consistency: 0.52, ambient_fingerprint: 0.28 } };
  M.stress = { id: '9f3c2a71-6b4e-4d0a-8c15-2e7d1b90a4f3', status: 'flagged', fraud_probability: 0.973,
    top_reason: 'The request comes from a hosting/VPN network (Digital Ocean Cloud Hosting Services Private Limited, Frankfurt am Main data centre) and GPS jumped 3.4 km in 4 s while the phone stayed still',
    feature_importances: { photo_quality: 0.0, motion_consistency: 0.5, ambient_fingerprint: 0.5 },
    fusion: fusion({
      site: { radius_m: 1500 },
      motion: { score: 0.1, reason: 'GPS jumped 3.4 km in 4 s while the phone stayed still', evidence: { fixes: 1204, reliable_fixes: 1100, duration_s: 600, distance_m: 41200, windows: 120, windows_with_data: 119, rows: rows({ still: 40, walking: 40, moving: 39 }), jumps: [{}, {}, {}], site: site(2400, { radius_m: 1500, end_inside: false, end_outside: true, end_acc_m: 14 }) } },
      environment: { score: 0.1, reason: 'The request comes from a hosting/VPN network (Digital Ocean Cloud Hosting Services Private Limited, Frankfurt am Main data centre)', components: [{ id: 'ip_location', status: 'other_country', detail: 'DE vs site IN' }] },
      ip: { country: 'DE', region: 'Hesse', city: 'Frankfurt am Main', org: 'Digital Ocean Cloud Hosting Services Private Limited', private: false },
      sensors: { hidden_s: 125, hidden_count: 7, watch_restarts: 3 }
    }) };
  M.stressNotes = ['GPS unavailable or denied', 'no motion samples (sensor unavailable or denied)', 'network info unavailable in this browser', 'the screen was off for most of the visit'];
  V.M = M;

  window.CAP_V = V;
})();
