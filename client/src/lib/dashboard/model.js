// Pure logic of the reviewer console (no React, no network), kept apart so it can be tested.
// Severity, status, KPI lenses, sorting, filtering, the "needs review" list, top sources, the chart numbers and the map markers.
import { FACTORS, flagMeta, matchesPhoto } from '../format.js'
import { whyLabel } from '../reviews.js'
import { MAPS } from './mapData.js'

export const DAY = 86_400_000

/* ---------- Severity: fraud >= 0.8 Critical, 0.6-0.8 High, 0.4-0.6 Medium, < 0.4 Low ---------- */
export const SEVERITY = [
  { key: 'critical', label: 'Critical', min: 0.8, rank: 4 },
  { key: 'high', label: 'High', min: 0.6, rank: 3 },
  { key: 'medium', label: 'Medium', min: 0.4, rank: 2 },
  { key: 'low', label: 'Low', min: 0, rank: 1 },
]
export const severity = (p) => SEVERITY.find((s) => (p ?? 0) >= s.min) ?? SEVERITY[3]
export const pctText = (p, digits = 0) => `${((p ?? 0) * 100).toFixed(digits)}%`
export const isDemoRow = (r) => String(r.id).startsWith('demo-')

/* ---------- Status: Open (needs a decision) / Resolved (a reviewer decided) / Accepted (nothing to do) ---------- */
export function statusOf(r) {
  if (r.review) return { key: 'resolved', label: 'Resolved' }
  if (r.needs_review || r.status === 'flagged') return { key: 'open', label: 'Open' }
  return { key: 'accepted', label: 'Accepted' }
}
export const STATUS_RANK = { open: 0, resolved: 1, accepted: 2 }

export const DECISION_META = {
  approve: { label: 'Approved', tone: 'ok', icon: 'circle-check' },
  reject: { label: 'Rejected', tone: 'bad', icon: 'circle-x' },
  needs_retake: { label: 'Needs retake', tone: 'warn', icon: 'rotate-ccw' },
}
export const decisionMeta = (d) => DECISION_META[d] ?? { label: d, tone: 'neutral', icon: 'circle-check' }

export const VERDICT_PILL = {
  pass: { label: 'Photo OK', tone: 'ok' },
  warn: { label: 'Photo warning', tone: 'warn' },
  block: { label: 'Photo poor', tone: 'bad' },
  unverified: { label: 'Unverified', tone: 'neutral' },
}
export const verdictPill = (v) => VERDICT_PILL[v ?? 'unverified'] ?? VERDICT_PILL.unverified

// Short title of a case, from why it needs a human. Falls back to a plain word for cases that do not.
export function caseTitle(r) {
  const why = r.review_reasons ?? []
  const specific = why.find((w) => w !== 'fraud_model') ?? why[0]
  if (specific) return whyLabel(specific, (f) => flagMeta(f).label)
  return r.status === 'flagged' ? 'Flagged by the fraud model' : 'Routine check'
}
export const whyList = (r) => (r.review_reasons ?? []).map((w) => whyLabel(w, (f) => flagMeta(f).label))

/* ---------- KPI numbers and lenses ---------- */
export function statsOf(rows) {
  const flagged = rows.filter((r) => r.status === 'flagged').length
  const n = rows.length
  return {
    n,
    flagged,
    accepted: n - flagged,
    rate: n ? flagged / n : 0,
    avg: n ? rows.reduce((a, r) => a + (r.fraud_probability ?? 0), 0) / n : 0,
  }
}

export const KPIS = [
  { key: 'submissions', label: 'Submissions', lens: 'All submissions in the last 7 days' },
  { key: 'flagged', label: 'Flagged', lens: 'Flagged submissions only' },
  { key: 'accepted', label: 'Accepted', lens: 'Accepted (not flagged) submissions only' },
  { key: 'rate', label: 'Flag rate', lens: 'Submissions from sites with an above-average flag rate' },
  { key: 'avg', label: 'Avg fraud probability', lens: 'Submissions scoring at or above the average' },
]

