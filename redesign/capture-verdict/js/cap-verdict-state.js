/* Capture · Verdict step prototype: state store and the presets of the state switcher.
   S = { theme, motion, ipdb, menu, result, notes, copied, fetchedOpen, frame, animate, presetId }
   frame: '' | 'celebrate' (the celebration frozen mid-burst) | 'copied' is handled by S.copied.
   animate: false = show final values at once (gallery, tests); true = count the gauge up and play the one-time celebration. */
(function () {
  var V = window.CAP_V, M = V.M;
  var S = null, listeners = [], byId = {}, P = [];

  function defaults() {
    return { theme: 'dark', motion: 'normal', ipdb: 'ok', menu: false, result: M.acceptedFull, notes: [], copied: false, fetchedOpen: false, frame: '', animate: true, presetId: null, burstDone: false, stage: 0 };
  }
  function add(group, id, label, set, desc) { var p = { group: group, id: id, label: label, set: set || {}, desc: desc || '' }; P.push(p); byId[id] = p; }

  add('1 · Accepted', 'accepted-full', 'Accepted, fusion all green', { result: M.acceptedFull }, 'Everything consistent. The gauge counts up and the one-time celebration plays.');
  add('1 · Accepted', 'accepted-celebrate', 'Accepted, the celebration frame', { result: M.acceptedFull, frame: 'celebrate', animate: false }, 'The celebration frozen mid-burst (a few small dots). Reduced motion hides it.');
  add('1 · Accepted', 'accepted-muted', 'Accepted, muted fusion + notes banner', { result: M.acceptedMuted, notes: M.acceptedMutedNotes }, 'Not enough data: muted rows, dashes in "What was fetched", 43.2% against the 50% mark.');
  add('1 · Accepted', 'accepted-amber', 'Accepted, close to the site (amber)', { result: M.acceptedAmber }, 'Arrival wording 3: close to the site but not clearly inside.');
  add('1 · Accepted', 'accepted-nosite', 'Accepted, no site registered', { result: M.acceptedNoSite }, 'Arrival wording 5: the company has not registered a location.');

  add('2 · Flagged', 'flagged-outside', 'Flagged, outside the site', { result: M.flaggedOutside }, 'Red arrival line, a GPS jump in "What was fetched", TOP DRIVER = Motion consistency.');
  add('2 · Flagged', 'flagged-network', 'Flagged by the network (hosting / VPN)', { result: M.flaggedNetwork }, 'TOP DRIVER = Network vs area; red network row, IP location from another country.');
  add('2 · Flagged', 'flagged-motion', 'Flagged by movement vs GPS', { result: M.flaggedMotion }, 'Server reason on the movement row; phone activity mostly still.');
  add('2 · Flagged', 'flagged-nogps', 'Flagged, photo is the top driver, no GPS fix', { result: M.flaggedNoGps, notes: M.flaggedNoGpsNotes }, 'Arrival wording 4: no reliable GPS fix. TOP DRIVER = Photo quality.');

  add('3 · Older server', 'nofusion-accepted', 'Accepted, result without fusion', { result: M.noFusionAccepted }, 'No fusion rows, no "What was fetched" card. Nothing else moves.');
  add('3 · Older server', 'nofusion-flagged', 'Flagged, result without fusion', { result: M.noFusionFlagged });

  add('4 · Copy submission ID', 'copy-default', 'Copy button, default', { result: M.acceptedFull, animate: false });
  add('4 · Copy submission ID', 'copy-copied', 'Copy button, copied (check, 1.5 s)', { result: M.acceptedFull, animate: false, copied: true, frozenCopy: true }, 'Frozen in the copied state so it can be reviewed; clicking the real button times out after 1.5 s.');

  add('5 · Stress', 'stress-long', 'Long id, long reason, 4 notes, 97.3%', { result: M.stress, notes: M.stressNotes }, 'Wrapping check at every width.');
  add('5 · Stress', 'shell-ipdb', 'IP database warning in the top bar', { result: M.flaggedNetwork, ipdb: 'missing' }, 'Same top-bar warning as the Photo step (phones: the "more" menu).');

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function reset() { S = defaults(); }
  function apply(id, opts) {
    var p = byId[id] || byId['accepted-full'];
    var keepTheme = S ? S.theme : 'dark', keepMotion = S ? S.motion : 'normal', keepAnimate = opts && opts.animate != null ? opts.animate : null;
    S = defaults();
    S.theme = keepTheme; S.motion = keepMotion; S.presetId = p.id;
    Object.keys(p.set).forEach(function (k) { S[k] = p.set[k]; });
    if (keepAnimate != null) S.animate = keepAnimate;
    S.result = clone(S.result); S.notes = (S.notes || []).slice();
    S.stage++;
    emit();
  }
  function emit() { listeners.forEach(function (f) { f(S); }); }
  window.CAP_VSTATE = {
    init: reset, get: function () { return S; }, apply: apply, emit: emit, presets: P, byId: byId,
    on: function (f) { listeners.push(f); }
  };
  reset();
})();
