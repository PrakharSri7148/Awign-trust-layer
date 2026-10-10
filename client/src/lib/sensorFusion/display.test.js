import assert from 'node:assert/strict'
import { test } from 'node:test'
import { envComponentText, fmtDistance, recordingSummary, scoreWord, timelineCells, trailGeometry, verdictSummary } from './display.js'
import { FUSION_FLAG_META, isFusionFlag } from './flags.js'

const SITE = { lat: 12.9716, lng: 77.5946, radius_m: 60 }

test('trail drawing: the path fits the box, the site circle is scaled, start and end are marked', () => {
  const pts = [[0, 12.9716, 77.5926], [5, 12.9716, 77.5936], [10, 12.9716, 77.5946]]
  const g = trailGeometry(pts, SITE, [], { w: 320, h: 200 })
  assert.ok(g.path.startsWith('M') && g.points.length === 3)
  for (const [x, y] of g.points) assert.ok(x >= 0 && x <= 320 && y >= 0 && y <= 200)
  assert.ok(g.site.r > 3 && Math.abs(g.end[0] - g.site.c[0]) < 2) // the walk ends at the site's centre
  assert.ok(g.start[0] < g.end[0]) // west to east
  assert.ok(g.spanM > 150 && g.spanM < 400)
})

test('a far jump shrinks the drawing instead of leaving the box, and is drawn as its own segment', () => {
  const pts = [[0, 13.1, 77.6], [5, 12.9716, 77.5946]]
  const g = trailGeometry(pts, SITE, [{ from: [13.1, 77.6], to: [12.9716, 77.5946] }])
  assert.ok(g.spanM > 10_000 && g.jumps.length === 1)
  for (const [x, y] of g.points) assert.ok(x >= 0 && x <= 320 && y >= 0 && y <= 200)
})

test('a jump is not part of the path (the phone did not travel along it) and the site ring stays visible', () => {
  const pts = [[0, 13.1, 77.6], [5, 13.1, 77.6], [10, 12.9716, 77.5946], [15, 12.9716, 77.5946]]
  const g = trailGeometry(pts, SITE, [{ from: [13.1, 77.6], to: [12.9716, 77.5946] }])
  assert.equal((g.path.match(/M/g) ?? []).length, 2, g.path) // two pieces: before and after the jump
  assert.equal(g.jumps.length, 1)
  assert.ok(g.site.r >= 6) // 60 m on a 14 km drawing would be a dot
  const walk = trailGeometry([[0, 12.9716, 77.5926], [5, 12.9716, 77.5936], [10, 12.9716, 77.5946]], SITE, [])
  assert.equal((walk.path.match(/M/g) ?? []).length, 1)
})

test('no points, no drawing; junk points are skipped; a single point still draws', () => {
  assert.equal(trailGeometry([], SITE), null)
  assert.equal(trailGeometry(null, null), null)
  assert.equal(trailGeometry([[0, NaN, 1], [1, null, null]], SITE), null)
  const one = trailGeometry([[0, 12.9716, 77.5946]], null)
  assert.equal(one.points.length, 1)
})

test('timeline cells mark where GPS and the phone disagree, unknowns stay unknown', () => {
  const cells = timelineCells([{ t: 0, gps: 'moving', gps_ms: 1.2, activity: 'still', acc_rms: 0.05, verdict: 'flat' }, { t: 5, gps: 'still', activity: 'still', verdict: 'ok' }, { t: 10 }])
  assert.deepEqual(cells.map((c) => c.mismatch), [true, false, false])
  assert.equal(cells[2].gps, 'unknown')
  assert.match(cells[0].title, /GPS moving \(1.2 m\/s\) · phone still/)
})

test('unknown is its own word, never "inconsistent"', () => {
  assert.equal(scoreWord(0.5, false).word, 'not enough data')
  assert.equal(scoreWord(0.95, true).tone, 'green')
  assert.equal(scoreWord(0.7, true).tone, 'amber')
  assert.equal(scoreWord(0.2, true).tone, 'red')
})

