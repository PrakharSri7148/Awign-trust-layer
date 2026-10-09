/* Capture · Photo step prototype: state store, presets for the state switcher, and the flows (open camera, capture, check,
   result, retake, arrive). Presets are frozen snapshots (auto = false); using the page by hand turns the flows on (auto = true). */
(function () {
  var D = window.CAP_DATA;
  var S = null;
  var listeners = [];
  var timers = [];

  function storeGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage can be blocked */ } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(a, b) {
    Object.keys(b).forEach(function (k) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]);
      else a[k] = b[k];
    });
    return a;
  }

  var LV = {
    idle: { phase: 'idle', challenge: null, promptShort: '', secs: 0, idx: 0, total: 2, attempts: 0, reason: '' },
    running: { phase: 'running', challenge: 'blink', promptShort: 'blink', secs: 3, idx: 0, total: 2, attempts: 1, reason: '' },
    running2: { phase: 'running', challenge: 'turn_left', promptShort: 'turn left', secs: 2, idx: 1, total: 2, attempts: 1, reason: '' },
    wait: { phase: 'wait', challenge: 'smile', promptShort: 'smile', secs: 0, idx: 1, total: 2, attempts: 1, reason: '' },
    active: { phase: 'active', challenge: 'smile', promptShort: 'smile', secs: 2, idx: 1, total: 2, attempts: 1, reason: '' },
    facelost: { phase: 'facelost', challenge: 'blink', promptShort: 'blink', secs: 3, idx: 0, total: 2, attempts: 1, reason: '' },
    passed: { phase: 'passed', challenge: null, promptShort: '', secs: 0, idx: 2, total: 2, attempts: 1, reason: '' },
    expired: { phase: 'expired', challenge: null, promptShort: '', secs: 0, idx: 2, total: 2, attempts: 1, reason: '' },
    failed: { phase: 'failed', challenge: 'blink', promptShort: 'blink', secs: 0, idx: 0, total: 2, attempts: 1, reason: 'We did not see you blink.' },
    failedLast: { phase: 'failed', challenge: 'turn_left', promptShort: 'turn left', secs: 0, idx: 1, total: 2, attempts: 3, reason: 'We did not see you turn your head.' },
    review: { phase: 'review', challenge: null, promptShort: '', secs: 0, idx: 2, total: 2, attempts: 3, reason: '' }
  };

  function defaults() {
    var hudMode = (new URLSearchParams(location.search)).get('hudmode');
    return {
      theme: 'dark', shell: 'online', loading: false, demo: false, ipdb: 'ok', native: false, menu: false,
      diag: { record: false, debug: false, raw: false, tools: false },
      step: 'photo', task: 'shelf', mode: 'camera', supported: true, cam: 'idle', camNote: null,
      quality: 'notready', problem: 'dark', faceFound: true, spoof: false,
      liveness: clone(LV.idle), voice: false, offlineLive: false,
      busy: false, photo: null, fileUrl: null, outcome: 'pass', error: null, shake: false,
      rec: { running: false, starting: false },
      visit: { motion: 'granted', geo: 'granted', serverDown: false, consentOpen: false, siteMsg: null, scenario: D.SCENARIOS[0][0], note: '' },
      feed: { open: false, tab: 'gps', empty: false, stale: false, noWake: false, hidden: false, serverMsg: null, serverVal: '', serverOpen: false },
      hud: { side: hudMode || storeGet('trustlayer.hud') || 'expanded', overlay: hudMode || storeGet('trustlayer.hud.overlay') || 'compact' },
      drawer: null, auto: true, clock: 0, presetId: null, accOpen: {}
    };
  }

  /* ---------- presets ---------- */
  var P = [];
  function add(group, id, label, set, desc) { P.push({ group: group, id: id, label: label, set: set, desc: desc || '' }); }
  var REC = { rec: { running: true, starting: false } };
  var LIVE = { cam: 'live', quality: 'ready' };
  var SELFIE = { task: 'selfie' };

  add('1 · Idle camera', 'idle', 'Idle camera, visit not started', {}, 'Nothing started. Shell online.');
  add('1 · Idle camera', 'idle-selfie', 'Idle, face task (selfie)', SELFIE, 'Task picker switches the brief note and the camera caption.');
  add('1 · Idle camera', 'starting', 'Opening camera…', { cam: 'starting' });
  add('2 · Visit recording', 'recording', 'Visit recording running', REC, 'Headline numbers filled; the feed is collapsed.');
  add('2 · Visit recording', 'recording-feed', 'Recording, sensor feed open', merge(clone(REC), { feed: { open: true, tab: 'gps' } }), 'Tabs: GPS · Motion · Session · Network · Trail · Not available.');
  add('2 · Visit recording', 'recording-consent', 'Not recording, “What is recorded?” open', { visit: { consentOpen: true } });
  add('2 · Visit recording', 'recording-notes', 'Recording with notes (motion denied, server unreachable)', merge(clone(REC), { visit: { motion: 'denied', serverDown: true }, feed: { open: true, tab: 'session' } }), 'D4 notes.');
  add('2 · Visit recording', 'recording-geo-denied', 'Recording, location denied', merge(clone(REC), { visit: { geo: 'denied' }, feed: { open: true, tab: 'gps', empty: true } }));
  add('3 · Live camera, not ready', 'live-dark', 'Not ready: too dark', merge(clone(REC), { cam: 'live', quality: 'notready', problem: 'dark' }), 'Hint shows the top problem; some rows amber / red.');
  add('3 · Live camera, not ready', 'live-blur', 'Not ready: blurry and shaky', { cam: 'live', quality: 'notready', problem: 'blur' });
  add('3 · Live camera, not ready', 'live-glare', 'Not ready: glare', { cam: 'live', quality: 'notready', problem: 'glare' });
  add('3 · Live camera, not ready', 'live-nohud', 'Live, first frame (no score yet)', { cam: 'live', quality: 'notready', hudEmpty: true }, 'Muted rows when there is no score yet.');
  add('4 · Live camera, ready', 'live-ready', 'Ready: green shutter', merge(clone(REC), LIVE), '“Looks good. Tap to capture.”');
  add('4 · Live camera, ready', 'live-ready-worker', 'Ready, face optional (rear camera)', merge(clone(LIVE), { task: 'worker' }));
  add('5 · Face task: liveness', 'lv-idle', 'Idle: position your face', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.idle }));
  add('5 · Face task: liveness', 'lv-running', 'Running: blink', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.running }));
  add('5 · Face task: liveness', 'lv-running2', 'Running: turn head left (step 2)', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.running2 }));
  add('5 · Face task: liveness', 'lv-wait', 'Waiting for neutral face', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.wait }));
  add('5 · Face task: liveness', 'lv-active', 'Active: “Got it, hold…”', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.active }));
  add('5 · Face task: liveness', 'lv-facelost', 'Face lost', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.facelost }));
  add('5 · Face task: liveness', 'lv-passed', 'Passed: shutter ready', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.passed }));
  add('5 · Face task: liveness', 'lv-expired', 'Expired', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.expired }));
  add('5 · Face task: liveness', 'lv-failed', 'Failed: try again (1 of 3 used)', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.failed }));
  add('5 · Face task: liveness', 'lv-failed-last', 'Failed: send for review', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.failedLast }));
  add('5 · Face task: liveness', 'lv-review', 'Sending for review', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.review }));
  add('5 · Face task: liveness', 'lv-offline', 'Offline: can’t reach the server', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.idle, offlineLive: true, shell: 'offline' }));
  add('5 · Face task: liveness', 'lv-voice', 'Reading prompts aloud on', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.running, voice: true }));
  add('6 · Capturing', 'capturing', 'Capturing: “Hold still…”', merge(clone(LIVE), { busy: true }));
  add('6 · Capturing', 'capturing-selfie', 'Capturing, face task', merge(clone(SELFIE), { cam: 'live', quality: 'ready', liveness: LV.passed, busy: true }));
  add('7 · Checking the photo', 'checking', 'Checking: scan line + terminal', { photo: { phase: 'checking', verdict: 'pass' } });
  add('7 · Checking the photo', 'checking-selfie', 'Checking, face task', merge(clone(SELFIE), { photo: { phase: 'checking', verdict: 'pass' } }));
  add('8 · Result', 'result-pass', 'Result: photo verified', merge(clone(REC), { photo: { phase: 'result', verdict: 'pass' } }));
  add('8 · Result', 'result-warn', 'Result: accepted with warnings', merge(clone(REC), { photo: { phase: 'result', verdict: 'warn' } }));
  add('8 · Result', 'result-block', 'Result: needs a retake (why list)', { photo: { phase: 'result', verdict: 'block' } });
  add('8 · Result', 'result-pass-selfie', 'Result: verified, face task', merge(clone(SELFIE), { photo: { phase: 'result', verdict: 'pass' }, liveness: LV.passed }));
  add('8 · Result', 'result-block-selfie', 'Result: blocked, face task', merge(clone(SELFIE), { photo: { phase: 'result', verdict: 'block' } }));
  add('9 · Camera denied + picker', 'denied', 'Camera denied → photo picker', { mode: 'file', camNote: 'denied' }, 'Warning banner + dashed viewfinder + “Use the live camera”.');
  add('9 · Camera denied + picker', 'denied-live', 'Denied, live-required task', merge(clone(SELFIE), { mode: 'file', camNote: 'denied' }), '“…it will be flagged for review.”');
  add('9 · Camera denied + picker', 'unavailable', 'Live camera not available here', { mode: 'file', camNote: 'unavailable' });
  add('9 · Camera denied + picker', 'picker', 'Photo picker chosen (no warning)', { mode: 'file' });
  add('9 · Camera denied + picker', 'picker-selfie', 'Picker, front camera caption', merge(clone(SELFIE), { mode: 'file' }));
  add('9 · Camera denied + picker', 'picker-checking', 'Picker: photo being checked', { mode: 'file', camNote: 'denied', photo: { phase: 'checking', verdict: 'warn' } });
  add('10 · Error banner', 'error-submit', 'Submission failed + Retry', merge(clone(REC), { photo: { phase: 'result', verdict: 'pass' }, error: { text: 'Submission failed: Server responded 503: upstream unavailable', retry: true } }));
  add('10 · Error banner', 'error-read', 'Could not read photo', { mode: 'file', error: { text: 'Could not read photo: the file is not a supported image', retry: false } });
  add('11 · Shell variants', 'shell-loading', 'Loading (skeletons)', { shell: 'connecting', loading: true });
  add('11 · Shell variants', 'shell-connecting', 'Connecting (no top-bar indicator any more)', { shell: 'connecting' });
  add('11 · Shell variants', 'shell-empty', 'Empty: recording, no fixes yet', merge(clone(REC), { feed: { open: true, tab: 'trail', empty: true } }), '“No fixes yet.”');
  add('11 · Shell variants', 'shell-offline', 'Backend offline (shows as server notes)', merge(clone(REC), { shell: 'offline', visit: { serverDown: true }, feed: { open: true, tab: 'session' } }));
  add('11 · Shell variants', 'diag-camera', 'Diagnostics: tools, raw numbers, IP warning', merge(clone(REC), { cam: 'live', quality: 'notready', demo: true, ipdb: 'stale', native: true, hud: { side: 'expanded', overlay: 'expanded' }, diag: { record: true, debug: true, raw: true, tools: true }, feed: { open: true, tab: 'session', serverOpen: true } }), 'A5 warning, D5, D6, H5, K2, K9.');
  add('11 · Shell variants', 'diag-result', 'Diagnostics: debug checks table', { photo: { phase: 'result', verdict: 'block' }, diag: { debug: true, record: false, raw: false, tools: false }, ipdb: 'missing' });
  add('12 · Other', 'arrival', 'After “I’ve reached the site” (step 2 stub)', { step: 'arrival' }, 'Steps 2–4 are not redesigned here.');

  var byId = {};
  P.forEach(function (p) { byId[p.id] = p; });

  /* ---------- core ---------- */
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function later(ms, fn) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function emit() { listeners.forEach(function (f) { f(S); }); }
  function set(patch, silent) { merge(S, patch); if (!silent) emit(); }

  function apply(id, opts) {
    var p = byId[id]; if (!p) return false;
    clearTimers();
    var keep = { theme: S ? S.theme : 'dark', outcome: S ? S.outcome : 'pass' };
    S = merge(defaults(), clone(p.set));
    S.theme = keep.theme; S.outcome = keep.outcome; S.presetId = id; S.auto = !!(opts && opts.auto);
    if (S.photo === undefined) S.photo = null;
    emit();
    return true;
  }
  function reset() { clearTimers(); var th = S.theme, oc = S.outcome; S = defaults(); S.theme = th; S.outcome = oc; S.auto = true; emit(); }

  var TASK_OF = function () { return D.TASKS[S.task]; };
  var needsLive = function () { return TASK_OF().face === 'required'; };

  /* ---------- flows (what the buttons do when used by hand) ---------- */
  var F = {
    pickTask: function (key) {
      if (key === S.task) return;
      clearTimers();
      var keepRec = S.rec, keepFeed = S.feed;
      Object.assign(S, { task: key, photo: null, error: null, busy: false, cam: 'idle', quality: 'notready', liveness: clone(LV.idle), presetId: null, auto: true, fileUrl: null, step: 'photo' });
      S.rec = keepRec; S.feed = keepFeed;
      emit();
    },
    openCamera: function () {
      if (S.cam !== 'idle') return;
      S.auto = true; S.presetId = null; S.cam = 'starting'; S.camNote = null; emit();
      later(800, function () {
        S.cam = 'live'; S.quality = 'notready'; S.problem = 'dark'; S.liveness = clone(LV.idle); emit();
        F.autoGuidance();
      });
    },
    /* simulated guidance: the lighting improves, then (face tasks) the live check plays through */
    autoGuidance: function () {
      later(2200, function () { if (S.cam !== 'live' || S.photo) return; S.quality = 'ready'; emit(); if (needsLive()) F.playLiveness(); });
    },
    playLiveness: function () {
      clearTimers();
      var seq = [[300, LV.idle], [1200, LV.running], [1800, LV.wait], [900, LV.running2], [1400, LV.active], [900, LV.passed]];
      var t = 0;
      seq.forEach(function (s) { t += s[0]; later(t, function () { if (S.cam !== 'live') return; S.liveness = clone(s[1]); emit(); }); });
    },
    closeCamera: function () { clearTimers(); S.cam = 'idle'; S.busy = false; S.auto = true; S.presetId = null; emit(); },
    capture: function () {
      if (S.busy || (needsLive() && S.liveness.phase !== 'passed')) return;
      S.busy = true; S.auto = true; S.presetId = null; emit();
      later(1100, function () {
        S.busy = false; S.photo = { phase: 'checking', verdict: S.outcome }; emit();
        later(2400, function () { S.photo.phase = 'result'; if (S.outcome === 'block') S.shake = true; emit(); S.shake = false; });
      });
    },
    retake: function () {
      clearTimers();
      S.photo = null; S.error = null; S.fileUrl = null; S.auto = true; S.presetId = null;
      if (S.mode === 'camera') { S.cam = 'live'; S.quality = 'notready'; S.liveness = clone(LV.idle); emit(); F.autoGuidance(); }
      else emit();
    },
    arrive: function () {
      clearTimers(); S.step = 'arrival'; S.presetId = null; S.auto = true; emit();
      window.CAP_UI && window.CAP_UI.toast('Location sent', 'Step 2 (Arrival) is not part of this redesign. Use “Back to the Photo step”.', 'ok');
    },
    backToPhoto: function () { reset(); },
    useFilePhoto: function (url) {
      clearTimers(); S.fileUrl = url; S.auto = true; S.presetId = null; S.error = null;
      S.photo = { phase: 'checking', verdict: S.outcome }; emit();
      later(2400, function () { S.photo.phase = 'result'; emit(); });
    },
    usePicker: function () { clearTimers(); S.mode = 'file'; S.camNote = null; S.cam = 'idle'; S.auto = true; S.presetId = null; emit(); },
    useLiveCamera: function () { S.mode = 'camera'; S.camNote = null; S.cam = 'idle'; S.auto = true; S.presetId = null; emit(); },
    startRec: function () {
      if (S.rec.running || S.rec.starting) return;
      S.rec.starting = true; S.auto = true; emit();
      later(900, function () { S.rec = { running: true, starting: false }; emit(); });
    },
    stopRec: function () { S.rec = { running: false, starting: false }; emit(); },
    retry: function () { S.error = null; F.arrive(); },
    liveRetry: function () { S.liveness = clone(LV.running); emit(); if (S.auto) F.playLiveness(); },
    liveReview: function () { S.liveness = clone(LV.review); emit(); },
    toggleHud: function (kind) {
      var key = kind === 'overlay' ? 'overlay' : 'side';
      S.hud[key] = S.hud[key] === 'expanded' ? 'compact' : 'expanded';
      storeSet(key === 'overlay' ? 'trustlayer.hud.overlay' : 'trustlayer.hud', S.hud[key]);
      emit();
    }
  };

  window.CAP_STATE = {
    presets: P,
    byId: byId,
    get: function () { return S; },
    init: function () { S = defaults(); },
    apply: apply, reset: reset, set: set, emit: emit, F: F, LV: LV,
    on: function (f) { listeners.push(f); },
    later: later, clear: clearTimers, clone: clone, merge: merge
  };
})();
