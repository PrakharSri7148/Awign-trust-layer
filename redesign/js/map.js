/* Hex-dot submission map. Land dots are one SVG path (zero-length round-capped segments); markers are real <button>s
   positioned in % over the same box, so they stay crisp, focusable and keyboard-operable.
   Several submissions at one site are spread on a small spiral (a few px) so each stays clickable. */
(function () {
  'use strict';
  var TL = window.TL, MAPS = window.TL_MAPS;

  function project(view, lat, lng) {
    return { x: ((lng - view.lng0) / view.w) * 100, y: ((view.lat1 - lat) / view.h) * 100 };
  }
  function inView(view, lat, lng) { return lng >= view.lng0 && lng <= view.lng1 && lat >= view.lat0 && lat <= view.lat1; }

  /* opts: { root, viewKey, rows, activeId, onSelect(row), onOpen(row), hidden: Set(sevKey) } */
  function SubmissionMap(root, opts) {
    this.root = root; this.opts = opts; this.viewKey = opts.viewKey || 'asia'; this.pinned = null; this.hideT = null;
    this.render();
  }
  SubmissionMap.prototype.render = function () {
    var self = this, view = MAPS[this.viewKey], o = this.opts;
    var dotR = this.viewKey === 'world' ? 1.7 : 0.62;
    var html = '<div class="map__canvas" style="aspect-ratio:' + view.w + ' / ' + view.h + '">' +
      '<svg class="map__land" viewBox="0 0 ' + view.w + ' ' + view.h + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<path d="' + view.land + '" stroke="var(--map-dot)" stroke-width="' + dotR + '" stroke-linecap="round" fill="none"/>' +
      '<path d="' + view.india + '" stroke="var(--map-dot-home)" stroke-width="' + dotR + '" stroke-linecap="round" fill="none"/></svg>';

    // group by rounded location (site-level) to spread overlapping markers
    var groups = {}, outside = 0;
    var rows = o.rows.filter(function (r) { return !o.hidden.has(TL.severity(r.fraud_probability).key); });
    rows.forEach(function (r) {
      if (!inView(view, r.gps.lat, r.gps.lng)) { outside++; return; }
      var k = r.gps.lat.toFixed(1) + ',' + r.gps.lng.toFixed(1);
      (groups[k] = groups[k] || []).push(r);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k].sort(function (a, b) { return b.fraud_probability - a.fraud_probability; });
      g.forEach(function (r, i) {
        var p = project(view, r.gps.lat, r.gps.lng);
        var ang = i * 2.4, rad = i === 0 ? 0 : 6 + Math.sqrt(i) * 4; // golden-angle spiral, in px
        var s = TL.severity(r.fraud_probability);
        html += '<button class="map-marker map-marker--' + s.key + (r.id === o.activeId ? ' is-active' : '') + '" data-id="' + r.id + '"' +
          ' style="left:calc(' + p.x.toFixed(3) + '% + ' + (Math.cos(ang) * rad).toFixed(1) + 'px);top:calc(' + p.y.toFixed(3) + '% + ' + (Math.sin(ang) * rad).toFixed(1) + 'px);z-index:' + (s.rank + (r.id === o.activeId ? 10 : 0)) + '"' +
          ' aria-label="Case ' + r.id + ', ' + s.label + ', ' + TL.esc(TL_DATA.siteById[r.site_id].name) + (r.gps.place ? ', located in ' + TL.esc(r.gps.place) : '') + '"></button>';
      });
    });
    html += '<div class="tooltip-card map__tip" role="dialog" aria-label="Case preview" hidden></div></div>';
    if (outside) html += '<p class="map__outside text-xs text-2">' + outside + (outside === 1 ? ' submission is' : ' submissions are') + ' outside this view. Switch to World to see ' + (outside === 1 ? 'it' : 'them') + '.</p>';
    if (!rows.length) html += '<div class="map__empty empty-state">' + window.icon('map-pin') + '<div class="empty-state__title">No submissions to show</div><div class="empty-state__text">Turn on more severity levels in the legend below.</div></div>';
    this.root.innerHTML = html;
    this.tip = this.root.querySelector('.map__tip');

    TL.$$('.map-marker', this.root).forEach(function (m) {
      var row = TL_DATA.byId(m.dataset.id);
      m.addEventListener('mouseenter', function () { if (!self.pinned) self.show(m, row); });
      m.addEventListener('mouseleave', function () { if (!self.pinned) self.scheduleHide(); });
      m.addEventListener('focus', function () { self.show(m, row); });
      m.addEventListener('blur', function (e) { if (!self.tip.contains(e.relatedTarget) && !self.pinned) self.scheduleHide(); });
      m.addEventListener('click', function () { self.pinned = row.id; self.show(m, row); if (o.onSelect) o.onSelect(row); });
      m.addEventListener('keydown', function (e) { if (e.key === 'Enter' && self.pinned === row.id) { e.preventDefault(); o.onOpen(row); } });
    });
    this.tip.addEventListener('mouseenter', function () { clearTimeout(self.hideT); });
    this.tip.addEventListener('mouseleave', function () { if (!self.pinned) self.scheduleHide(); });
    this.root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !self.tip.hidden) { e.stopPropagation(); var id = self.pinned; self.hide(); var mk = id && self.root.querySelector('.map-marker[data-id="' + id + '"]'); if (mk) mk.focus(); } });
    this.root.addEventListener('click', function (e) { if (e.target.closest('.map__canvas') && !e.target.closest('.map-marker,.map__tip')) self.hide(); });
  };
  SubmissionMap.prototype.scheduleHide = function () { var s = this; clearTimeout(this.hideT); this.hideT = setTimeout(function () { s.hide(); }, 160); };
  SubmissionMap.prototype.hide = function () { this.pinned = null; this.tip.hidden = true; };
  SubmissionMap.prototype.show = function (marker, row) {
    clearTimeout(this.hideT);
    var s = TL.severity(row.fraud_probability), site = TL_DATA.siteById[row.site_id], o = this.opts;
    this.tip.innerHTML =
      '<button class="tooltip-card__head" data-open>' + '<span>' + TL.esc(row.task) + ' <span class="text-2 mono">#' + row.id + '</span></span>' + window.icon('chevron-right') + '</button>' +
      '<div class="tooltip-card__time">' + TL.fmtDateTime(row.timestamp) + '</div>' +
      '<dl><dt>Worker</dt><dd class="mono truncate">' + row.worker_id + '</dd>' +
      '<dt>Site</dt><dd class="truncate" title="' + TL.esc(site.name) + '">' + TL.esc(site.name) + '</dd>' +
      (row.gps.place ? '<dt>Located</dt><dd>' + TL.esc(row.gps.place) + '</dd>' : '') +
      '<dt>Fraud</dt><dd><span style="color:' + s.color + '">' + TL.pct(row.fraud_probability) + ' · ' + s.label + '</span></dd></dl>' +
      '<button class="btn btn--sm btn--block" data-open style="margin-top:10px">Open case ' + window.icon('chevron-right') + '</button>';
    TL.$$('[data-open]', this.tip).forEach(function (b) { b.addEventListener('click', function () { o.onOpen(row, marker); }); });
    this.tip.hidden = false;
    var c = this.root.querySelector('.map__canvas').getBoundingClientRect(), m = marker.getBoundingClientRect();
    var tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    var x = m.left - c.left + 14, y = m.top - c.top - th / 2;
    if (x + tw > c.width) x = m.left - c.left - tw - 8;
    x = Math.max(4, x); y = Math.max(4, Math.min(y, c.height - th - 4));
    this.tip.style.left = x + 'px'; this.tip.style.top = y + 'px';
  };
  SubmissionMap.prototype.update = function (patch) { Object.assign(this.opts, patch); if (patch.viewKey) this.viewKey = patch.viewKey; this.pinned = null; this.render(); };
  SubmissionMap.prototype.setActive = function (id) {
    this.opts.activeId = id;
    TL.$$('.map-marker', this.root).forEach(function (m) {
      var on = +m.dataset.id === id;
      m.classList.toggle('is-active', on);
      m.style.zIndex = on ? 20 : '';
    });
  };

  window.TL.SubmissionMap = SubmissionMap;
})();
