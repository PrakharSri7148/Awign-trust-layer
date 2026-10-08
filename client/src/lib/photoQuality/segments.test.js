import assert from 'node:assert/strict'
import { test } from 'node:test'
import { THRESHOLDS } from './config.js'
import { OVERALL_SEGMENTS, SEGMENTS, positionSegments, segmentTicks, toSegments } from './segments.js'
import { STATUS } from './schema.js'

test('segment counts come from thresholds.json (10 per metric, 20 overall)', () => {
  assert.equal(SEGMENTS, 10)
  assert.equal(OVERALL_SEGMENTS, 20)
  assert.equal(THRESHOLDS.live.hud.segments, 10)
})

test('lit segments = round(pct / 10), clamped to 0..n', () => {
  const lit = (p) => toSegments(p).lit
  assert.deepEqual([0, 4, 5, 14, 15, 46, 100].map(lit), [0, 0, 1, 1, 2, 5, 10])
  assert.equal(lit(-30), 0)
  assert.equal(lit(250), 10)
  assert.equal(lit(null), 0)
  assert.equal(lit(NaN), 0)
})

test('a 0 to 100 ramp lights segments monotonically, one step at a time, and cells are a prefix', () => {
  let prev = 0
  for (let p = 0; p <= 100; p += 1) {
    const s = toSegments(p)
    assert.ok(s.lit >= prev && s.lit - prev <= 1, `jumped at ${p}`)
    prev = s.lit
    assert.equal(s.cells.length, 10)
    assert.deepEqual(s.cells, Array.from({ length: 10 }, (_, i) => i < s.lit))
  }
  assert.equal(prev, 10)
})

test('falling values darken segments in the same steps', () => {
  const down = []
  for (let p = 100; p >= 0; p -= 5) down.push(toSegments(p).lit)
  for (let i = 1; i < down.length; i++) assert.ok(down[i] <= down[i - 1] && down[i - 1] - down[i] <= 1)
})

test('the colour follows the status so a bad reading never looks green', () => {
  assert.equal(toSegments(80, 10, STATUS.PASS).tone, 'pass')
  assert.equal(toSegments(80, 10, STATUS.WARN).tone, 'warn')
  assert.equal(toSegments(80, 10, STATUS.FAIL).tone, 'fail')
  assert.equal(toSegments(80, 10, 'bogus').tone, 'pass')
})

test('overall meter uses 20 segments', () => {
  assert.equal(toSegments(73, OVERALL_SEGMENTS).lit, 15)
  assert.equal(toSegments(73, OVERALL_SEGMENTS).cells.length, 20)
})

test('tick notches map to boundaries and vanish at the ends', () => {
  assert.deepEqual(segmentTicks({ warn: 70, fail: 50 }), { warn: 7, fail: 5 })
  assert.deepEqual(segmentTicks({ warn: 62, fail: 0 }), { warn: 6, fail: null })
  assert.deepEqual(segmentTicks({ warn: 100, fail: 100 }), { warn: null, fail: null })
  assert.deepEqual(segmentTicks(null), { warn: null, fail: null })
  assert.deepEqual(segmentTicks({ warn: [10, 90], fail: [5, 95] }), { warn: null, fail: null }) // two-sided ticks belong to the position meter
})

test('position meter: one lit segment at the mean-luma position, good zone between the warn levels', () => {
  const ticks = { warn: [(65 / 255) * 100, (210 / 255) * 100] }
  const mid = positionSegments(52, ticks)
  assert.equal(mid.at, 5)
  assert.deepEqual(mid.cells.map(Number), [0, 0, 0, 0, 0, 1, 0, 0, 0, 0])
  assert.deepEqual(mid.zone.map(Number), [0, 0, 0, 1, 1, 1, 1, 1, 0, 0]) // centres 35..75 lie inside 25.5%..82.4%
  assert.equal(positionSegments(0, ticks).at, 0)
  assert.equal(positionSegments(100, ticks).at, 9)
  assert.equal(positionSegments(null, ticks).at, 0)
})

test('position meter ramp moves monotonically left to right', () => {
  let prev = -1
  for (let p = 0; p <= 100; p += 2) {
    const a = positionSegments(p, null).at
    assert.ok(a >= prev)
    prev = a
  }
})
