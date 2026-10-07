// A Node stand-in for the browser decode environment, backed by @napi-rs/canvas,
// so the real decode -> frame path is tested end to end.
import { createCanvas, loadImage } from '@napi-rs/canvas'

export const nodeEnv = {
  async createImageBitmap(src) {
    const img = await loadImage(src.bytes)
    return Object.assign(img, { close() {} })
  },
  createCanvas: (w, h) => createCanvas(w, h),
}

// Wrap encoded bytes the way a File looks to decodeToFrame.
export const asFile = (bytes, type) => ({ bytes, size: bytes.length, type })

// Encode RGBA pixels as PNG or JPEG bytes.
export function encodeImage(rgba, w, h, { type = 'jpeg', quality = 90 } = {}) {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(w, h)
  img.data.set(rgba)
  ctx.putImageData(img, 0, 0)
  return type === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', quality)
}
