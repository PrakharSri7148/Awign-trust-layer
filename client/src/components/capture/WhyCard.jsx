import { CircleCheck, CircleX, Minus, TriangleAlert } from 'lucide-react'
import { FACTORS, pct } from '../../lib/format.js'
import { verdictSummary } from '../../lib/sensorFusion/display.js'

// fusion tone (display.js) -> row class, icon, screen-reader word. Colour is never the only carrier.
const TONE = { green: ['ok', CircleCheck, 'Passed'], amber: ['warn', TriangleAlert, 'Warning'], red: ['bad', CircleX, 'Problem'], muted: ['muted', Minus, 'No data'] }

// The |SHAP| importances as three 20-segment meters (the Photo step's cap-meter). The largest gets the accent and the TOP DRIVER tag.
function ShapRows({ importances }) {
  const rows = FACTORS.map((f) => ({ ...f, v: importances?.[f.key] ?? 0 }))
  const top = rows.reduce((a, b) => (b.v > a.v ? b : a), rows[0])
  return (
    <div className="cap-shap">
      <h3 className="cap-eyebrow">SHAP factor breakdown</h3>
      <div className="cap-shap__rows">
        {rows.map((r) => {
          const isTop = r.key === top.key && r.v > 0
          const lit = r.v > 0 ? Math.max(1, Math.round(r.v * 20)) : 0
          return (
            <div key={r.key} className={`cap-shap__row${isTop ? ' cap-shap__row--top' : ''}`}>
              <div className="cap-shap__head">
                <span className="cap-shap__name">{r.label}{isTop && <span className="cap-pill cap-pill--info cap-shap__tag">TOP DRIVER</span>}</span>
                <span className="cap-shap__val cap-num">{pct(r.v)}</span>
              </div>
              <span className={`cap-meter cap-meter--20 cap-meter--${isTop ? 'accent' : 'neutral'}`} role="meter" aria-label={r.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number((r.v * 100).toFixed(1))} aria-valuetext={pct(r.v)}>
                {Array.from({ length: 20 }, (_, i) => <i key={i} className={`cap-meter__cell${i < lit ? ' cap-meter__cell--on' : ''}`} />)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// C2: the plain-language reason, the fusion summary (only when the server sent fusion) and the SHAP breakdown.
export default function WhyCard({ result }) {
  const lines = verdictSummary(result.fusion)
  return (
    <section className="cap-card cap-vwhy" aria-labelledby="vwhy-h" data-testid="why-card">
      <div className="cap-card__head"><h2 className="cap-eyebrow" id="vwhy-h">Why?</h2></div>
      <div className="cap-card__body">
        <p className="cap-reason" data-testid="top-reason">{result.top_reason}</p>
        {lines.length > 0 && (
          <ul className="cap-checks cap-fused" aria-label="Fusion summary" data-testid="fusion-verdict">
            {lines.map((l) => {
              const [cls, Icon, word] = TONE[l.tone] ?? TONE.muted
              return (
                <li key={l.id} className={`cap-check cap-check--${cls}`} data-tone={l.tone} data-testid={`fusion-${l.id}`}>
                  <Icon size={18} className="cap-icon" aria-hidden="true" />
                  <div>
                    <div className="cap-check__line"><span className="cap-check__label">{l.label}<span className="cap-sr">: {word}</span></span></div>
                    <p className="cap-check__hint">{l.text}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <ShapRows importances={result.feature_importances} />
      </div>
    </section>
  )
}
