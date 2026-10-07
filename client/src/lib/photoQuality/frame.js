// A "frame" is everything the checks need, built once per photo. All checks
// are pure functions of a frame so they run unchanged in Node, a Worker or
// the main thread.
//
//   {
//     width, height,         analysis size (longest side <= ANALYSIS_MAX, 1280)
//     rgba: Uint8ClampedArray, gray: Float32Array (luma 0..255)
//     native: { width, height, bytes, mime, patches: [{ gray, width, height }] }
//     meta: { sensor, task }  optional context supplied by the caller
//   }

export const ANALYSIS_MAX = 1280
export const PATCH_SIZE = 384

export function rgbaToGray(rgba, n = rgba.length / 4) {
  const gray = new Float32Array(n)
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    gray[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  }
  return gray
}

// Area-average downscale of a grayscale image so its longest side is `maxSide`.
export function resizeGray(gray, width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  if (scale === 1) return { gray, width, height }
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w))
      let s = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += gray[yy * width + xx]
      out[y * w + x] = s / ((y1 - y0) * (x1 - x0))
    }
  }
  return { gray: out, width: w, height: h }
}

export function analysisSize(width, height, max = ANALYSIS_MAX) {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// Positions (x, y) of native-resolution patches: centre, upper-left third,
// lower-right third. Aligned to the 8px JPEG grid so blockiness can be measured.
export function patchOrigins(width, height, size = PATCH_SIZE) {
  const pw = Math.min(size, width)
  const ph = Math.min(size, height)
  const snap = (v) => Math.max(0, Math.floor(v / 8) * 8)
  const clampX = (v) => Math.min(snap(v), Math.max(0, width - pw))
  const clampY = (v) => Math.min(snap(v), Math.max(0, height - ph))
  const spots = [
    [(width - pw) / 2, (height - ph) / 2],
    [width / 3 - pw / 2, height / 3 - ph / 2],
    [(2 * width) / 3 - pw / 2, (2 * height) / 3 - ph / 2],
  ]
  const seen = new Set()
  const out = []
  for (const [x, y] of spots) {
    const ox = clampX(x)
    const oy = clampY(y)
    const k = `${ox},${oy}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ x: ox, y: oy, width: pw, height: ph })
  }
  return out
}

// Build a frame from already-decoded pixels. `patches` are native-resolution
// RGBA crops: [{ rgba, width, height }]; when omitted the analysis frame is
// reused as the only patch (fine for tests and for images <= ANALYSIS_MAX).
export function buildFrame({ rgba, width, height, native = {}, patches, meta = {} }) {
  const gray = rgbaToGray(rgba, width * height)
  const nativePatches = patches?.length
    ? patches.map((p) => ({ gray: rgbaToGray(p.rgba, p.width * p.height), width: p.width, height: p.height }))
    : [{ gray, width, height }]
  return {
    width,
    height,
    rgba,
    gray,
    native: {
      width: native.width ?? width,
      height: native.height ?? height,
      bytes: native.bytes ?? null,
      mime: native.mime ?? null,
      patches: nativePatches,
    },
    meta,
  }
}
