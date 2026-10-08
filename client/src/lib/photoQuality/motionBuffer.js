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
      let gravity = null
      handler = (ev) => {
        const r = ev.rotationRate
        // Desktop browsers fire devicemotion with every field null: that is "no sensor", not "perfectly still".
        const rot = r && (r.alpha != null || r.beta != null || r.gamma != null) ? { alpha: r.alpha ?? 0, beta: r.beta ?? 0, gamma: r.gamma ?? 0 } : null
        let acc = ev.acceleration && ev.acceleration.x != null ? { x: ev.acceleration.x, y: ev.acceleration.y, z: ev.acceleration.z } : null
        if (!acc) {
          // Some Android browsers only report acceleration INCLUDING gravity: strip it with a low-pass
          // estimate of gravity so a still phone reads ~0 instead of ~9.8 m/s^2.
          const g = ev.accelerationIncludingGravity
          if (g && g.x != null) {
            if (!gravity) gravity = { x: g.x, y: g.y, z: g.z }
            for (const k of ['x', 'y', 'z']) gravity[k] = 0.8 * gravity[k] + 0.2 * g[k]
            acc = { x: g.x - gravity.x, y: g.y - gravity.y, z: g.z - gravity.z }
          }
        }
        if (rot || acc) push({ t: now(), rot, acc })
      }
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
