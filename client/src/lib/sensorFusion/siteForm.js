// Pure logic of the dashboard's "Site location" panel (components/dashboard/SiteLocationPanel.jsx), kept apart so it can be tested.
export const DEMO_SITE_ID = 'site_demo_1' // the id the Capture page uses (Capture.jsx)
export const BIG_MOVE_M = 1000 // beyond this a move also forgets the learned network by default
export const GOOD_ACCURACY_M = 50 // a position fix worse than this gets a warning

const R = 6371008.8
const rad = (d) => (d * Math.PI) / 180

export function distanceM(a, b) {
  if (!a || !b) return null
  const raw = [a.lat, a.lng, b.lat, b.lng]
  if (raw.some((v) => v === '' || v == null)) return null // an empty box is not 0
  const [la1, ln1, la2, ln2] = raw.map(Number)
  if (![la1, ln1, la2, ln2].every(Number.isFinite)) return null
  const h = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(ln2 - ln1) / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function fmtDist(m) {
  if (m == null || !Number.isFinite(m)) return ''
  if (m < 10) return `${m.toFixed(1)} m`
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(m < 100000 ? 1 : 0)} km`
}

// The distance sanity line under the form. `site` = the saved site or null; `form` = the editable values.
export function moveLine(site, form) {
  if (!site) return { kind: 'new', text: 'This registers a new site.' }
  const m = distanceM(site, form)
  if (m == null) return { kind: 'unknown', text: '' }
  if (m < 1) return { kind: 'same', text: 'The point is unchanged.', moved_m: m }
  return { kind: m > BIG_MOVE_M ? 'big' : 'small', text: `This moves the site ${fmtDist(m)}.`, moved_m: m }
}

// "Forget the learned network" is ticked by default only for a move of more than 1 km (the home network would otherwise make the venue's network look "unseen").
export const shouldDefaultReset = (site, form) => {
  const m = site ? distanceM(site, form) : null
  return m != null && m > BIG_MOVE_M
}

export function accuracyNote(acc) {
  if (!Number.isFinite(acc)) return null
  const a = Math.round(acc)
  return a > GOOD_ACCURACY_M
    ? { tone: 'amber', text: `Location found, but only to ±${a} m (worse than ${GOOD_ACCURACY_M} m). Step outside, wait for a better fix, or type the coordinates.` }
    : { tone: 'green', text: `Location found (±${a} m).` }
}

const same = (a, b) => (a ?? '') === (b ?? '')
const num = (v) => (v === '' || v == null ? null : Number(v))

// Rows for the confirm step: what the site is now and what it will be. `changed` marks the differences.
export function diffRows(site, form) {
  const to = { lat: num(form.lat), lng: num(form.lng), radius_m: num(form.radius_m), country: (form.country ?? '').trim().toUpperCase() || null, label: (form.label ?? '').trim() || null }
  const from = site ?? { lat: null, lng: null, radius_m: null, country: null, label: null }
  const f = (k, v) => (v == null || v === '' ? '(none)' : k === 'lat' || k === 'lng' ? Number(v).toFixed(6) : k === 'radius_m' ? `${v} m` : String(v))
  return [['lat', 'Latitude'], ['lng', 'Longitude'], ['radius_m', 'Radius'], ['country', 'Country'], ['label', 'Label']]
    .map(([k, name]) => ({ key: k, name, from: f(k, from[k]), to: f(k, to[k]), changed: !same(from[k], to[k]) }))
}

// One line of the change log.
export function describeChange(c) {
  const label = c.new?.label ? ` (${c.new.label})` : ''
  if (c.kind === 'create' || !c.old) return { what: `Registered${label}`, moved: '', network: c.network_reset ? 'learned network cleared' : '' }
  const bits = []
  if (c.moved_m != null && c.moved_m >= 1) bits.push(`moved ${fmtDist(c.moved_m)}`)
  if (c.old.radius_m !== c.new.radius_m) bits.push(`radius ${c.old.radius_m} to ${c.new.radius_m} m`)
  if (c.old.country !== c.new.country) bits.push(`country ${c.old.country ?? '-'} to ${c.new.country ?? '-'}`)
  if (c.old.label !== c.new.label) bits.push(`label "${c.old.label ?? ''}" to "${c.new.label ?? ''}"`)
  return { what: bits.join(', ') || 'No value changed', moved: c.moved_m != null && c.moved_m >= 1 ? fmtDist(c.moved_m) : '', network: c.network_reset ? `learned network forgotten (${c.profile_rows_cleared} rows)` : 'learned network kept' }
}

export function fmtWhen(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// "4g|3|<150" (effective type | log2 of the downlink in Mbps | round-trip bucket) in words, e.g. "4g, about 8-16 Mbps, round trip under 150 ms".
export function explainLinkKey(key) {
  const m = /^([^|]*)\|(none|\d+)\|(none|<\d+|>=\d+)$/.exec(String(key ?? ''))
  if (!m) return ''
  const [, type, dl, rtt] = m
  const speed = dl === 'none' ? 'speed not reported' : dl === '0' ? 'under 2 Mbps' : `about ${2 ** Number(dl)}-${2 ** (Number(dl) + 1)} Mbps`
  const lag = rtt === 'none' ? 'round trip not reported' : rtt.startsWith('<') ? `round trip under ${rtt.slice(1)} ms` : `round trip ${rtt.slice(2)} ms or more`
  return `${type === 'none' ? 'connection type not reported' : type}, ${speed}, ${lag}`
}

const KIND_NAME = { link: 'Network speed class', asn: 'Internet provider (AS number)', wifi: 'WiFi networks (hashed)', cell: 'Cell towers (hashed)' }

// The "Learned network" view: exactly what the server stored for the site (GET /sites/{id}/profile), as a headline and rows.
export function describeProfile(p) {
  if (!p || typeof p !== 'object') return { headline: '', known: false, rows: [], empty: true }
  const rows = []
  for (const kind of ['link', 'asn', 'wifi', 'cell']) {
    for (const r of p.kinds?.[kind] ?? []) rows.push({ kind: KIND_NAME[kind], key: r.key, meaning: kind === 'link' ? explainLinkKey(r.key) : '', count: r.count, last: r.last_seen ? fmtWhen(r.last_seen) : '' })
  }
  const need = p.needed ?? 3
  const n = p.visits ?? 0
  const headline = rows.length === 0
    ? `Nothing learned yet. It takes ${need} accepted visits with the movement verified; until then "new network" checks are off.`
    : p.known
      ? `Learned from ${n} accepted visit${n === 1 ? '' : 's'}.`
      : `Fewer than ${need} accepted visits so far (${n}): "new network" checks are off.`
  return { headline, known: !!p.known, rows, empty: rows.length === 0, rule: p.rule ?? '' }
}
