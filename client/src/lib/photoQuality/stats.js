// Small numeric helpers shared by the checks. All take row-major Float32Array
// grayscale images unless noted.

// Large inputs are strided down to ~60k samples first: a percentile of a
// million pixels doesn't need a million-element sort.
const MAX_SAMPLES = 60000
export function percentile(values, p) {
  if (!values.length) return 0
  let src = values
  if (values.length > MAX_SAMPLES) {
    const stride = Math.ceil(values.length / MAX_SAMPLES)
    src = new Float32Array(Math.ceil(values.length / stride))
    for (let i = 0, j = 0; i < values.length; i += stride) src[j++] = values[i]
  }
  const s = Float32Array.from(src).sort()
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]
}

// 3x3 box mean with edge clamping.
export function box3(g, w, h) {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1) * w
    const y0 = y * w
    const yp = Math.min(h - 1, y + 1) * w
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1)
      const xp = Math.min(w - 1, x + 1)
      out[y0 + x] =
        (g[ym + xm] + g[ym + x] + g[ym + xp] + g[y0 + xm] + g[y0 + x] + g[y0 + xp] + g[yp + xm] + g[yp + x] + g[yp + xp]) / 9
    }
  }
  return out
}

// Sobel gradient magnitude, normalised so a unit step edge reads ~1 per level.
// Border pixels are 0.
export function sobel(g, w, h) {
  const m = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - (g[i - w - 1] + 2 * g[i - 1] + g[i + w - 1])
      const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1])
      m[i] = Math.hypot(gx, gy) / 4
    }
  }
  return m
}

// Robust noise sigma (Immerkaer's mask, but with the median of the absolute
// response instead of the mean so edges and texture barely bias it).
// White noise of std s gives a response of std 6s.
export function noiseSigma(g, w, h, step = 1) {
  const r = []
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const i = y * w + x
      const v =
        g[i - w - 1] - 2 * g[i - w] + g[i - w + 1] - 2 * g[i - 1] + 4 * g[i] - 2 * g[i + 1] + g[i + w - 1] - 2 * g[i + w] + g[i + w + 1]
      r.push(Math.abs(v))
    }
  }
  if (!r.length) return 0
  return percentile(r, 0.5) / 0.6745 / 6
}

// Iterate a gx x gy grid of tiles, calling fn(tile) with pixel bounds.
export function tiles(w, h, gx, gy) {
  const out = []
  for (let ty = 0; ty < gy; ty++) {
    for (let tx = 0; tx < gx; tx++) {
      out.push({
        tx,
        ty,
        x0: Math.floor((tx * w) / gx),
        x1: Math.floor(((tx + 1) * w) / gx),
        y0: Math.floor((ty * h) / gy),
        y1: Math.floor(((ty + 1) * h) / gy),
      })
    }
  }
  return out
}

export function tileValues(arr, w, t) {
  const out = []
  for (let y = t.y0; y < t.y1; y++) for (let x = t.x0; x < t.x1; x++) out.push(arr[y * w + x])
  return out
}

// Connected components (4-neighbour) over a boolean tile grid.
export function components(mask, gx, gy) {
  const seen = new Uint8Array(mask.length)
  const out = []
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue
    const stack = [i]
    seen[i] = 1
    const cells = []
    while (stack.length) {
      const c = stack.pop()
      cells.push(c)
      const x = c % gx
      const y = (c / gx) | 0
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= gx || ny >= gy) continue
        const j = ny * gx + nx
        if (mask[j] && !seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    out.push(cells)
  }
  return out
}