test('distance and environment wording', () => {
  assert.equal(fmtDistance(850), '850 m')
  assert.equal(fmtDistance(14200), '14.2 km')
  assert.equal(fmtDistance(null), '-')
  assert.deepEqual(envComponentText({ id: 'ip_location', status: 'far', detail: '840 km from the site' }), { name: 'IP location', status: 'far from site', detail: '840 km from the site' })
  assert.equal(envComponentText({ id: 'x', status: 'y' }).name, 'x')
})

test('recording summary', () => {
  assert.equal(recordingSummary(null), 'Not recording')
  assert.equal(recordingSummary({ running: true, fixes: 1, distanceM: 0, accuracyM: null, motion: 'granted' }), '1 location fix')
  assert.equal(recordingSummary({ running: true, fixes: 12, distanceM: 1500, accuracyM: 8.4, motion: 'null_events' }), '12 location fixes · 1.5 km · ±8 m · no motion sensor')
})

test('every fusion flag has a label, a kind and help text, and none is named like a photo check', () => {
  for (const [id, m] of Object.entries(FUSION_FLAG_META)) {
    assert.ok(m.label && m.help && ['integrity', 'info'].includes(m.kind), id)
    assert.ok(isFusionFlag(id))
  }
  assert.equal(isFusionFlag('blur'), false)
})

test('the server and the dashboard agree on the flag names', async () => {
  // every flag id the backend engines can raise has dashboard text (no raw "snake case" shown to a reviewer)
  const { execFileSync } = await import('node:child_process')
  const path = await import('node:path')
  const root = path.resolve(import.meta.dirname, '../../../..')
  const out = execFileSync(path.join(root, 'backend/.venv/bin/python'), ['-c', `
import re, pathlib
src = ''.join(p.read_text() for p in pathlib.Path('fusion').glob('*.py'))
ids = set(re.findall(r'flags\\.append\\("([a-z_]+)"\\)', src)) | set(re.findall(r'"(visit_unverified|trail_invalid|trail_replayed)"', src))
ids |= {f"{k}_not_seen_at_site" for k in ("wifi", "cell")}
print(" ".join(sorted(ids)))`], { cwd: path.join(root, 'backend') }).toString().trim().split(' ')
  const missing = out.filter((f) => !isFusionFlag(f))
  assert.deepEqual(missing, [])
  assert.ok(out.length >= 18, `found ${out.length} flags`)
})

test('verdict summary: consistent, spoof and unknown read differently and never invent a cause', () => {
  const ok = verdictSummary({ motion: { score: 0.97, known: true, sensor_used: true, reason: null }, environment: { score: 1, known: true, reason: null } }).filter((l) => l.id !== 'arrival')
  assert.deepEqual(ok.map((l) => l.tone), ['green', 'green'])
  assert.match(ok[0].text, /matches the GPS trail/)
  const spoof = verdictSummary({ motion: { score: 0.16, known: true, sensor_used: true, reason: 'GPS jumped 14.0 km in 6 s while the phone stayed still' }, environment: { score: 0.5, known: false } }).filter((l) => l.id !== 'arrival')
  assert.equal(spoof[0].tone, 'red')
  assert.equal(spoof[0].text, 'GPS jumped 14.0 km in 6 s while the phone stayed still')
  assert.equal(spoof[1].tone, 'muted')
  const gpsOnly = verdictSummary({ motion: { score: 0.9, known: true, sensor_used: false }, environment: { known: false } }).filter((l) => l.id !== 'arrival')
  assert.equal(gpsOnly[0].tone, 'muted')
  assert.match(gpsOnly[0].text, /Not enough sensor data/)
  assert.deepEqual(verdictSummary(null), [])
  assert.deepEqual(verdictSummary({}), [])
})

// ---------------------------------------------------------------- live feed + "what was fetched" (H3b)
import { NOT_AVAILABLE, fetchedSummary, liveFeed } from './display.js'

