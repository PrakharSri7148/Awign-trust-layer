// The in-browser entry point: decode on the main thread (the browser decodes off
// thread anyway), run the pixel checks in a Web Worker, run the face check on the
// main thread (MediaPipe's WASM), then merge. Falls back to doing everything on
// the main thread when workers are unavailable.
import { analyzeFrame, checkFace, decodeToFrame } from './index.js'
import { DEFAULT_TASK } from './config.js'
import { frameToTransfer } from './transfer.js'
import { withCheck, withSensorShake } from './merge.js'

let worker = null
let nextId = 1
const pending = new Map()

function getWorker() {
  if (worker || typeof Worker === 'undefined') return worker
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id)
      if (!p) return
      pending.delete(data.id)
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.report)
    }
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'worker failed'))
      pending.clear()
      worker = null // next call retries, or falls back
    }
  } catch {
    worker = null
  }
  return worker
}

export function analyzeInWorker(frame, task) {
  const w = getWorker()
  if (!w) return Promise.resolve(analyzeFrame(frame, { task })) // no worker: same result, on this thread
  const id = nextId++
  const { payload, transfer } = frameToTransfer(frame)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, frame: payload, task }, transfer)
  })
}

// file -> full report. `sensor`: motion samples from the camera window (optional).
export async function runPhotoQualityBrowser(file, { task = {}, detector, sensor, env } = {}) {
  const taskCfg = { ...DEFAULT_TASK, ...task }
  const frame = await decodeToFrame(file, { env })
  // The face check needs the pixels on this thread, and transferring the frame to
  // the worker detaches its buffers: hand the face check its own copy first.
  const faceFrame = taskCfg.face !== 'off' ? { ...frame, rgba: frame.rgba.slice(), gray: frame.gray.slice() } : null
  const [report, face] = await Promise.all([
    // If the worker dies after taking the frame its buffers are gone, so fall back by decoding again.
    analyzeInWorker(frame, taskCfg).catch(async () => analyzeFrame(await decodeToFrame(file, { env }), { task: taskCfg })),
    faceFrame ? checkFace(faceFrame, { task: taskCfg, detector }) : null,
  ])
  return withSensorShake(withCheck(report, face, taskCfg), sensor, taskCfg)
}
