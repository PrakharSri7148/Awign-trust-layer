import { useEffect, useRef } from 'react'

const N = 90
const W = 240
const H = 44

// An oscilloscope trace of |acceleration| from devicemotion, drawn as one SVG path (the Photo step's cap-feed__wave box).
// `active`: record live. `hold`: not live any more, keep the last trace on screen (the reading is Locked). Neither: a flat line
// (waiting, unavailable, or a laptop with no sensor), which is the honest picture.
function pathOf(buf) {
  let d = ''
  for (let i = 0; i < buf.length; i++) {
    const x = (i / (buf.length - 1)) * W
    const y = H / 2 - Math.min(1, buf[i] / 3) * (H / 2 - 3) * (i % 2 ? 1 : -1)
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

export default function Waveform({ active = false, hold = false, label = 'Live motion waveform' }) {
  const line = useRef(null)
  const buf = useRef(new Array(N).fill(0))

  useEffect(() => {
    let latest = 0
    let gravity = null
    const onMotion = (e) => {
      const a = e.acceleration
      if (a && a.x != null) {
        latest = Math.hypot(a.x, a.y, a.z)
      } else if (e.accelerationIncludingGravity?.x != null) {
        const g = e.accelerationIncludingGravity
        gravity = gravity ?? { x: g.x, y: g.y, z: g.z }
        for (const k of ['x', 'y', 'z']) gravity[k] = 0.8 * gravity[k] + 0.2 * g[k]
        latest = Math.hypot(g.x - gravity.x, g.y - gravity.y, g.z - gravity.z)
      }
    }
    if (active) window.addEventListener('devicemotion', onMotion)

    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let last = 0
    let raf
    const draw = (t) => {
      if (!reduced || t - last > 250) {
        last = t
        if (active) { buf.current.push(latest); buf.current.shift() } else if (!hold) { buf.current.push(0); buf.current.shift() }
        line.current?.setAttribute('d', pathOf(buf.current))
      }
      if (active || (!hold && buf.current.some((v) => v !== 0))) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('devicemotion', onMotion)
    }
  }, [active, hold])

  return (
    <svg className="cap-feed__wave" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path className="cap-wave__base" d={`M0 ${H / 2} L${W} ${H / 2}`} />
      <path className="cap-wave__line" ref={line} d={pathOf(buf.current)} />
    </svg>
  )
}
