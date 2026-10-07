import { useEffect, useState } from 'react'
import { FACTORS, pct } from '../../lib/format.js'

// Horizontal breakdown of the |SHAP| importances for one submission.
export default function ShapBars({ importances, highlightTop = true }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const rows = FACTORS.map((f) => ({ ...f, v: importances?.[f.key] ?? 0 }))
  const top = rows.reduce((a, b) => (b.v > a.v ? b : a), rows[0])

  return (
    <div className="shap">
      {rows.map((r) => {
        const isTop = highlightTop && r.key === top.key && r.v > 0
        return (
          <div key={r.key} className={`shap__row${isTop ? ' shap__row--top' : ''}`}>
            <div className="shap__head">
              <span className="shap__name">
                {r.label}
                {isTop && <span className="shap__tag">TOP DRIVER</span>}
              </span>
              <span className="num">{pct(r.v)}</span>
            </div>
            <div className="shap__track" role="img" aria-label={`${r.label} ${pct(r.v)}`}>
              <div className="shap__fill" style={{ width: ready ? `${r.v * 100}%` : 0 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
