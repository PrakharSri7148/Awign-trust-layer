/* Insights: the three charts (fraud over time, accepted vs flagged, signal importance) and the Photo quality panel.
   Hand-drawn SVG in the flat style: thin lines, one accent, semantic color only for ok / flagged / problems.
   Every chart has a "View data" table as its text alternative. */
(function () {
  'use strict';
  var TL = window.TL, D = window.TL_DATA, I = window.icon, esc = TL.esc, $ = TL.$;

  var FACTORS = [
    { key: 'photo_quality', label: 'Photo quality' },
    { key: 'motion_consistency', label: 'Motion consistency' },
    { key: 'ambient_fingerprint', label: 'Network vs area' },
  ];
  var VERDICTS = [
    { key: 'Photo OK', label: 'Photo OK', color: 'var(--color-ok)' },
    { key: 'warning', label: 'Photo warning', color: 'var(--color-warn)' },
    { key: 'poor', label: 'Photo poor', color: 'var(--color-crit)' },
    { key: 'unverified', label: 'Unverified', color: 'var(--color-neutral)' },
  ];
  var KIND = {
    quality: { label: 'Photo problem', color: 'var(--color-warn)' },
    integrity: { label: 'Integrity concern', color: 'var(--color-crit)' },
    info: { label: 'Context', color: 'var(--color-neutral)' },
  };

  function dataTable(caption, head, rows) {
    return '<details class="data-table"><summary>View data</summary><div class="table-wrap" style="max-height:240px;overflow:auto"><table class="table"><caption class="sr-only">' + caption + '</caption><thead><tr>' +
      head.map(function (h) { return '<th scope="col">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>';
  }

  /* ---------- 1. Fraud probability over time ---------- */
  function lineChart(rows) {
    var series = rows.slice().reverse().slice(-60);
    var W = 640, H = 220, L = 40, R = 10, T = 10, B = 24, iw = W - L - R, ih = H - T - B;
    var x = function (i) { return L + (series.length < 2 ? iw / 2 : (i / (series.length - 1)) * iw); };
    var y = function (p) { return T + (1 - p) * ih; };
    var pts = series.map(function (r, i) { return x(i).toFixed(1) + ',' + y(r.fraud_probability).toFixed(1); });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart__svg" role="img" aria-label="Fraud probability for the last ' + series.length + ' submissions, with the 50% flag threshold. Data table below.">';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (g) {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="var(--color-border)"/><text x="' + (L - 8) + '" y="' + (y(g) + 4) + '" text-anchor="end" class="chart__tick">' + Math.round(g * 100) + '%</text>';
    });
    var ticks = 5;
    for (var k = 0; k < ticks; k++) {
      var i = Math.round((k / (ticks - 1)) * (series.length - 1));
      if (series[i]) svg += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (k === 0 ? 'start' : k === ticks - 1 ? 'end' : 'middle') + '" class="chart__tick">' + TL.fmtDay(series[i].timestamp) + '</text>';
    }
    svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0.5) + '" y2="' + y(0.5) + '" stroke="var(--color-warn)" stroke-dasharray="5 4"/>';
    svg += '<polygon points="' + x(0) + ',' + y(0) + ' ' + pts.join(' ') + ' ' + x(series.length - 1) + ',' + y(0) + '" fill="var(--color-accent)" opacity=".10"/>';
    svg += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--color-accent-text)" stroke-width="1.6" stroke-linejoin="round"/>';
    svg += '<g class="chart__cursor" hidden><line y1="' + T + '" y2="' + (T + ih) + '" stroke="var(--color-text-2)" stroke-dasharray="2 3"/><circle r="4" fill="var(--color-accent-text)" stroke="var(--color-shell)" stroke-width="2"/></g></svg>';
    return {
      series: series, x: x, y: y, W: W,
      html: '<div class="chart" tabindex="0" aria-label="Chart. Use left and right arrows to read each submission." data-chart="line">' + svg + '<div class="chart__tip" role="status" hidden></div></div>' +
        dataTable('Fraud probability per submission', ['Case', 'Time', 'Fraud probability'], series.slice().reverse().map(function (r) { return ['#' + r.id, TL.fmtDateTime(r.timestamp), TL.pct(r.fraud_probability)]; })),
    };
  }
  function wireLine(root, chart) {
    var el = $('[data-chart=line]', root); if (!el) return;
    var cursor = $('.chart__cursor', el), tip = $('.chart__tip', el), svg = $('svg', el), s = chart.series, idx = -1;
    function show(i) {
      i = Math.max(0, Math.min(s.length - 1, i)); idx = i;
      var r = s[i], px = chart.x(i), py = chart.y(r.fraud_probability), box = svg.getBoundingClientRect(), k = box.width / chart.W;
      cursor.hidden = false; cursor.setAttribute('transform', 'translate(' + px + ' 0)');
      $('circle', cursor).setAttribute('cy', py);
      tip.hidden = false; tip.innerHTML = '<div class="text-2">' + TL.fmtDateTime(r.timestamp) + '</div>Case <span class="mono">#' + r.id + '</span> <b class="num">' + TL.pct(r.fraud_probability) + '</b>';
      var left = px * k + 12; if (left + 150 > box.width) left = px * k - 150;
      tip.style.left = Math.max(4, left) + 'px'; tip.style.top = Math.max(0, py * k - 44) + 'px';
    }
    function hide() { cursor.hidden = true; tip.hidden = true; idx = -1; }
    svg.addEventListener('mousemove', function (e) { var b = svg.getBoundingClientRect(), vx = ((e.clientX - b.left) / b.width) * chart.W, f = (vx - 40) / (chart.W - 50); show(Math.round(f * (s.length - 1))); });
    svg.addEventListener('mouseleave', hide);
    el.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { e.preventDefault(); show(idx < 0 ? 0 : idx + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx < 0 ? s.length - 1 : idx - 1); } if (e.key === 'Escape') hide(); });
    el.addEventListener('blur', hide);
  }

  /* ---------- 2. Accepted vs flagged (thin ring) ---------- */
  function donut(rows) {
    var flagged = rows.filter(function (r) { return r.status === 'flagged'; }).length, acc = rows.length - flagged, C = 2 * Math.PI * 52;
    var fl = rows.length ? (flagged / rows.length) * C : 0, gap = rows.length && flagged && acc ? 3 : 0;
    var svg = '<svg viewBox="0 0 140 140" class="donut__svg" role="img" aria-label="' + acc + ' accepted and ' + flagged + ' flagged out of ' + rows.length + ' submissions">' +
      '<circle cx="70" cy="70" r="52" fill="none" stroke="var(--color-ok)" stroke-width="10" opacity="' + (rows.length ? 1 : 0.2) + '"/>' +
      (flagged ? '<circle cx="70" cy="70" r="52" fill="none" stroke="var(--color-crit)" stroke-width="10" stroke-dasharray="' + Math.max(0, fl - gap) + ' ' + C + '" transform="rotate(-90 70 70)"/>' : '') + '</svg>';
    return '<div class="donut">' + svg + '<div class="donut__center"><div class="donut__value num">' + (rows.length ? Math.round((flagged / rows.length) * 100) : 0) + '%</div><div class="text-xs text-2">flagged</div></div></div>' +
      '<ul class="legend-list"><li><i style="background:var(--color-ok)"></i>Accepted <b class="num">' + acc + '</b></li><li><i style="background:var(--color-crit)"></i>Flagged <b class="num">' + flagged + '</b></li></ul>';
  }

  /* ---------- 3. Signal importance (average of the three signal groups) ---------- */
  function importance(rows) {
    var avg = FACTORS.map(function (f) { return { label: f.label, v: rows.length ? (rows.reduce(function (a, r) { return a + (r.feature_importances ? r.feature_importances[f.key] : 0); }, 0) / rows.length) * 100 : 0 }; });
    var max = Math.max.apply(null, avg.map(function (a) { return a.v; })) || 1;
    return '<ul class="hbars" aria-label="Average importance of each signal group">' + avg.map(function (a) {
      return '<li><div class="hbars__label"><span>' + a.label + '</span><b class="num">' + a.v.toFixed(1) + '%</b></div><div class="hbars__track"><span style="width:' + (a.v / max) * 100 + '%;background:var(--color-accent-text)"></span></div></li>';
    }).join('') + '</ul><p class="text-xs text-2" style="margin-top:12px">How much each group of signals contributed to scores, averaged over all submissions.</p>';
  }

  function renderInsights(rows) {
    var line = lineChart(rows), el = $('#insights');
    el.innerHTML =
      '<div class="insight insight--wide panel"><div class="panel__head"><h2 class="panel__title">Fraud probability over time</h2><span class="pill pill--plain">threshold 50%</span></div><div class="insight__body">' + line.html + '</div></div>' +
      '<div class="insight panel"><div class="panel__head"><h2 class="panel__title">Accepted vs flagged</h2></div><div class="insight__body">' + donut(rows) + '</div></div>' +
      '<div class="insight panel"><div class="panel__head"><h2 class="panel__title">Signal importance</h2></div><div class="insight__body">' + importance(rows) + '</div></div>';
    wireLine(el, line);
  }

  /* ---------- Photo quality panel ---------- */
  function renderQuality(rows) {
    var n = rows.length;
    var verdicts = VERDICTS.map(function (v) { return { label: v.label, color: v.color, value: rows.filter(function (r) { return r.photo_verdict === v.key; }).length }; });
    var counts = {};
    rows.forEach(function (r) { r.quality_flags.forEach(function (f) { counts[f] = (counts[f] || 0) + 1; }); });
    var flags = Object.keys(counts).map(function (f) { return { name: f, kind: D.flagMeta(f).kind, value: counts[f] }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
    var scored = rows.filter(function (r) { return r.photo_quality_score != null; });
    var avg = scored.length ? scored.reduce(function (a, r) { return a + r.photo_quality_score; }, 0) / scored.length : 0;
    var stats = [
      ['Avg photo quality', Math.round(avg * 100) + '/100'],
      ['Submitted anyway', rows.filter(function (r) { return r.photo_override; }).length],
      ['Device report mismatch', rows.filter(function (r) { return r.client_mismatch; }).length],
      ['Duplicate photos', rows.filter(function (r) { return r.quality_flags.indexOf('Duplicate photo') >= 0; }).length],
    ];
    var max = flags.length ? flags[0].value : 1;
    $('#quality').innerHTML =
      '<div class="panel__head"><div><h2 class="panel__title">Photo quality</h2><p class="panel__sub">Where photos go wrong</p></div><span class="pill pill--plain">server-measured</span></div>' +
      '<div class="quality"><div><h3 class="quality__h">Verdicts</h3>' +
      '<div class="vbar" role="img" aria-label="Photo verdict split: ' + verdicts.map(function (v) { return v.label + ' ' + v.value; }).join(', ') + '">' + verdicts.filter(function (v) { return v.value; }).map(function (v) { return '<i style="flex:' + v.value + ';background:' + v.color + '" title="' + v.label + ': ' + v.value + '"></i>'; }).join('') + '</div>' +
      '<ul class="legend-list">' + verdicts.map(function (v) { return '<li><i style="background:' + v.color + '"></i>' + v.label + ' <b class="num">' + v.value + '</b></li>'; }).join('') + '</ul>' +
      '<dl class="qstats">' + stats.map(function (s) { return '<div><dt>' + s[0] + '</dt><dd class="num">' + s[1] + '</dd></div>'; }).join('') + '</dl></div>' +
      '<div><h3 class="quality__h">Most common photo flags</h3>' + (flags.length ? '<ul class="hbars">' + flags.map(function (f) {
        return '<li><div class="hbars__label"><span>' + esc(f.name) + '</span><b class="num">' + f.value + '</b></div><div class="hbars__track"><span style="width:' + (f.value / max) * 100 + '%;background:' + KIND[f.kind].color + '"></span></div></li>';
      }).join('') + '</ul>' : '<div class="empty-state" style="padding:24px 0">' + I('image') + '<div class="empty-state__title">No photo flags yet</div></div>') +
      '<ul class="legend-list" style="margin-top:12px">' + Object.keys(KIND).map(function (k) { return '<li><i style="background:' + KIND[k].color + '"></i>' + KIND[k].label + '</li>'; }).join('') + '</ul></div></div>';
  }

  function skeleton() {
    $('#insights').innerHTML = [1, 2, 3].map(function (i) { return '<div class="insight panel' + (i === 1 ? ' insight--wide' : '') + '"><div class="panel__head"><span class="skeleton" style="height:16px;width:160px"></span></div><div class="insight__body"><span class="skeleton" style="height:180px"></span></div></div>'; }).join('');
    $('#quality').innerHTML = '<div class="panel__head"><span class="skeleton" style="height:16px;width:120px"></span></div><div class="quality"><span class="skeleton" style="height:140px"></span><span class="skeleton" style="height:140px"></span></div>';
  }

  TL.Insights = { render: function (rows) { renderInsights(rows); renderQuality(rows); }, skeleton: skeleton };
})();
