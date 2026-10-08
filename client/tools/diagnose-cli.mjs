// The browser engine on one photo, in Node, as JSON. Used by backend/tools/focus_diagnose.py --client
// to put the client's numbers next to the server's (are the two engines disagreeing about this photo?).
//   node tools/diagnose-cli.mjs --task <task id> <photo>   < detections.json
// stdin: the face detections to evaluate ([] or empty = pixel checks only). MediaPipe's WASM detector
// only runs in a browser, so the Python detector's boxes are passed in; the face LOGIC is the JS one.
import fs from 'node:fs'
import { analyzeFrame, evaluateFace } from '../src/lib/photoQuality/index.js'
import { decodeToFrame } from '../src/lib/photoQuality/index.js'
import { withCheck } from '../src/lib/photoQuality/merge.js'
import { asFile, nodeEnv } from '../src/lib/photoQuality/testing/nodeEnv.js'
import { TASKS } from '../src/lib/photoQuality/config.js'

const args = process.argv.slice(2)
const ti = args.indexOf('--task')
const taskId = ti >= 0 ? args.splice(ti, 2)[1] : 'task_demo_1'
const task = { ...(TASKS[taskId] ?? {}) }
let faces = []
try {
  const raw = fs.readFileSync(0, 'utf8').trim()
  if (raw) faces = JSON.parse(raw)
} catch {
  /* no stdin */
}

const out = []
for (const file of args) {
  const bytes = fs.readFileSync(file)
  const frame = await decodeToFrame(asFile(bytes, /\.png$/i.test(file) ? 'image/png' : 'image/jpeg'), { env: nodeEnv })
  let report = analyzeFrame(frame, { task })
  if (task.face && task.face !== 'off') report = withCheck(report, evaluateFace(faces, frame), task)
  out.push({ file, verdict: report.verdict, checks: report.checks, issues: report.issues })
}
process.stdout.write(JSON.stringify(out))
