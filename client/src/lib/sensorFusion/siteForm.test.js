import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BIG_MOVE_M, DEMO_SITE_ID, accuracyNote, describeChange, describeProfile, diffRows, explainLinkKey, distanceM, fmtDist, moveLine, shouldDefaultReset } from './siteForm.js'

const HOME = { lat: 12.9259481, lng: 77.6722586, radius_m: 100, country: 'IN', label: 'Home (test)' }
const NEAR = { ...HOME, lat: 12.9261, lng: 77.6723 } // ~17 m away
const FAR = { lat: '12.9716', lng: '77.5946', radius_m: '100', country: 'IN', label: '' } // Bengaluru centre, ~9.8 km

test('the demo site id is the one the Capture page uses', () => assert.equal(DEMO_SITE_ID, 'site_demo_1'))

test('distance matches known values and refuses non-numbers', () => {
  assert.ok(Math.abs(distanceM(HOME, { lat: 12.9716, lng: 77.5946 }) - 9800) < 300)
  assert.equal(distanceM(HOME, HOME), 0)
  assert.equal(distanceM(HOME, { lat: 'x', lng: 1 }), null)
  assert.equal(distanceM(null, HOME), null)
  assert.equal(distanceM(HOME, { lat: '', lng: '' }), null) // an empty box is not the point (0, 0)
})

test('distances are written in words', () => {
  assert.equal(fmtDist(4.26), '4.3 m')
  assert.equal(fmtDist(430), '430 m')
  assert.equal(fmtDist(9400), '9.4 km')
  assert.equal(fmtDist(290000), '290 km')
  assert.equal(fmtDist(null), '')
})

test('the sanity line says new / same / small / big', () => {
  assert.equal(moveLine(null, FAR).kind, 'new')
  assert.equal(moveLine(HOME, HOME).kind, 'same')
  assert.deepEqual([moveLine(HOME, NEAR).kind, moveLine(HOME, NEAR).text], ['small', 'This moves the site 17 m.'])
  const big = moveLine(HOME, FAR)
  assert.equal(big.kind, 'big')
  assert.match(big.text, /^This moves the site 9\.[5-9] km\.$/)
})

test('forgetting the learned network is the default only for a move of more than 1 km', () => {
  assert.equal(BIG_MOVE_M, 1000)
  assert.equal(shouldDefaultReset(HOME, FAR), true)
  assert.equal(shouldDefaultReset(HOME, NEAR), false)
  assert.equal(shouldDefaultReset(HOME, HOME), false)
  assert.equal(shouldDefaultReset(null, FAR), false) // nothing learned yet for a new site
  assert.equal(shouldDefaultReset(HOME, { lat: '', lng: 'x' }), false)
})

test('a position fix worse than 50 m gets a warning, a good one a confirmation', () => {
  assert.equal(accuracyNote(12).tone, 'green')
  assert.equal(accuracyNote(50).tone, 'green')
  const w = accuracyNote(80)
  assert.equal(w.tone, 'amber')
  assert.match(w.text, /±80 m.*worse than 50 m/)
  assert.equal(accuracyNote(undefined), null)
})

test('the confirm step lists old and new values and marks what changed', () => {
  const rows = diffRows(HOME, { ...FAR, label: 'Hackathon venue', country: ' in ' })
  const by = Object.fromEntries(rows.map((r) => [r.key, r]))
  assert.equal(by.lat.from, '12.925948')
  assert.equal(by.lat.to, '12.971600')
  assert.equal(by.lat.changed, true)
  assert.equal(by.radius_m.changed, false)
  assert.equal(by.country.changed, false)
  assert.deepEqual([by.label.from, by.label.to, by.label.changed], ['Home (test)', 'Hackathon venue', true])
  const fresh = diffRows(null, FAR)
  assert.equal(fresh.every((r) => r.from === '(none)' || r.key === 'x'), true)
})

test('the change log reads as sentences', () => {
  const create = describeChange({ kind: 'create', old: null, new: { label: 'Home (test)' }, network_reset: false })
  assert.deepEqual(create, { what: 'Registered (Home (test))', moved: '', network: '' })
  const move = describeChange({ kind: 'update', old: { radius_m: 100, country: 'IN', label: 'Home (test)' }, new: { radius_m: 120, country: 'IN', label: 'Venue' }, moved_m: 9400, network_reset: true, profile_rows_cleared: 8 })
  assert.equal(move.what, 'moved 9.4 km, radius 100 to 120 m, label "Home (test)" to "Venue"')
  assert.equal(move.network, 'learned network forgotten (8 rows)')
  assert.equal(describeChange({ kind: 'update', old: { radius_m: 100 }, new: { radius_m: 100 }, moved_m: 0, network_reset: false }).network, 'learned network kept')
})

test('the learned network is described exactly as stored, with the visit count and the rule', () => {
  const none = describeProfile({ site_id: 's', visits: 0, needed: 3, known: false, kinds: {}, rows: 0 })
  assert.equal(none.empty, true)
  assert.match(none.headline, /Nothing learned yet.*3 accepted visits/)
  const few = describeProfile({ visits: 2, needed: 3, known: false, kinds: { link: [{ key: '4g|2|<150', count: 2, last_seen: '2026-10-08T10:00:00Z' }] } })
  assert.match(few.headline, /Fewer than 3 accepted visits so far \(2\)/)
  const known = describeProfile({ visits: 4, needed: 3, known: true, rule: 'R', kinds: { asn: [{ key: 'AS24309', count: 4, last_seen: null }], link: [{ key: '4g|2|<150', count: 4, last_seen: '2026-10-08T10:00:00Z' }] } })
  assert.equal(known.headline, 'Learned from 4 accepted visits.')
  assert.deepEqual(known.rows.map((r) => [r.kind, r.key, r.count]), [['Network speed class', '4g|2|<150', 4], ['Internet provider (AS number)', 'AS24309', 4]])
  assert.equal(known.rule, 'R')
  assert.equal(describeProfile(null).empty, true)
})

test('a stored link-speed key is explained in words', () => {
  assert.equal(explainLinkKey('4g|3|<150'), '4g, about 8-16 Mbps, round trip under 150 ms')
  assert.equal(explainLinkKey('3g|0|<400'), '3g, under 2 Mbps, round trip under 400 ms')
  assert.equal(explainLinkKey('none|none|none'), 'connection type not reported, speed not reported, round trip not reported')
  assert.equal(explainLinkKey('2g|-1|>=1000'), '')
  assert.equal(explainLinkKey('weird'), '')
  assert.equal(explainLinkKey(null), '')
})
