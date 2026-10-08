// What the Web Worker does with a message, as a plain function so it can be tested in Node.
//   { id, frame, task }                      -> { id, report }   full analysis of a captured photo
//   { id, type: 'live', frame, opts }        -> { id, summary }  one live-viewfinder tick (HUD numbers)
import { analyzeFrame } from './index.js'
import { buildFrame } from './frame.js'
import { analyzeLive } from './live.js'
import { frameFromTransfer } from './transfer.js'

export function handleMessage(data) {
  const { id, type } = data
  try {
    if (type === 'live') {
      // Only the RGBA pixels cross the boundary; gray is derived here, off the UI thread.
      const frame = buildFrame({ rgba: data.frame.rgba, width: data.frame.width, height: data.frame.height })
      return { id, summary: analyzeLive(frame, data.opts) }
    }
    return { id, report: analyzeFrame(frameFromTransfer(data.frame), { task: data.task }) }
  } catch (err) {
    return { id, error: String(err?.message ?? err) }
  }
}
