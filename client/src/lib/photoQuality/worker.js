// Web Worker: runs the (CPU-heavy, pure) pixel checks off the UI thread.
import { analyzeFrame } from './index.js'
import { frameFromTransfer } from './transfer.js'

self.onmessage = ({ data }) => {
  const { id, frame, task } = data
  try {
    postMessage({ id, report: analyzeFrame(frameFromTransfer(frame), { task }) })
  } catch (err) {
    postMessage({ id, error: String(err?.message ?? err) })
  }
}
