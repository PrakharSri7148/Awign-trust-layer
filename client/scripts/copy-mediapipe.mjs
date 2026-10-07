// Copies MediaPipe's WASM runtime from node_modules into public/mediapipe so the
// face detector is served from our own origin (no third-party CDN: works with a
// strict CSP, and the photo never has to reach anyone else's server).
// The 230 KB face model (blaze_face_short_range.tflite) is committed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const to = path.join(root, 'public/mediapipe')
if (!fs.existsSync(from)) {
  console.warn('[mediapipe] @mediapipe/tasks-vision not installed; face checks will be unavailable.')
  process.exit(0)
}
fs.mkdirSync(to, { recursive: true })
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  fs.copyFileSync(path.join(from, f), path.join(to, f))
}
console.log('[mediapipe] runtime copied to public/mediapipe')