test('liveFeed prints what the recorder holds and nothing it does not', () => {
  const empty = liveFeed({ running: false, fixes: 0, windows: 0 })
  assert.equal(empty.gps.lat, null)
  assert.equal(empty.motion.acc, null)
  assert.equal(empty.network, null)
  assert.equal(empty.session.recordingS, null)

  const s = {
    running: true, geo: 'granted', motion: 'granted', gyro: true, fixes: 4, windows: 2, distanceM: 63, lastFixAgoS: 2,
    lastFix: { lat: 12.97161234, lng: 77.59461234, acc: 8.4, speed: null, heading: 271.6, alt: 912.2 },
    lastMotion: { acc: 1.234, gyro: 22.26 }, hz: 60,
    lastWindow: { activity: 'walking', cad_hz: 1.84, cad_pw: 0.61, acc_rms: 1.9 },
    activities: ['still', 'walking'], visitId: 'abcdef1234567890', offsetMs: -1520.4, startedAt: 1000, wakeLock: true, visible: true, hiddenS: 3, hiddenCount: 1, watchRestarts: 0,
  }
  const f = liveFeed(s, { net: { effectiveType: '4g', downlink: 9.5, rtt: 50 }, now: 31_000 })
  assert.deepEqual([f.gps.lat, f.gps.lng, f.gps.accuracy, f.gps.speed, f.gps.heading, f.gps.altitude], ['12.97161', '77.59461', '8 m', 'not reported', '272°', '912 m'])
  assert.equal(f.gps.distance, '63 m')
  assert.deepEqual([f.motion.acc, f.motion.gyro, f.motion.rateHz], ['1.23 m/s²', '22.3 °/s', '60 Hz'])
  assert.equal(f.activity.now, 'walking')
  assert.equal(f.activity.rhythm, '1.84 Hz · strength 0.61')
  assert.deepEqual(f.network, { type: '4g', downlink: '9.5 Mbps', rtt: '50 ms' })
  assert.deepEqual([f.session.visit, f.session.offset, f.session.recordingS, f.session.wakeLock], ['abcdef12', '-1520 ms', 30, 'held'])
})

test('liveFeed: motion numbers only when motion is really granted; a phone without a gyroscope says so', () => {
  const denied = liveFeed({ running: true, motion: 'denied', lastMotion: { acc: 1, gyro: 2 } })
  assert.equal(denied.motion.acc, null)
  const noGyro = liveFeed({ running: true, motion: 'granted', gyro: false, lastMotion: { acc: 0.5, gyro: null } })
  assert.equal(noGyro.motion.gyro, 'no gyroscope')
})

test('every not-available item carries a reason', () => {
  assert.ok(NOT_AVAILABLE.length >= 5)
  for (const n of NOT_AVAILABLE) assert.ok(n.label && n.reason.length > 20, n.id)
})

test('fetchedSummary counts what the server received; missing site / IP database are said, not hidden', () => {
  assert.equal(fetchedSummary(null), null)
  const fusion = {
    motion: { evidence: { fixes: 12, reliable_fixes: 11, duration_s: 61.2, distance_m: 74, windows: 12, windows_with_data: 12, jumps: [], site: null, rows: [{ activity: 'walking' }, { activity: 'walking' }, { activity: 'still' }, { activity: 'unknown' }] } },
    environment: { components: [] }, ip: null, site: null, sensors: { hidden_s: 0, watch_restarts: 0 },
  }
  const r = Object.fromEntries(fetchedSummary(fusion).map((x) => [x.id, x]))
  assert.match(r.fixes.text, /12 fixes \(11 accurate enough\) over 61 s, 74 m/)
  assert.match(r.windows.text, /12 of 12/)
  assert.equal(r.activity.text, 'still 33% · walking 67% · moving 0%')
  assert.equal(r.site.ok, false)
  assert.match(r.site.text, /not registered/)
  assert.equal(r.ip.ok, false)
  assert.match(r.ip.text, /not available/)
  assert.equal(r.jumps.text, 'none')

  const spoof = { ...fusion, site: { lat: 1, lng: 2, radius_m: 80 }, ip: { country: 'IN', region: 'Maharashtra', city: 'Navi Mumbai', org: 'Reliance Jio', private: false },
    motion: { evidence: { ...fusion.motion.evidence, jumps: [{ from: [0, 0], to: [1, 1] }], site: { end_m: 12 } } }, sensors: { hidden_s: 14, hidden_count: 2, watch_restarts: 1 } }
  const q = Object.fromEntries(fetchedSummary(spoof).map((x) => [x.id, x]))
  assert.equal(q.jumps.tone, 'red')
  assert.match(q.site.text, /registered, radius 80 m; trail ended 12 m from it/)
  assert.equal(q.ip.text, 'IN · Maharashtra · Navi Mumbai · Reliance Jio')
  assert.match(q.hidden.text, /14 s in 2 breaks/)
  assert.match(q.restarts.text, /^1 /)
  const lan = fetchedSummary({ ...fusion, ip: { private: true } }).find((x) => x.id === 'ip')
  assert.match(lan.text, /private/)
})