export const withinDays = (rows, days, now = Date.now()) => rows.filter((r) => now - new Date(r.timestamp).getTime() <= days * DAY)

export function lensRows(rows, kpi) {
  const st = statsOf(rows)
  if (kpi === 'flagged') return rows.filter((r) => r.status === 'flagged')
  if (kpi === 'accepted') return rows.filter((r) => r.status !== 'flagged')
  if (kpi === 'avg') return rows.filter((r) => (r.fraud_probability ?? 0) >= st.avg)
  if (kpi === 'rate') {
    const bySite = new Map()
    rows.forEach((r) => bySite.set(r.site_id, [...(bySite.get(r.site_id) ?? []), r]))
    const hot = new Set([...bySite].filter(([, rs]) => statsOf(rs).rate > st.rate).map(([id]) => id))
    return rows.filter((r) => hot.has(r.site_id))
  }
  return rows
}

// 7 daily buckets, oldest first, for the tiny KPI trends.
export function dayBuckets(rows, fn, now = Date.now()) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = 6 - i
    return fn(rows.filter((r) => { const a = now - new Date(r.timestamp).getTime(); return a >= d * DAY && a < (d + 1) * DAY }))
  })
}

// Change against the previous period. `prev` = the same figure for the 7 days before; null when there was none.
export function deltaPct(cur, prev) {
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}

