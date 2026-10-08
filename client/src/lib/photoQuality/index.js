import { CHECKS } from './checks/index.js'
import { DEFAULT_TASK, POLICY } from './config.js'
import { decodeToFrame } from './decode.js'
import { checkFace, softenCropBlur } from './face/facecheck.js'
import { aggregate } from './policy.js'
import { REPORT_VERSION, STATUS, checkResult } from './schema.js'

export { decodeToFrame } from './decode.js'
export { checkFace, evaluateFace, softenCropBlur } from './face/facecheck.js'
export { buildFrame } from './frame.js'
export * from './schema.js'

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function runChecks(frame, taskCfg, checks) {
  const results = []
  const done = {} // results so far, for checks that depend on an earlier one
  for (const [id, fn] of Object.entries(checks)) {
    try {
      const r = fn(frame, { task: taskCfg, results: done })
      done[id] = r
      results.push(r)
    } catch (err) {
      results.push(checkResult(id, { status: STATUS.SKIP, details: { error: String(err?.message ?? err) } }))
    }
  }
  return results
}

function finish(frame, results, taskCfg, policy, t0) {
  const { verdict, issues, qualityScore } = aggregate(results, { policy, task: taskCfg })
  return {
    version: REPORT_VERSION,
    verdict,
    qualityScore,
    issues,
    checks: Object.fromEntries(results.map((r) => [r.id, r])),
    metrics: {
      width: frame.native.width,
      height: frame.native.height,
      bytes: frame.native.bytes,
      mime: frame.native.mime,
      analysisMs: Math.round(now() - t0),
    },
  }
}

// Pure: frame -> report (pixel checks only; no face).
export function analyzeFrame(frame, { task = {}, checks = CHECKS, policy = POLICY } = {}) {
  const t0 = now()
  const taskCfg = { ...DEFAULT_TASK, ...task }
  return finish(frame, runChecks(frame, taskCfg, checks), taskCfg, policy, t0)
}

// Pixel checks plus, when the task needs a face, the face check. The detector is
// injected (mediapipeDetector() in the app, a scripted fake in tests).
export async function analyzeFrameAsync(frame, { task = {}, checks = CHECKS, policy = POLICY, detector } = {}) {
  const t0 = now()
  const taskCfg = { ...DEFAULT_TASK, ...task }
  const results = runChecks(frame, taskCfg, checks)
  if (taskCfg.face !== 'off') results.push(softenCropBlur(await checkFace(frame, { task: taskCfg, detector }), results.find((r) => r.id === 'blur')))
  return finish(frame, results, taskCfg, policy, t0)
}

// file -> report. `signal`-style staleness is handled by the caller (see Capture).
export async function runPhotoQuality(file, { task, env, meta, detector } = {}) {
  const frame = await decodeToFrame(file, { env, meta })
  return analyzeFrameAsync(frame, { task, detector })
}

// What the client tells the server about its own check. Heavy `details` are
// dropped; the server recomputes everything from the photo anyway and compares.
export function compactReport(report) {
  return {
    version: report.version,
    verdict: report.verdict,
    quality_score: Number(report.qualityScore.toFixed(4)),
    issues: report.issues.map((i) => ({ id: i.id, status: i.status, blocking: i.blocking })),
    checks: Object.fromEntries(
      Object.entries(report.checks).map(([id, c]) => [
        id,
        { status: c.status, score: c.score == null ? null : Number(c.score.toFixed(4)), value: c.value == null ? null : Number(Number(c.value).toFixed(4)) },
      ]),
    ),
    // How steady the phone was around the shutter (camera captures only).
    sensor: report.checks.shake?.details?.sensor
      ? {
          rotation_rms: Number((report.checks.shake.details.sensor.rotRms ?? 0).toFixed(2)),
          accel_rms: Number((report.checks.shake.details.sensor.accRms ?? 0).toFixed(3)),
          samples: report.checks.shake.details.sensor.samples,
        }
      : null,
    metrics: {
      width: report.metrics.width,
      height: report.metrics.height,
      bytes: report.metrics.bytes,
      mime: report.metrics.mime,
      analysis_ms: report.metrics.analysisMs,
    },
  }
}
