/* Shared UI helpers: formatting, severity/status pills, toasts, focus trap, popover menus, theme. */
(function () {
  'use strict';
  var D = window.TL_DATA;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------- Severity: fraud >= 0.8 Critical, 0.6-0.8 High, 0.4-0.6 Medium, < 0.4 Low ---------- */
  var SEV = [
    { key: 'critical', label: 'Critical', min: 0.8, rank: 4, color: 'var(--color-crit)' },
    { key: 'high', label: 'High', min: 0.6, rank: 3, color: 'var(--color-high)' },
    { key: 'medium', label: 'Medium', min: 0.4, rank: 2, color: 'var(--color-warn)' },
    { key: 'low', label: 'Low', min: 0, rank: 1, color: 'var(--color-neutral)' },
  ];
  function severity(p) { for (var i = 0; i < SEV.length; i++) if (p >= SEV[i].min) return SEV[i]; return SEV[3]; }
  function sevPill(p) { var s = severity(p); return '<span class="pill pill--' + s.key + '">' + s.label + '</span>'; }
  function pct(p) { return Math.round(p * 100) + '%'; }

  /* ---------- Status: Open (flagged, no decision) / Resolved (reviewed) / Accepted (auto) ---------- */
  function statusOf(row) {
    if (row.review) return { key: 'resolved', label: 'Resolved' };
    if (row.status === 'flagged') return { key: 'open', label: 'Open' };
    return { key: 'accepted', label: 'Accepted' };
  }
  function statusHtml(row) { var s = statusOf(row); return '<span class="status status--' + s.key + '">' + s.label + '</span>'; }

  var DECISION = {
    approve: { label: 'Approved', icon: 'circle-check', cls: 'ok' },
    reject: { label: 'Rejected', icon: 'circle-x', cls: 'bad' },
    retake: { label: 'Needs retake', icon: 'rotate-ccw', cls: 'warn' },
  };

  function photoPill(v) {
    var map = {
      'Photo OK': ['ok', 'Photo OK'],
      warning: ['warn', 'Photo warning'],
      poor: ['bad', 'Photo poor'],
      unverified: ['neutral', 'Unverified'],
    };
    var m = map[v] || map.unverified;
    return '<span class="pill pill--' + m[0] + '">' + m[1] + '</span>';
  }

  /* ---------- Time ---------- */
  function relTime(iso) {
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 24) return h + ' hr ago';
    var d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function fmtClock(iso) { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').toLowerCase(); }
  function fmtDay(iso) {
    var d = new Date(iso), t = new Date(), y = new Date(Date.now() - 86400000);
    if (d.toDateString() === t.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function fmtDateTime(iso) { return fmtDay(iso) + ', ' + fmtClock(iso); }
  function fmtDistance(m) { return m >= 1000 ? (m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' km' : m + ' m'; }

  /* ---------- Toasts. Errors persist until dismissed; successes clear themselves. ---------- */
  function toast(o) {
    var region = $('#toast-region');
    if (!region) { region = document.createElement('div'); region.id = 'toast-region'; region.className = 'toast-region'; region.setAttribute('role', 'region'); region.setAttribute('aria-label', 'Notifications'); document.body.appendChild(region); }
    var type = o.type || 'ok';
    var el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = window.icon(type === 'error' ? 'circle-alert' : 'circle-check') +
      '<div class="toast__body"><div class="toast__title">' + esc(o.title) + '</div>' + (o.text ? '<div class="toast__text">' + esc(o.text) + '</div>' : '') + '</div>' +
      '<button class="icon-btn" aria-label="Dismiss notification">' + window.icon('x') + '</button>';
    $('button', el).addEventListener('click', function () { el.remove(); });
    region.appendChild(el);
    if (type !== 'error' && !o.persist) setTimeout(function () { el.remove(); }, 4500);
    return el;
  }

  /* ---------- Focus trap ---------- */
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function trapFocus(container, onEscape) {
    function onKey(e) {
      if (e.key === 'Escape' && onEscape) { e.stopPropagation(); onEscape(); return; }
      if (e.key !== 'Tab') return;
      var f = $$(FOCUSABLE, container).filter(function (n) { return n.offsetParent !== null || n === document.activeElement; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    return function release() { document.removeEventListener('keydown', onKey, true); };
  }

  /* ---------- Popover menu anchored to a button ---------- */
  var openPop = null;
  function closePopover(returnFocus) {
    if (!openPop) return;
    var p = openPop; openPop = null;
    p.el.remove(); p.anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', p.onDoc, true); document.removeEventListener('keydown', p.onKey, true);
    window.removeEventListener('resize', p.onResize);
    if (returnFocus !== false) p.anchor.focus();
  }
  // html: inner HTML; onMount(el) wires item handlers. align: 'right' | 'left'
  function popover(anchor, html, o) {
    o = o || {};
    if (openPop && openPop.anchor === anchor) { closePopover(); return null; }
    closePopover(false);
    var el = document.createElement('div');
    el.className = 'popover' + (o.className ? ' ' + o.className : '');
    el.setAttribute('role', o.role || 'menu');
    if (o.label) el.setAttribute('aria-label', o.label);
    if (o.width) el.style.width = o.width + 'px';
    el.innerHTML = html;
    document.body.appendChild(el);
    anchor.setAttribute('aria-expanded', 'true');
    function place() {
      var r = anchor.getBoundingClientRect(), w = el.offsetWidth;
      var left = o.align === 'left' ? r.left : r.right - w;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      var top = r.bottom + 6, h = el.offsetHeight;
      if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
      el.style.left = left + window.scrollX + 'px'; el.style.top = top + window.scrollY + 'px';
    }
    place();
    var items = function () { return $$('.menu__item,[data-menu-item]', el); };
    var state = {
      el: el, anchor: anchor,
      onDoc: function (e) { if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover(false); },
      onKey: function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); closePopover(); return; }
        if (e.key === 'Tab' && el.getAttribute('role') === 'menu') { closePopover(false); return; }
        if (el.getAttribute('role') !== 'menu') return;
        var list = items(), i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
        if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
        if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
      },
      onResize: place,
    };
    openPop = state;
    document.addEventListener('mousedown', state.onDoc, true);
    document.addEventListener('keydown', state.onKey, true);
    window.addEventListener('resize', state.onResize);
    if (o.onMount) o.onMount(el, function () { closePopover(); });
    var first = o.focus === false ? null : items()[0] || $(FOCUSABLE, el);
    if (first) first.focus();
    return el;
  }

  /* ---------- Theme ---------- */
  var THEME_KEY = 'tl.theme';
  function getTheme() { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* storage can be blocked; the choice just does not persist */ }
  }
  function initTheme(defaultTheme) {
    var q = new URLSearchParams(location.search).get('theme');
    // A ?theme= param is a one-off preview (used by the frames page); it must not overwrite the saved choice.
    if (q === 'light' || q === 'dark') document.documentElement.setAttribute('data-theme', q);
    else setTheme(getTheme() || defaultTheme || 'dark');
  }

  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

  /* Tiny 7-day trend: values -> inline SVG polyline + end dot. Decorative; the number carries the meaning. */
  function trend(values, w, h) {
    w = w || 64; h = h || 20;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), span = max - min || 1;
    var pts = values.map(function (v, i) { return [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)]; });
    var last = pts[pts.length - 1];
    return '<svg class="trend" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true" focusable="false">' +
      '<polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2" fill="currentColor"/></svg>';
  }

  /* Photo placeholder: no real images ship with the prototype, so each case gets a deterministic illustrated "photo". */
  function photoArt(row, opts) {
    opts = opts || {};
    var seed = row.id * 9301 + 49297, r = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    var selfie = row.task === D.tasks[1];
    var dark = row.quality_flags.indexOf('Lighting') >= 0;
    var blur = row.quality_flags.indexOf('Blurry') >= 0;
    var out = '<svg viewBox="0 0 300 400" class="photo-art" role="img" aria-label="' + esc(opts.label || 'Submitted photo (illustration)') + '" preserveAspectRatio="xMidYMid slice">';
    out += '<defs><filter id="pb' + row.id + '"><feGaussianBlur stdDeviation="' + (blur ? 3.2 : 0) + '"/></filter></defs>';
    out += '<rect width="300" height="400" fill="' + (dark ? '#1b1d22' : '#3a3f4a') + '"/><g filter="url(#pb' + row.id + ')">';
    if (selfie) {
      out += '<rect y="250" width="300" height="150" fill="' + (dark ? '#22252c' : '#454b58') + '"/>';
      out += '<ellipse cx="150" cy="190" rx="62" ry="78" fill="' + (dark ? '#6a5a50' : '#b88f76') + '"/>';
      out += '<path d="M88 168 Q150 90 212 168 Q205 120 150 112 Q95 120 88 168Z" fill="' + (dark ? '#14120f' : '#2a2018') + '"/>';
      out += '<rect x="60" y="290" width="180" height="120" rx="60" fill="' + (dark ? '#2e3a52' : '#4f6aa0') + '"/>';
      out += '<circle cx="128" cy="190" r="5" fill="#1b1410"/><circle cx="172" cy="190" r="5" fill="#1b1410"/>';
    } else {
      var shelfY = [70, 150, 230, 310], cols = ['#d9534f', '#e9b44c', '#4f8fd9', '#5fb37c', '#b9bec8', '#9b6bd1'];
      shelfY.forEach(function (y) {
        out += '<rect x="14" y="' + (y + 54) + '" width="272" height="6" fill="' + (dark ? '#2b2e35' : '#6d7380') + '"/>';
        var x = 20;
        while (x < 276) {
          var w = 22 + Math.floor(r() * 22), h = 30 + Math.floor(r() * 34);
          out += '<rect x="' + x + '" y="' + (y + 54 - h) + '" width="' + w + '" height="' + h + '" rx="3" fill="' + cols[Math.floor(r() * cols.length)] + '" opacity="' + (dark ? 0.45 : 0.9) + '"/>';
          x += w + 4;
        }
      });
    }
    out += '</g></svg>';
    return out;
  }

  window.TL = window.TL || {};
  Object.assign(window.TL, {
    $: $, $$: $$, esc: esc, severity: severity, SEV: SEV, sevPill: sevPill, pct: pct,
    statusOf: statusOf, statusHtml: statusHtml, DECISION: DECISION, photoPill: photoPill,
    relTime: relTime, fmtClock: fmtClock, fmtDay: fmtDay, fmtDateTime: fmtDateTime, fmtDistance: fmtDistance,
    toast: toast, trapFocus: trapFocus, popover: popover, closePopover: closePopover,
    initTheme: initTheme, setTheme: setTheme, debounce: debounce, trend: trend, photoArt: photoArt, FOCUSABLE: FOCUSABLE,
  });
})();
