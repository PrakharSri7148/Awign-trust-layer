import { THRESHOLDS } from '../config.js'
import { STATUS, checkResult, ramp } from '../schema.js'
import { components } from '../stats.js'

const REGIONS = [
  ['top-left', 'top', 'top-right'],
  ['left', 'centre', 'right'],
  ['bottom-left', 'bottom', 'bottom-right'],
]
const regionName = (cx, cy) => REGIONS[Math.min(2, Math.floor(cy * 3))][Math.min(2, Math.floor(cx * 3))]

// Glare = a blown-out (near-white, texture-less) region with a soft halo around
// it, because light falls off smoothly (over several cells) from a reflection or
// bright source. A
// white sticker or poster is just as bright but has a hard edge, so it isn't
// glare. Work is done on an 8px cell grid.
export function glareMetrics(frame, cfg = THRESHOLDS.glare) {
  const { width: w, height: h, rgba, gray } = frame
  const cell = cfg.cell
  const gx = Math.floor(w / cell)
  const gy = Math.floor(h / cell)
  const n = gx * gy
  const blown = new Uint8Array(n)
  const cellMean = new Float32Array(n)
  const px = cell * cell

  for (let cy = 0; cy < gy; cy++) {
    for (let cx = 0; cx < gx; cx++) {
      let sat = 0
      let sum = 0
      let sumSq = 0
      for (let y = cy * cell; y < (cy + 1) * cell; y++) {
        for (let x = cx * cell; x < (cx + 1) * cell; x++) {
          const i = y * w + x
          const k = i * 4
          const r = rgba[k]
          const g = rgba[k + 1]
          const b = rgba[k + 2]
          const mx = r > g ? (r > b ? r : b) : g > b ? g : b
          const mn = r < g ? (r < b ? r : b) : g < b ? g : b
          if (mx >= cfg.vMin && (mx - mn) / mx <= cfg.satMax) sat++
          const v = gray[i]
          sum += v
          sumSq += v * v
        }
      }
      const mean = sum / px
      const idx = cy * gx + cx
      cellMean[idx] = mean
      blown[idx] = sat / px >= cfg.cellSatFrac && sumSq / px - mean * mean <= cfg.cellFlatVar ? 1 : 0
    }
  }

  const comps = components(blown, gx, gy)
  const totalBlown = comps.reduce((a, c) => a + c.length, 0) / n
  let best = null
  for (const c of comps) if (!best || c.length > best.length) best = c
  if (!best) return { area: 0, totalBlown: 0, halo: 0, soft: false, bbox: null, region: null }

  // Rings of cells at distance 2 and 5 from the biggest blob. Ring 1 is skipped on
  // purpose: any edge, hard or soft, leaves partly-bright cells right next to the
  // blob (and resampling differs between engines), so it says nothing about halo.
  const dist = new Int8Array(n).fill(-1)
  let frontier = best.slice()
  for (const c of best) dist[c] = 0
  for (let d = 1; d <= 5; d++) {
    const next = []
    for (const c of frontier) {
      const x = c % gx
      const y = (c / gx) | 0
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= gx || ny >= gy) continue
        const j = ny * gx + nx
        if (dist[j] === -1 && !blown[j]) {
          dist[j] = d
          next.push(j)
        }
      }
    }
    frontier = next
  }
  const ringMean = (d) => {
    let s = 0
    let m = 0
    for (let i = 0; i < n; i++) if (dist[i] === d) { s += cellMean[i]; m++ }
    return m ? s / m : null
  }
  // A halo falls off steadily outward: ring 2 > 3 > 4 > 5. A coincidentally
  // brighter neighbourhood in a busy scene doesn't do that, so require both a
  // total drop and a monotone one.
  const means = [2, 3, 4, 5].map(ringMean)
  const complete = means.every((v) => v != null)
  const halo = complete ? means[0] - means[3] : 0
  const monotone = complete && means.every((v, i) => i === 0 || means[i - 1] - v >= -1)
  // ...and it surrounds the blob: most ring-2 cells are brighter than the far ring,
  // not just one side of the neighbourhood.
  let ring2 = 0
  let ring2Bright = 0
  if (complete) {
    for (let i = 0; i < n; i++) {
      if (dist[i] !== 2) continue
      ring2++
      if (cellMean[i] > means[3] + cfg.haloMin / 2) ring2Bright++
    }
  }
  const surround = ring2 ? ring2Bright / ring2 : 0

  let x0 = gx
  let x1 = 0
  let y0 = gy
  let y1 = 0
  for (const c of best) {
    const x = c % gx
    const y = (c / gx) | 0
    x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1)
  }
  const bbox = { x0: x0 / gx, x1: x1 / gx, y0: y0 / gy, y1: y1 / gy }
  return {
    area: best.length / n,
    totalBlown,
    halo,
    monotone,
    surround,
    soft: monotone && surround >= cfg.haloSurround && halo >= cfg.haloMin,
    bbox,
    region: regionName((bbox.x0 + bbox.x1) / 2, (bbox.y0 + bbox.y1) / 2),
  }
}

export function glareStatus(m, t = THRESHOLDS.glare) {
  let status = STATUS.PASS
  let hint = null
  if (m.soft && m.area >= t.failArea) {
    status = STATUS.FAIL
    hint = `Strong glare on the ${m.region} of the photo. Change your angle or block the light source.`
  } else if (m.soft && m.area >= t.warnArea) {
    status = STATUS.WARN
    hint = `Glare on the ${m.region} of the photo. Change your angle to avoid the reflection.`
  } else if (!m.soft && m.area >= t.hardWarnArea) {
    status = STATUS.WARN
    hint = `A large part of the photo is blown out to white (${m.region}). Check the lighting.`
  }
  return { status, hint }
}

export function checkGlare(frame) {
  const t = THRESHOLDS.glare
  const m = glareMetrics(frame)
  const { status, hint } = glareStatus(m, t)
  return checkResult('glare', {
    status,
    score: ramp(m.soft ? m.area : m.area * 0.4, t.failArea * 1.5, 0),
    value: m.area,
    hint,
    details: m,
  })
}