test('recentFix: the recorder\'s fix stands in for a failed one-shot GPS only while fresh', async () => {
  const { recentFix } = await import('./display.js')
  const s = { lastFix: { lat: 12.97, lng: 77.59, acc: 8 }, lastFixAgoS: 4 }
  assert.deepEqual(recentFix(s), { lat: 12.97, lng: 77.59 })
  assert.equal(recentFix({ ...s, lastFixAgoS: 31 }), null)
  assert.equal(recentFix({ lastFix: null }), null)
  assert.equal(recentFix(null), null)
})

// ---------------------------------------------------------------- "Arrival at site" (the worker confirmed they reached the site)
import { arrivalLine } from './display.js'

const withSite = (site, extra = {}) => ({ site: extra.noSite ? null : { lat: 1, lng: 2, radius_m: 60 }, motion: { evidence: { site } }, ...extra.rest })

test('arrival line: inside, outside, near, no fix and no registered site read differently; only "outside" is red', () => {
  const inside = arrivalLine(withSite({ end_m: 12, radius_m: 60, end_inside: true, end_outside: false, end_acc_m: 8 }))
  assert.equal(inside.tone, 'green')
  assert.match(inside.text, /GPS places you at the site: 12 m from its centre \(site radius 60 m\)/)
  const outside = arrivalLine(withSite({ end_m: 540, radius_m: 60, end_inside: false, end_outside: true, end_acc_m: 8 }))
  assert.equal(outside.tone, 'red')
  assert.match(outside.text, /540 m from the site.*arrival not confirmed, sent for review/)
  const near = arrivalLine(withSite({ end_m: 75, radius_m: 60, end_inside: false, end_outside: false, end_acc_m: 9.4 }))
  assert.equal(near.tone, 'amber')
  assert.match(near.text, /not clearly inside: 75 m away.*±9 m/)
  const noFix = arrivalLine(withSite(null))
  assert.equal(noFix.tone, 'muted')
  assert.match(noFix.text, /No reliable GPS fix/)
  const noSite = arrivalLine(withSite(null, { noSite: true }))
  assert.equal(noSite.tone, 'muted')
  assert.match(noSite.text, /company has not registered a location/)
  assert.equal(arrivalLine(null).tone, 'muted')
})

test('the verdict summary lists the arrival first, then movement and network', () => {
  const v = verdictSummary({ site: { lat: 1, lng: 2, radius_m: 60 }, motion: { score: 0.97, known: true, sensor_used: true, evidence: { site: { end_m: 5, radius_m: 60, end_inside: true } } }, environment: { known: false } })
  assert.deepEqual(v.map((l) => l.id), ['arrival', 'motion', 'network'])
})

import { countryName, distanceM, whereSummary } from './display.js'

test('where: a network in another country than the site is called out, with distances', () => {
  const w = whereSummary({
    site: { lat: 12.9716, lng: 77.5946, radius_m: 60, country: 'IN' },
    position: { lat: 12.9717, lng: 77.5947, acc_m: 8, at: 1_700_000_000_000, source: 'trail' },
    ip: { country: 'US', region: 'Virginia', city: 'Ashburn', org: 'Some VPN Inc', lat: 39.04, lng: -77.49, private: false },
  })
  assert.equal(w.countryClash, true)
  assert.equal(w.headline.tone, 'bad')
  assert.match(w.headline.text, /United States \(US\).*India \(IN\)/)
  assert.ok(w.phoneFromSiteM < 20)
  assert.ok(w.netFromSiteKm > 12_000 && w.netFromPhoneKm > 12_000)
  assert.equal(w.net.place, 'Ashburn, Virginia')
})

