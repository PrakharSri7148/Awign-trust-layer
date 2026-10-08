// Web Worker: runs the (CPU-heavy, pure) pixel checks off the UI thread, for captured photos and
// for the live viewfinder ticks. The logic lives in workerHandlers.js.
import { handleMessage } from './workerHandlers.js'

self.onmessage = ({ data }) => postMessage(handleMessage(data))
