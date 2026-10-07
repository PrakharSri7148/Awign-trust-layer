// Run with: npm test  (pure-function test, no browser/canvas needed)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { laplacianVariance, SHARPNESS_THRESHOLD } from './edgeValidator.js'

const W = 300
const H = 200

function checkerboard(cell = 10) {
  const g = new Float32Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      g[y * W + x] = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) * 255
  return g
}

function boxBlur(src, radius, passes = 3) {
  let a = src
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0
        let n = 0
        for (let dy = -radius; dy <= radius; dy++)
          for (let dx = -radius; dx <= radius; dx++) {
            const yy = y + dy
            const xx = x + dx
            if (yy >= 0 && yy < H && xx >= 0 && xx < W) {
              s += a[yy * W + xx]
              n++
            }
          }
        b[y * W + x] = s / n
      }
    a = b
  }
  return a
}

test('sharp image passes the threshold', () => {
  assert.ok(laplacianVariance(checkerboard(), W, H) > SHARPNESS_THRESHOLD)
})

test('heavily blurred image fails the threshold', () => {
  assert.ok(laplacianVariance(boxBlur(checkerboard(), 4), W, H) <= SHARPNESS_THRESHOLD)
})

test('flat image scores zero', () => {
  assert.equal(laplacianVariance(new Float32Array(W * H).fill(128), W, H), 0)
})
