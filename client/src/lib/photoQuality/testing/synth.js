// Synthetic image generators for tests and the calibration tool. Grayscale
// helpers work on Float32Array (0..255); RGBA helpers on Uint8ClampedArray.
import { buildFrame } from '../frame.js'

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeGray(w, h, fn) {
  const g = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = fn(x, y)
  return g
}

export const clip255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

export function checkerboard(w, h, cell = 10) {
  return makeGray(w, h, (x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) * 255)
}

// A cluttered "scene": smooth lighting gradient, random rectangles/discs with
// hard edges at mixed contrast, and a little fine texture. Much closer to a real
// shelf/storefront photo than a checkerboard.
export function sceneGray(w, h, seed = 1) {
  const r = mulberry32(seed)
  const g = makeGray(w, h, (x, y) => 110 + 40 * (x / w) + 20 * (y / h))
  const shapes = 40 + Math.floor(r() * 20)
  for (let s = 0; s < shapes; s++) {
    const level = 30 + r() * 200
    const disc = r() < 0.35
    const cx = r() * w
    const cy = r() * h
    const sw = (0.04 + r() * 0.2) * w
    const sh = (0.04 + r() * 0.2) * h
    const x0 = Math.max(0, Math.floor(cx - sw / 2))
    const x1 = Math.min(w, Math.ceil(cx + sw / 2))
    const y0 = Math.max(0, Math.floor(cy - sh / 2))
    const y1 = Math.min(h, Math.ceil(cy + sh / 2))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (disc) {
          const dx = (x - cx) / (sw / 2)
          const dy = (y - cy) / (sh / 2)
          if (dx * dx + dy * dy > 1) continue
        }
        g[y * w + x] = level + 12 * Math.sin(x * 0.9) * Math.cos(y * 0.7)
      }
    }
  }
  return g
}

// Separable box blur via running sums; `passes` ~ 3 approximates a Gaussian.
export function boxBlur(src, w, h, radius, passes = 3) {
  if (radius <= 0) return Float32Array.from(src)
  let a = Float32Array.from(src)
  const tmp = new Float32Array(w * h)
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let s = 0
      let n = 0
      const row = y * w
      for (let x = 0; x <= Math.min(radius, w - 1); x++) { s += a[row + x]; n++ }
      for (let x = 0; x < w; x++) {
        tmp[row + x] = s / n
        const add = x + radius + 1
        const rem = x - radius
        if (add < w) { s += a[row + add]; n++ }
        if (rem >= 0) { s -= a[row + rem]; n-- }
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0
      let n = 0
      for (let y = 0; y <= Math.min(radius, h - 1); y++) { s += tmp[y * w + x]; n++ }
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / n
        const add = y + radius + 1
        const rem = y - radius
        if (add < h) { s += tmp[add * w + x]; n++ }
        if (rem >= 0) { s -= tmp[rem * w + x]; n-- }
      }
    }
  }
  return a
}

// Linear motion blur: average `len` samples along `angle` (radians).
export function motionBlur(src, w, h, len, angle = 0) {
  const out = new Float32Array(w * h)
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let k = 0; k < len; k++) {
        const t = k - (len - 1) / 2
        const xx = Math.min(w - 1, Math.max(0, Math.round(x + dx * t)))
        const yy = Math.min(h - 1, Math.max(0, Math.round(y + dy * t)))
        s += src[yy * w + xx]
      }
      out[y * w + x] = s / len
    }
  }
  return out
}

function gauss(r) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
}

export function addNoise(src, sigma, seed = 3) {
  const r = mulberry32(seed)
  return src.map((v) => clip255(v + sigma * gauss(r)))
}

export const adjust = (src, gain = 1, bias = 0) => src.map((v) => clip255(v * gain + bias))

export function resizeNearest(src, w, h, nw, nh) {
  return makeGray(nw, nh, (x, y) => src[Math.min(h - 1, Math.floor((y * h) / nh)) * w + Math.min(w - 1, Math.floor((x * w) / nw))])
}

export function toRgba(gray) {
  const out = new Uint8ClampedArray(gray.length * 4)
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]
    out[i * 4] = v
    out[i * 4 + 1] = v
    out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }
  return out
}

// Paint a soft disc (radial falloff) onto RGBA. `color` = [r,g,b]; alpha 0..1.
export function paintDisc(rgba, w, h, cx, cy, radius, color, { alpha = 1, soft = 0.4 } = {}) {
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(w - 1, Math.ceil(cx + radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(h - 1, Math.ceil(cy + radius))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / radius
      if (d > 1) continue
      const a = alpha * (d < 1 - soft ? 1 : (1 - d) / soft)
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) rgba[i + c] = rgba[i + c] * (1 - a) + color[c] * a
    }
  }
  return rgba
}

export function paintRect(rgba, w, h, x0, y0, x1, y1, color, alpha = 1) {
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) rgba[i + c] = rgba[i + c] * (1 - alpha) + color[c] * alpha
    }
  }
  return rgba
}

// Build a frame straight from a gray image (or from RGBA when given).
export function frameFromGray(gray, w, h, { rgba, native, meta } = {}) {
  return buildFrame({ rgba: rgba ?? toRgba(gray), width: w, height: h, native, meta })
}

// Apply a grayscale-image transform to each colour channel of an RGBA image.
export function mapChannels(rgba, w, h, fn) {
  const out = new Uint8ClampedArray(rgba.length)
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) ch[i] = rgba[i * 4 + c]
    const r = fn(ch, c)
    for (let i = 0; i < w * h; i++) out[i * 4 + c] = r[i]
  }
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = 255
  return out
}
