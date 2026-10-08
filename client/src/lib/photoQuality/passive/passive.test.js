import assert from 'node:assert/strict'
import { test } from 'node:test'
import { THRESHOLDS } from '../config.js'
import { decodeToFrame } from '../decode.js'
import { addNoise, boxBlur, clip255, makeGray, sceneGray, toRgba } from '../testing/synth.js'
import { asFile, encodeImage, nodeEnv } from '../testing/nodeEnv.js'
import { bandingEvidence, rowProfile } from './banding.js'
import { bezelMetrics } from './bezel.js'
import { fft1d, fftMagnitude2d } from './fft.js'
import { moireMetrics } from './moire.js'
import { passiveFromFrame, passiveScore } from './passive.js'
import { planarity } from './planarity.js'

const W = 480
const H = 360
const P = THRESHOLDS.passive
// a "natural" baseline: blurred blobs + sensor noise (sceneGray alone has a periodic texture of its own)
const natural = (seed = 4) => addNoise(boxBlur(sceneGray(W, H, seed), W, H, 3), 3, seed)
// a rotated 2-D grid like a screen's pixel structure beating against the sensor
function withGrid(g, period, amp, deg = 11) {
  const t = (deg * Math.PI) / 180
  return g.map((v, i) => {
    const x = i % W
    const y = Math.floor(i / W)
    const u = x * Math.cos(t) + y * Math.sin(t)
    const w = -x * Math.sin(t) + y * Math.cos(t)
    return clip255(v + (amp * (Math.cos((2 * Math.PI * u) / period) + Math.cos((2 * Math.PI * w) / period))) / 2)
  })
}

test('fft: a pure cosine lands in exactly its bin', () => {
  const n = 64
  const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n))
  const im = new Float64Array(n)
  fft1d(re, im)
  const mag = re.map((v, i) => Math.hypot(v, im[i]))
  assert.ok(Math.abs(mag[5] - n / 2) < 1e-9 && Math.abs(mag[n - 5] - n / 2) < 1e-9)
  assert.ok(mag.every((m, i) => i === 5 || i === n - 5 || m < 1e-9))
  const img = Float64Array.from({ length: 16 * 16 }, (_, i) => Math.cos((2 * Math.PI * 3 * (i % 16)) / 16))
  const M = fftMagnitude2d(img, 16)
  assert.ok(M[3] > 100 && M[0] < 1e-9)
})

test('moire: a screen-like grid is caught, natural texture is not', () => {
  const base = natural()
  const clean = moireMetrics(base, W, H)
  assert.ok(clean.score < P.moire.warn, `clean ${clean.score}`)
  for (const period of [3.3, 5]) {
    const m = moireMetrics(withGrid(base, period, 14), W, H)
    assert.ok(m.score >= P.moire.fail, `period ${period}: ${m.score}`)
    assert.ok(m.peaks >= 1)
  }
  // the detected period is the grid's
  const m = moireMetrics(withGrid(base, 5, 14), W, H)
  assert.ok(Math.abs(m.periodPx - 5) < 0.6, String(m.periodPx))
  // a fainter grid scores lower (monotone in amplitude)
  assert.ok(moireMetrics(withGrid(base, 5, 4), W, H).score < moireMetrics(withGrid(base, 5, 14), W, H).score)
})

test('moire: JPEG 8x8 blocking and a straight edge are not mistaken for a screen', async () => {
  const base = natural(9)
  const rgba = toRgba(base)
  const bytes = encodeImage(rgba, W, H, { type: 'jpeg', quality: 35 })
  const fr = await decodeToFrame(asFile(bytes, 'image/jpeg'), { env: nodeEnv })
  const m = moireMetrics(fr.gray, fr.width, fr.height)
  assert.ok(m.score < P.moire.warn, `jpeg q35 ${m.score}`)
  const edge = makeGray(W, H, (x) => (x < 233 ? 60 : 190))
  assert.ok(moireMetrics(addNoise(edge, 2, 3), W, H).score < P.moire.warn, 'a hard vertical edge')
})

test('moire: tiny patches are skipped, not guessed', () => {
  const m = moireMetrics(new Float32Array(40 * 40), 40, 40)
  assert.equal(m.score, null)
})

