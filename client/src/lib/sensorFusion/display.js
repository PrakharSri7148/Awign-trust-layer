// Pure helpers for showing a sensor-fusion report (the case file) and the live recording. No React, no network.

const M_PER_DEG = 111_320

// Project trail points ([t, lat, lng, acc]) and the site to a small drawing. Local flat-earth metres around the centroid,
// scaled to fit `w` x `h`; nothing leaves the browser (no map tiles).
export function trailGeometry(points, site, jumps = [], { w = 320, h = 200, pad = 14 } = {}) {
  const pts = (points ?? []).filter((p) => Number.isFinite(p?.[1]) && Number.isFinite(p?.[2]))
  if (!pts.length) return null
  const all = pts.map((p) => [p[1], p[2]])
  if (site) all.push([site.lat, site.lng])
  for (const j of jumps) {
    if (j?.from) all.push(j.from)
    if (j?.to) all.push(j.to)
  }
  const lat0 = all.reduce((s, p) => s + p[0], 0) / all.length
  const lng0 = all.reduce((s, p) => s + p[1], 0) / all.length
  const kx = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG
  const xy = (lat, lng) => [(lng - lng0) * kx, -(lat - lat0) * M_PER_DEG]
  const proj = all.map((p) => xy(p[0], p[1]))
  const r = site ? Math.max(site.radius_m ?? 100, 1) : 0
  const sx = site ? xy(site.lat, site.lng) : null
  const xs = proj.map((p) => p[0]).concat(sx ? [sx[0] - r, sx[0] + r] : [])
  const ys = proj.map((p) => p[1]).concat(sx ? [sx[1] - r, sx[1] + r] : [])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanM = Math.max(maxX - minX, maxY - minY, 20)
  const scale = Math.min((w - 2 * pad) / spanM, (h - 2 * pad) / spanM)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const to = ([x, y]) => [Math.round((w / 2 + (x - cx) * scale) * 10) / 10, Math.round((h / 2 + (y - cy) * scale) * 10) / 10]
  const line = pts.map((p) => to(xy(p[1], p[2])))
  const jumpLines = jumps.filter((j) => j?.from && j?.to).map((j) => ({ from: to(xy(j.from[0], j.from[1])), to: to(xy(j.to[0], j.to[1])) }))
  // A jump is drawn as its own dashed line, not as part of the path (the phone did not travel along it).
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 2
  const isJump = (a, b) => jumpLines.some((j) => (near(a, j.from) && near(b, j.to)) || (near(a, j.to) && near(b, j.from)))
  const path = line.map((p, i) => `${i && !isJump(line[i - 1], p) ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')
  return {
    w,
    h,
    spanM: Math.round(spanM),
    path,
    start: line[0],
    end: line[line.length - 1],
    points: line,
    site: sx ? { c: to(sx), r: Math.max(r * scale, 6) } : null, // never smaller than a visible ring, even when a far jump shrinks the drawing
    jumps: jumpLines,
  }
}

export function fmtDistance(m) {
  if (m == null) return '-'
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

// The per-window speed-vs-activity table -> two strips of cells. `mismatch` marks where GPS and phone disagree.
export function timelineCells(rows) {
  return (rows ?? []).map((r) => ({
    t: r.t,
    gps: r.gps ?? 'unknown',
    activity: r.activity ?? 'unknown',
    mismatch: r.verdict === 'flat',
    title: `${r.t}s · GPS ${r.gps}${r.gps_ms != null ? ` (${r.gps_ms} m/s)` : ''} · phone ${r.activity}${r.acc_rms != null ? ` (${r.acc_rms} m/s²)` : ''}`,
  }))
}

// One word for a 0..1 consistency score. Unknown is its own state: never "low".
export function scoreWord(score, known) {
  if (!known) return { word: 'not enough data', tone: 'muted' }
  if (score >= 0.85) return { word: 'consistent', tone: 'green' }
  if (score >= 0.6) return { word: 'some doubt', tone: 'amber' }
  return { word: 'inconsistent', tone: 'red' }
}

const ENV_STATUS = { match: 'matches', unseen: 'new here', far: 'far from site', near: 'near the site', other_country: 'other country', hosting_or_vpn: 'hosting / VPN', unavailable: 'not available', unknown: 'not enough history', mismatch: 'mismatch', no_overlap: 'no overlap' }
const ENV_NAME = { link: 'Network speed class', asn: 'Internet provider', hosting: 'Provider type', ip_location: 'IP location', ip: 'IP address', timezone: 'Time zone', wifi: 'WiFi networks', cell: 'Cell towers' }
export const envComponentText = (c) => ({ name: ENV_NAME[c.id] ?? c.id, status: ENV_STATUS[c.status] ?? c.status, detail: c.detail ?? '' })

// Live recording summary for the Sensors step / visit banner.
export function recordingSummary(s) {
  if (!s?.running) return 'Not recording'
  const parts = [`${s.fixes} location fix${s.fixes === 1 ? '' : 'es'}`]
  if (s.distanceM) parts.push(fmtDistance(s.distanceM))
  if (s.accuracyM != null) parts.push(`±${Math.round(s.accuracyM)} m`)
  if (s.motion === 'null_events') parts.push('no motion sensor')
  else if (s.motion === 'denied') parts.push('motion denied')
  else if (s.motion === 'absent') parts.push('no motion sensor')
  return parts.join(' · ')
}
