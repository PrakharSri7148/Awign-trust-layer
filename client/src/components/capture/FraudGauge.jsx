import { useEffect, useState } from 'react'

const SEGS = 60
// 60 segments clockwise from 12 o'clock (the Photo step's segment language). Geometry is fixed, so it is computed once.
const TICKS = Array.from({ length: SEGS }, (_, i) => {
  const a = ((i + 0.5) / SEGS) * 2 * Math.PI - Math.PI / 2
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [50 + 40 * c, 50 + 40 * s, 50 + 48 * c, 50 + 48 * s].map((n) => n.toFixed(2))
})

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// 0 -> value over 1.4 s (ease-out), one clock for the number and the lit segments. Reduced motion: the final value from the first paint.
function useCountUp(target, { duration = 1400, delay = 150 } = {}) {
  const [v, setV] = useState(() => (reducedMotion() ? target : 0))
  useEffect(() => {
    if (reducedMotion()) { setV(target); return undefined }
    let raf
    let t0 = null
    const tick = (now) => {
      if (t0 == null) t0 = now
      const k = Math.max(0, Math.min(1, (now - t0 - delay) / duration))
      setV(target * (1 - (1 - k) ** 3))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const done = setTimeout(() => setV(target), delay + duration + 400) // a hidden tab pauses requestAnimationFrame
    return () => { cancelAnimationFrame(raf); clearTimeout(done) }
  }, [target, duration, delay])
  return v
}

// The fraud probability as a ring with the 50% threshold mark at 6 o'clock. `value` is 0..1; `tone` = 'ok' | 'fail'.
// role="meter" with a text value; its visible label, number and caption are presentational for assistive tech (the aria-valuetext says all three).
export default function FraudGauge({ value, tone }) {
  const v = useCountUp(Math.max(0, Math.min(1, value)))
  const lit = Math.round(v * SEGS)
  const final = `${(value * 100).toFixed(1)}%`
  return (
    <div className={`cap-gauge cap-gauge--${tone}`} role="meter" aria-label="Fraud prob." aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number((value * 100).toFixed(1))} aria-valuetext={`${final}, threshold 50%`} data-testid="fraud-gauge">
      <svg className="cap-gauge__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        {TICKS.map(([x1, y1, x2, y2], i) => <line key={i} className={`cap-gauge__seg${i < lit ? ' cap-gauge__seg--on' : ''}`} x1={x1} y1={y1} x2={x2} y2={y2} />)}
        <line className="cap-gauge__mark" x1="50" y1="86" x2="50" y2="100.5" />
      </svg>
      <div className="cap-gauge__center">
        <span className="cap-gauge__label">Fraud prob.</span>
        <b className="cap-gauge__value cap-num">{(v * 100).toFixed(1)}%</b>
        <span className="cap-gauge__cap">threshold 50%</span>
      </div>
    </div>
  )
}
