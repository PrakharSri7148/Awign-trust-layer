/* Mock data for the prototype. Deterministic (seeded) so screenshots and walkthroughs are repeatable.
   Shape follows the product's fields: id, worker_id, task, site_id, timestamp, status, fraud_probability, top_reason,
   photo_verdict, quality_flags, review, site lat/lng, GPS trail points. */
(function () {
  'use strict';

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(412);
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function between(a, b) { return a + rnd() * (b - a); }

  function haversineM(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ---------- Sites, workers, reviewers ---------- */
  var SITES = [
    { id: 'site_blr_01', name: 'Koramangala Retail Hub', city: 'Bengaluru', lat: 12.9352, lng: 77.6245 },
    { id: 'site_blr_02', name: 'Whitefield Warehouse', city: 'Bengaluru', lat: 12.9698, lng: 77.75 },
    { id: 'site_del_01', name: 'Connaught Place Outlet', city: 'New Delhi', lat: 28.6315, lng: 77.2167 },
    { id: 'site_gur_01', name: 'Cyber Hub Store', city: 'Gurugram', lat: 28.495, lng: 77.089 },
    { id: 'site_mum_01', name: 'Andheri East Depot', city: 'Mumbai', lat: 19.1136, lng: 72.8697 },
    { id: 'site_pun_01', name: 'Hinjewadi Phase 2 Store', city: 'Pune', lat: 18.5912, lng: 73.7389 },
    { id: 'site_hyd_01', name: 'HITEC City Store', city: 'Hyderabad', lat: 17.4435, lng: 78.3772 },
    { id: 'site_che_01', name: 'T. Nagar Outlet', city: 'Chennai', lat: 13.0418, lng: 80.2341 },
    { id: 'site_kol_01', name: 'Salt Lake Sector V', city: 'Kolkata', lat: 22.5697, lng: 88.431 },
  ];
  var SITE_BY_ID = {};
  SITES.forEach(function (s) { SITE_BY_ID[s.id] = s; });

  // The two outliers: the phone was nowhere near India when the photo was sent.
  var OUTLIERS = [
    { place: 'Dubai, UAE', lat: 25.2697, lng: 55.3094 },
    { place: 'Singapore', lat: 1.3329, lng: 103.7436 },
  ];

  var WORKERS = [
    { id: 'worker_demo_1', name: 'Arjun N.', site: 'site_blr_01' },
    { id: 'worker_demo_2', name: 'Divya K.', site: 'site_blr_02' },
    { id: 'worker_demo_3', name: 'Rahul S.', site: 'site_del_01' },
    { id: 'worker_demo_4', name: 'Sneha P.', site: 'site_gur_01' },
    { id: 'worker_demo_5', name: 'Imran Q.', site: 'site_mum_01' },
    { id: 'worker_demo_6', name: 'Pooja D.', site: 'site_pun_01' },
    { id: 'worker_demo_7', name: 'Karthik R.', site: 'site_hyd_01' },
    { id: 'worker_demo_8', name: 'Lakshmi V.', site: 'site_che_01' },
    { id: 'worker_demo_9', name: 'Sourav B.', site: 'site_kol_01' },
  ];
  var WORKER_BY_ID = {};
  WORKERS.forEach(function (w) { WORKER_BY_ID[w.id] = w; });

  var REVIEWERS = ['Anita Rao', 'Vikram Shah', 'Meera Iyer'];
  var TASKS = ['Shelf / site photo', 'Selfie check-in'];

  /* ---------- Reasons (drive top_reason, "Why this score" and SHAP labels) ---------- */
  var REASONS = {
    gps_far: { label: 'Distance from site', sentence: 'The phone was far from the assigned site when the photo was taken.' },
    dup: { label: 'Duplicate photo match', text: 'Same photo was already sent earlier', sentence: 'This photo matches one that was already submitted.' },
    screen: { label: 'Screen-capture pattern', text: 'Photo looks like a picture of a screen', sentence: 'The photo has the pattern of a screen being photographed.' },
    still: { label: 'Motion on approach', text: 'Phone stayed still, no travel trail to the site', sentence: 'There is no movement trail leading to the site.' },
    jump: { label: 'Trail continuity', text: 'Location jumped 14 km in 20 seconds', sentence: 'The location trail jumps between places too fast to be real.' },
    net: { label: 'Network profile', text: 'Network does not match this site’s usual profile', sentence: 'The network does not look like the one normally seen at this site.' },
    clock: { label: 'Clock offset', text: 'Phone clock is 6 minutes off server time', sentence: 'The phone clock is several minutes away from server time.' },
    face: { label: 'Live face match', text: 'Face did not match the live prompt', sentence: 'The face in the photo did not follow the live on-screen prompt.' },
    ok: { label: 'Matches site profile', text: 'Signals consistent with the site profile', sentence: 'Location, motion and network all match the site profile.' },
  };
  var SECONDARY = [
    { label: 'Photo sharpness', up: 'The photo is slightly soft.', down: 'The photo is sharp.' },
    { label: 'GPS accuracy', up: 'GPS accuracy was poor.', down: 'GPS accuracy was good.' },
    { label: 'Time at site', up: 'The worker was at the site for only a few seconds.', down: 'The worker spent normal time at the site.' },
    { label: 'Worker history', up: 'This worker has recent flagged cases.', down: 'This worker has a clean history.' },
    { label: 'Motion during capture', up: 'The phone moved oddly at the moment of capture.', down: 'Natural hand motion at capture.' },
  ];

  /* ---------- Row generation ---------- */
  var NOW = Date.now();
  var COUNT = 40, LAST_ID = 412;

  // Fraud probability mix: 7 critical, 6 high, 6 medium, 21 low, shuffled, then pinned for the newest cases.
  var buckets = [];
  function add(n, lo, hi) { for (var i = 0; i < n; i++) buckets.push(+between(lo, hi).toFixed(2)); }
  add(7, 0.81, 0.97); add(6, 0.61, 0.79); add(6, 0.41, 0.59); add(21, 0.04, 0.38);
  for (var i = buckets.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = buckets[i]; buckets[i] = buckets[j]; buckets[j] = t; }
  var PIN = { 0: 0.93, 1: 0.74, 2: 0.31, 3: 0.86, 4: 0.57, 5: 0.12, 6: 0.68 };
  Object.keys(PIN).forEach(function (k) { buckets[k] = PIN[k]; });

  var OUTLIER_AT = { 8: 0, 21: 1 }; // row index -> outlier index

  function reasonFor(p, task, outlier) {
    if (outlier) return 'gps_far';
    if (p < 0.5) return 'ok';
    var pool = ['dup', 'screen', 'still', 'jump', 'net', 'clock'];
    if (task === TASKS[1]) pool.push('face', 'face');
    return pick(pool);
  }

  function makeTrail(site, end, mode, whenMs) {
    var pts = [], n = 8;
    // Start ~700 m away and walk to the capture point; "jump" breaks the path, "still" keeps every point the same.
    var startLat = end.lat + 0.0062, startLng = end.lng - 0.0048;
    for (var k = 0; k < n; k++) {
      var f = k / (n - 1);
      var lat = startLat + (end.lat - startLat) * f, lng = startLng + (end.lng - startLng) * f;
      if (mode === 'still') { lat = end.lat; lng = end.lng; }
      if (mode === 'jump' && k >= 4) { lat += 0.13; lng += 0.05; }
      pts.push({
        t: Math.round(-(n - 1 - k) * 25), // seconds before capture
        lat: +(lat + (rnd() - 0.5) * 0.00008).toFixed(6),
        lng: +(lng + (rnd() - 0.5) * 0.00008).toFixed(6),
        speed_kmh: mode === 'still' ? 0 : mode === 'jump' && k === 4 ? 612 : +between(2.8, 5.6).toFixed(1),
      });
    }
    return pts;
  }

  function makeRow(idx) {
    var id = LAST_ID - idx;
    var p = buckets[idx];
    var outlierIdx = OUTLIER_AT[idx];
    var isOutlier = outlierIdx !== undefined;
    if (isOutlier) p = idx === 8 ? 0.91 : 0.88;
    var worker = isOutlier ? (idx === 8 ? WORKERS[0] : WORKERS[2]) : pick(WORKERS);
    var site = SITE_BY_ID[worker.site];
    var task = rnd() < 0.7 ? TASKS[0] : TASKS[1];
    var reason = reasonFor(p, task, isOutlier);

    var gps;
    if (isOutlier) {
      var o = OUTLIERS[outlierIdx];
      gps = { lat: o.lat + (rnd() - 0.5) * 0.01, lng: o.lng + (rnd() - 0.5) * 0.01, accuracy_m: 14, place: o.place };
    } else {
      var spread = reason === 'ok' ? 0.0012 : 0.0035;
      gps = { lat: site.lat + (rnd() - 0.5) * spread * 2, lng: site.lng + (rnd() - 0.5) * spread * 2, accuracy_m: Math.round(between(6, reason === 'ok' ? 14 : 38)) };
    }
    gps.lat = +gps.lat.toFixed(6); gps.lng = +gps.lng.toFixed(6);
    var distance = Math.round(haversineM(gps, site));

    var photoVerdict, flags = [];
    if (reason === 'dup' || reason === 'screen') photoVerdict = 'Photo OK';
    else {
      var r = rnd();
      photoVerdict = p < 0.4 ? (r < 0.82 ? 'Photo OK' : 'warning') : (r < 0.35 ? 'Photo OK' : r < 0.65 ? 'warning' : r < 0.85 ? 'poor' : 'unverified');
    }
    if (photoVerdict === 'warning') flags.push(task === TASKS[1] && rnd() < 0.5 ? 'Face not clear' : pick(['Blurry', 'Lighting']));
    if (photoVerdict === 'poor') flags.push('Blurry', 'Lighting');
    if ((photoVerdict === 'warning' || photoVerdict === 'poor') && rnd() < 0.7) flags.push('Submitted anyway');
    if (reason === 'dup') flags.push('Duplicate photo');

    // Time: newest is 2 minutes ago, then roughly 25 to 330 minutes apart.
    return { idx: idx, id: id, p: p, worker: worker, site: site, task: task, reason: reason, gps: gps, distance: distance, photoVerdict: photoVerdict, flags: flags };
  }

  var minutesAgo = 2;
  var rows = [];
  for (var k = 0; k < COUNT; k++) {
    var base = makeRow(k);
    if (k > 0) minutesAgo += Math.round(between(25, 330));
    var ts = new Date(NOW - minutesAgo * 60000);
    var r = base;
    var mode = r.reason === 'jump' ? 'jump' : r.reason === 'still' ? 'still' : 'walk';
    var distText = r.distance >= 1000 ? (r.distance / 1000).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' km' : r.distance + ' m';
    var topReason = r.reason === 'gps_far' ? 'GPS ' + distText + ' from assigned site' : REASONS[r.reason].text;
    if (r.reason === 'dup') topReason = 'Same photo already sent by ' + pick(WORKERS.filter(function (w) { return w.id !== r.worker.id; })).id;

    // Top 3 SHAP drivers: the main reason first; the sign flips for low-risk cases.
    var main = REASONS[r.reason];
    var risky = r.p >= 0.5;
    var s1 = +(risky ? 0.18 + r.p * 0.34 : -(0.1 + (1 - r.p) * 0.2)).toFixed(2);
    var sec = SECONDARY.slice().sort(function () { return rnd() - 0.5; }).slice(0, 2);
    var shap = [{ label: main.label, value: s1 }];
    shap.push({ label: sec[0].label, value: +(risky ? 0.06 + rnd() * 0.12 : -(0.04 + rnd() * 0.1)).toFixed(2), note: risky ? sec[0].up : sec[0].down });
    shap.push({ label: sec[1].label, value: +((rnd() < 0.5 ? -1 : 1) * (0.02 + rnd() * 0.07)).toFixed(2), note: null });
    shap.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
    shap[1].note = shap[1].note || null;

    var net = r.reason === 'net' ? pick(['VPN / datacenter', '2g']) : pick(['4g', '4g', 'wifi', '5g']);
    var row = {
      id: r.id,
      worker_id: r.worker.id,
      task: r.task,
      site_id: r.site.id,
      timestamp: ts.toISOString(),
      status: r.p >= 0.5 ? 'flagged' : 'accepted',
      fraud_probability: r.p,
      top_reason: topReason,
      reason_key: r.reason,
      photo_verdict: r.photoVerdict,
      quality_flags: r.flags,
      review: null,
      gps: r.gps,
      distance_m: r.distance,
      trail: makeTrail(r.site, r.gps, mode, ts.getTime()),
      shap: shap,
      sensors: {
        network: net,
        motion_mean: r.reason === 'still' ? 0.04 : +between(0.9, 2.6).toFixed(2),
        motion_var: r.reason === 'still' ? 0.001 : +between(0.18, 0.9).toFixed(2),
        clock_offset_s: r.reason === 'clock' ? 372 : Math.round(between(-4, 5)),
        ip_region: r.reason === 'gps_far' ? r.gps.place : r.site.city,
      },
      photo: { w: 3024, h: 4032, sharpness: r.photoVerdict === 'Photo OK' ? +between(0.72, 0.96).toFixed(2) : +between(0.22, 0.58).toFixed(2), brightness: r.flags.indexOf('Lighting') >= 0 ? +between(0.12, 0.24).toFixed(2) : +between(0.42, 0.7).toFixed(2) },
    };
    rows.push(row);
  }

  // Older flagged cases already have a reviewer decision; the newest stay open.
  var REASON_TEXT = {
    approve: ['Checked the trail and photo, site visit looks genuine.', 'GPS drift near a metal roof; trail is consistent.', 'Worker confirmed on call. Photo matches the shelf layout.'],
    reject: ['Photo is a duplicate of an earlier submission.', 'Location is not the assigned site.', 'Screen capture, not a live photo.'],
    retake: ['Photo too dark to verify. Ask for a retake in daylight.', 'Face not clear. Retake with the face fully in the frame.'],
  };
  rows.forEach(function (row) {
    var ageH = (NOW - new Date(row.timestamp).getTime()) / 3600000;
    if (row.status !== 'flagged' || ageH < 26) return;
    var p = row.fraud_probability, r = rnd();
    var decision = p >= 0.8 ? (r < 0.7 ? 'reject' : 'retake') : (r < 0.5 ? 'approve' : r < 0.75 ? 'retake' : 'reject');
    row.review = {
      decision: decision,
      reviewer: pick(REVIEWERS),
      reason: pick(REASON_TEXT[decision]),
      at: new Date(new Date(row.timestamp).getTime() + Math.round(between(20, 140)) * 60000).toISOString(),
    };
  });

  /* ---------- Helpers ---------- */
  var listeners = [];
  var DATA = {
    now: NOW,
    sites: SITES, siteById: SITE_BY_ID,
    workers: WORKERS, workerById: WORKER_BY_ID,
    reviewers: REVIEWERS, tasks: TASKS, reasons: REASONS,
    rows: rows, // newest first
    byId: function (id) { return rows.filter(function (r) { return r.id === +id; })[0] || null; },
    subscribe: function (fn) { listeners.push(fn); },
    emit: function (type, row) { listeners.forEach(function (fn) { fn(type, row); }); },
    haversineM: haversineM,
    setReview: function (id, review) {
      var row = DATA.byId(id);
      if (!row) return null;
      if (row.review) (row.review_history = row.review_history || []).push(row.review);
      row.review = review;
      DATA.emit('review', row);
      return row;
    },
    // "Refresh" brings in one new case the first time, then reports nothing new.
    pulled: false,
    pull: function () {
      if (DATA.pulled) return null;
      DATA.pulled = true;
      var site = SITE_BY_ID['site_mum_01'];
      var gps = { lat: 19.1151, lng: 72.8712, accuracy_m: 22 };
      var row = {
        id: ++LAST_ID, worker_id: 'worker_demo_5', task: TASKS[0], site_id: site.id, timestamp: new Date().toISOString(),
        status: 'flagged', fraud_probability: 0.84, top_reason: 'Same photo already sent by worker_demo_2', reason_key: 'dup',
        photo_verdict: 'Photo OK', quality_flags: ['Duplicate photo'], review: null, gps: gps, distance_m: Math.round(haversineM(gps, site)),
        trail: makeTrail(site, gps, 'walk', Date.now()),
        shap: [{ label: 'Duplicate photo match', value: 0.47 }, { label: 'Time at site', value: 0.13, note: 'The worker was at the site for only a few seconds.' }, { label: 'GPS accuracy', value: -0.04, note: null }],
        sensors: { network: '4g', motion_mean: 1.4, motion_var: 0.4, clock_offset_s: 2, ip_region: 'Mumbai' },
        photo: { w: 3024, h: 4032, sharpness: 0.88, brightness: 0.55 },
      };
      if (DATA.decorate) DATA.decorate(row);
      rows.unshift(row);
      DATA.emit('new', row);
      return row;
    },
  };
  window.TL_DATA = DATA;
})();
