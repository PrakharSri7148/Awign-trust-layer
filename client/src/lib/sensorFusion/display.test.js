import assert from 'node:assert/strict'
import { test } from 'node:test'
import { envComponentText, fmtDistance, recordingSummary, scoreWord, timelineCells, trailGeometry } from './display.js'
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
