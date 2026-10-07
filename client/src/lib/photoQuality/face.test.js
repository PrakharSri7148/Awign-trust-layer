import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeFrameAsync, checkFace, evaluateFace } from './index.js'
import { STATUS, VERDICT } from './schema.js'
import { taskConfig } from './config.js'
import { boxBlur, frameFromGray, sceneGray } from './testing/synth.js'

const W = 960
const H = 640
const scene = sceneGray(W, H, 7)
const frame = (gray = scene) => frameFromGray(gray, W, H)

// A scripted detection. cx/cy/h are fractions of the frame; pixel geometry is
// derived so the face is a sensible shape in a non-square frame.
function face({ cx = 0.5, cy = 0.45, h = 0.35, score = 0.92, yaw = 0, rollDeg = 0 } = {}) {
  const hPx = h * H
  const wPx = 0.78 * hPx
  const eyeDist = 0.42 * wPx
  const r = (rollDeg * Math.PI) / 180
  const ex = (Math.cos(r) * eyeDist) / 2 / W
  const ey = (Math.sin(r) * eyeDist) / 2 / H
  const eyeY = cy - 0.12 * h
  return {
    box: { x: cx - wPx / W / 2, y: cy - h / 2, w: wPx / W, h },
    score,
    keypoints: [
      { x: cx - ex, y: eyeY - ey }, // right eye (image-left)
      { x: cx + ex, y: eyeY + ey }, // left eye
      { x: cx + (yaw * eyeDist) / W, y: cy + 0.05 * h }, // nose
      { x: cx, y: cy + 0.25 * h },
      { x: cx - 0.45 * wPx / W, y: eyeY },
      { x: cx + 0.45 * wPx / W, y: eyeY },
    ],
  }
}
const ev = (faces, f = frame()) => evaluateFace(faces, f)

test('no face found fails and tells the worker to move closer', () => {
  const r = ev([])
  assert.equal(r.status, STATUS.FAIL)
  assert.match(r.hint, /No face found.*closer/)
})

test('a clear, centred, frontal face passes', () => {
  const r = ev([face()])
  assert.equal(r.status, STATUS.PASS, r.details.problems?.join('; '))
  assert.equal(r.hint, null)
  assert.ok(r.score > 0.8)
})

test('detector confidence: partly clear warns, unclear fails', () => {
  assert.equal(ev([face({ score: 0.6 })]).status, STATUS.WARN)
  const low = ev([face({ score: 0.4 })])
  assert.equal(low.status, STATUS.FAIL)
  assert.match(low.hint, /No clear face/)
})

test('size: small warns, tiny fails', () => {
  assert.equal(ev([face({ h: 0.12 })]).status, STATUS.WARN)
  const tiny = ev([face({ h: 0.05 })])
  assert.equal(tiny.status, STATUS.FAIL)
  assert.match(tiny.hint, /too small/)
})

test('cut off by the frame edge fails with the specific hint', () => {
  const r = ev([face({ cx: 0.02 })]) // half the face is outside
  assert.equal(r.status, STATUS.FAIL)
  assert.match(r.hint, /cut off/)
  assert.ok(r.details.visibleFrac < 0.75)
})

test('a face just touching the edge only warns', () => {
  const f = face({ cx: 0.5 })
  f.box.x = -0.01 // ~5% of the box outside
  const r = ev([f])
  assert.ok(r.details.visibleFrac < 0.99 && r.details.visibleFrac > 0.9)
  assert.notEqual(r.status, STATUS.FAIL)
})

test('eyes outside the frame fail even if the box is mostly inside', () => {
  const f = face()
  f.keypoints[0] = { x: -0.02, y: 0.3 }
  assert.equal(ev([f]).status, STATUS.FAIL)
})

test('pose: turned head warns, looking away fails, tilt warns', () => {
  assert.equal(ev([face({ yaw: 0.45 })]).status, STATUS.WARN)
  const away = ev([face({ yaw: 0.9 })])
  assert.equal(away.status, STATUS.FAIL)
  assert.match(away.hint, /looking away/)
  const tilt = ev([face({ rollDeg: 32 })])
  assert.equal(tilt.status, STATUS.WARN)
  assert.match(tilt.hint, /tilted/)
  assert.ok(Math.abs(tilt.details.roll - 32) < 1)
})

test('yaw sign is symmetric (left or right)', () => {
  assert.equal(ev([face({ yaw: -0.9 })]).status, STATUS.FAIL)
})

test('more than one confident face warns; a spurious low-confidence one is ignored', () => {
  const multi = ev([face({ cx: 0.3 }), face({ cx: 0.75, h: 0.3, score: 0.9 })])
  assert.equal(multi.status, STATUS.WARN)
  assert.match(multi.hint, /More than one/)
  const spurious = ev([face(), face({ cx: 0.8, h: 0.4, score: 0.3 })])
  assert.equal(spurious.status, STATUS.PASS)
})

test('the main face is the most confident one, not the biggest box', () => {
  const r = ev([face({ cx: 0.5, h: 0.35, score: 0.93 }), face({ cx: 0.5, h: 0.8, score: 0.35 })])
  assert.equal(r.details.score, 0.93)
  assert.equal(r.status, STATUS.PASS)
})

