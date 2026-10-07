// Frames cross the worker boundary as plain typed arrays, transferred (not copied).
export function frameToTransfer(frame) {
  const payload = {
    width: frame.width,
    height: frame.height,
    rgba: frame.rgba,
    gray: frame.gray,
    native: {
      width: frame.native.width,
      height: frame.native.height,
      bytes: frame.native.bytes,
      mime: frame.native.mime,
      patches: frame.native.patches.map((p) => ({ gray: p.gray, width: p.width, height: p.height })),
    },
  }
  const seen = new Set()
  const transfer = []
  for (const buf of [payload.rgba.buffer, payload.gray.buffer, ...payload.native.patches.map((p) => p.gray.buffer)]) {
    if (!seen.has(buf)) {
      seen.add(buf)
      transfer.push(buf)
    }
  }
  return { payload, transfer }
}

// The worker side: a structured clone already gives back real typed arrays, so
// this only re-attaches the shape the checks expect.
export const frameFromTransfer = (p) => ({ ...p, meta: {} })
