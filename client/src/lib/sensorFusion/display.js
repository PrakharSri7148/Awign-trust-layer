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
const ENV_NAME = { link: 'Network speed class', asn: 'Internet provider', hosting: 'Provider type', ip_location: 'IP location', ip_vs_gps: 'IP vs the phone\'s GPS', ip: 'IP address', timezone: 'Time zone', wifi: 'WiFi networks', cell: 'Cell towers' }
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

// Did the GPS put the worker at the site the company registered? Evidence only: outside the site sends the case to review, it never blocks.
export function arrivalLine(fusion) {
  const label = 'Arrival at site'
  const s = fusion?.motion?.evidence?.site ?? null
  if (!fusion?.site) return { id: 'arrival', label, tone: 'muted', text: 'The company has not registered a location for this site, so arrival could not be checked' }
  if (!s || s.end_m == null) return { id: 'arrival', label, tone: 'muted', text: 'No reliable GPS fix was received, so arrival could not be confirmed' }
  const d = fmtDistance(s.end_m)
  const r = fmtDistance(s.radius_m ?? fusion.site.radius_m)
  if (s.end_inside) return { id: 'arrival', label, tone: 'green', text: `GPS places you at the site: ${d} from its centre (site radius ${r})` }
  if (s.end_outside) return { id: 'arrival', label, tone: 'red', text: `GPS places you ${d} from the site (site radius ${r}): arrival not confirmed, sent for review` }
  return { id: 'arrival', label, tone: 'amber', text: `Close to the site but not clearly inside: ${d} away (site radius ${r}, GPS accuracy ±${Math.round(s.end_acc_m ?? 0)} m)` }
}

// Two plain lines for the verdict screen: what the phone's movement said about the GPS trail, and what the network said about the
// area. Evidence only (never a verdict); "not enough data" is its own state, not a problem.
export function verdictSummary(fusion) {
  if (!fusion?.motion) return []
  const m = fusion.motion
  const e = fusion.environment ?? {}
  const mw = scoreWord(m.score, m.known)
  const ew = scoreWord(e.score ?? 0.5, e.known)
  const motionText = !m.known || !m.sensor_used
    ? 'Not enough sensor data to compare the phone\'s movement with the GPS trail'
    : m.reason ?? 'The phone\'s movement matches the GPS trail'
  const envText = !e.known ? 'Network: not enough history to compare' : e.reason ?? 'The network fits the claimed area'
  return [
    arrivalLine(fusion),
    { id: 'motion', label: 'Movement vs GPS', tone: m.known && m.sensor_used ? mw.tone : 'muted', text: motionText },
    { id: 'network', label: 'Network vs area', tone: e.known ? ew.tone : 'muted', text: envText },
  ]
}

// ---------------------------------------------------------------- what the feature fetches, on screen (hackathon H3b)

// What a web page / this app CANNOT fetch, with the reason. Shown as "not available", never left out silently.
export const NOT_AVAILABLE = [
  { id: 'wifi', label: 'WiFi networks nearby', reason: 'browsers do not expose WiFi names; only a native app can read them' },
  { id: 'cell', label: 'Cell towers', reason: 'browsers do not expose cell tower IDs; only a native app can read them' },
  { id: 'mock', label: 'Android "mock location" flag', reason: 'only native Android code can see it; the web page infers a fake from the GPS trail instead' },
  { id: 'background', label: 'Data while the screen is off', reason: 'a web page is paused when hidden; time hidden is counted and sent instead' },
  { id: 'activity_api', label: 'Android activity recognition', reason: 'a native-only API; activity here is computed from the accelerometer and gyroscope' },
]

const fx = (v, d, unit = '') => (Number.isFinite(v) ? `${v.toFixed(d)}${unit}` : null)

// The live Sensor feed (Capture page): plain values from recorder.getState() + the browser's network info. Missing values are
// null (the panel prints "-" or the reason); nothing is invented.
export function liveFeed(s, { net = null, now = Date.now() } = {}) {
  const f = s?.lastFix ?? null
  const w = s?.lastWindow ?? null
  const m = s?.lastMotion ?? null
  const motionOn = s?.motion === 'granted'
  return {
    gps: {
      state: s?.geo ?? (s?.running ? 'waiting' : null),
      lat: f ? f.lat.toFixed(5) : null,
      lng: f ? f.lng.toFixed(5) : null,
      accuracy: f ? fx(f.acc, 0, ' m') : null,
      speed: f ? (f.speed == null ? 'not reported' : `${f.speed.toFixed(1)} m/s`) : null,
      heading: f ? (f.heading == null ? 'not reported' : `${Math.round(f.heading)}°`) : null,
      altitude: f ? (f.alt == null ? 'not reported' : `${Math.round(f.alt)} m`) : null,
      fixes: s?.fixes ?? 0,
      agoS: s?.lastFixAgoS ?? null,
      distance: s?.distanceM ? fmtDistance(s.distanceM) : null,
    },
    motion: {
      state: s?.motion ?? null,
      acc: motionOn && m?.acc != null ? fx(m.acc, 2, ' m/s²') : null,
      gyro: motionOn && m?.gyro != null ? fx(m.gyro, 1, ' °/s') : (motionOn && !s?.gyro ? 'no gyroscope' : null),
      rateHz: s?.hz != null ? `${s.hz} Hz` : null,
      windows: s?.windows ?? 0,
    },
    activity: {
      now: w?.activity ?? null,
      rhythm: w?.cad_hz != null && w?.cad_pw != null ? `${w.cad_hz.toFixed(2)} Hz · strength ${w.cad_pw.toFixed(2)}` : null,
      accRms: w?.acc_rms != null ? `${w.acc_rms.toFixed(2)} m/s²` : null,
      recent: s?.activities ?? [],
    },
    network: net?.effectiveType
      ? { type: net.effectiveType, downlink: net.downlink != null ? `${net.downlink} Mbps` : null, rtt: net.rtt != null ? `${net.rtt} ms` : null }
      : null,
    session: {
      visit: s?.visitId ? String(s.visitId).slice(0, 8) : null,
      offset: s?.visitId ? `${s.offsetMs >= 0 ? '+' : ''}${Math.round(s.offsetMs)} ms` : null,
      recordingS: s?.running && s?.startedAt ? Math.max(0, Math.round((now - s.startedAt) / 1000)) : null,
      wakeLock: s?.running ? (s.wakeLock ? 'held' : 'not held') : null,
      visible: s?.visible !== false,
      hiddenS: s?.hiddenS ?? 0,
      hiddenCount: s?.hiddenCount ?? 0,
      watchRestarts: s?.watchRestarts ?? 0,
    },
  }
}

