import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MESH_EDGES, MESH_EDGE_INDEX, MESH_INDICES, MESH_NAMES, MESH_POINTS, lerpPoints, projectPoints, selectMeshPoints } from './face/meshGraph.js'

test('mesh: a sparse set of points (like the reference), every index a real landmark and unique', () => {
  assert.ok(MESH_NAMES.length >= 24 && MESH_NAMES.length <= 34, `${MESH_NAMES.length} points`)
  assert.equal(new Set(MESH_INDICES).size, MESH_INDICES.length)
  for (const i of MESH_INDICES) assert.ok(Number.isInteger(i) && i >= 0 && i < 468, `landmark ${i}`)
})

test('mesh: edges only join defined points, never a point to itself, no duplicates, every point is connected', () => {
  const seen = new Set()
  const used = new Set()
  for (const [a, b] of MESH_EDGES) {
    assert.ok(a in MESH_POINTS && b in MESH_POINTS, `${a}-${b}`)
    assert.notEqual(a, b)
    const k = [a, b].sort().join('|')
    assert.ok(!seen.has(k), `duplicate edge ${k}`)
    seen.add(k)
    used.add(a); used.add(b)
  }
  for (const n of MESH_NAMES) assert.ok(used.has(n), `${n} has no line`)
  assert.equal(MESH_EDGE_INDEX.length, MESH_EDGES.length)
  assert.ok(MESH_EDGES.length >= 40)
})

test('mesh: left and right are symmetric (every r* point has an l* twin and every r* edge a mirrored l* edge)', () => {
  for (const n of MESH_NAMES) if (n.startsWith('r') && /^r[A-Z]/.test(n)) assert.ok(`l${n.slice(1)}` in MESH_POINTS, n)
  const flip = (n) => (/^r[A-Z]/.test(n) ? 'l' + n.slice(1) : /^l[A-Z]/.test(n) ? 'r' + n.slice(1) : n)
  const keys = new Set(MESH_EDGES.map(([a, b]) => [a, b].sort().join('|')))
  for (const [a, b] of MESH_EDGES) assert.ok(keys.has([flip(a), flip(b)].sort().join('|')), `${a}-${b} has no mirror image`)
})

test('selectMeshPoints picks the curated landmarks in order, and rejects a short/empty result', () => {
  const lm = Array.from({ length: 478 }, (_, i) => ({ x: i / 1000, y: i / 2000 }))
  const pts = selectMeshPoints(lm)
  assert.equal(pts.length, MESH_NAMES.length)
  assert.deepEqual(pts[MESH_NAMES.indexOf('chin')], { x: 0.152, y: 0.076 })
  assert.equal(selectMeshPoints(null), null)
  assert.equal(selectMeshPoints(lm.slice(0, 100)), null)
})

test('projection to pixels, mirrored for the front camera', () => {
  const p = [{ x: 0.25, y: 0.5 }]
  assert.deepEqual(projectPoints(p, 400, 200), [[100, 100]])
  assert.deepEqual(projectPoints(p, 400, 200, true), [[300, 100]])
})

test('lerp glides towards the target, starts at it, and a lost face (null) stays null', () => {
  const t = [{ x: 1, y: 1 }]
  assert.deepEqual(lerpPoints(null, t, 0.3), [{ x: 1, y: 1 }]) // no hop-in from the corner
  const step = lerpPoints([{ x: 0, y: 0 }], t, 0.25)
  assert.deepEqual(step, [{ x: 0.25, y: 0.25 }])
  let c = [{ x: 0, y: 0 }]
  for (let i = 0; i < 40; i++) c = lerpPoints(c, t, 0.35)
  assert.ok(c[0].x > 0.999)
  assert.equal(lerpPoints(c, null, 0.3), null)
  assert.notEqual(lerpPoints(null, t, 0.3)[0], t[0]) // a copy, not the target object
})

// ---- painting, on a real canvas ---------------------------------------------------------------
import { createCanvas } from '@napi-rs/canvas'
import { paintMesh } from './face/meshDraw.js'

const fakeFace = () => MESH_NAMES.map((_, i) => ({ x: 0.2 + 0.6 * ((i * 7) % 11) / 11, y: 0.1 + 0.8 * ((i * 5) % 13) / 13 }))
function paintOn(alpha) {
  const c = createCanvas(400, 400)
  const ctx = c.getContext('2d')
  paintMesh(ctx, projectPoints(fakeFace(), 400, 400), { alpha, t: 0 })
  const d = ctx.getImageData(0, 0, 400, 400).data
  let blue = 0
  let white = 0
  let any = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 40) any++
    if (d[i + 2] > 200 && d[i] < 90 && d[i + 1] < 140 && d[i + 3] > 200) blue++
    if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235 && d[i + 3] > 200) white++
  }
  return { blue, white, any }
}

test('paintMesh draws blue dots with white rings and white lines; fully transparent draws nothing', () => {
  const on = paintOn(1)
  assert.ok(on.blue > MESH_NAMES.length * 30, `blue pixels ${on.blue}`)
  assert.ok(on.white > 200, `white pixels ${on.white}`)
  const off = paintOn(0)
  assert.equal(off.any, 0)
  const faint = paintOn(0.3)
  assert.ok(faint.any > 0 && faint.blue < on.blue)
})
