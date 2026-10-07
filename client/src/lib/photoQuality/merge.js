// Adding a check that was computed somewhere else (the face check on the main
// thread, the sensor reading from the camera) to a finished report, then
// re-deriving verdict / issues / quality score.
import { POLICY, DEFAULT_TASK } from './config.js'
import { aggregate } from './policy.js'
import { STATUS } from './schema.js'
import { sensorShake } from './checks/shakeSensor.js'

const RANK = { [STATUS.SKIP]: -1, [STATUS.PASS]: 0, [STATUS.WARN]: 1, [STATUS.FAIL]: 2 }

function rebuild(report, checks, task, policy = POLICY) {
  const taskCfg = { ...DEFAULT_TASK, ...task }
  const results = Object.values(checks)
  const { verdict, issues, qualityScore } = aggregate(results, { policy, task: taskCfg })
  return { ...report, checks, verdict, issues, qualityScore }
}

export function withCheck(report, result, task, policy) {
  if (!result) return report
  return rebuild(report, { ...report.checks, [result.id]: result }, task, policy)
}

// Fold a sensor reading into the `shake` check: the worse of image and sensor wins.
export function withSensorShake(report, samples, task, policy) {
  const sensor = sensorShake(samples)
  const image = report.checks.shake
  if (!sensor || !image) return report
  const worse = RANK[sensor.status] > RANK[image.status]
  const status = worse ? sensor.status : image.status
  const hint =
    status === STATUS.PASS
      ? null
      : worse
        ? 'The phone was moving when the photo was taken. Hold it with both hands, brace your elbows and wait a moment before tapping.'
        : image.hint
  const merged = {
    ...image,
    status,
    hint,
    score: Math.min(image.score ?? 1, sensor.score),
    details: { ...image.details, sensor: { rotRms: sensor.rotRms, accRms: sensor.accRms, samples: sensor.samples, status: sensor.status } },
  }
  return rebuild(report, { ...report.checks, shake: merged }, task, policy)
}