// a scene inside a bezel: dark outside, the picture inside, with a thin lighter frame line
function framed(inner, { dark = 20, margin = 0.1, sides = 4 } = {}) {
  const x0 = Math.round(W * margin), x1 = Math.round(W * (1 - margin)), y0 = Math.round(H * margin), y1 = Math.round(H * (1 - margin))
  return Float32Array.from(inner, (v, i) => {
    const x = i % W, y = Math.floor(i / W)
    const inside = x >= x0 && x < x1 && y >= y0 && y < y1
    const sideOk = (x < x0 ? sides >= 1 : x >= x1 ? sides >= 2 : true) && (y < y0 ? sides >= 3 : y >= y1 ? sides >= 4 : true)
    return inside || !sideOk ? Math.max(v, 90) : dark
  })
}

test('bezel: a bright picture inside a dark frame is found; the same scene without the frame is not', () => {
  const inner = natural(2)
  const yes = bezelMetrics(framed(inner), W, H)
  assert.ok(yes.found && yes.score > 0.6 && yes.consistent === 4, JSON.stringify(yes))
  assert.equal(yes.polarity, 'outside-darker')
  assert.equal(bezelMetrics(Float32Array.from(inner, (v) => Math.max(v, 90)), W, H).found, false)
})

test('bezel: needs a consistent rectangle, not a single door-like line', () => {
  const door = makeGray(W, H, (x) => (x > 100 && x < 108 ? 20 : 150))
  assert.equal(bezelMetrics(addNoise(door, 2, 3), W, H).found, false)
})

test('bezel: a rectangle that does not contain the face (a window or monitor behind the person) counts for much less', () => {
  const g = framed(natural(3))
  const inside = bezelMetrics(g, W, H, { x: 0.35, y: 0.3, w: 0.3, h: 0.4 })
  const outside = bezelMetrics(g, W, H, { x: 0.0, y: 0.0, w: 0.2, h: 0.25 })
  assert.ok(inside.score > 2 * outside.score, `${inside.score} vs ${outside.score}`)
})

test('bezel: a white paper margin around a darker picture (a print) is also a frame', () => {
  const g = framed(Float32Array.from(natural(5), (v) => v * 0.5), { dark: 235 })
  const m = bezelMetrics(g, W, H)
  assert.ok(m.found, JSON.stringify(m))
  assert.equal(m.polarity, 'outside-brighter')
})

// frames with horizontal bands whose phase advances each frame
const bandFrame = (phase, amp = 12, period = 44, base = 120) => makeGray(W, 240, (x, y) => base + amp * Math.sin((2 * Math.PI * (y + phase)) / period))

test('banding: bands that DRIFT between frames fire; static stripes and a plain scene do not', () => {
  const drifting = Array.from({ length: 6 }, (_, i) => rowProfile(bandFrame(i * 7), W, 240))
  const d = bandingEvidence(drifting)
  assert.ok(d.banded && d.drifting && d.score > 0.5, JSON.stringify(d))
  const stripes = Array.from({ length: 6 }, () => rowProfile(bandFrame(0), W, 240))
  assert.equal(bandingEvidence(stripes).score, 0) // a striped shirt does not move
  // bands UNDER a busy static scene (a face on the screen): the scene cancels in the frame difference
  const busy = natural(8)
  const withScene = (phase) => Float32Array.from(busy, (v, i) => clip255(v + 5 * Math.sin((2 * Math.PI * (Math.floor(i / W) * 360 / 240 + phase)) / 60)))
  const sc = bandingEvidence(Array.from({ length: 6 }, (_, i) => rowProfile(withScene(i * 7), W, 360)))
  assert.ok(sc.score > 0.3, JSON.stringify(sc))
  const noBands = bandingEvidence(Array.from({ length: 6 }, (_, i) => rowProfile(addNoise(busy, 1.5, i + 1), W, 360)))
  assert.equal(noBands.score, 0)
  // a person moving (a non-periodic residual) is not banding
  const moving = Array.from({ length: 6 }, (_, i) => rowProfile(Float32Array.from(busy, (v, j) => ((j % W) > 100 + i * 20 && (j % W) < 220 + i * 20 && Math.floor(j / W) > 60 && Math.floor(j / W) < 240 ? v + 40 : v)), W, 360))
  assert.equal(bandingEvidence(moving).score, 0)
  const plain = Array.from({ length: 6 }, (_, i) => rowProfile(addNoise(makeGray(W, 240, () => 120), 1.5, i + 1), W, 240))
  assert.equal(bandingEvidence(plain).score, 0)
  assert.equal(bandingEvidence(drifting.slice(0, 2)).score, null) // not enough frames yet
})

