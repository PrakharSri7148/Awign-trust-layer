import { useEffect, useRef } from 'react'

// Live oscilloscope of |acceleration| from devicemotion. With no sensor (desktop)
// the trace is honestly flat.
export default function Waveform({ active }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const N = 90
    const buf = new Array(N).fill(0)
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
    window.addEventListener('devicemotion', onMotion)

    let raf
    const draw = () => {
      buf.push(active ? latest : 0)
      buf.shift()
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.beginPath()
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
      ctx.stroke()
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = 1.8
      ctx.shadowColor = '#22d3ee'
      ctx.shadowBlur = 8
      ctx.beginPath()
      buf.forEach((v, i) => {
        const x = (i / (N - 1)) * w
        const y = h / 2 - Math.min(1, v / 3) * (h / 2 - 3) * (i % 2 ? 1 : -1)
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      })
      ctx.stroke()
      ctx.shadowBlur = 0
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('devicemotion', onMotion)
    }
  }, [active])

  return <canvas ref={ref} className="wave" aria-hidden="true" />
}