const pctShare = (n, d) => (d ? Math.round((100 * n) / d) : 0)

// "What was fetched" on the verdict screen: what the server actually received and used, from result.fusion. Missing = said so.
export function fetchedSummary(fusion) {
  if (!fusion?.motion) return null
  const ev = fusion.motion.evidence ?? {}
  const rows = ev.rows ?? []
  const acts = rows.map((r) => r.activity).filter((a) => a && a !== 'unknown')
  const share = (k) => pctShare(acts.filter((a) => a === k).length, acts.length)
  const s = fusion.sensors ?? {}
  const ip = fusion.ip
  const ipComp = (fusion.environment?.components ?? []).find((c) => c.id === 'ip_location')
  const ipLine = !ip
    ? { ok: false, text: 'IP database not available on the server (or a private/local address)' }
    : ip.private
      ? { ok: false, text: 'a private / local network address (laptop or LAN demo): no IP location' }
      : { ok: true, text: [ip.country, ip.region, ip.city].filter(Boolean).join(' · ') + (ip.org ? ` · ${ip.org}` : '') + (ipComp?.detail ? ` (${ipComp.detail})` : '') }
  return [
    { id: 'fixes', label: 'GPS fixes', ok: (ev.fixes ?? 0) > 0, text: `${ev.fixes ?? 0} fixes (${ev.reliable_fixes ?? 0} accurate enough) over ${Math.round(ev.duration_s ?? 0)} s, ${fmtDistance(ev.distance_m ?? 0)} travelled` },
    { id: 'windows', label: 'Motion windows', ok: (ev.windows_with_data ?? 0) > 0, text: (ev.windows_with_data ?? 0) > 0 ? `${ev.windows_with_data} of ${ev.windows ?? 0} five-second windows had accelerometer/gyroscope data` : 'no accelerometer/gyroscope data arrived' },
    { id: 'activity', label: 'Phone activity', ok: acts.length > 0, text: acts.length ? `still ${share('still')}% · walking ${share('walking')}% · moving ${share('moving')}%` : 'not measured' },
    { id: 'jumps', label: 'GPS jumps', ok: true, tone: (ev.jumps ?? []).length ? 'red' : null, text: (ev.jumps ?? []).length ? `${ev.jumps.length} jump${ev.jumps.length > 1 ? 's' : ''} faster or farther than a device can move` : 'none' },
    { id: 'site', label: 'Site location', ok: !!fusion.site, text: fusion.site ? `registered, radius ${fusion.site.radius_m} m${ev.site?.end_m != null ? `; trail ended ${fmtDistance(ev.site.end_m)} from it` : ''}` : 'not registered: the arrival and outside-the-site checks were skipped' },
    { id: 'ip', label: 'IP location', ok: ipLine.ok, text: ipLine.text },
    { id: 'hidden', label: 'App hidden', ok: true, text: s.hidden_s ? `${s.hidden_s} s in ${s.hidden_count ?? 1} break${(s.hidden_count ?? 1) > 1 ? 's' : ''} (nothing recorded then)` : 'never' },
    { id: 'restarts', label: 'GPS restarts', ok: true, text: s.watch_restarts ? `${s.watch_restarts} (the GPS stalled and was restarted)` : 'none needed' },
  ]
}

// The recorder's last fix as the submission's `gps`, when the one-shot position request at submit time fails (a cold
// getCurrentPosition often times out on phones while the running watch already has a fresh fix). Too old = null.
export function recentFix(s, { maxAgeS = 30 } = {}) {
  const f = s?.lastFix
  if (!f || !Number.isFinite(f.lat) || !Number.isFinite(f.lng) || s.lastFixAgoS == null || s.lastFixAgoS > maxAgeS) return null
  return { lat: f.lat, lng: f.lng }
}
