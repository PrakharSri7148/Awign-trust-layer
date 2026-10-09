/* Reviewer console. One state object, small render functions, event delegation on the tables. */
(function () {
  'use strict';
  var TL = window.TL, D = window.TL_DATA, I = window.icon, esc = TL.esc, $ = TL.$, $$ = TL.$$;
  TL.initTheme('dark');

  /* ---------- State ---------- */
  var VIEWS = [
    { key: 'overview', label: 'Overview', icon: 'layout-grid' },
    { key: 'queue', label: 'Review queue', icon: 'triangle-alert' },
    { key: 'submissions', label: 'Submissions', icon: 'list' },
    { key: 'map', label: 'Map', icon: 'globe' },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];
  var KPIS = [
    { key: 'submissions', label: 'Submissions', lens: 'All submissions in the last 7 days' },
    { key: 'flagged', label: 'Flagged', lens: 'Flagged submissions only' },
    { key: 'accepted', label: 'Accepted', lens: 'Accepted (not flagged) submissions only' },
    { key: 'rate', label: 'Flag rate', lens: 'Submissions from sites with an above-average flag rate' },
    { key: 'avg', label: 'Avg fraud probability', lens: 'Submissions scoring above the average' },
  ];
  var q = new URLSearchParams(location.search);
  var S = {
    view: VIEWS.some(function (v) { return v.key === q.get('view'); }) ? q.get('view') : 'overview',
    kpi: 'submissions', loading: true, activeId: null, hidden: new Set(), mapView: 'asia', mapTable: false,
    qSort: { key: null, dir: 'desc' }, sSort: { key: 'time', dir: 'desc' },
    status: 'all', range: '7', photo: 'all', search: '', page: 1, per: 10, topBy: 'worker', openNeed: null, refreshing: false, lastUpdated: 'Updated just now',
    list: [],
  };
  var map = null, lastOpener = null;

  /* ---------- Derived data ---------- */
  var DAY = 86400000;
  function age(r) { return Date.now() - new Date(r.timestamp).getTime(); }
  function inRange(r) { return S.range === 'all' || age(r) <= +S.range * DAY; }
  function allRows() { return D.rows.filter(function (r) { return age(r) <= 7 * DAY; }); }
  function stats(rows) {
    var fl = rows.filter(function (r) { return r.status === 'flagged'; });
    return { n: rows.length, flagged: fl.length, rate: rows.length ? fl.length / rows.length : 0, avg: rows.length ? rows.reduce(function (a, r) { return a + r.fraud_probability; }, 0) / rows.length : 0 };
  }
  function lensRows() {
    var rows = allRows(), st = stats(rows);
    if (S.kpi === 'flagged') return rows.filter(function (r) { return r.status === 'flagged'; });
    if (S.kpi === 'accepted') return rows.filter(function (r) { return r.status !== 'flagged'; });
    if (S.kpi === 'avg') return rows.filter(function (r) { return r.fraud_probability >= st.avg; });
    if (S.kpi === 'rate') {
      var hot = {};
      D.sites.forEach(function (s) { var sr = rows.filter(function (r) { return r.site_id === s.id; }); if (sr.length && stats(sr).rate > st.rate) hot[s.id] = 1; });
      return rows.filter(function (r) { return hot[r.site_id]; });
    }
    return rows;
  }
  var STATUS_RANK = { open: 0, resolved: 1, accepted: 2 };
  function cmp(key) {
    return {
      id: function (a, b) { return a.id - b.id; }, case: function (a, b) { return a.id - b.id; },
      task: function (a, b) { return a.task.localeCompare(b.task); },
      time: function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); },
      worker: function (a, b) { return a.worker_id.localeCompare(b.worker_id, undefined, { numeric: true }); },
      site: function (a, b) { return D.siteById[a.site_id].name.localeCompare(D.siteById[b.site_id].name); },
      severity: function (a, b) { return a.fraud_probability - b.fraud_probability; },
      status: function (a, b) { return STATUS_RANK[TL.statusOf(a).key] - STATUS_RANK[TL.statusOf(b).key]; },
    }[key];
  }
  function sortRows(rows, sort) {
    var out = rows.slice();
    if (!sort.key) { // actionable first: open, then most severe, then newest
      return out.sort(function (a, b) { return STATUS_RANK[TL.statusOf(a).key] - STATUS_RANK[TL.statusOf(b).key] || b.fraud_probability - a.fraud_probability || new Date(b.timestamp) - new Date(a.timestamp); });
    }
    var f = cmp(sort.key); return out.sort(function (a, b) { return sort.dir === 'asc' ? f(a, b) : f(b, a); });
  }
  function needsRows() {
    return D.rows.filter(function (r) { return r.status === 'flagged' && !r.review; })
      .sort(function (a, b) { return b.fraud_probability - a.fraud_probability || new Date(b.timestamp) - new Date(a.timestamp); });
  }

  /* ---------- Nav ---------- */
  function renderNav() {
    $$('[data-nav]').forEach(function (nav) {
      var bottom = nav.hasAttribute('data-bottom');
      nav.innerHTML = VIEWS.map(function (v) {
        var cur = v.key === S.view;
        return '<button class="nav-tab" data-view="' + v.key + '" aria-label="' + v.label + '"' + (cur ? ' aria-current="page"' : '') + (bottom ? '' : ' data-tip="' + v.label + '"') + '>' + I(v.icon) + (bottom ? '<span>' + (v.key === 'queue' ? 'Queue' : v.label) + '</span>' : '') + '</button>';
      }).join('');
      $$('.nav-tab', nav).forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.view); }); });
    });
  }
  function setView(v) {
    S.view = v;
    var u = new URL(location.href); if (v === 'overview') u.searchParams.delete('view'); else u.searchParams.set('view', v);
    history.replaceState(null, '', u.pathname + u.search + u.hash);
    var main = $('#main'); main.dataset.view = v;
    $('#settings').hidden = v !== 'settings';
    $('#view-title').textContent = VIEWS.filter(function (x) { return x.key === v; })[0].label;
    document.title = $('#view-title').textContent + ' · Trust Layer';
    renderNav(); renderAll();
    if (v === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  /* ---------- KPI tabs ---------- */
  function buckets(fn) {
    var out = [];
    for (var d = 6; d >= 0; d--) {
      var rows = D.rows.filter(function (r) { var a = age(r); return a >= d * DAY && a < (d + 1) * DAY; });
      out.push(fn(rows));
    }
    return out;
  }
  var PREV = { submissions: 37, flagged: 15, accepted: 22, rate: 0.41, avg: 0.39 }; // mock figures for the previous 7 days
  function renderKpis() {
    var st = stats(allRows());
    var vals = {
      submissions: { v: st.n, t: String(st.n), cur: st.n, trend: buckets(function (r) { return r.length; }) },
      flagged: { v: st.flagged, t: String(st.flagged), cur: st.flagged, trend: buckets(function (r) { return r.filter(function (x) { return x.status === 'flagged'; }).length; }) },
      accepted: { t: String(st.n - st.flagged), cur: st.n - st.flagged, trend: buckets(function (r) { return r.filter(function (x) { return x.status !== 'flagged'; }).length; }) },
      rate: { t: Math.round(st.rate * 100) + '%', cur: st.rate, trend: buckets(function (r) { return r.length ? stats(r).rate : 0; }) },
      avg: { t: TL.pct(st.avg), cur: st.avg, trend: buckets(function (r) { return r.length ? stats(r).avg : 0; }) },
    };
    $('#kpis').innerHTML = KPIS.map(function (k) {
      var x = vals[k.key], on = S.kpi === k.key;
      var d = Math.round(((x.cur - PREV[k.key]) / PREV[k.key]) * 100);
      var good = k.key === 'submissions' ? null : k.key === 'accepted' ? d >= 0 : d <= 0; // more submissions is neutral; more flags or higher fraud is bad
      var cls = good === null ? 'neutral' : good ? 'ok' : 'bad';
      var arrow = d >= 0 ? 'arrow-up' : 'arrow-down';
      return '<button class="kpi-tab" role="tab" id="kpi-' + k.key + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-kpi="' + k.key + '" aria-controls="queue-panel">' +
        '<span class="kpi-tab__label">' + k.label + '</span>' +
        '<span class="kpi-tab__value">' + (S.loading ? '<span class="skeleton" style="width:56px;height:28px"></span>' : x.t) + '</span>' +
        '<span class="kpi-tab__meta">' + (S.loading ? '' : TL.trend(x.trend) + '<span class="pill pill--' + cls + '">' + I(arrow) + (d >= 0 ? '+' : '−') + Math.abs(d) + '%<span class="sr-only"> versus the previous 7 days</span></span>') + '</span></button>';
    }).join('');
    $('#queue-panel').setAttribute('aria-labelledby', 'kpi-' + S.kpi);
    var tabs = $$('.kpi-tab');
    tabs.forEach(function (b, i) {
      b.addEventListener('click', function () { S.kpi = b.dataset.kpi; S.activeId = null; renderKpis(); renderQueue(); renderMap(); $('#kpi-' + S.kpi).focus(); });
      b.addEventListener('keydown', function (e) {
        var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
        if (n === null) return; e.preventDefault(); tabs[(n + tabs.length) % tabs.length].click();
      });
    });
  }

  /* ---------- Sortable headers ---------- */
  function renderHead(table, sort, labels) {
    $$('thead th[data-sort]', table).forEach(function (th) {
      var key = th.dataset.sort, on = sort.key === key;
      th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.innerHTML = '<button class="th-sort" data-sortkey="' + key + '">' + labels[key] + I(on ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down') + '</button>';
    });
  }
  function wireSort(table, sort, rerender) {
    table.querySelector('thead').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sortkey]'); if (!b) return;
      var k = b.dataset.sortkey;
      if (sort.key === k) { if (sort.dir === 'desc') sort.dir = 'asc'; else if (sort.def === k) { sort.dir = 'desc'; } else { sort.key = sort.def || null; sort.dir = 'desc'; } }
      else { sort.key = k; sort.dir = k === 'severity' || k === 'time' || k === 'id' ? 'desc' : 'asc'; }
      rerender();
      var nb = table.querySelector('[data-sortkey="' + k + '"]'); if (nb) nb.focus();
    });
  }
  function skelRows(n, cols) {
    var out = '';
    for (var i = 0; i < n; i++) { out += '<tr class="skel-row">'; for (var c = 0; c < cols; c++) out += '<td><span class="skeleton" style="height:14px;width:' + (c === 0 ? 70 : 50 + ((i + c) * 13) % 40) + '%"></span></td>'; out += '</tr>'; }
    return out;
  }
  function empty(icon, title, text, action) {
    return '<div class="empty-state">' + I(icon) + '<div class="empty-state__title">' + title + '</div><div class="empty-state__text">' + text + '</div>' + (action || '') + '</div>';
  }

  /* ---------- Review queue ---------- */
  var QL = { case: 'Case', worker: 'Worker / Site', time: 'Time', severity: 'Severity', status: 'Status' };
  function queueRows() { return sortRows(lensRows(), S.qSort); }
  function renderQueue() {
    var table = $('#queue-table'), tb = $('tbody', table);
    renderHead(table, S.qSort, QL);
    var lens = KPIS.filter(function (k) { return k.key === S.kpi; })[0];
    var note = $('#lens-note');
    note.hidden = S.kpi === 'submissions';
    if (!note.hidden) note.innerHTML = I('sliders-horizontal') + '<span>' + esc(lens.lens) + '</span><button class="btn btn--ghost btn--sm" id="clear-lens">Show all</button>';
    var rows = queueRows(), limit = S.view === 'queue' ? 40 : 7, shown = rows.slice(0, limit);
    if (S.loading) { tb.innerHTML = skelRows(6, 5); $('#queue-foot').innerHTML = ''; return; }
    if (!shown.length) {
      tb.innerHTML = '<tr><td colspan="5">' + empty('inbox', 'Nothing to review here', 'New submissions that need a decision will show up in this list as workers send them.') + '</td></tr>';
    } else {
      tb.innerHTML = shown.map(function (r) {
        var site = D.siteById[r.site_id];
        return '<tr tabindex="0" data-id="' + r.id + '" class="' + (r.id === S.activeId ? 'is-active' : '') + '" aria-label="Open case ' + r.id + '">' +
          '<td class="cell--primary" data-label="Case"><div class="cell-stack"><span>' + esc(r.task) + '</span><small class="mono">#' + r.id + '</small></div></td>' +
          '<td data-label="Worker / Site"><div class="cell-stack"><span class="mono truncate">' + r.worker_id + '</span><small class="truncate">' + esc(site.name) + '</small></div></td>' +
          '<td data-label="Time"><div class="cell-stack"><span class="num">' + TL.fmtClock(r.timestamp) + '</span><small>' + TL.fmtDay(r.timestamp) + '</small></div></td>' +
          '<td class="cell--end" data-label="Severity">' + TL.sevPill(r.fraud_probability) + '</td>' +
          '<td data-label="Status">' + TL.statusHtml(r) + '</td></tr>';
      }).join('');
    }
    var open = rows.filter(function (r) { return TL.statusOf(r).key === 'open'; }).length;
    var qc = $('#queue-count'); if (qc) qc.textContent = needsRows().length;
    $('#queue-foot').innerHTML = '<span>' + (shown.length ? 'Showing ' + shown.length + ' of ' + rows.length + ' · ' + open + ' open' : '') + '</span>';
    var clr = $('#clear-lens'); if (clr) clr.addEventListener('click', function () { S.kpi = 'submissions'; renderKpis(); renderQueue(); renderMap(); });
  }
  function wireRowLinks(tb) {
    tb.addEventListener('mouseover', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr && map) map.setActive(+tr.dataset.id); });
    tb.addEventListener('mouseleave', function () { if (map) map.setActive(S.activeId); });
    tb.addEventListener('focusin', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr && map) map.setActive(+tr.dataset.id); });
  }

  /* ---------- Map ---------- */
  var LEG = [['critical', 'Critical', 'var(--color-crit)'], ['high', 'High', 'var(--color-high)'], ['medium', 'Medium', 'var(--color-warn)'], ['low', 'Low', 'var(--color-neutral)']];
  function renderLegend() {
    var all = S.hidden.size === 0;
    $('#legend').innerHTML = LEG.map(function (l) {
      return '<button class="legend-chip" data-sev="' + l[0] + '" aria-pressed="' + !S.hidden.has(l[0]) + '"><span class="legend-chip__dot" style="--dot:' + l[2] + '"></span>' + l[1] + '</button>';
    }).join('') + '<button class="legend-chip legend-chip--all" data-sev="all" aria-pressed="' + all + '">All</button>';
  }
  function renderMap() {
    var rows = S.loading ? [] : lensRows();
    var opts = { rows: rows, activeId: S.activeId, hidden: S.hidden, viewKey: S.mapView, onSelect: function (r) { setActive(r.id, true); }, onOpen: function (r, el) { openCase(r.id, el); } };
    var root = $('#map');
    if (!map) map = new TL.SubmissionMap(root, opts); else map.update(opts);
    if (S.loading) root.innerHTML = '<div class="skeleton" style="height:240px;width:100%"></div>';
    renderMapTable(rows);
  }
  function renderMapTable(rows) {
    var el = $('#map-table');
    var vis = rows.filter(function (r) { return !S.hidden.has(TL.severity(r.fraud_probability).key); });
    el.innerHTML = '<table class="table"><caption class="sr-only">Submission locations</caption><thead><tr><th scope="col">Case</th><th scope="col">Site</th><th scope="col">Location</th><th scope="col">Severity</th></tr></thead><tbody>' +
      vis.map(function (r) { return '<tr><td><button class="btn btn--ghost btn--sm" data-open="' + r.id + '">#' + r.id + '</button></td><td>' + esc(D.siteById[r.site_id].name) + '</td><td class="mono">' + r.gps.lat.toFixed(3) + ', ' + r.gps.lng.toFixed(3) + '</td><td>' + TL.sevPill(r.fraud_probability) + '</td></tr>'; }).join('') + '</tbody></table>';
    $$('[data-open]', el).forEach(function (b) { b.addEventListener('click', function () { openCase(+b.dataset.open, b); }); });
    $('#map').hidden = S.mapTable; el.hidden = !S.mapTable;
    var tb = $('#map-astable'); tb.setAttribute('aria-pressed', S.mapTable);
    tb.setAttribute('aria-label', S.mapTable ? 'Show map' : 'Show map as a table'); tb.dataset.tip = S.mapTable ? 'Show map' : 'Show as table';
    tb.innerHTML = I(S.mapTable ? 'map' : 'list');
  }
  function setActive(id, scroll) {
    S.activeId = id;
    $$('#queue-table tbody tr[data-id]').forEach(function (tr) { tr.classList.toggle('is-active', +tr.dataset.id === id); });
    if (map) map.setActive(id);
    var tr = $('#queue-table tbody tr[data-id="' + id + '"]');
    if (scroll && tr) tr.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- Needs review (accordion) + Refresh ---------- */
  function renderNeeds() {
    var list = $('#needs-list'), btn = $('#btn-refresh');
    btn.innerHTML = I('refresh-cw') + 'Refresh'; btn.classList.toggle('is-spinning', S.refreshing); btn.disabled = S.refreshing;
    btn.setAttribute('aria-label', S.refreshing ? 'Refreshing' : 'Refresh needs review list');
    $('#needs-updated').textContent = S.refreshing ? 'Refreshing…' : S.lastUpdated;
    if (S.loading || S.refreshing) { list.innerHTML = [1, 2, 3, 4].map(function () { return '<div class="accordion__item" style="padding:14px"><span class="skeleton" style="height:14px;width:60%"></span><span class="skeleton" style="height:10px;width:30%;margin-top:8px"></span></div>'; }).join(''); list.setAttribute('aria-busy', 'true'); return; }
    list.removeAttribute('aria-busy');
    var rows = needsRows().slice(0, 5);
    if (!rows.length) { list.innerHTML = empty('circle-check', 'All caught up', 'There is nothing waiting for a decision. New flagged cases will appear here.'); return; }
    if (S.openNeed === null || !rows.some(function (r) { return r.id === S.openNeed; })) S.openNeed = S.openNeed === 0 ? 0 : rows[0].id;
    list.innerHTML = rows.map(function (r) {
      var open = r.id === S.openNeed, site = D.siteById[r.site_id], crit = TL.severity(r.fraud_probability).key === 'critical';
      return '<div class="accordion__item' + (open ? ' is-open' : '') + '">' +
        '<button class="accordion__trigger" aria-expanded="' + open + '" aria-controls="need-' + r.id + '" data-need="' + r.id + '"><span><span class="accordion__title">' + esc(TL.REASON_TITLE[r.reason_key]) + (crit ? '<span style="color:var(--color-crit)">' + I('triangle-alert') + '<span class="sr-only">Critical</span></span>' : '') + '</span><span class="accordion__meta">' + TL.relTime(r.timestamp) + ' · #' + r.id + '</span></span>' + I('chevron-down', 'accordion__chev') + '</button>' +
        '<div class="accordion__panel" id="need-' + r.id + '" role="region"' + (open ? '' : ' hidden') + '><div class="needs-summary"><p>' + esc(r.top_reason) + '.</p>' + (r.review_reasons && r.review_reasons.length ? '<p class="text-xs text-2">Why it is here: ' + r.review_reasons.map(function (x) { return esc(D.REVIEW_WHY[x] || x); }).join(' \u00b7 ') + '</p>' : '') +
        '<dl class="kv"><dt class="text-2">Affected site</dt><dd>' + esc(site.name) + '</dd><dt class="text-2">Severity</dt><dd>' + TL.sevPill(r.fraud_probability) + '</dd></dl>' +
        '<button class="btn btn--block" data-details="' + r.id + '" style="margin-top:6px">More details</button></div></div></div>';
    }).join('');
  }

  /* ---------- Top flagged sources ---------- */
  function renderSources() {
    var counts = {};
    D.rows.filter(function (r) { return r.status === 'flagged'; }).forEach(function (r) { var k = S.topBy === 'worker' ? r.worker_id : r.site_id; counts[k] = (counts[k] || 0) + 1; });
    var items = Object.keys(counts).map(function (k) { return [k, counts[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
    $('#sources').innerHTML = items.length ? items.map(function (it, i) {
      var name = S.topBy === 'worker' ? '<span class="mono">' + it[0] + '</span>' : esc(D.siteById[it[0]].name);
      var sub = S.topBy === 'worker' ? esc(D.workerById[it[0]].name) : esc(D.siteById[it[0]].city);
      return '<li><button class="source-row" data-source="' + it[0] + '"><span class="source-row__rank">' + (i + 1) + '</span><span class="source-row__main"><span class="truncate" style="display:block">' + name + '</span><small>' + sub + '</small></span><span class="badge-count" aria-label="' + it[1] + ' flagged">' + it[1] + '</span></button></li>';
    }).join('') : '<li>' + empty('inbox', 'No flagged sources', 'Nothing has been flagged yet.') + '</li>';
    $$('#top-by .segmented__item').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.by === S.topBy); });
  }

  /* ---------- All submissions ---------- */
  var SL = { id: 'ID', task: 'Task', time: 'Date', worker: 'Worker', site: 'Site', severity: 'Severity', status: 'Status' };
  function matchesPhoto(r, f) {
    return f === 'all' || (f === 'any' && (r.quality_flags.length > 0 || r.photo_verdict === 'poor')) || (f === 'unverified' && r.photo_verdict === 'unverified') || r.quality_flags.indexOf(f) >= 0;
  }
  function subsRows() {
    var term = S.search.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (!inRange(r)) return false;
      if (S.status !== 'all' && TL.statusOf(r).key !== S.status) return false;
      if (!matchesPhoto(r, S.photo)) return false;
      if (term) { var hay = ('#' + r.id + ' ' + r.worker_id + ' ' + D.workerById[r.worker_id].name + ' ' + D.siteById[r.site_id].name + ' ' + D.siteById[r.site_id].city + ' ' + r.task + ' ' + r.task_id).toLowerCase(); if (hay.indexOf(term) < 0) return false; }
      return true;
    });
    return sortRows(rows, S.sSort);
  }
  function renderSubs() {
    var table = $('#subs-table'), tb = $('tbody', table);
    renderHead(table, S.sSort, SL);
    var ps = $('#subs-photo'), flagsSeen = [];
    D.rows.forEach(function (r) { r.quality_flags.forEach(function (f) { if (flagsSeen.indexOf(f) < 0) flagsSeen.push(f); }); });
    flagsSeen.sort();
    ps.innerHTML = '<option value="all">Photo: all</option><option value="any">Photo: any issue</option><option value="unverified">Photo: unverified</option>' + flagsSeen.map(function (f) { return '<option value="' + esc(f) + '">Photo: ' + esc(f) + '</option>'; }).join('');
    ps.value = S.photo;
    renderBanner();
    if (S.loading) { tb.innerHTML = skelRows(6, 8); $('#pager').innerHTML = ''; $('#subs-count').textContent = 'Loading…'; return; }
    var rows = subsRows(), pages = Math.max(1, Math.ceil(rows.length / S.per));
    S.page = Math.min(S.page, pages);
    var start = (S.page - 1) * S.per, shown = rows.slice(start, start + S.per);
    S.list = rows.map(function (r) { return r.id; });
    $('#subs-count').textContent = rows.length + ' of ' + D.rows.length + ' shown';
    if (!shown.length) {
      tb.innerHTML = '<tr><td colspan="8">' + empty('search', 'No submissions match these filters', 'Try a different search, status or date range.', '<button class="btn btn--sm" id="clear-filters" style="margin-top:6px">Clear filters</button>') + '</td></tr>';
      $('#pager').innerHTML = '';
      $('#clear-filters').addEventListener('click', function () { S.search = ''; S.status = 'all'; S.range = 'all'; S.photo = 'all'; $('#subs-search').value = ''; $('#subs-status').value = 'all'; $('#subs-range').value = 'all'; $('#subs-photo').value = 'all'; renderSubs(); });
      return;
    }
    tb.innerHTML = shown.map(function (r) {
      var site = D.siteById[r.site_id];
      return '<tr tabindex="0" data-id="' + r.id + '" aria-label="Open case ' + r.id + '">' +
        '<td class="cell--primary" data-label="ID"><span class="mono">#' + r.id + '</span></td>' +
        '<td class="cell--wide" data-label="Task">' + esc(r.task) + '</td>' +
        '<td data-label="Date"><div class="cell-stack"><span>' + TL.fmtDay(r.timestamp) + '</span><small class="num">' + TL.fmtClock(r.timestamp) + '</small></div></td>' +
        '<td data-label="Worker"><span class="mono">' + r.worker_id + '</span></td>' +
        '<td data-label="Site"><div class="cell-stack"><span class="truncate">' + esc(site.name) + '</span><small>' + esc(site.city) + '</small></div></td>' +
        '<td class="cell--end" data-label="Severity"><span class="sev-cell">' + TL.sevPill(r.fraud_probability) + '<span class="num text-2 text-xs">' + TL.pct(r.fraud_probability) + '</span></span></td>' +
        '<td data-label="Status"><div class="cell-stack">' + TL.statusHtml(r) + (r.review ? '<small>' + esc(TL.DECISION[r.review.decision].label.toLowerCase()) + ' by ' + esc(r.review.reviewer) + '</small>' : '') + '</div></td>' +
        '<td class="cell--wide"><button class="icon-btn" data-kebab="' + r.id + '" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for case ' + r.id + '">' + I('ellipsis-vertical') + '</button></td></tr>';
    }).join('');
    $('#pager').innerHTML = '<span>Showing ' + (start + 1) + '–' + (start + shown.length) + ' of ' + rows.length + '</span>' +
      '<div class="pager__btns"><button class="btn btn--sm" data-page="-1"' + (S.page <= 1 ? ' disabled' : '') + '>' + I('chevron-left') + 'Previous</button><span style="align-self:center">Page ' + S.page + ' of ' + pages + '</span><button class="btn btn--sm" data-page="1"' + (S.page >= pages ? ' disabled' : '') + '>Next' + I('chevron-right') + '</button></div>';
  }
  /* Load problems: the access-token prompt (?auth=required) and the generic error with Retry (?error=1) */
  var TOKEN_KEY = 'tl.token';
  function hasToken() { try { return !!sessionStorage.getItem(TOKEN_KEY); } catch (e) { return false; } }
  function renderBanner() {
    var el = $('#subs-banner'), locked = q.get('auth') === 'required' && !hasToken() && !S.unlocked, failed = q.get('error') === '1' && !S.retried;
    if (locked) {
      el.hidden = false; el.className = 'banner banner--error';
      el.innerHTML = '<form class="banner__form" role="alert"><span>' + I('lock') + 'This dashboard needs an access token.</span><label class="sr-only" for="tok">Access token</label><input class="input" id="tok" name="token" type="password" autocomplete="off" placeholder="Access token" /><button class="btn btn--primary btn--sm" type="submit">Unlock</button></form>';
      $('form', el).addEventListener('submit', function (e) { e.preventDefault(); var v = $('#tok', el).value.trim(); if (!v) { $('#tok', el).focus(); return; } try { sessionStorage.setItem(TOKEN_KEY, v); } catch (x) { /* kept in memory only */ } S.unlocked = true; TL.toast({ title: 'Unlocked' }); renderSubs(); });
    } else if (failed) {
      el.hidden = false; el.className = 'banner banner--error';
      el.innerHTML = '<div role="alert" class="banner__form"><span>' + I('circle-alert') + 'We could not load the latest submissions. Check your connection and try again.</span><button class="btn btn--sm btn--danger" id="retry">Retry</button></div>';
      $('#retry', el).addEventListener('click', function () { S.retried = true; S.loading = true; renderAll(); setTimeout(function () { S.loading = false; renderAll(); }, 700); });
    } else { el.hidden = true; el.innerHTML = ''; }
  }

  function kebab(btn) {
    var id = +btn.dataset.kebab;
    TL.popover(btn, '<button class="menu__item" role="menuitem" data-act="open">' + I('eye') + 'Open case</button><div class="menu__sep" role="separator"></div>' +
      '<button class="menu__item" role="menuitem" data-act="approve">' + I('circle-check') + 'Approve…</button>' +
      '<button class="menu__item" role="menuitem" data-act="reject">' + I('circle-x') + 'Reject…</button>' +
      '<button class="menu__item" role="menuitem" data-act="retake">' + I('rotate-ccw') + 'Needs retake…</button><div class="menu__sep" role="separator"></div>' +
      '<button class="menu__item" role="menuitem" data-act="copy">' + I('copy') + 'Copy case link</button>', {
      label: 'Actions for case ' + id,
      onMount: function (el, close) {
        $$('[data-act]', el).forEach(function (b) {
          b.addEventListener('click', function () {
            var act = b.dataset.act; close();
            if (act === 'copy') {
              var url = location.origin + location.pathname + '#case/' + id;
              (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { TL.toast({ title: 'Link copied', text: 'Case #' + id }); }, function () { TL.toast({ type: 'error', title: 'Could not copy the link', text: 'Copy it from the address bar after opening the case.' }); });
            } else openCase(id, btn, act === 'open' ? null : act);
          });
        });
      },
    });
  }

  /* ---------- Case deep link ---------- */
  function openCase(id, opener, decision) {
    lastOpener = opener || document.activeElement;
    S.openDecision = decision || null;
    var h = '#case/' + id;
    if (location.hash === h) syncHash(); else location.hash = h;
  }
  function syncHash() {
    var m = /^#case\/(\d+)$/.exec(location.hash);
    if (!m) { if (TL.CaseFile.isOpen()) TL.CaseFile.close(); return; }
    var row = D.byId(m[1]);
    if (!row) { TL.toast({ type: 'error', title: 'Case #' + m[1] + ' was not found', text: 'It may have been removed or the link is wrong.' }); history.replaceState(null, '', location.pathname + location.search); return; }
    TL.CaseFile.open(row, {
      list: S.list.length ? S.list : D.rows.map(function (r) { return r.id; }), decision: S.openDecision,
      onNavigate: function (nid) { history.replaceState(null, '', '#case/' + nid); TL.CaseFile.open(D.byId(nid), { decision: null }); },
      onDecided: function () { renderAll(); },
      onClose: function (r) {
        history.replaceState(null, '', location.pathname + location.search);
        // The opener may have been re-rendered (a decision re-sorts the lists); fall back to the same case's row, then to the page.
        var back = (lastOpener && document.contains(lastOpener) && lastOpener) || $('tr[data-id="' + r.id + '"]') || $('#main');
        if (back) back.focus();
        S.openDecision = null; lastOpener = null;
      },
    });
    S.openDecision = null;
  }

  /* ---------- Settings (hosts the destructive network-profile reset) ---------- */
  function renderSettings() {
    var theme = document.documentElement.getAttribute('data-theme');
    $('#settings').innerHTML = '<div class="settings">' +
      '<section class="panel"><div class="panel__head"><h2 class="panel__title">Appearance</h2></div><div class="settings__body"><p class="settings-note">The console is dark by default. Light is easier to read outdoors.</p>' +
      '<div class="segmented" role="radiogroup" aria-label="Theme" id="theme-seg" style="width:fit-content"><button class="segmented__item" role="radio" aria-checked="' + (theme === 'dark') + '" data-theme-set="dark">' + I('moon') + 'Dark</button><button class="segmented__item" role="radio" aria-checked="' + (theme === 'light') + '" data-theme-set="light">' + I('sun') + 'Light</button></div></div></section>' +
      '<section class="panel"><div class="panel__head"><h2 class="panel__title">Notifications</h2></div><div class="settings__body">' +
      '<label class="check-row"><input type="checkbox" checked /> Critical cases, as they arrive</label><label class="check-row"><input type="checkbox" checked /> Daily summary of open cases</label><label class="check-row"><input type="checkbox" /> Cases assigned to me only</label></div></section>' +
      '<section class="panel"><div class="panel__head"><h2 class="panel__title">Severity levels</h2></div><div class="settings__body"><p class="settings-note">Severity is set from the fraud probability. These levels are fixed for the whole team.</p><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Level</th><th scope="col">Fraud probability</th></tr></thead><tbody>' +
      '<tr><td><span class="pill pill--critical">Critical</span></td><td class="num">80% and above</td></tr><tr><td><span class="pill pill--high">High</span></td><td class="num">60% to 79%</td></tr><tr><td><span class="pill pill--medium">Medium</span></td><td class="num">40% to 59%</td></tr><tr><td><span class="pill pill--low">Low</span></td><td class="num">Below 40%</td></tr></tbody></table></div></div></section>' +
      '<section class="panel"><div class="panel__head"><h2 class="panel__title">Reviewer</h2></div><div class="settings__body"><dl class="kv"><dt>Name</dt><dd>Anita Rao</dd><dt>Role</dt><dd>Ops reviewer</dd><dt>Email</dt><dd>anita.rao@example.com</dd></dl></div></section>' +
      '</div><div class="settings" id="site-settings" style="padding-top:0"></div>';
    $$('[data-theme-set]').forEach(function (b) { b.addEventListener('click', function () { TL.setTheme(b.dataset.themeSet); renderSettings(); $('[data-theme-set="' + b.dataset.themeSet + '"]').focus(); }); });
    TL.SiteSettings.render($('#site-settings'));
  }
  /* ---------- Top bar: search, notifications, account ---------- */
  function wireTopbar() {
    $('#btn-search').innerHTML = I('search'); $('#btn-bell').innerHTML = I('bell'); $('#subs-search-icon').innerHTML = I('search');
    $('#btn-search').addEventListener('click', function (e) {
      TL.popover(e.currentTarget, '<div class="input-group"><span>' + I('search') + '</span><input class="input" id="gs" type="search" placeholder="Case number, worker or site" aria-label="Search cases" /></div><ul id="gs-res" style="margin-top:6px" aria-label="Results"></ul>', {
        role: 'dialog', label: 'Search cases', width: 360, focus: false,
        onMount: function (el, close) {
          var inp = $('#gs', el), res = $('#gs-res', el);
          function show() {
            var t = inp.value.trim().toLowerCase().replace('#', '');
            var rows = t ? D.rows.filter(function (r) { return (r.id + ' ' + r.worker_id + ' ' + D.siteById[r.site_id].name + ' ' + r.task).toLowerCase().indexOf(t) >= 0; }).slice(0, 6) : [];
            res.innerHTML = !t ? '<li class="menu__label">Type to search all submissions</li>' : rows.length ? rows.map(function (r) { return '<li><button class="menu__item" data-menu-item data-r="' + r.id + '"><span class="mono">#' + r.id + '</span><span class="truncate" style="flex:1">' + esc(D.siteById[r.site_id].name) + '</span>' + TL.sevPill(r.fraud_probability) + '</button></li>'; }).join('') : '<li class="menu__label">No cases match “' + esc(inp.value) + '”</li>';
            $$('[data-r]', res).forEach(function (b) { b.addEventListener('click', function () { var o = $('#btn-search'); close(); openCase(+b.dataset.r, o); }); });
          }
          inp.addEventListener('input', show); show();
          inp.addEventListener('keydown', function (e2) { if (e2.key === 'Enter') { var f = $('[data-r]', res); if (f) f.click(); } if (e2.key === 'ArrowDown') { var f2 = $('[data-r]', res); if (f2) { e2.preventDefault(); f2.focus(); } } });
          inp.focus();
        },
      });
    });
    $('#btn-bell').addEventListener('click', function (e) {
      var top = needsRows().slice(0, 3);
      TL.popover(e.currentTarget, '<div class="menu__label">Needs attention</div>' + top.map(function (r) { return '<button class="menu__item" role="menuitem" data-r="' + r.id + '"><span style="display:grid;text-align:left"><span>' + esc(TL.REASON_TITLE[r.reason_key]) + ' <span class="mono text-2">#' + r.id + '</span></span><small class="text-2">' + TL.relTime(r.timestamp) + '</small></span></button>'; }).join(''), {
        width: 300, label: 'Notifications',
        onMount: function (el, close) { $$('[data-r]', el).forEach(function (b) { b.addEventListener('click', function () { close(); openCase(+b.dataset.r, $('#btn-bell')); }); }); },
      });
    });
    $('#btn-user').addEventListener('click', function (e) {
      TL.popover(e.currentTarget, '<div class="menu__label">Anita Rao · Ops reviewer</div><button class="menu__item" role="menuitem" data-a="settings">' + I('settings') + 'Settings</button><button class="menu__item" role="menuitem" data-a="theme">' + I(document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon') + 'Switch theme</button><a class="menu__item" role="menuitem" href="index.html" style="text-decoration:none">' + I('smartphone') + 'Worker capture app</a><div class="menu__sep" role="separator"></div><button class="menu__item" role="menuitem" data-a="out">' + I('log-out') + 'Sign out</button>', {
        width: 230, label: 'Account',
        onMount: function (el, close) { $$('[data-a]', el).forEach(function (b) { b.addEventListener('click', function () { close(); if (b.dataset.a === 'settings') setView('settings'); if (b.dataset.a === 'theme') { TL.setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); if (S.view === 'settings') renderSettings(); } if (b.dataset.a === 'out') TL.toast({ title: 'Signed out', text: 'This is a prototype, so you stay on this page.' }); }); }); },
      });
    });
  }

  /* ---------- Wiring ---------- */
  function refresh() {
    if (S.refreshing) return;
    S.refreshing = true; renderNeeds();
    setTimeout(function () {
      S.refreshing = false; S.lastUpdated = 'Updated just now';
      var row = D.pull();
      if (row) { S.openNeed = row.id; TL.toast({ title: '1 new case', text: 'Critical: ' + TL.REASON_TITLE[row.reason_key].toLowerCase() + ', case #' + row.id + '.' }); }
      else TL.toast({ title: 'You are up to date', text: 'No new cases since the last refresh.' });
      renderAll();
    }, 900);
  }
  function renderAll() { renderKpis(); renderQueue(); renderMap(); renderLegend(); renderNeeds(); renderSources(); renderSubs(); if (S.loading) TL.Insights.skeleton(); else TL.Insights.render(D.rows); }

  function wire() {
    wireTopbar();
    $('#btn-refresh').addEventListener('click', refresh);
    $('#queue-viewall').addEventListener('click', function () { setView('queue'); });
    $('#queue-table tbody').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr) { setActive(+tr.dataset.id); openCase(+tr.dataset.id, tr); } });
    $('#queue-table tbody').addEventListener('keydown', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCase(+tr.dataset.id, tr); } });
    wireRowLinks($('#queue-table tbody'));
    S.qSort.def = null; wireSort($('#queue-table'), S.qSort, renderQueue);
    wireSort($('#subs-table'), Object.assign(S.sSort, { def: 'time' }), function () { S.page = 1; renderSubs(); });

    var st = $('#subs-table tbody');
    st.addEventListener('click', function (e) {
      var k = e.target.closest('[data-kebab]'); if (k) { e.stopPropagation(); kebab(k); return; }
      var tr = e.target.closest('tr[data-id]'); if (tr) openCase(+tr.dataset.id, tr);
    });
    st.addEventListener('keydown', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCase(+tr.dataset.id, tr); } });
    $('#pager').addEventListener('click', function (e) { var b = e.target.closest('[data-page]'); if (b) { S.page += +b.dataset.page; renderSubs(); var nb = $('#pager [data-page="' + b.dataset.page + '"]:not([disabled])') || $('#pager [data-page]:not([disabled])'); if (nb) nb.focus(); } });
    $('#subs-search').addEventListener('input', TL.debounce(function (e) { S.search = e.target.value; S.page = 1; renderSubs(); }, 150));
    $('#subs-status').addEventListener('change', function (e) { S.status = e.target.value; S.page = 1; renderSubs(); });
    $('#subs-photo').addEventListener('change', function (e) { S.photo = e.target.value; S.page = 1; renderSubs(); });
    $('#subs-range').addEventListener('change', function (e) { S.range = e.target.value; S.page = 1; renderSubs(); });

    $('#legend').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sev]'); if (!b) return;
      var s = b.dataset.sev;
      if (s === 'all') S.hidden.clear(); else if (S.hidden.has(s)) S.hidden.delete(s); else S.hidden.add(s);
      renderLegend(); renderMap(); $('#legend [data-sev="' + s + '"]').focus();
    });
    $('#map-view').addEventListener('click', function (e) { var b = e.target.closest('[data-view]'); if (!b) return; S.mapView = b.dataset.view; $$('#map-view .segmented__item').forEach(function (x) { x.setAttribute('aria-checked', x === b); }); renderMap(); });
    $('#map-astable').addEventListener('click', function () { S.mapTable = !S.mapTable; renderMap(); });
    $('#top-by').addEventListener('click', function (e) { var b = e.target.closest('[data-by]'); if (b) { S.topBy = b.dataset.by; renderSources(); } });
    $('#sources').addEventListener('click', function (e) {
      var b = e.target.closest('[data-source]'); if (!b) return;
      S.search = S.topBy === 'worker' ? b.dataset.source : D.siteById[b.dataset.source].name; S.page = 1; $('#subs-search').value = S.search;
      if (S.view !== 'overview' && S.view !== 'submissions') setView('overview'); renderSubs();
      $('#all-submissions').scrollIntoView({ behavior: 'smooth', block: 'start' });
      TL.toast({ title: 'Showing ' + S.search, text: 'Filtered the submissions table.' });
    });
    $('#needs-list').addEventListener('click', function (e) {
      var d = e.target.closest('[data-details]'); if (d) { openCase(+d.dataset.details, d); return; }
      var t = e.target.closest('[data-need]'); if (!t) return;
      var id = +t.dataset.need; S.openNeed = S.openNeed === id ? 0 : id; renderNeeds(); $('[data-need="' + id + '"]').focus();
    });
    window.addEventListener('hashchange', syncHash);
    D.subscribe(function (type) { if (type === 'review') renderAll(); });
  }

  /* ---------- Boot ---------- */
  renderNav(); wire();
  $('#main').dataset.view = S.view; $('#settings').hidden = S.view !== 'settings';
  $('#view-title').textContent = VIEWS.filter(function (x) { return x.key === S.view; })[0].label;
  renderAll(); if (S.view === 'settings') renderSettings();
  setTimeout(function () { S.loading = false; renderAll(); syncHash(); }, 700);
  if (location.hash.indexOf('#case/') === 0) S.loading = false, renderAll(), syncHash();
})();
