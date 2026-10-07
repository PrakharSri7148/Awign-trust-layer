import { THRESHOLDS } from '../config.js'
import { STATUS, ramp } from '../schema.js'

// Camera movement measured by the phone's own sensors in the window around the
// shutter. Unlike the image-based check this sees shake even when the image
// happens not to show directional blur. `samples`: [{ rot: deg/s magnitude,
// acc: m/s^2 magnitude, t }]. Returns null when there is nothing to judge.
export function sensorShake(samples, cfg = THRESHOLDS.shake.sensor) {
  const s = (samples ?? []).filter((x) => Number.isFinite(x.rot) || Number.isFinite(x.acc))
  if (s.length < cfg.minSamples) return null
  const rms = (key) => {
    const v = s.map((x) => x[key]).filter(Number.isFinite)
    return v.length ? Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length) : null
  }
  const rotRms = rms('rot')
  const accRms = rms('acc')
  let status = STATUS.PASS
  const bump = (v, warn, fail) => {
    if (v == null) return
    if (v >= fail) status = STATUS.FAIL
    else if (v >= warn && status !== STATUS.FAIL) status = STATUS.WARN
  }
  bump(rotRms, cfg.rotWarn, cfg.rotFail)
  bump(accRms, cfg.accWarn, cfg.accFail)
  return {
    status,
    rotRms,
    accRms,
    samples: s.length,
    score: Math.min(rotRms == null ? 1 : ramp(rotRms, cfg.rotFail * 1.5, 2), accRms == null ? 1 : ramp(accRms, cfg.accFail * 1.5, 0.2)),
  }
}

// Turn a window of raw devicemotion events into samples.
export function motionSamples(events) {
  return events.map((e) => ({
    t: e.t,
    rot: e.rot ? Math.hypot(e.rot.alpha ?? 0, e.rot.beta ?? 0, e.rot.gamma ?? 0) : null,
    acc: e.acc ? Math.hypot(e.acc.x ?? 0, e.acc.y ?? 0, e.acc.z ?? 0) : null,
  }))
}
