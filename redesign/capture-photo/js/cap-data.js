/* Capture · Photo step prototype: strings, mock data and the small models behind the screens.
   Every user-facing string that exists in today's Photo step is copied from the React source (see ../README.md for the file list).
   Anything marked MOCK is invented for the prototype (values and example reasons only, never labels). */
(function () {
  var D = {};

  /* ---------- Tasks (C3, C4, F1 caption, I1 caption) ---------- */
  D.TASKS = {
    shelf: { id: 'task_demo_1', label: 'Shelf / site photo', face: 'off', camera: 'environment', live: false },
    selfie: { id: 'task_selfie_checkin', label: 'Selfie check-in', face: 'required', camera: 'user', live: true },
    worker: { id: 'task_worker_at_site', label: 'Worker at site (face optional)', face: 'optional', camera: 'environment', live: false }
  };
  D.TASK_ORDER = ['shelf', 'selfie', 'worker'];
  D.FACE_NOTE = {
    required: 'This task needs a clear photo of your face and a short live check (blink, turn your head, smile or open your mouth). They are used only to verify this submission.',
    optional: 'A face is optional for this task.'
  };
  D.WORKER_ID = 'worker_demo_1';
  D.SITE_ID = 'site_demo_1';
  D.STEPS = ['Photo', 'Arrival', 'AI scan', 'Verdict'];

  /* ---------- Shell (A) ---------- */
  D.STATUS = {
    connecting: { label: 'CONNECTING', tone: 'warn' },
    online: { label: 'SYSTEM ONLINE', tone: 'pass' },
    offline: { label: 'BACKEND OFFLINE', tone: 'fail' }
  };
  D.IPDB = {
    missing: { label: 'IP database missing', detail: 'MOCK: the IP geolocation database file was not found on the server, so network checks that use it are skipped.' },
    stale: { label: 'IP database out of date', detail: 'MOCK: the IP geolocation database is older than 45 days; country checks may be wrong.' }
  };
  D.DBIP = { url: 'https://db-ip.com', text: 'IP Geolocation by DB-IP' };

  /* ---------- Visit recording (D) ---------- */
  D.CONSENT_TITLE = 'Record my approach to the site';
  D.CONSENT_SHORT = 'Your location and phone movement are recorded for up to 10 minutes and sent with your submission. Optional.';
  D.CONSENT_NETWORK = 'We also use your network connection details (your internet provider and approximate location from your IP address, and connection speed) to check that you are where you say you are. We store a shortened IP address for 30 days.';
  D.CONSENT_TEXT = "While this page is open, the app records your phone's location and movement (accelerometer and gyroscope summaries) for up to 10 minutes, and sends them with your submission to check that the visit is genuine. Location points are deleted after the retention period; scores and flags are kept. You can use the app without this, but the submission may be sent for review. " + D.CONSENT_NETWORK;
  D.NOTES = {
    motionDenied: 'Motion access was denied, so only the location is recorded.',
    motionAbsent: 'This device has no motion sensor, so only the location is recorded.',
    geoDenied: 'Location access was denied, so no trail can be recorded.',
    server: 'Could not reach the server to open the visit. The trail is still recorded, but it cannot be checked against the server clock.'
  };
  D.SCENARIOS = [['normal_walk', 'Normal walk to the site'], ['stationary', 'Standing still'], ['vehicle', 'Arrived by vehicle'], ['indoor_gps_loss', 'Indoors, GPS drops']]; /* MOCK options */

  /* ---------- Camera + banners (E, F, G, I) ---------- */
  D.CAMERA_NOTE = {
    denied: 'Camera permission was denied. ',
    unavailable: 'The live camera is not available here. ',
    live: 'You can still pick a photo, but it will be flagged for review.',
    other: 'Use the photo picker instead.'
  };
  D.CHIP_LABELS = { lens: 'Lens', light: 'Light', face: 'Face', steady: 'Steady', focus: 'Focus', glare: 'Glare' };
  D.CHIP_ORDER = ['lens', 'light', 'face', 'steady', 'focus', 'glare'];
  D.PROMPTS = { blink: 'Blink', turn_left: 'Turn your head left', turn_right: 'Turn your head right', smile: 'Smile', open_mouth: 'Open your mouth' };
  D.LIVE_MAX_ATTEMPTS = 3;
  D.LIVE_TIMEOUT_S = 4;

  /* ---------- Live quality (H) ---------- */
  D.HUD_ORDER = ['brightness', 'focus', 'lens', 'glare', 'steady', 'noise', 'resolution', 'face', 'liveness'];
  D.HUD_LABELS = { brightness: 'Brightness', focus: 'Focus', lens: 'Lens', glare: 'Glare', steady: 'Steadiness', noise: 'Noise', resolution: 'Resolution', face: 'Face', liveness: 'Liveness' };
  /* a row: { display, pct, status, reason, ticks:{warn,fail} (pct where the status changes), position:bool } */
  var GOOD = {
    brightness: { display: '58%', pct: 58, status: 'pass', position: true, ticks: { lo: 30, hi: 82 }, reason: null },
    focus: { display: 'Focus 82%', pct: 82, status: 'pass', ticks: { warn: 45, fail: 30 }, reason: null },
    lens: { display: 'clear', pct: 100, status: 'pass', ticks: { warn: 70, fail: 40 }, reason: null },
    glare: { display: '1%', pct: 97, status: 'pass', ticks: { warn: 70, fail: 40 }, reason: null },
    steady: { display: 'steady', pct: 91, status: 'pass', ticks: { warn: 60, fail: 35 }, reason: null },
    noise: { display: 'low', pct: 86, status: 'pass', ticks: { warn: 55, fail: 30 }, reason: null },
    resolution: { display: '1920×1440', pct: 100, status: 'pass', ticks: { warn: 60, fail: 30 }, reason: null }
  };
  /* what is wrong in the "not ready" state (MOCK numbers; labels and statuses are the real vocabulary) */
  D.PROBLEMS = {
    dark: {
      hint: 'Too dark. Move to a brighter spot.',
      rows: {
        brightness: { display: '21%', pct: 21, status: 'fail', position: true, ticks: { lo: 30, hi: 82 }, reason: 'Too dark. Move to a brighter spot.' },
        focus: { display: 'Focus 38%', pct: 38, status: 'warn', ticks: { warn: 45, fail: 30 }, reason: 'A little soft. Hold still and tap the screen to focus.' },
        steady: { display: 'moving', pct: 52, status: 'warn', ticks: { warn: 60, fail: 35 }, reason: 'Hold the phone with both hands.' },
        noise: { display: 'high', pct: 34, status: 'warn', ticks: { warn: 55, fail: 30 }, reason: 'Grainy because of low light.' }
      },
      scene: { dark: true }
    },
    blur: {
      hint: 'Too blurry. Hold still.',
      rows: {
        focus: { display: 'Focus 19%', pct: 19, status: 'fail', ticks: { warn: 45, fail: 30 }, reason: 'Blurry. Hold still and tap the screen to focus.' },
        steady: { display: 'shaky', pct: 27, status: 'fail', ticks: { warn: 60, fail: 35 }, reason: 'The phone is moving too much.' }
      },
      scene: { blur: true, shaky: true }
    },
    glare: {
      hint: 'Glare on the shelf. Tilt the phone.',
      rows: {
        glare: { display: '17%', pct: 44, status: 'warn', ticks: { warn: 70, fail: 40 }, reason: 'A bright reflection covers part of the frame.' },
        brightness: { display: '88%', pct: 88, status: 'warn', position: true, ticks: { lo: 30, hi: 82 }, reason: 'A little too bright.' }
      },
      scene: { glare: true }
    }
  };
  D.LIVENESS_ROW = {
    idle: { display: 'waiting for face', pct: 0, status: null, reason: 'Position your face in the frame' },
    wait: { display: 'waiting', pct: 0, status: null, reason: 'Look at the camera' },
    passed: { display: 'passed', pct: 100, status: 'pass', reason: null },
    spoof: { display: 'passed · screen?', pct: 50, status: 'warn', reason: 'The picture looks like it may show a screen or a print' },
    review: { display: 'review', pct: 30, status: 'warn', reason: 'The live check could not be completed' },
    failed: { display: 'failed', pct: 0, status: 'fail', reason: null },
    expired: { display: 'expired', pct: 30, status: 'warn', reason: 'Do the live check again' }
  };
  D.OVERALL_N = 20;
  D.ROW_N = 10;

  /** Build the HUD model from the state (rows in order, overall, chips, top hint). */
  D.hudModel = function (S) {
    var task = D.TASKS[S.task];
    var rows = {};
    Object.keys(GOOD).forEach(function (k) { rows[k] = Object.assign({}, GOOD[k]); });
    var prob = S.quality === 'notready' ? D.PROBLEMS[S.problem || 'dark'] : null;
    if (prob) Object.keys(prob.rows).forEach(function (k) { rows[k] = Object.assign({}, prob.rows[k]); });
    // face row
    if (task.face === 'off') rows.face = { display: 'off', pct: 0, status: null, reason: null };
    else if (S.faceFound === false) rows.face = { display: 'not found', pct: 0, status: 'fail', ticks: { warn: 70, fail: 40 }, reason: 'Position your face in the frame' };
    else rows.face = { display: '92% · 38%', pct: 92, status: 'pass', ticks: { warn: 70, fail: 40 }, reason: null };
    // liveness row (face tasks only)
    if (task.face !== 'off') {
      var L = S.liveness;
      var lr;
      if (task.face === 'optional') lr = { display: 'not checked', pct: 0, status: null, reason: null };
      else if (L.phase === 'passed') lr = D.LIVENESS_ROW[S.spoof ? 'spoof' : 'passed'];
      else if (L.phase === 'review') lr = D.LIVENESS_ROW.review;
      else if (L.phase === 'failed') lr = Object.assign({}, D.LIVENESS_ROW.failed, { reason: L.reason });
      else if (L.phase === 'expired') lr = D.LIVENESS_ROW.expired;
      else if (L.phase === 'running' || L.phase === 'active' || L.phase === 'facelost') lr = { display: L.promptShort + ' ' + L.secs + 's', pct: 0, status: null, reason: D.PROMPTS[L.challenge] };
      else if (L.phase === 'wait') lr = D.LIVENESS_ROW.wait;
      else lr = D.LIVENESS_ROW.idle;
      rows.liveness = Object.assign({ ticks: { warn: 60, fail: 30 } }, lr);
    }
    var order = D.HUD_ORDER.filter(function (id) { return id !== 'liveness' || task.face !== 'off'; });
    var list = order.map(function (id) {
      var r = rows[id];
      return Object.assign({ id: id, label: D.HUD_LABELS[id], score: r.status ? r.pct : null, muted: !r.status && r.pct === 0 && !/^\d|^Focus|clear|steady|low|^\d/.test(r.display) }, r);
    });
    // a row with no status yet is muted ("no score yet")
    list.forEach(function (r) { r.muted = !r.status; r.status = r.status || 'pass'; r.noScore = r.muted; });
    var scored = list.filter(function (r) { return !r.noScore; });
    var overall = scored.length ? Math.round(scored.reduce(function (a, r) { return a + r.pct; }, 0) / scored.length) : null;
    if (S.hudEmpty) { list.forEach(function (r) { r.muted = true; r.noScore = true; r.display = '—'; r.reason = null; r.pct = 0; }); overall = null; }
    var overallStatus = overall == null ? 'pass' : overall >= 75 ? 'pass' : overall >= 50 ? 'warn' : 'fail';
    // compact chips: pass / warn / fail per check
    var chipMap = {
      lens: rows.lens.status,
      light: rows.brightness.status,
      face: task.face === 'off' ? null : (rows.face.status || 'warn'),
      steady: rows.steady.status,
      focus: rows.focus.status,
      glare: rows.glare.status
    };
    var chips = D.CHIP_ORDER.filter(function (k) { return chipMap[k]; }).map(function (k) { return { id: k, label: D.CHIP_LABELS[k], status: chipMap[k] }; });
    return { rows: list, overall: overall, overallStatus: overallStatus, chips: chips, hint: prob ? prob.hint : null, scene: prob ? prob.scene : {} };
  };

  /* ---------- Photo result (J) ---------- */
  D.TITLES = { pass: 'Photo verified', warn: 'Photo accepted with warnings', block: 'Photo needs a retake' };
  D.CHECK_LABELS = { obstruction: 'Lens', resolution: 'Resolution', exposure: 'Lighting', blur: 'Focus', face: 'Face', liveness: 'Liveness', glare: 'Glare', shake: 'Steadiness', noise: 'Noise / compression' };
  D.CHECK_ORDER = ['obstruction', 'resolution', 'exposure', 'blur', 'face', 'liveness', 'glare', 'shake', 'noise'];
  D.ARRIVAL_HINT = 'Photo checked. When you are standing at the site, tap the button: we then send your GPS location{AND} and verify you reached it.';
  D.ARRIVAL_AND = ' and the movement recorded on the way';
  D.ARRIVAL_NOREC = ' (Without the visit recording only your location can be checked.)';
  D.TERMINAL = function (needsFace) { return '> Checking focus, lighting, lens' + (needsFace ? ', face' : '') + ' on-device…'; };

  function pass(id, value) { return { id: id, status: 'pass', blocking: false, value: value, hint: null, numbers: null }; }
  /** The mock report for a verdict. Values, hints and numbers are MOCK; labels, titles and structure are real. */
  D.report = function (verdict, taskKey) {
    var task = D.TASKS[taskKey];
    var f = task.face;
    var c = {
      obstruction: pass('obstruction', 'clear'),
      resolution: pass('resolution', '1920×1440'),
      exposure: pass('exposure', 'Brightness 58%'),
      blur: pass('blur', 'Focus 82%'),
      face: f === 'off' ? null : pass('face', '92% · 38%'),
      liveness: f === 'required' ? pass('liveness', 'passed') : null,
      glare: pass('glare', '1%'),
      shake: pass('shake', 'steady'),
      noise: pass('noise', 'low')
    };
    var score = 92;
    var boxes = f === 'off' ? [] : [{ x0: 0.35, y0: 0.2, x1: 0.65, y1: 0.76, label: 'face', tone: 'ok' }];
    if (verdict === 'warn') {
      score = 71;
      c.glare = { id: 'glare', status: 'warn', blocking: false, value: '14%', hint: 'A reflection covers part of the photo. Tilt the phone and retake if you can.', numbers: 'Glare 14% of the frame — must stay under 8%' };
      c.exposure = { id: 'exposure', status: 'warn', blocking: false, value: 'Brightness 86%', hint: 'The photo is a little too bright.', numbers: 'Brightness 86% — must stay under 82%' };
      boxes.push({ x0: 0.08, y0: 0.14, x1: 0.34, y1: 0.46, label: 'glare', tone: 'warn' });
    } else if (verdict === 'block') {
      score = 38;
      c.blur = { id: 'blur', status: 'fail', blocking: true, value: 'Focus 19%', hint: 'The photo is blurry. Hold still, tap the screen to focus and retake.', numbers: 'Focus 19% — needs at least 31%' };
      c.obstruction = { id: 'obstruction', status: 'fail', blocking: true, value: 'covered', hint: 'Something is covering part of the lens. Wipe the lens and keep your fingers clear.', numbers: '17% of the frame is covered — must stay under 10%' };
      c.exposure = { id: 'exposure', status: 'warn', blocking: false, value: 'Brightness 24%', hint: 'The photo is dark. Find more light.', numbers: 'Brightness 24% — needs at least 30%' };
      c.shake = { id: 'shake', status: 'warn', blocking: false, value: 'moving', hint: 'The phone moved while the photo was taken.', numbers: 'Movement 0.42 — must stay under 0.30' };
      if (c.face) c.face = { id: 'face', status: 'fail', blocking: true, value: '41% · 22%', hint: 'Your face is too small or too far away. Move closer.', numbers: 'face is 22% of the frame height — needs at least 30%' };
      boxes = [{ x0: 0.6, y0: 0.52, x1: 0.96, y1: 0.96, label: 'covered?', tone: 'bad' }];
      if (f !== 'off') boxes.push({ x0: 0.38, y0: 0.3, x1: 0.62, y1: 0.7, label: 'face', tone: 'bad' });
    }
    var rows = D.CHECK_ORDER.map(function (id) { var r = c[id]; if (!r) return null; r.label = D.CHECK_LABELS[id]; return r; }).filter(Boolean);
    return { verdict: verdict, score: score, rows: rows, blockers: rows.filter(function (r) { return r.blocking; }), boxes: boxes, width: 1920, height: 1440 };
  };
  D.DEBUG_LINES = [
    'blur 0.214 [fail < 0.31, warn < 0.45] · tiles 0.12 0.18 0.22 0.19 0.31 0.27 · textured 5',
    'face 0.92 conf · height 0.38 · crop blur 0.402 on 412×412 px [fail < 0.20, warn < 0.30]',
    'verdict {V} · blocking {B}'
  ]; /* MOCK numbers */

  /* ---------- Sensor feed (K) ---------- */
  D.FEED_TABS = [['gps', 'GPS'], ['motion', 'Motion'], ['session', 'Session'], ['network', 'Network'], ['trail', 'Trail'], ['na', 'Not available']];
  D.NOT_AVAILABLE = [
    { id: 'wifi', label: 'WiFi networks nearby', reason: 'browsers do not expose WiFi names; only a native app can read them' },
    { id: 'cell', label: 'Cell towers', reason: 'browsers do not expose cell tower IDs; only a native app can read them' },
    { id: 'mock', label: 'Android "mock location" flag', reason: 'only native Android code can see it; the web page infers a fake from the GPS trail instead' },
    { id: 'background', label: 'Data while the screen is off', reason: 'a web page is paused when hidden; time hidden is counted and sent instead' },
    { id: 'activity_api', label: 'Android activity recognition', reason: 'a native-only API; activity here is computed from the accelerometer and gyroscope' }
  ];
  D.NATIVE_NOTE = "Inside the app the backend address must be set: enter the laptop's address under Server below.";
  D.STATE_WORD = { granted: 'allowed', denied: 'denied', prompt: 'not asked yet', absent: 'no sensor', null_events: 'no sensor (empty events)', waiting: 'waiting for data' };
  D.SOURCE_WORD = { url: 'from ?api=', saved: 'saved on this device', build: 'set at build time', default: 'default' };
  D.NEXT_RESULT_LABELS = { pass: 'Pass', warn: 'Warn', block: 'Blocked' };

  /** Live feed values from the state (MOCK numbers, ticking ones come from S.clock seconds). */
  D.feedModel = function (S) {
    var r = S.rec, running = r.running, t = S.clock || 0;
    var empty = running && S.feed.empty;
    var has = running && !empty;
    var geoWord = !running ? null : S.visit.geo === 'denied' ? 'denied' : empty ? 'waiting for data' : 'granted';
    var motionWord = !running ? null : S.visit.motion === 'denied' ? 'denied' : S.visit.motion === 'absent' ? 'absent' : empty ? 'waiting for data' : 'granted';
    var ago = has ? (S.feed.stale ? 22 + (t % 5) : 2 + (t % 4)) : null;
    var moving = has && S.visit.motion === 'granted';
    var net = S.shell === 'offline' ? null : { type: '4g', downlink: '10 Mbps', rtt: '50 ms' };
    var activities = [];
    if (moving) { var seq = ['still','still','still','walking','walking','walking','walking','moving','walking','walking','walking','still','walking','walking','walking','walking','moving','moving','walking','walking','walking','walking','still','walking']; activities = seq; }
    return {
      running: running, empty: empty,
      gps: {
        state: geoWord,
        lat: has ? '12.97164' : null, lng: has ? '77.59462' : null,
        accuracy: has ? '±12 m' : null, speed: has ? '1.3 m/s' : null, heading: has ? '84°' : null, altitude: has ? '912 m' : null,
        fixes: has ? String(14 + Math.floor(t / 3)) : (empty ? '0' : null), ago: ago, distance: has ? (186 + t) + ' m' : null
      },
      motion: {
        state: motionWord,
        acc: moving ? '9.84 m/s²' : null, gyro: moving ? '0.12 rad/s' : null, rate: moving ? '58 Hz' : null, windows: moving ? String(7 + Math.floor(t / 5)) : (empty ? '0' : null),
        now: moving ? 'walking' : null, rhythm: moving ? '1.8 steps/s' : null, activities: activities
      },
      session: {
        visit: running ? (S.visit.serverDown || S.shell === 'offline' ? 'not opened' : 'v_8f31c2') : null,
        offset: running && !S.visit.serverDown && S.shell !== 'offline' ? '+120 ms' : null,
        recordingS: running ? (38 + t) : null,
        wake: running ? (S.feed.noWake ? 'not held' : 'held') : null,
        hiddenS: running ? (S.feed.hidden ? 6 : 0) : 0, hiddenN: running ? (S.feed.hidden ? 1 : 0) : 0,
        restarts: running ? (S.feed.hidden ? 1 : 0) : null,
        geoPerm: S.visit.geo === 'denied' ? 'denied' : running ? 'granted' : 'prompt',
        camPerm: S.camNote === 'denied' ? 'denied' : S.camNote === 'unavailable' ? 'absent' : 'granted'
      },
      network: net,
      trail: has ? { span: 240, siteText: 'registered, radius 80 m' } : { span: 0, siteText: running ? 'registered, radius 80 m' : 'not registered' }
    };
  };

  /** A believable GPS trail for the SVG (approach to the site circle). */
  D.TRAIL = { w: 320, h: 180, site: { c: [236, 92], r: 34 }, path: 'M 24 150 C 52 138, 70 130, 98 120 S 150 108, 172 96 S 214 86, 232 90', start: [24, 150], end: [232, 90] };

  /* ---------- Mock scenes (flat SVG, no gradients) ---------- */
  function box(x, y, w, h, c, label) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="' + c + '"/>' + (label ? '<rect x="' + (x + 8) + '" y="' + (y + h * 0.4) + '" width="' + (w - 16) + '" height="' + h * 0.26 + '" rx="2" fill="rgba(255,255,255,.82)"/>' : '');
  }
  D.sceneShelf = function () {
    var s = '<svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Camera preview">';
    s += '<rect width="800" height="600" fill="#2c3340"/><rect y="520" width="800" height="80" fill="#1f242d"/>';
    s += '<rect x="40" y="40" width="720" height="470" fill="#232a36"/>';
    var colors = ['#c9533e', '#3e7cc9', '#e0b341', '#4aa57a', '#8a6fd1', '#d9d4c7', '#c9533e', '#3e7cc9'];
    [[140, 'a'], [300, 'b'], [460, 'c']].forEach(function (row, ri) {
      var y = row[0];
      s += '<rect x="40" y="' + (y + 58) + '" width="720" height="12" fill="#7a6650"/>';
      var x = 62;
      for (var i = 0; i < 8; i++) {
        var w = 62 + ((i * 17 + ri * 11) % 28), h = 78 + ((i * 13 + ri * 7) % 36);
        s += box(x, y + 58 - h, w, h, colors[(i + ri * 3) % colors.length], true);
        x += w + 20;
      }
    });
    return s + '</svg>';
  };
  D.sceneFace = function (k) {
    k = k || 1;
    var s = '<svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Camera preview">';
    s += '<rect width="800" height="600" fill="#39453f"/><rect y="430" width="800" height="170" fill="#2d3731"/>';
    s += '<g transform="translate(400 300) scale(' + k + ') translate(-400 -300)">';
    s += '<path d="M120 600 C140 470 260 440 400 440 C540 440 660 470 680 600 Z" fill="#3b5aa8"/>';
    s += '<rect x="360" y="380" width="80" height="90" rx="20" fill="#c98f6a"/>';
    s += '<ellipse cx="400" cy="270" rx="118" ry="148" fill="#d9a47e"/>';
    s += '<path d="M280 250 C280 130 340 110 400 110 C470 110 520 140 520 250 C500 190 470 170 400 168 C330 170 300 195 280 250 Z" fill="#2a2321"/>';
    s += '<ellipse cx="355" cy="255" rx="16" ry="9" fill="#fff"/><ellipse cx="445" cy="255" rx="16" ry="9" fill="#fff"/><circle cx="355" cy="256" r="6" fill="#2a2321"/><circle cx="445" cy="256" r="6" fill="#2a2321"/>';
    s += '<path d="M330 228 Q355 214 380 226 M420 226 Q445 214 470 228" stroke="#2a2321" stroke-width="6" fill="none" stroke-linecap="round"/>';
    s += '<path d="M400 262 L392 312 Q400 320 412 312" stroke="#b27b59" stroke-width="5" fill="none" stroke-linecap="round"/>';
    s += '<path d="M358 354 Q400 378 442 354" stroke="#8c4a44" stroke-width="7" fill="none" stroke-linecap="round"/>';
    return s + '</g></svg>';
  };
  /** Face mesh: dots + lines in a 0..100 box, built from a few landmark groups. */
  D.faceMesh = function () {
    var groups = [], pts = [];
    function ring(cx, cy, rx, ry, n, a0, a1, close) { var g = []; for (var i = 0; i < n; i++) { var a = a0 + (a1 - a0) * (i / (close ? n : n - 1)); g.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } groups.push({ g: g, close: !!close }); }
    ring(50, 46, 44, 50, 17, 0.12 * Math.PI, 0.88 * Math.PI);             // jaw
    ring(50, 40, 44, 46, 13, 1.04 * Math.PI, 1.96 * Math.PI);             // forehead arc
    ring(33, 38, 11, 6, 8, 0, 2 * Math.PI, true); ring(67, 38, 11, 6, 8, 0, 2 * Math.PI, true); // eyes
    ring(33, 29, 12, 4, 5, 1.1 * Math.PI, 1.9 * Math.PI); ring(67, 29, 12, 4, 5, 1.1 * Math.PI, 1.9 * Math.PI); // brows
    groups.push({ g: [[50, 36], [49, 46], [48, 55], [44, 62], [50, 64], [56, 62]], close: false }); // nose
    ring(50, 76, 17, 7, 12, 0, 2 * Math.PI, true); ring(50, 76, 10, 3, 8, 0, 2 * Math.PI, true); // mouth
    var svg = '<svg class="cap-mesh__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">';
    groups.forEach(function (o) { var g = o.g; for (var i = 0; i < g.length - 1; i++) svg += '<line x1="' + g[i][0].toFixed(1) + '" y1="' + g[i][1].toFixed(1) + '" x2="' + g[i + 1][0].toFixed(1) + '" y2="' + g[i + 1][1].toFixed(1) + '"/>'; if (o.close) svg += '<line x1="' + g[g.length - 1][0].toFixed(1) + '" y1="' + g[g.length - 1][1].toFixed(1) + '" x2="' + g[0][0].toFixed(1) + '" y2="' + g[0][1].toFixed(1) + '"/>'; });
    groups.forEach(function (o) { o.g.forEach(function (p) { svg += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="0.9"/>'; }); });
    return svg + '</svg>';
  };

  window.CAP_DATA = D;
})();
