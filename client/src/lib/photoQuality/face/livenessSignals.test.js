import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blendshapeMap, noseRatio, toSample, yawFromMatrix } from './livenessSignals.js'

// Ry(theta) as a 4x4, serialised row-major and column-major
const ry = (deg) => {
  const t = (deg * Math.PI) / 180
  const R = [[Math.cos(t), 0, Math.sin(t), 0], [0, 1, 0, 0], [-Math.sin(t), 0, Math.cos(t), 0], [0, 0, 0, 1]]
  return { row: R.flat(), col: R[0].map((_, j) => R.map((r) => r[j])).flat() }
}

test('yaw from the transformation matrix: sign and magnitude (positive = user\'s left)', () => {
  // the browser's layout (column-major) is the default
  for (const d of [-46, -20, 0, 8, 25, 46]) assert.ok(Math.abs(yawFromMatrix(ry(d).col) - d) < 1e-6, String(d))
  assert.ok(Math.abs(yawFromMatrix(ry(30).row, true) - 30) < 1e-6)
  // reading a column-major matrix as row-major flips the sign: the bug the real-photo check caught
  assert.ok(yawFromMatrix(ry(30).col, true) < 0)
  assert.equal(yawFromMatrix(null), null)
  assert.equal(yawFromMatrix([1, 2, 3]), null)
})

test('blendshapes are folded into the sample the state machine reads', () => {
  const b = blendshapeMap([
    { categoryName: 'eyeBlinkLeft', score: 0.8 }, { categoryName: 'eyeBlinkRight', score: 0.6 },
    { categoryName: 'mouthSmileLeft', score: 0.4 }, { categoryName: 'mouthSmileRight', score: 0.2 }, { categoryName: 'jawOpen', score: 0.5 },
  ])
  const s = toSample(1234, { points: [{ x: 0, y: 0 }], blendshapes: b, matrix: ry(-12).col })
  assert.equal(s.t, 1234)
  assert.equal(s.face, true)
  assert.ok(Math.abs(s.blink - 0.7) < 1e-9 && Math.abs(s.smile - 0.3) < 1e-9 && s.jaw === 0.5)
  assert.ok(Math.abs(s.yaw + 12) < 1e-6)
})

test('no face -> face:false and zero signals', () => {
  const s = toSample(5, { points: null })
  assert.deepEqual([s.face, s.blink, s.smile, s.jaw, s.yaw], [false, 0, 0, 0, 0])
})

test('nose ratio: towards the image-right is positive', () => {
  const pts = []
  pts[1] = { x: 0.6, y: 0.5 }
  pts[234] = { x: 0.3, y: 0.5 }
  pts[454] = { x: 0.7, y: 0.5 }
  assert.ok(Math.abs(noseRatio(pts) - 0.5) < 1e-9)
  pts[1] = { x: 0.4, y: 0.5 }
  assert.ok(noseRatio(pts) < 0)
  assert.equal(noseRatio([]), null)
})