// a crude 3-D face: 28 landmarks with real depth; viewed straight on and after a head turn
const face3d = Array.from({ length: 28 }, (_, i) => {
  const t = (i / 28) * 2 * Math.PI
  const x = 0.5 * Math.cos(t) * (0.6 + 0.4 * Math.abs(Math.sin(t)))
  const y = 0.5 * Math.sin(t)
  return [x, y, 0.3 * Math.max(0, 1 - Math.hypot(x, y) / 0.5) + (i % 5 === 0 ? 0.25 : 0)]
})
const view = (pts, yawDeg, depth = true) => pts.map((p) => {
  const a = (yawDeg * Math.PI) / 180
  const z0 = depth ? p[2] : 0
  const x = p[0] * Math.cos(a) + z0 * Math.sin(a)
  const z = -p[0] * Math.sin(a) + z0 * Math.cos(a)
  return [0.5 + x / (1 - z / 3), 0.5 + p[1] / (1 - z / 3)]
})

test('planarity: a flat picture moves as one homography, a 3-D face does not, no motion is "unknown"', () => {
  const flat = planarity(view(face3d, 0, false), view(face3d, 25, false), 1)
  assert.equal(flat.planar, true)
  assert.ok(flat.rel < 0.05)
  const real = planarity(view(face3d, 0), view(face3d, 14), 1)
  assert.equal(real.planar, false)
  assert.ok(real.rel > 0.8)
  assert.equal(planarity(view(face3d, 0), view(face3d, 0.2), 1).planar, null) // moved too little to say
  assert.equal(planarity(view(face3d, 0).slice(0, 4), view(face3d, 9).slice(0, 4), 1).planar, null)
})

test('passiveScore: a noisy-OR of weighted signals with explicit unknowns', () => {
  const none = passiveScore({})
  assert.equal(none.score, null)
  assert.equal(none.status, 'unknown')
  const strongMoire = passiveScore({ moire: { score: P.moire.fail } })
  assert.ok(Math.abs(strongMoire.score - P.weights.moire) < 1e-9)
  assert.equal(strongMoire.status, 'warn') // 0.6 >= warnAt 0.45
  assert.equal(passiveScore({ moire: { score: P.moire.warn - 1 } }).status, 'pass')
  const both = passiveScore({ moire: { score: P.moire.fail }, bezel: { score: 1 } })
  assert.ok(both.score > strongMoire.score && both.score < 1)
  assert.equal(passiveScore({ moire: { score: 99 }, bezel: { score: 1 }, banding: { score: 1 }, planar: { planar: true } }).status, 'warn') // failAt is above 1: heuristics alone never block (decided in 7f)
  assert.deepEqual(passiveScore({ planar: { planar: null } }).used, [])
  assert.ok(passiveScore({ planar: { planar: true } }).score < P.warnAt) // weak evidence alone does not flag a person who just slid sideways
})

test('passiveFromFrame: the photo part (what the server recomputes) catches a screen-like photo', async () => {
  const base = natural(6)
  for (const [name, g, expect] of [['clean', base, false], ['grid + bezel', framed(withGrid(base, 4, 16)), true]]) {
    const bytes = encodeImage(toRgba(g), W, H, { type: 'jpeg', quality: 94 })
    const fr = await decodeToFrame(asFile(bytes, 'image/jpeg'), { env: nodeEnv })
    const s = passiveScore(passiveFromFrame(fr))
    assert.equal(s.score >= P.warnAt, expect, `${name}: ${JSON.stringify(s)}`)
  }
})

import { createPassiveSession } from './session.js'

test('passive session: medians resist one odd frame; 3-D motion beats flat readings', () => {
  const s = createPassiveSession()
  for (const v of [2, 2.5, 30, 2.2, 2.4]) s.addTick({ moire: { score: v }, bezel: { score: 0 }, banding: { score: 0 } })
  assert.ok(s.summary().moire.score < 3) // the 30 is an outlier
  assert.equal(s.summary().planar.planar, null)
  // landmarks of a flat picture sliding and tilting for ~1 s -> flat; a 3-D face turning -> organic
  const flatPts = (yaw) => view(face3d, yaw, false).map(([x, y]) => ({ x, y }))
  const realPts = (yaw) => view(face3d, yaw).map(([x, y]) => ({ x, y }))
  const run = (mk) => { const x = createPassiveSession(); for (let i = 0; i <= 30; i++) x.addLandmarks(i * 70, mk(i * 0.9)); return x.summary().planar }
  assert.equal(run(flatPts).planar, true)
  assert.equal(run(realPts).planar, false)
  s.reset()
  assert.equal(s.summary().moire.score, null)
  assert.equal(s.addLandmarks(0, null), null)
})
