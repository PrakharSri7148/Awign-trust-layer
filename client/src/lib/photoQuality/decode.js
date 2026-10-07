// Browser/Node decode step: file -> frame. The environment is injected so the
// same code is exercised in tests (@napi-rs/canvas) and in the browser.
import { analysisSize, buildFrame, patchOrigins } from './frame.js'

export const browserEnv = {
  createImageBitmap: (blob, opts) => createImageBitmap(blob, opts),
  createCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    return c
  },
}

function readPixels(env, bitmap, sx, sy, sw, sh, dw, dh) {
  const canvas = env.createCanvas(dw, dh)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh)
  return ctx.getImageData(0, 0, dw, dh).data
}

// `source` is a Blob/File (or anything the injected createImageBitmap accepts).
export async function decodeToFrame(source, { env = browserEnv, meta = {} } = {}) {
  let bitmap
  try {
    bitmap = await env.createImageBitmap(source)
  } catch {
    throw new Error('Could not decode image')
  }
  try {
    const { width: nw, height: nh } = bitmap
    const { width, height } = analysisSize(nw, nh)
    const rgba = readPixels(env, bitmap, 0, 0, nw, nh, width, height)
    const patches = patchOrigins(nw, nh).map((o) => ({
      rgba: readPixels(env, bitmap, o.x, o.y, o.width, o.height, o.width, o.height),
      width: o.width,
      height: o.height,
    }))
    return buildFrame({
      rgba,
      width,
      height,
      native: { width: nw, height: nh, bytes: source.size ?? null, mime: source.type || null },
      patches,
      meta,
    })
  } finally {
    bitmap.close?.()
  }
}
