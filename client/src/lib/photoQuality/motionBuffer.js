// A rolling buffer of device-motion readings, so the camera can ask "how steady
// was the phone around the moment this frame was taken?".
import { motionSamples } from './checks/shakeSensor.js'

export function createMotionBuffer({ keepMs = 3000, now = () => performance.now() } = {}) {
  let events = []
  let handler = null

  const push = (e) => {
    events.push(e)
    const cutoff = e.t - keepMs
    while (events.length && events[0].t < cutoff) events.shift()
  }

  return {
    // Test seam / manual feed.
    push,
    start(target = window) {
      if (handler || !target?.addEventListener) return
      handler = (ev) =>
        push({
          t: now(),
          rot: ev.rotationRate ? { alpha: ev.rotationRate.alpha, beta: ev.rotationRate.beta, gamma: ev.rotationRate.gamma } : null,
          acc: ev.acceleration && ev.acceleration.x != null ? { x: ev.acceleration.x, y: ev.acceleration.y, z: ev.acceleration.z } : null,
        })
      target.addEventListener('devicemotion', handler)
      this._target = target
    },
    stop() {
      if (handler) this._target?.removeEventListener('devicemotion', handler)
      handler = null
      events = []
    },
    // Samples with t in [from, to] (performance.now() ms), as { rot, acc, t }.
    window(from, to) {
      return motionSamples(events.filter((e) => e.t >= from && e.t <= to))
    },
    recent(ms, t = now()) {
      return motionSamples(events.filter((e) => e.t >= t - ms && e.t <= t))
    },
    get size() {
      return events.length
    },
  }
}