test('where: same country and close is quiet; a phone far outside the radius warns', () => {
  const site = { lat: 12.9716, lng: 77.5946, radius_m: 60, country: 'IN' }
  const ip = { country: 'IN', city: 'Bengaluru', lat: 12.97, lng: 77.59, private: false }
  assert.equal(whereSummary({ site, ip, position: { lat: 12.9716, lng: 77.5947 } }).headline, null)
  const far = whereSummary({ site, ip, position: { lat: 12.99, lng: 77.62 } })
  assert.equal(far.headline.tone, 'warn')
  assert.equal(far.countryClash, false)
})

test('where: missing pieces stay null; a private address is not a network location; unknown site country never claims a clash', () => {
  assert.equal(whereSummary(null), null)
  const w = whereSummary({ site: { lat: 1, lng: 2, radius_m: 50 }, ip: { private: true }, position: null })
  assert.equal(w.net, null)
  assert.equal(w.pos, null)
  assert.equal(w.headline, null)
  assert.equal(whereSummary({ site: { lat: 1, lng: 2 }, ip: { country: 'US', lat: 39, lng: -77 } }).countryClash, false)
  assert.equal(whereSummary({ ip: { country: 'US', lat: null, lng: null, purged: true } }).net.located, false)
  assert.equal(whereSummary({}).any, false)
})

test('distance and country names', () => {
  assert.ok(Math.abs(distanceM(0, 0, 0, 1) - 111_195) < 300)
  assert.equal(countryName(null), null)
  assert.match(countryName('in'), /India/)
})

test('where: the start is the first trail point, and its distances are worked out', () => {
  const w = whereSummary({
    site: { lat: 12.9716, lng: 77.5946, radius_m: 60, country: 'IN' },
    trail: { points: [[0, 12.9716, 77.5926, 9.5], [5, 12.9716, 77.5946, 6]] },
    position: { lat: 12.9716, lng: 77.5946, source: 'trail' },
  })
  assert.deepEqual(w.start, { lat: 12.9716, lng: 77.5926, acc_m: 9.5 })
  assert.ok(w.startFromSiteM > 190 && w.startFromSiteM < 250)
  assert.ok(Math.abs(w.startToEndM - w.startFromSiteM) < 1)
  assert.equal(whereSummary({ trail: { points: [], purged: true } }).start, null)
})

test('where: a network in another country, or one flagged as hosting, is labelled a VPN, with its distance from the start', () => {
  const ip = { country: 'US', city: 'Ashburn', lat: 39.04, lng: -77.49 }
  const start = [[0, 12.9716, 77.5926, 9]]
  const clash = whereSummary({ site: { lat: 12.97, lng: 77.59, country: 'IN' }, ip, trail: { points: start } })
  assert.equal(clash.net.isVpn, true)
  assert.ok(clash.netFromStartKm > 12_000)
  assert.equal(whereSummary({ ip, flags: ['anonymizing_network'] }).net.isVpn, true)
  assert.equal(whereSummary({ ip: { country: 'IN', lat: 12.9, lng: 77.6 }, site: { lat: 12.97, lng: 77.59, country: 'IN' } }).net.isVpn, false)
})

test('where: a submission without a stored last fix shows the last saved trail point instead', () => {
  const w = whereSummary({ source: 'trail', trail: { points: [[0, 12.9, 77.6, 17], [20, 12.95, 77.65, 4]] } })
  assert.deepEqual(w.pos, { lat: 12.95, lng: 77.65, acc_m: 4, at: null, source: 'trail' })
  assert.equal(whereSummary({ source: 'legacy_gps', trail: { points: [[0, 12.9, 77.6, null]] } }).pos.source, 'legacy_gps')
  assert.equal(whereSummary({ position: { lat: 1, lng: 2, at: 5, source: 'trail' }, trail: { points: [[0, 9, 9, 1]] } }).pos.lat, 1) // a stored fix wins
  assert.equal(whereSummary({ trail: { points: [], purged: true } }).pos, null)
})
