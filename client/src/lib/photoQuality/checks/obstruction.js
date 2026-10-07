import { THRESHOLDS } from '../config.js'
import { STATUS, checkResult } from '../schema.js'
import { box3, components, tileValues, tiles } from '../stats.js'

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: max === 0 ? 0 : d / max, v: max / 255 }
}

// Skin / out-of-focus finger over the lens: warm hue, moderate saturation.
// A finger in front of a flash glows red (hue < 20, high saturation).
function looksLikeFinger({ h, s, v }) {
  const warm = h <= 50 || h >= 345
  return warm && s >= 0.15 && s <= (h < 20 ? 0.95 : 0.75) && v >= 0.2 && v <= 0.97
}

// Lens covered by a finger, cloth or dirt: a flat (texture-less) area that is
// dark or finger-coloured and sticks to the frame edge, while the rest of the
// frame still has detail. Sky or a plain wall is flat too, but bright/neutral,
// so it is not matched.
export function obstructionMetrics(frame) {
  const t = THRESHOLDS.obstruction
  const { width: w, height: h, rgba } = frame
  const sm = box3(frame.gray, w, h)
  const grid = t.grid
  const cells = tiles(w, h, grid, grid)
  const flat = new Uint8Array(cells.length)
  const cover = new Uint8Array(cells.length)
  const info = []
  const stds = []
  let textured = 0

  // Pass 1: per-tile stats.
  cells.forEach((tile) => {
    const px = tileValues(sm, w, tile)
    let mean = 0
    for (const v of px) mean += v
    mean /= px.length
    let varSum = 0
    for (const v of px) varSum += (v - mean) * (v - mean)
    const std = Math.sqrt(varSum / px.length)
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = tile.y0; y < tile.y1; y += 2) {
      for (let x = tile.x0; x < tile.x1; x += 2) {
        const k = (y * w + x) * 4
        r += rgba[k]
        g += rgba[k + 1]
        b += rgba[k + 2]
        n++
      }
    }
    stds.push(std)
    info.push({ std, mean, hsv: rgbToHsv(r / n, g / n, b / n) })
  })

  // Pass 2: a tile is "flat" if it has almost no texture compared with the rest
  // of this photo. Judging against the photo's own median keeps a uniformly dim
  // or low-contrast shot from looking covered.
  const medianStd = [...stds].sort((a, b) => a - b)[Math.floor(stds.length / 2)]
  const frameMean = info.reduce((a, tile) => a + tile.mean, 0) / info.length
  // Dark relative to the photo: a uniformly dim shot is an exposure problem
  // (reported by the exposure check), not a covered lens.
  const darkLimit = Math.min(t.darkTileMean, 0.6 * frameMean)
  const flatLimit = Math.min(t.flatTileStd, t.flatRelative * medianStd)
  let fullFlat = 0
  info.forEach((tile, i) => {
    tile.flat = tile.std < Math.max(flatLimit, 0) || tile.std < t.coverFlatStd
    tile.dark = tile.mean < darkLimit
    tile.finger = looksLikeFinger(tile.hsv)
    flat[i] = tile.flat ? 1 : 0
    cover[i] = tile.flat && (tile.dark || tile.finger) ? 1 : 0
    if (!tile.flat) textured++
    if (tile.std < t.coverFlatStd) fullFlat++
  })

  let best = { area: 0, touchesEdge: false, cells: [] }
  for (const comp of components(cover, grid, grid)) {
    const touchesEdge = comp.some((c) => {
      const x = c % grid
      const y = (c / grid) | 0
      return x === 0 || y === 0 || x === grid - 1 || y === grid - 1
    })
    const area = comp.length / cells.length
    if (touchesEdge && area > best.area) best = { area, touchesEdge, cells: comp }
  }
  const coverTotal = cover.reduce((a, b) => a + b, 0) / cells.length
  const texturedFrac = textured / cells.length
  const bbox = best.cells.length
    ? {
        x0: Math.min(...best.cells.map((c) => c % grid)) / grid,
        x1: (Math.max(...best.cells.map((c) => c % grid)) + 1) / grid,
        y0: Math.min(...best.cells.map((c) => (c / grid) | 0)) / grid,
        y1: (Math.max(...best.cells.map((c) => (c / grid) | 0)) + 1) / grid,
      }
    : null
  const finger = best.cells.length ? best.cells.filter((c) => info[c].finger).length / best.cells.length > 0.5 : false
  const fullFlatFrac = fullFlat / cells.length
  // Every tile is texture-less in absolute terms and the frame is dark or
  // finger-coloured: the whole lens is covered (judged without the relative-dark
  // rule above, which would excuse an all-black frame).
  const fingerFrac = info.filter((tile) => tile.finger).length / info.length
  const fullCover = fullFlatFrac >= t.fullCoverArea && (frameMean < t.darkTileMean || fingerFrac >= 0.5)
  return { area: best.area, coverTotal, texturedFrac, bbox, finger, medianStd, fullFlatFrac, fullCover, frameMean }
}

export function checkObstruction(frame) {
  const t = THRESHOLDS.obstruction
  const m = obstructionMetrics(frame)
  let status = STATUS.PASS
  let hint = null
  const full = m.fullCover
  if (full || m.area >= t.failArea) {
    status = STATUS.FAIL
    hint = full
      ? 'The photo is almost completely dark: uncover the lens or move to better light, then retake.'
      : `The lens looks partly covered${m.finger ? ' (finger?)' : ''}. Move your hand or clean the lens and retake.`
  } else if (m.area >= t.warnArea) {
    status = STATUS.WARN
    hint = `Something may be covering part of the lens${m.finger ? ' (finger?)' : ''}. Check and retake.`
  }
  return checkResult('obstruction', {
    status,
    score: full ? 0 : Math.max(0, 1 - Math.max(m.area, m.coverTotal * 0.8) / t.failArea),
    value: m.area,
    hint,
    details: m,
  })
}
