/* Detail layer for the mock data: everything the existing app's sections need beyond the basic submission fields.
   Photo checks (server vs device), live check, EXIF, sensor-fusion report, feature importances, review reasons and history,
   site radius/country/label, learned network profile and the site change log. Deterministic (seeded). */
(function () {
  'use strict';
  var D = window.TL_DATA;

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(90210);
  function between(a, b) { return a + rnd() * (b - a); }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }

  /* ---------- Flags: label, kind (quality / integrity / info), help, and whether sensor fusion owns it ---------- */
  var FLAG_META = {
    'Blurry': { kind: 'quality', help: 'Out of focus or soft.' },
    'Lighting': { kind: 'quality', help: 'Too dark, over-exposed or washed out.' },
    'Face not clear': { kind: 'quality', help: 'Face missing, cut off, too small, blurred, in shadow or hidden.' },
    'Glare': { kind: 'quality', help: 'Reflection or bright source blowing out part of the photo.' },
    'Submitted anyway': { kind: 'info', help: 'The worker overrode a quality warning.' },
    'Duplicate photo': { kind: 'integrity', help: 'The identical photo was submitted by another worker, task or site.' },
    'Spoof suspected': { kind: 'integrity', help: 'The photo looks like a picture of a screen or a print.' },
    'Liveness not verified': { kind: 'integrity', help: 'The live check (a random blink or head turn) was not completed or failed.' },
    'Device report mismatch': { kind: 'integrity', help: 'The device said the photo was fine; the server measured otherwise.' },
    'No EXIF': { kind: 'info', help: 'No camera metadata: a screenshot, edited or forwarded copy.' },
    'GPS jump': { kind: 'integrity', fusion: true, help: 'The location trail jumps between places too fast to be real.' },
    'Motion mismatch': { kind: 'integrity', fusion: true, help: 'GPS says the phone was moving, but its motion sensors say it stayed still.' },
    'Outside site area': { kind: 'integrity', fusion: true, help: 'The photo was taken outside the site’s radius.' },
    'Unusual network': { kind: 'integrity', fusion: true, help: 'The network does not match what is normally seen at this site.' },
    'Clock mismatch': { kind: 'integrity', fusion: true, help: 'The phone clock is several minutes away from server time.' },
  };
  function flagMeta(f) { return FLAG_META[f] || { kind: 'info', help: '' }; }
  var REASON_FLAG = { screen: 'Spoof suspected', face: 'Liveness not verified', jump: 'GPS jump', still: 'Motion mismatch', net: 'Unusual network', clock: 'Clock mismatch', gps_far: 'Outside site area' };

  /* ---------- Photo checks (server value + status, device status) ---------- */
  var CHECKS = [
    { id: 'blur', label: 'Focus', flag: 'Blurry', hint: 'Sharpness of the whole frame.' },
    { id: 'exposure', label: 'Lighting', flag: 'Lighting', hint: 'Too dark, over-exposed or washed out.' },
    { id: 'glare', label: 'Glare', flag: 'Glare', hint: 'Bright reflection covering part of the photo.' },
    { id: 'obstruction', label: 'Lens clear', flag: null, hint: 'Finger, cloth or dirt over the lens.' },
    { id: 'resolution', label: 'Resolution', flag: null, hint: 'Enough pixels to be useful.' },
    { id: 'noise', label: 'Noise', flag: null, hint: 'Grain from low light or heavy compression.' },
    { id: 'shake', label: 'Camera shake', flag: null, hint: 'Directional blur from movement.' },
    { id: 'face', label: 'Face', flag: 'Face not clear', hint: 'Face found, large enough and clear.', selfieOnly: true },
    { id: 'liveness', label: 'Live check', flag: 'Liveness not verified', hint: 'The random blink or head-turn challenge.', selfieOnly: true },
  ];
  var CHALLENGE_WORDS = { blink: 'blink', turn_left: 'turn head left', turn_right: 'turn head right', smile: 'smile' };

  function scoreWord(score) {
    if (score >= 0.7) return { word: 'Consistent', tone: 'ok' };
    if (score >= 0.4) return { word: 'Unclear', tone: 'warn' };
    return { word: 'Does not match', tone: 'bad' };
  }

  function decorate(row) {
    var site = D.siteById[row.site_id], selfie = row.task === D.tasks[1], rk = row.reason_key, p = row.fraud_probability;
    row.task_id = selfie ? 'task_demo_2' : 'task_demo_1';

    // Flags owned by the reason (photo and sensor fusion)
    if (REASON_FLAG[rk] && row.quality_flags.indexOf(REASON_FLAG[rk]) < 0) row.quality_flags.push(REASON_FLAG[rk]);
    if (rk === 'ok' && rnd() < 0.08) row.quality_flags.push('No EXIF');
    var poor = row.photo_verdict === 'poor';
    row.client_mismatch = (poor && rnd() < 0.5) || (rk === 'screen' && rnd() < 0.5);
    if (row.client_mismatch && row.quality_flags.indexOf('Device report mismatch') < 0) row.quality_flags.push('Device report mismatch');
    row.photo_override = row.quality_flags.indexOf('Submitted anyway') >= 0;
    row.photo_quality_score = row.photo_verdict === 'unverified' ? null :
      +(row.photo_verdict === 'Photo OK' ? between(0.74, 0.96) : row.photo_verdict === 'warning' ? between(0.46, 0.66) : between(0.16, 0.4)).toFixed(2);

    // Why a human has to look
    row.review_reasons = row.status === 'flagged' ? ['fraud_model'].concat(poor ? ['photo_blocked'] : []) : [];

    // Average importance of the three signal groups
    var w = { photo: 0.2, motion: 0.2, ambient: 0.2 };
    if (rk === 'screen' || rk === 'dup' || rk === 'face') w.photo = 0.55;
    else if (rk === 'jump' || rk === 'still' || rk === 'gps_far') w.motion = 0.55;
    else if (rk === 'net' || rk === 'clock') w.ambient = 0.55;
    var a = w.photo + between(0, 0.15), b = w.motion + between(0, 0.15), c = w.ambient + between(0, 0.15), tot = a + b + c;
    row.feature_importances = { photo_quality: +(a / tot).toFixed(3), motion_consistency: +(b / tot).toFixed(3), ambient_fingerprint: +(c / tot).toFixed(3) };

    // Server vs device photo checks
    row.checks = {};
    CHECKS.forEach(function (ck) {
      if (ck.selfieOnly && !selfie) return;
      var has = ck.flag && row.quality_flags.indexOf(ck.flag) >= 0;
      var status = has ? (ck.id === 'liveness' || poor ? 'fail' : 'warn') : 'pass';
      if (ck.id === 'noise' && poor) status = 'warn';
      if (row.photo_verdict === 'unverified') status = 'skip';
      var client = status === 'fail' && row.client_mismatch ? 'pass' : status === 'skip' ? null : status;
      row.checks[ck.id] = { status: status, value: status === 'skip' ? null : +(status === 'pass' ? between(0.72, 0.98) : status === 'warn' ? between(0.4, 0.62) : between(0.1, 0.34)).toFixed(2), hint: ck.hint, client: client };
    });

    // Live check evidence (face tasks)
    if (selfie) {
      var failed = rk === 'face';
      row.liveness = {
        challenges: ['blink', 'turn_left'], attempts: failed ? 3 : 1,
        results: failed ? [{ id: 'blink', status: 'failed', secs: 2.1 }, { id: 'turn_left', status: 'missed', secs: 3.0 }] : [{ id: 'blink', status: 'passed', secs: 0.9 }, { id: 'turn_left', status: 'passed', secs: 1.6 }],
        replay: failed ? 'the signal timeline does not show it (no head movement)' : 'the signal timeline shows the challenges being performed',
        nonce: rk === 'dup' ? 'already used (replay)' : 'issued by the server, used once',
        passive: { status: rk === 'screen' ? 'suspect' : 'ok', score: rk === 'screen' ? 0.81 : 0.07 },
      };
    }

    // Capture metadata
    var noExif = row.quality_flags.indexOf('No EXIF') >= 0 || rk === 'screen';
    row.exif = noExif ? null : { make: pick(['Samsung', 'Xiaomi', 'Realme', 'OnePlus']), model: pick(['SM-A546E', 'Redmi Note 12', 'RMX3631', 'CPH2491']), taken_at: row.timestamp };
    row.steadiness = { rotation_rms: +between(2, 9).toFixed(1), accel_rms: +between(0.2, 1.1).toFixed(2) };

    // Sensor fusion report
    var motionBad = rk === 'jump' || rk === 'still', envBad = rk === 'net' || rk === 'clock' || rk === 'gps_far';
    var mScore = motionBad ? +between(0.06, 0.28).toFixed(2) : +between(0.8, 0.96).toFixed(2);
    var eScore = envBad ? +between(0.08, 0.3).toFixed(2) : +between(0.78, 0.95).toFixed(2);
    var cells = row.trail.map(function (pt, i) {
      var gps = pt.speed_kmh > 20 ? 'vehicle' : pt.speed_kmh >= 1 ? 'moving' : 'still';
      var act = rk === 'still' || rk === 'jump' && i >= 4 ? 'still' : 'walking';
      var mismatch = (gps === 'moving' && act === 'still') || (gps === 'vehicle' && act === 'walking') || (gps === 'still' && act === 'walking' && rk === 'still');
      return { t: i * 5, gps: gps, activity: act, mismatch: mismatch, title: (i * 5) + ' s: GPS ' + gps + ', phone ' + act + (mismatch ? ' (mismatch)' : '') };
    });
    var near = row.distance_m < 3000;
    var ipPlace = row.gps.place || site.city;
    row.fusion = {
      source: 'trail', policy: 'optional',
      motion: { score: mScore, known: true, sensor_used: true,
        reason: rk === 'jump' ? 'The location jumped 14 km in 20 seconds while the phone kept walking pace' : rk === 'still' ? 'GPS shows walking pace but the phone’s motion sensors show it stayed still' : 'GPS speed and phone movement agree along the whole approach' },
      environment: { score: eScore, known: true, profile: { visits: 14, needed: 3 },
        reason: rk === 'net' ? 'The network is not one normally seen at this site' : rk === 'gps_far' ? 'The network is in ' + ipPlace + ', far from the claimed site area' : rk === 'clock' ? 'The phone clock is 6 minutes off server time' : 'The network matches the usual profile for this site',
        components: [
          { name: 'Network speed class', status: rk === 'net' ? 'new' : 'matches', detail: row.sensors.network + (rk === 'net' ? ' (never seen here)' : ' (seen on 12 earlier visits)') },
          { name: 'IP location', status: near ? 'near the site' : 'far from the site', detail: ipPlace + (near ? ' · ' + TL_fmt(row.distance_m) + ' from the site' : ' · ' + TL_fmt(row.distance_m) + ' away') },
          { name: 'Provider', status: rk === 'net' ? 'hosting network' : 'residential / mobile', detail: rk === 'net' ? 'AS14061 DigitalOcean' : pick(['AS24560 Bharti Airtel', 'AS55836 Reliance Jio', 'AS38266 Vodafone Idea']) },
          { name: 'Phone clock', status: rk === 'clock' ? 'off' : 'in sync', detail: (row.sensors.clock_offset_s > 0 ? '+' : '') + row.sensors.clock_offset_s + ' s vs server' },
        ] },
      evidence: { fixes: row.trail.length, distance_m: Math.round(between(520, 760)), duration_s: 175, rows: cells, end_m: row.distance_m },
      ip: { city: row.gps.place ? row.gps.place.split(',')[0] : site.city, region: row.gps.place ? '' : 'Karnataka', country: row.gps.place ? (row.gps.place.indexOf('UAE') >= 0 ? 'AE' : 'SG') : 'IN', org: rk === 'net' ? 'DigitalOcean' : 'Bharti Airtel', ip: '49.' + Math.floor(between(10, 250)) + '.' + Math.floor(between(1, 250)) + '.x' },
      sensors: { geo: 'granted', motion: 'granted', gyro: true, hz_median: 50 },
      site: { radius_m: site.radius_m },
    };
    return row;
  }
  function TL_fmt(m) { return m >= 1000 ? (m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' km' : m + ' m'; }

  /* ---------- Sites: radius, country, label, learned network profile, change log ---------- */
  var SITE_EXTRA = { site_blr_01: [100, 'Retail hub'], site_blr_02: [150, 'Warehouse'], site_del_01: [80, 'Outlet'], site_gur_01: [100, 'Store'], site_mum_01: [120, 'Depot'], site_pun_01: [100, 'Store'], site_hyd_01: [100, 'Store'], site_che_01: [80, 'Outlet'], site_kol_01: [120, 'Office park'] };
  D.sites.forEach(function (s) { var e = SITE_EXTRA[s.id]; s.radius_m = e[0]; s.country = 'IN'; s.label = e[1]; });

  function profileFor(site) {
    var visits = 6 + Math.floor(between(0, 14));
    return {
      visits: visits, needed: 3,
      rows: [
        { kind: 'Speed class', key: '4g', meaning: 'Mobile data, fast', count: visits - 2, last: 'Today' },
        { kind: 'Speed class', key: 'wifi', meaning: 'Wi-Fi at the venue', count: Math.max(2, visits - 7), last: 'Yesterday' },
        { kind: 'Provider', key: 'AS24560', meaning: 'Bharti Airtel', count: visits - 3, last: 'Today' },
        { kind: 'Provider', key: 'AS55836', meaning: 'Reliance Jio', count: Math.max(1, visits - 8), last: 'Yesterday' },
      ],
    };
  }
  D.profiles = {}; D.siteChanges = {};
  D.sites.forEach(function (s) { D.profiles[s.id] = profileFor(s); D.siteChanges[s.id] = []; });
  var NOW = D.now;
  D.siteChanges.site_blr_01 = [
    { id: 3, at: new Date(NOW - 9 * 86400000).toISOString(), what: 'Radius 80 m → 100 m', network: 'Learned network kept' },
    { id: 2, at: new Date(NOW - 31 * 86400000).toISOString(), what: 'Moved 4.3 km north-east · label set to “Retail hub”', network: 'Learned network forgotten' },
    { id: 1, at: new Date(NOW - 45 * 86400000).toISOString(), what: 'Site registered', network: null },
  ];

  D.decorate = decorate;
  D.rows.forEach(decorate);

  // A few reviewed cases were decided twice: show the earlier decision in the history.
  D.rows.filter(function (r) { return r.review; }).slice(0, 3).forEach(function (r, i) {
    r.review_history = [{ decision: 'retake', reviewer: D.reviewers[(i + 1) % 3], reason: 'Photo too dark to verify. Ask for a retake in daylight.', at: new Date(new Date(r.review.at).getTime() - 3 * 3600000).toISOString() }];
  });

  D.CHECKS = CHECKS; D.FLAG_META = FLAG_META; D.flagMeta = flagMeta; D.scoreWord = scoreWord; D.CHALLENGE_WORDS = CHALLENGE_WORDS;
  D.REVIEW_WHY = { fraud_model: 'Fraud model flagged it', photo_blocked: 'Photo blocked by the server check' };
})();