/* ---------- Sorting ---------- */
const BY = {
  id: (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
  task: (a, b) => String(a.task_id).localeCompare(String(b.task_id)),
  time: (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  worker: (a, b) => String(a.worker_id).localeCompare(String(b.worker_id), undefined, { numeric: true }),
  site: (a, b) => String(a.site_id).localeCompare(String(b.site_id)),
  severity: (a, b) => (a.fraud_probability ?? 0) - (b.fraud_probability ?? 0),
  status: (a, b) => STATUS_RANK[statusOf(a).key] - STATUS_RANK[statusOf(b).key],
}
BY.case = BY.id

// sort = { key, dir }. No key = "actionable first": open, then most severe, then newest.
export function sortRows(rows, sort) {
  const out = rows.slice()
  if (!sort?.key) {
    return out.sort((a, b) => STATUS_RANK[statusOf(a).key] - STATUS_RANK[statusOf(b).key] || (b.fraud_probability ?? 0) - (a.fraud_probability ?? 0) || new Date(b.timestamp) - new Date(a.timestamp))
  }
  const f = BY[sort.key]
  return out.sort((a, b) => (sort.dir === 'asc' ? f(a, b) : f(b, a)))
}

// Header click: same column cycles desc -> asc -> default; a new column starts at its natural direction.
export function nextSort(sort, key, def = null) {
  if (sort.key === key) {
    if (sort.dir === 'desc') return { key, dir: 'asc' }
    return def && def !== key ? { key: def, dir: 'desc' } : { key: def, dir: 'desc' }
  }
  return { key, dir: ['severity', 'time', 'id'].includes(key) ? 'desc' : 'asc' }
}

/* ---------- Needs review, top sources, All submissions filters ---------- */
// Cases that need a human and have none yet (real submissions only; demo rows cannot be reviewed). Flagged first, then most severe, then newest.
export function needsRows(rows) {
  return rows
    .filter((r) => r.needs_review && !r.review && !isDemoRow(r))
    .sort((a, b) => Number(b.status === 'flagged') - Number(a.status === 'flagged') || (b.fraud_probability ?? 0) - (a.fraud_probability ?? 0) || new Date(b.timestamp) - new Date(a.timestamp))
}

export function topSources(rows, by = 'worker', n = 5) {
  const counts = new Map()
  rows.filter((r) => r.status === 'flagged').forEach((r) => { const k = by === 'worker' ? r.worker_id : r.site_id; counts.set(k, (counts.get(k) ?? 0) + 1) })
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, n)
}

export function filterSubmissions(rows, { status = 'all', range = 'all', photo = 'all', search = '' } = {}, now = Date.now()) {
  const needle = search.trim().toLowerCase().replace(/^#/, '')
  return rows.filter((r) => {
    if (range !== 'all' && now - new Date(r.timestamp).getTime() > Number(range) * DAY) return false
    if (status !== 'all' && statusOf(r).key !== status) return false
    if (!matchesPhoto(r, photo)) return false
    if (needle && ![r.id, r.worker_id, r.site_id, r.task_id].some((v) => String(v).toLowerCase().includes(needle))) return false
    return true
  })
}

/* ---------- Charts ---------- */
export const lineSeries = (rows, n = 60) => rows.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).slice(-n)

export function importanceAverage(rows) {
  return FACTORS.map((f) => ({ key: f.key, label: f.label, value: rows.length ? (rows.reduce((a, r) => a + (r.feature_importances?.[f.key] ?? 0), 0) / rows.length) * 100 : 0 }))
}

export const VERDICT_ORDER = ['pass', 'warn', 'block', 'unverified']

export function qualitySummary(rows) {
  const verdicts = VERDICT_ORDER.map((v) => ({ key: v, label: verdictPill(v).label, tone: verdictPill(v).tone, value: rows.filter((r) => (r.photo_verdict ?? 'unverified') === v).length }))
  const counts = {}
  rows.forEach((r) => (r.quality_flags ?? []).forEach((f) => { counts[f] = (counts[f] ?? 0) + 1 }))
  const flags = Object.entries(counts)
    .map(([f, value]) => ({ key: f, label: flagMeta(f).label, kind: flagMeta(f).kind, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 8)
  const n = rows.length
  return {
    verdicts,
    flags,
    avgQuality: n ? rows.reduce((a, r) => a + (r.photo_quality_score ?? 0), 0) / n : 0,
    overrides: rows.filter((r) => r.photo_override).length,
    mismatches: rows.filter((r) => r.client_mismatch).length,
    dupes: rows.filter((r) => (r.quality_flags ?? []).some((f) => f.includes('duplicate'))).length,
  }
}

/* ---------- Map ---------- */
export const project = (view, lat, lng) => ({ x: ((lng - view.lng0) / view.w) * 100, y: ((view.lat1 - lat) / view.h) * 100 })
export const inView = (view, lat, lng) => lng >= view.lng0 && lng <= view.lng1 && lat >= view.lat0 && lat <= view.lat1

// Markers sit on the REGISTERED location of each submission's site (a submission row carries no coordinates of its own).
// Several at one site are fanned out on a golden-angle spiral, in px, so each stays clickable.
export function mapMarkers(rows, sitesById, viewKey, hidden = new Set()) {
  const view = MAPS[viewKey]
  const groups = new Map()
  let outside = 0
  let unplaced = 0
  for (const r of rows) {
    if (hidden.has(severity(r.fraud_probability).key)) continue
    const s = sitesById.get(r.site_id)
    if (!s) { unplaced++; continue }
    if (!inView(view, s.lat, s.lng)) { outside++; continue }
    groups.set(r.site_id, [...(groups.get(r.site_id) ?? []), r])
  }
  const markers = []
  for (const [siteId, g] of groups) {
    const s = sitesById.get(siteId)
    const p = project(view, s.lat, s.lng)
    g.slice().sort((a, b) => (b.fraud_probability ?? 0) - (a.fraud_probability ?? 0)).forEach((row, i) => {
      const ang = i * 2.4
      const rad = i === 0 ? 0 : 6 + Math.sqrt(i) * 4
      markers.push({ row, x: p.x, y: p.y, dx: Math.cos(ang) * rad, dy: Math.sin(ang) * rad, site: s })
    })
  }
  return { view, markers, outside, unplaced }
}
