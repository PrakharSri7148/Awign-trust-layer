import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeLive } from './live.js'
import { estimateShift, makeThumb, opticalMotion } from './checks/opticalMotion.js'
import { createMotionBuffer } from './motionBuffer.js'
import { STATUS } from './schema.js'
import { frameFromGray, makeGray, mapChannels, sceneGray, toRgba } from './testing/synth.js'

const W = 480
const H = 270
const base = sceneGray(W, H, 9)
// the same scene seen `dx` px to the right / `dy` down (content moves by that much)
const shifted = (dx, dy = 0) => makeGray(W, H, (x, y) => base[Math.min(H - 1, Math.max(0, y - dy)) * W + Math.min(W - 1, Math.max(0, x - dx))])
const thumb = (g) => makeThumb(g, W, H)
const colour = (g) => mapChannels(toRgba(g), W, H, (c) => c)

test('a still scene reads ~0 and passes', () => {
  const m = opticalMotion(thumb(base), thumb(base))
  assert.ok(m.pct < 0.1, `${m.pct}`)
  assert.equal(m.status, STATUS.PASS)
  assert.ok(m.score > 0.95)
})

test('a known shift gives a known percentage of the frame width (thumbnail is 160 wide, so 3 px of 480 = 1 px = 0.625%)', () => {
  for (const [px, expect] of [[3, 0.625], [6, 1.25], [12, 2.5]]) {
    const m = opticalMotion(thumb(base), thumb(shifted(px)))
    assert.ok(Math.abs(m.pct - expect) < 0.25, `${px}px -> ${m.pct.toFixed(2)}% (want ${expect})`)
  }
})

test('direction does not matter; vertical and diagonal motion are measured too', () => {
  const v = opticalMotion(thumb(base), thumb(shifted(0, 9)))
  assert.ok(Math.abs(v.pct - 1.9) < 0.4, `${v.pct}`)
  const d = opticalMotion(thumb(base), thumb(shifted(-6, 6)))
  assert.ok(d.pct > 1.4 && d.pct < 2.2, `${d.pct}`)
})

test('status tiers: pass below 1%, warn from 1%, fail from 3%; a skipped tick is normalised to 200 ms', () => {
  assert.equal(opticalMotion(thumb(base), thumb(shifted(3))).status, STATUS.PASS) // 0.6%
  assert.equal(opticalMotion(thumb(base), thumb(shifted(9))).status, STATUS.WARN) // ~1.9%
  assert.equal(opticalMotion(thumb(base), thumb(shifted(19))).status, STATUS.FAIL) // ~3.9% (edge of the search: "at least")
  // the same 2.5% shift seen over 400 ms is half the speed per tick
  const slow = opticalMotion(thumb(base), thumb(shifted(12)), 400)
  assert.ok(Math.abs(slow.pct - 1.25) < 0.3, `${slow.pct}`)
  assert.equal(estimateShift(thumb(base), thumb(shifted(30))).saturated, true)
})

test('a texture-less scene cannot be measured: null, not "perfectly still"', () => {
  const flat = thumb(makeGray(W, H, () => 120))
  assert.equal(opticalMotion(flat, flat), null)
  assert.equal(opticalMotion(null, flat), null)
})

// ---- inside the HUD: image-only, sensor-only, both ------------------------------------------
const frameOf = (g) => frameFromGray(g, W, H, { rgba: colour(g) })
const VIDEO = { width: 1920, height: 1080 }
const steadyRow = (r) => r.metrics.steady
const rot = (v) => Array.from({ length: 10 }, (_, i) => ({ t: i, rot: v, acc: 0.1 }))

test('HUD: with no sensor the 2nd tick already shows image motion (this is the laptop case)', () => {
  const a = analyzeLive(frameOf(base), { video: VIDEO, now: 1000 })
  assert.equal(steadyRow(a).display, 'measuring…')
  const still = analyzeLive(frameOf(base), { video: VIDEO, now: 1200, prev: a.state })
  assert.equal(steadyRow(still).status, STATUS.PASS)
  assert.match(steadyRow(still).display, /^motion 0\.\d%$/)
  const moving = analyzeLive(frameOf(shifted(19)), { video: VIDEO, now: 1400, prev: still.state })
  assert.equal(moving.checks.steady.status, STATUS.FAIL)
  assert.match(steadyRow(moving).reason, /image moving/)
})

test('HUD: sensor and image are combined as the worse of the two, and the reason names the driver', () => {
  const a = analyzeLive(frameOf(base), { video: VIDEO, motion: rot(2), now: 1000 })
  // sensor says steady, the picture says moving -> warn/fail with "image moving"
  const b1 = analyzeLive(frameOf(shifted(19)), { video: VIDEO, motion: rot(2), now: 1200, prev: a.state })
  assert.equal(b1.checks.steady.status, STATUS.FAIL) // the chip reacts at once...
  const b = analyzeLive(frameOf(shifted(38)), { video: VIDEO, motion: rot(2), now: 1400, prev: b1.state }) // ...the row after 2 ticks
  assert.equal(steadyRow(b).display, '2°/s') // the sensor reading is what is shown
  assert.equal(steadyRow(b).status, STATUS.FAIL)
  assert.match(steadyRow(b).reason, /image moving/)
  // sensor says shaking, the picture is still -> the sensor drives it
  const c1 = analyzeLive(frameOf(base), { video: VIDEO, motion: rot(156), now: 1200, prev: a.state })
  const c = analyzeLive(frameOf(base), { video: VIDEO, motion: rot(156), now: 1400, prev: c1.state })
  assert.equal(steadyRow(c).status, STATUS.FAIL)
  assert.match(steadyRow(c).display, /°\/s$/) // sensor units (smoothed, so still converging towards 156)
  assert.ok(parseFloat(steadyRow(c).display) > 60)
})

test('HUD: the optical state is plain data that survives the worker round trip', () => {
  const a = analyzeLive(frameOf(base), { video: VIDEO, now: 1000 })
  const cloned = structuredClone(a.state)
  const b = analyzeLive(frameOf(shifted(9)), { video: VIDEO, now: 1200, prev: cloned })
  assert.equal(steadyRow(b).status, STATUS.WARN)
})

// ---- the sensor buffer on awkward devices ---------------------------------------------------
function feed(events) {
  const buf = createMotionBuffer({ now: () => 5 })
  let handler
  buf.start({ addEventListener: (_, f) => (handler = f), removeEventListener() {} })
  events.forEach((e) => handler(e))
  return buf.recent(100, 5)
}

test('motion buffer: all-null desktop events are "no sensor", not "perfectly still"', () => {
  const s = feed(Array.from({ length: 5 }, () => ({ rotationRate: { alpha: null, beta: null, gamma: null }, acceleration: { x: null, y: null, z: null } })))
  assert.equal(s.length, 0)
})

test('motion buffer: acceleration including gravity is turned into a ~0 reading when still', () => {
  const still = feed(Array.from({ length: 30 }, () => ({ rotationRate: null, acceleration: null, accelerationIncludingGravity: { x: 0.2, y: 9.7, z: 0.5 } })))
  assert.ok(still.length === 30)
  assert.ok(still.slice(-5).every((s) => s.acc < 0.2), JSON.stringify(still.slice(-3)))
  assert.equal(still[0].rot, null)
  // a jolt shows up
  const jolt = feed([...Array.from({ length: 20 }, () => ({ accelerationIncludingGravity: { x: 0, y: 9.8, z: 0 } })), { accelerationIncludingGravity: { x: 4, y: 12, z: 3 } }])
  assert.ok(jolt[jolt.length - 1].acc > 3)
})