test('low-confidence detections do not produce pose/quality verdicts from garbage keypoints', () => {
  const f = face({ score: 0.35, yaw: 3 })
  const r = ev([f])
  assert.equal(r.details.yaw, null)
  assert.equal(r.details.crop, null)
  assert.match(r.hint, /No clear face/)
})

test('a blurred face fails even though the rest of the photo is sharp', () => {
  const f = face({ cx: 0.5, cy: 0.5, h: 0.5 })
  const blurred = boxBlur(scene, W, H, 12)
  const mixed = scene.map((v, i) => {
    const x = (i % W) / W
    const y = Math.floor(i / W) / H
    // cover the face box AND the margin the sharpness measurement samples
    const mx = 0.25 * f.box.w
    const my = 0.25 * f.box.h
    const inFace = x > f.box.x - mx && x < f.box.x + f.box.w + mx && y > f.box.y - my && y < f.box.y + f.box.h + my
    return inFace ? blurred[i] : v
  })
  const r = ev([f], frame(mixed))
  assert.equal(r.status, STATUS.FAIL, JSON.stringify(r.details.crop))
  assert.match(r.hint, /blurry/)
})

test('a face in shadow fails; eyes hidden by sunglasses warn', () => {
  const f = face({ cx: 0.5, cy: 0.5, h: 0.5 })
  const inBox = (i) => {
    const x = (i % W) / W
    const y = Math.floor(i / W) / H
    return x > f.box.x - 0.03 && x < f.box.x + f.box.w + 0.03 && y > f.box.y - 0.03 && y < f.box.y + f.box.h + 0.03
  }
  const shadow = scene.map((v, i) => (inBox(i) ? v * 0.12 : v))
  const s = ev([f], frame(shadow))
  assert.equal(s.status, STATUS.FAIL)
  assert.match(s.hint, /shadow/)

  const bright = scene.map((v, i) => (inBox(i) ? 170 + (v % 20) : v)) // evenly lit face
  const glasses = Float32Array.from(bright)
  const rr = Math.round(0.35 * Math.hypot((f.keypoints[1].x - f.keypoints[0].x) * W, (f.keypoints[1].y - f.keypoints[0].y) * H))
  for (const k of [f.keypoints[0], f.keypoints[1]]) {
    for (let y = Math.round(k.y * H) - rr; y <= Math.round(k.y * H) + rr; y++)
      for (let x = Math.round(k.x * W) - rr; x <= Math.round(k.x * W) + rr; x++) glasses[y * W + x] = 15
  }
  assert.equal(ev([f], frame(bright)).status, STATUS.PASS)
  const g = ev([f], frame(glasses))
  assert.equal(g.status, STATUS.WARN)
  assert.match(g.hint, /eyes/)
})

// ---- orchestration --------------------------------------------------------
const detector = (faces) => ({ detect: async () => faces })

test('checkFace: skipped when the task does not need a face', async () => {
  const r = await checkFace(frame(), { task: taskConfig('task_demo_1'), detector: detector([]) })
  assert.equal(r.status, STATUS.SKIP)
})

test('checkFace: a missing or failing detector is a non-blocking warning, never a block', async () => {
  const noDet = await checkFace(frame(), { task: { face: 'required' } })
  assert.equal(noDet.status, STATUS.WARN)
  assert.equal(noDet.details.unchecked, true)
  const broken = await checkFace(frame(), { task: { face: 'required' }, detector: { detect: async () => { throw new Error('wasm unsupported') } } })
  assert.equal(broken.status, STATUS.WARN)
  assert.match(broken.details.reason, /wasm unsupported/)
})

test('pipeline: required face missing blocks; optional face missing only flags; off ignores it', async () => {
  const none = detector([])
  const req = await analyzeFrameAsync(frame(), { task: taskConfig('task_selfie_checkin'), detector: none })
  assert.equal(req.checks.face.status, STATUS.FAIL)
  assert.equal(req.verdict, VERDICT.BLOCK)
  assert.ok(req.issues.find((i) => i.id === 'face').blocking)

  const opt = await analyzeFrameAsync(frame(), { task: taskConfig('task_worker_at_site'), detector: none })
  assert.equal(opt.checks.face.status, STATUS.FAIL)
  assert.notEqual(opt.verdict, VERDICT.BLOCK)

  const off = await analyzeFrameAsync(frame(), { task: taskConfig('task_demo_1'), detector: none })
  assert.equal(off.checks.face, undefined)
})

test('pipeline: a good face on a good photo passes', async () => {
  const full = frameFromGray(scene, W, H, { native: { width: 2000, height: 1333 } }) // a real-sized photo
  const r = await analyzeFrameAsync(full, { task: taskConfig('task_selfie_checkin'), detector: detector([face()]) })
  assert.equal(r.checks.face.status, STATUS.PASS)
  assert.equal(r.verdict, VERDICT.PASS, JSON.stringify(r.issues))
})

test('task config: unknown tasks default to no face and the rear camera', () => {
  assert.deepEqual(taskConfig('nope'), { face: 'off', camera: 'environment' })
  assert.equal(taskConfig('task_selfie_checkin').camera, 'user')
})
