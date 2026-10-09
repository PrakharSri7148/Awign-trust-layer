/* Settings: Sites (list + add) and Site location (edit, old -> new confirm, learned network, change log).
   Carries over the existing "Site locations" and "Site location" panels, plus the destructive "Reset site network profile"
   action that used to sit inside every case file. */
(function () {
  'use strict';
  var TL = window.TL, D = window.TL_DATA, I = window.icon, esc = TL.esc, $ = TL.$, $$ = TL.$$;

  var M = { siteId: 'site_blr_01', form: null, step: 'edit', reset: false, resetTouched: false, fix: null, error: null, forgetAsk: false, busy: false, addForm: { site_id: '', lat: '', lng: '', radius_m: '80', country: 'IN', label: '' }, addError: null, container: null };

  function site() { return D.siteById[M.siteId]; }
  function formFrom(s) { return { lat: String(s.lat), lng: String(s.lng), radius_m: String(s.radius_m), country: s.country || '', label: s.label || '' }; }
  function validate(f) {
    var lat = Number(f.lat), lng = Number(f.lng), r = Number(f.radius_m);
    if (f.lat === '' || f.lng === '') return 'Enter a latitude and a longitude.';
    if (!isFinite(lat) || lat < -90 || lat > 90) return 'Latitude must be a number between -90 and 90.';
    if (!isFinite(lng) || lng < -180 || lng > 180) return 'Longitude must be a number between -180 and 180.';
    if (!isFinite(r) || r < 10 || r > 5000) return 'Radius must be between 10 and 5,000 metres.';
    if (f.country && !/^[A-Za-z]{2}$/.test(f.country)) return 'Country is a 2-letter code, for example IN.';
    return null;
  }
  var DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  function moveLine(s, f) {
    if (!s || validate(f)) return { text: null, kind: 'none' };
    var to = { lat: +f.lat, lng: +f.lng }, m = D.haversineM(s, to);
    if (m < 30) return { text: null, kind: 'none' };
    var dy = to.lat - s.lat, dx = (to.lng - s.lng) * Math.cos((s.lat * Math.PI) / 180), ang = (Math.atan2(dx, dy) * 180) / Math.PI, dir = DIRS[Math.round(((ang + 360) % 360) / 45) % 8];
    if (m < 1000) return { text: 'Moves the site ' + Math.round(m) + ' m ' + dir + '.', kind: 'small' };
    return { text: 'Moves the site ' + (m / 1000).toFixed(1) + ' km ' + dir + '. That is a big move.', kind: 'big' };
  }
  function accuracyNote(a) {
    if (a <= 30) return { tone: 'ok', text: 'Location found, accurate to about ' + Math.round(a) + ' m. Good for a site.' };
    if (a <= 100) return { tone: 'warn', text: 'Location found, but only accurate to about ' + Math.round(a) + ' m. Step outside or wait a few seconds and try again for a better fix.' };
    return { tone: 'bad', text: 'This fix is only accurate to about ' + Math.round(a) + ' m, too rough for a site. Move outdoors and try again.' };
  }
  function diffRows(s, f) {
    var rows = [['Latitude', s.lat.toFixed(6), (+f.lat).toFixed(6)], ['Longitude', s.lng.toFixed(6), (+f.lng).toFixed(6)], ['Radius', s.radius_m + ' m', Number(f.radius_m) + ' m'], ['Country', s.country || '-', (f.country || '').toUpperCase() || '-'], ['Label', s.label || '-', f.label || '-']];
    return rows.map(function (r) { return { name: r[0], from: r[1], to: r[2], changed: r[1] !== r[2] }; });
  }
  function whenText(iso) { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + TL.fmtClock(iso); }

  function locate() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error('This browser cannot read your location.'));
      navigator.geolocation.getCurrentPosition(function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
        function (e) { reject(new Error(e.code === 1 ? 'Location permission was not given. Allow it in your browser settings, or type the values.' : 'Could not read your location. On a phone this needs the HTTPS address.')); }, { enableHighAccuracy: true, timeout: 9000 });
    });
  }

  /* ---------- Confirm dialog for the destructive reset (the case file no longer carries this button) ---------- */
  function confirmReset(s, opener, done) {
    var scrim = document.createElement('div'); scrim.className = 'scrim';
    var dlg = document.createElement('div'); dlg.className = 'dialog'; dlg.setAttribute('role', 'alertdialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'dlg-title'); dlg.setAttribute('aria-describedby', 'dlg-desc');
    dlg.innerHTML = '<h2 id="dlg-title">Reset network profile?</h2><p id="dlg-desc" class="text-2" style="font-size:var(--text-sm)">The network profile learned for <strong class="mono" style="color:var(--color-text)">' + s.id + '</strong> is forgotten and rebuilt from the next accepted visits. Until then the network check says “not enough history”. This cannot be undone.</p>' +
      '<div class="dialog__actions"><button class="btn" data-cancel>Cancel</button><button class="btn btn--danger-solid" data-ok>Reset network profile</button></div>';
    document.body.append(scrim, dlg);
    var release;
    function close() { release(); scrim.remove(); dlg.remove(); if (opener && document.contains(opener)) opener.focus(); }
    release = TL.trapFocus(dlg, close);
    scrim.addEventListener('click', close);
    $('[data-cancel]', dlg).addEventListener('click', close);
    $('[data-ok]', dlg).addEventListener('click', function () {
      D.profiles[s.id] = { visits: 0, needed: 3, rows: [] };
      close(); TL.toast({ title: 'Network profile reset for ' + s.id, text: 'It will be rebuilt from the next accepted visits.' }); if (done) done();
    });
    $('[data-cancel]', dlg).focus();
  }

  /* ---------- Render ---------- */
  function field(id, label, val, attrs) { return '<div class="field"><label class="field__label" for="' + id + '">' + label + '</label><input class="input" id="' + id + '" value="' + esc(val) + '" ' + (attrs || '') + ' /></div>'; }

  function sitesPanel() {
    var a = M.addForm;
    return '<section class="panel panel--wide" aria-labelledby="sites-title"><div class="panel__head"><div><h2 class="panel__title" id="sites-title">Sites</h2><p class="panel__sub">Where each site really is. The arrival and “outside the site” checks use it. Without a registered site those checks are skipped, never guessed.</p></div></div><div class="settings__body">' +
      '<div class="table-wrap"><table class="table table--stack"><thead><tr><th scope="col">Site</th><th scope="col">Latitude, longitude</th><th scope="col">Radius</th><th scope="col">Country</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      D.sites.map(function (s) {
        return '<tr><td class="cell--primary" data-label="Site"><div class="cell-stack"><span><span class="mono">' + s.id + '</span></span><small>' + esc(s.name) + (s.label ? ' · ' + esc(s.label) : '') + '</small></div></td><td data-label="Location" class="mono">' + s.lat.toFixed(5) + ', ' + s.lng.toFixed(5) + '</td><td data-label="Radius" class="num">' + s.radius_m + ' m</td><td data-label="Country">' + (s.country || '-') + '</td>' +
          '<td class="cell--wide" style="text-align:right;white-space:nowrap"><button class="btn btn--sm btn--ghost" data-edit="' + s.id + '">Edit location</button> <button class="btn btn--sm btn--danger" data-reset="' + s.id + '">Reset network profile</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<form id="add-site" class="sites-form" novalidate aria-label="Add a site"><h3 style="font-size:var(--text-sm)">Add a site</h3><div class="sites-form__grid">' +
      field('as-id', 'Site ID', a.site_id, 'placeholder="site_xyz_01" autocomplete="off"') + field('as-lat', 'Latitude', a.lat, 'inputmode="decimal" autocomplete="off"') + field('as-lng', 'Longitude', a.lng, 'inputmode="decimal" autocomplete="off"') +
      field('as-r', 'Radius (m)', a.radius_m, 'inputmode="numeric" autocomplete="off"') + field('as-c', 'Country', a.country, 'maxlength="2" autocomplete="off"') + '</div>' +
      (M.addError ? '<div class="field__error" role="alert">' + I('circle-alert') + esc(M.addError) + '</div>' : '') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn--sm" id="as-here">' + I('navigation') + 'Use my current location</button><button type="submit" class="btn btn--primary btn--sm">Save site</button></div></form></div></section>';
  }

  function locationPanel() {
    var s = site(), f = M.form, pf = D.profiles[s.id], v = validate(f), mv = moveLine(s, f), changes = D.siteChanges[s.id] || [];
    var unchanged = !diffRows(s, f).some(function (r) { return r.changed; }) && !v;
    var learned = pf.rows.length ? { headline: 'Learned from ' + pf.visits + ' accepted visits. A network counts as normal here once it has been seen on ' + pf.needed + ' of them.', known: pf.visits >= pf.needed } : { headline: 'Nothing learned yet. The next ' + pf.needed + ' accepted visits start the profile.', known: false };
    var h = '<section class="panel panel--wide" aria-labelledby="loc-title"><div class="panel__head"><div><h2 class="panel__title" id="loc-title">Site location</h2><p class="panel__sub">Edit where a site is, review the change, and see what the network profile has learned.</p></div>' +
      '<div class="field" style="min-width:220px"><label class="sr-only" for="loc-site">Site</label><select class="select" id="loc-site">' + D.sites.map(function (x) { return '<option value="' + x.id + '"' + (x.id === s.id ? ' selected' : '') + '>' + x.id + ' · ' + esc(x.name) + '</option>'; }).join('') + '</select></div></div><div class="settings__body">';
    h += '<dl class="kv site-current"><dt>Latitude</dt><dd class="mono">' + s.lat.toFixed(6) + '</dd><dt>Longitude</dt><dd class="mono">' + s.lng.toFixed(6) + '</dd><dt>Radius</dt><dd>' + s.radius_m + ' m</dd><dt>Country</dt><dd>' + (s.country || '-') + '</dd><dt>Label</dt><dd>' + esc(s.label || '-') + '</dd><dt>Last changed</dt><dd>' + (changes[0] ? whenText(changes[0].at) : 'before the change log existed') + '</dd></dl>';

    // Learned network
    h += '<div class="learned"><h3 class="quality__h">' + I('activity') + ' Learned network (the site’s fingerprint)</h3><p class="learned__headline' + (learned.known ? ' is-ok' : '') + '">' + learned.headline + '</p>';
    if (pf.rows.length) {
      h += '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">What</th><th scope="col">Value</th><th scope="col">Visits</th><th scope="col">Last seen</th></tr></thead><tbody>' + pf.rows.map(function (r) { return '<tr><td>' + r.kind + '</td><td><div class="cell-stack"><span class="mono">' + r.key + '</span><small>' + esc(r.meaning) + '</small></div></td><td class="num">' + r.count + '</td><td class="text-2">' + r.last + '</td></tr>'; }).join('') + '</tbody></table></div>';
      h += '<p class="text-xs text-2">Stored: speed classes and provider numbers only, never an IP address.</p>';
      if (!M.forgetAsk) h += '<button class="btn btn--sm btn--danger" id="forget-now" style="width:fit-content">Forget the learned network</button>';
      else h += '<div class="inline-confirm" role="alertdialog" aria-label="Confirm forgetting the learned network"><span>This forgets all ' + pf.rows.length + ' rows above. The next ' + pf.needed + ' trusted visits rebuild it.</span><button class="btn btn--sm btn--danger-solid" id="forget-yes">Yes, forget it</button><button class="btn btn--sm btn--ghost" id="forget-no">Keep it</button></div>';
    }
    h += '</div>';

    // Edit form
    h += '<form id="loc-form" class="loc-form" novalidate aria-label="Edit site location"><h3 class="quality__h">' + I('map-pin') + ' Change the location</h3><div class="sites-form__grid">' +
      field('lf-lat', 'Latitude', f.lat, 'inputmode="decimal" autocomplete="off"') + field('lf-lng', 'Longitude', f.lng, 'inputmode="decimal" autocomplete="off"') + field('lf-r', 'Radius (m)', f.radius_m, 'inputmode="numeric" autocomplete="off"') + field('lf-c', 'Country', f.country, 'maxlength="2" autocomplete="off"') + field('lf-l', 'Label', f.label, 'maxlength="80" placeholder="e.g. Hackathon venue" autocomplete="off"') + '</div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn btn--sm" id="lf-here">' + I('navigation') + 'Use my current location</button><span class="text-xs text-2">Stand at the place and tap this, or type the values. On a phone this needs the HTTPS address.</span></div>';
    if (M.fix) { var an = accuracyNote(M.fix.accuracy); h += '<p class="note note--' + an.tone + '" role="status">' + an.text + '</p>'; }
    if (mv.text) h += '<p class="note note--' + (mv.kind === 'big' ? 'warn' : 'neutral') + '">' + mv.text + '</p>';
    h += '<label class="check-row" style="align-items:flex-start"><input type="checkbox" id="lf-reset"' + (M.reset ? ' checked' : '') + ' style="margin-top:3px"/><span><b>Forget the learned network for this site</b><span class="text-2"> The system learns the usual network here from accepted visits. If the site moves far, the old place’s network would make the new place look “unseen”. ' + (mv.kind === 'big' ? 'Ticked because the move is more than 1 km. Untick to keep what was learned.' : 'Left unticked because the move is under 1 km. Tick it to forget what was learned anyway.') + '</span></span></label>';
    if (v && (f.lat !== '' || f.lng !== '')) h += '<div class="field__error" role="alert">' + I('circle-alert') + esc(v) + '</div>';
    if (M.error) h += '<div class="field__error" role="alert">' + I('circle-alert') + esc(M.error) + '</div>';
    if (M.step === 'edit') h += '<div><button type="submit" class="btn btn--primary" id="lf-review"' + (v || unchanged ? ' disabled' : '') + '>Review change</button></div>';
    h += '</form>';

    if (M.step === 'confirm') {
      h += '<div class="confirm-box" role="region" aria-label="Confirm change"><h3 class="quality__h">Confirm: old → new</h3><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Field</th><th scope="col">Now</th><th scope="col">After saving</th></tr></thead><tbody>' +
        diffRows(s, f).map(function (r) { return '<tr' + (r.changed ? ' class="is-differs"' : '') + '><td>' + r.name + '</td><td class="num text-2">' + esc(r.from) + '</td><td class="num">' + (r.changed ? esc(r.to) : '<span class="text-2">' + esc(r.to) + ' (same)</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        (mv.text ? '<p class="note note--' + (mv.kind === 'big' ? 'warn' : 'neutral') + '">' + mv.text + '</p>' : '') +
        '<p class="text-2 text-sm">' + (M.reset ? 'The learned network for this site will be forgotten.' : 'The learned network for this site will be kept.') + '</p>' +
        '<div style="display:flex;gap:8px"><button class="btn btn--primary" id="lf-confirm"' + (M.busy ? ' disabled' : '') + '>Confirm and save</button><button class="btn btn--ghost" id="lf-back">Back</button></div></div>';
    }

    // Change log
    h += '<div class="changelog"><h3 class="quality__h">' + I('history') + ' Change log</h3>' + (changes.length ? '<ul class="changelog__list">' + changes.map(function (c) { return '<li><span class="mono text-2">' + whenText(c.at) + '</span><span>' + esc(c.what) + '</span>' + (c.network ? '<span class="text-2">' + esc(c.network) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="text-2 text-sm">No changes recorded yet.</p>') + '</div>';
    return h + '</div></section>';
  }

  function render(keepFocus) {
    var active = keepFocus && document.activeElement && document.activeElement.id;
    if (!M.form) M.form = formFrom(site());
    M.container.innerHTML = sitesPanel() + locationPanel();
    wire();
    if (active) { var n = document.getElementById(active); if (n) { n.focus(); if (n.setSelectionRange && /^(lf|as)-/.test(active) && n.type !== 'checkbox') { var l = n.value.length; try { n.setSelectionRange(l, l); } catch (e) { /* not a text input */ } } } }
  }

  function selectSite(id) { M.siteId = id; M.form = formFrom(site()); M.step = 'edit'; M.fix = null; M.error = null; M.forgetAsk = false; M.resetTouched = false; M.reset = false; }
  function syncReset() { if (!M.resetTouched) M.reset = moveLine(site(), M.form).kind === 'big'; }

  function wire() {
    var c = M.container;
    $$('[data-reset]', c).forEach(function (b) { b.addEventListener('click', function () { confirmReset(D.siteById[b.dataset.reset], b, function () { render(); }); }); });
    $$('[data-edit]', c).forEach(function (b) { b.addEventListener('click', function () { selectSite(b.dataset.edit); render(); $('#loc-title').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#lf-lat').focus(); }); });
    $('#loc-site', c).addEventListener('change', function (e) { selectSite(e.target.value); render(true); });

    // Add a site
    var af = $('#add-site', c), map = { 'as-id': 'site_id', 'as-lat': 'lat', 'as-lng': 'lng', 'as-r': 'radius_m', 'as-c': 'country' };
    Object.keys(map).forEach(function (id) { $('#' + id, c).addEventListener('input', function (e) { M.addForm[map[id]] = e.target.value; M.addError = null; }); });
    $('#as-here', c).addEventListener('click', function () { locate().then(function (p) { M.addForm.lat = p.lat.toFixed(6); M.addForm.lng = p.lng.toFixed(6); TL.toast({ title: 'Location found', text: 'Accurate to about ' + Math.round(p.accuracy) + ' m.' }); render(); }, function (e) { TL.toast({ type: 'error', title: 'Could not get your location', text: e.message }); }); });
    af.addEventListener('submit', function (e) {
      e.preventDefault();
      var a = M.addForm, id = a.site_id.trim(), bad = !id ? 'Enter a site ID.' : !/^[A-Za-z0-9_-]+$/.test(id) ? 'The site ID can only use letters, numbers, dashes and underscores.' : D.siteById[id] ? 'A site with this ID already exists. Use “Edit location” instead.' : validate(a);
      if (bad) { M.addError = bad; render(); $('#as-id').focus(); return; }
      var s = { id: id, name: a.site_id.trim(), city: '', lat: +a.lat, lng: +a.lng, radius_m: +a.radius_m, country: (a.country || '').toUpperCase(), label: '' };
      D.sites.push(s); D.siteById[id] = s; D.profiles[id] = { visits: 0, needed: 3, rows: [] }; D.siteChanges[id] = [{ id: 1, at: new Date().toISOString(), what: 'Site registered', network: null }];
      M.addForm = { site_id: '', lat: '', lng: '', radius_m: '80', country: 'IN', label: '' }; M.addError = null; TL.toast({ title: 'Site ' + id + ' saved' }); render();
    });

    // Location form
    var fm = { 'lf-lat': 'lat', 'lf-lng': 'lng', 'lf-r': 'radius_m', 'lf-c': 'country', 'lf-l': 'label' };
    Object.keys(fm).forEach(function (id) { $('#' + id, c).addEventListener('input', function (e) { M.form[fm[id]] = e.target.value; M.error = null; M.step = 'edit'; syncReset(); render(true); }); });
    $('#lf-reset', c).addEventListener('change', function (e) { M.resetTouched = true; M.reset = e.target.checked; render(true); });
    $('#lf-here', c).addEventListener('click', function () { locate().then(function (p) { M.form.lat = p.lat.toFixed(6); M.form.lng = p.lng.toFixed(6); M.fix = { accuracy: p.accuracy }; M.step = 'edit'; syncReset(); render(); }, function (e) { M.fix = null; M.error = e.message; render(); }); });
    $('#loc-form', c).addEventListener('submit', function (e) { e.preventDefault(); if (!validate(M.form)) { M.step = 'confirm'; render(); var cb = $('#lf-confirm'); if (cb) cb.focus(); } });
    var back = $('#lf-back', c); if (back) back.addEventListener('click', function () { M.step = 'edit'; render(); $('#lf-review').focus(); });
    var ok = $('#lf-confirm', c); if (ok) ok.addEventListener('click', function () {
      var s = site(), f = M.form, mv = moveLine(s, f), changed = diffRows(s, f).filter(function (r) { return r.changed; }).map(function (r) { return r.name.toLowerCase(); });
      var what = (mv.text ? mv.text.replace(' That is a big move.', '').replace('Moves the site', 'Moved') : 'Updated ' + changed.join(', '));
      s.lat = +f.lat; s.lng = +f.lng; s.radius_m = +f.radius_m; s.country = (f.country || '').toUpperCase(); s.label = f.label;
      if (M.reset) D.profiles[s.id] = { visits: 0, needed: 3, rows: [] };
      D.siteChanges[s.id].unshift({ id: Date.now(), at: new Date().toISOString(), what: what, network: M.reset ? 'Learned network forgotten' : 'Learned network kept' });
      TL.toast({ title: 'Site ' + s.id + ' saved' + (M.reset ? ' · learned network forgotten' : '') });
      M.step = 'edit'; M.fix = null; M.form = formFrom(s); M.resetTouched = false; M.reset = false; render();
    });
    var fn = $('#forget-now', c); if (fn) fn.addEventListener('click', function () { M.forgetAsk = true; render(); $('#forget-no').focus(); });
    var fy = $('#forget-yes', c); if (fy) fy.addEventListener('click', function () { D.profiles[M.siteId] = { visits: 0, needed: 3, rows: [] }; M.forgetAsk = false; TL.toast({ title: 'Learned network forgotten', text: 'The next 3 trusted visits rebuild it.' }); render(); });
    var fnn = $('#forget-no', c); if (fnn) fnn.addEventListener('click', function () { M.forgetAsk = false; render(); $('#forget-now').focus(); });
  }

  TL.SiteSettings = { render: function (container) { M.container = container; render(); }, confirmReset: confirmReset };
})();
