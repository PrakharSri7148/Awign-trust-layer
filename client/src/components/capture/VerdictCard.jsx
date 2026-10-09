import { Check, Copy, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import FraudGauge from './FraudGauge.jsx'

// The celebration: a few small dots from the badge, once, accepted only (hidden by prefers-reduced-motion in the CSS).
const BURST = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * 2 * Math.PI + 0.2
  const d = 34 + (i % 3) * 9
  return { dx: (Math.cos(a) * d).toFixed(1), dy: (Math.sin(a) * d).toFixed(1), c: i % 2 ? 'var(--cap-ok)' : 'var(--cap-accent-text)' }
})

export function NewSubmission({ onReset, className = '' }) {
  return (
    <button type="button" className={`cap-btn cap-btn--primary cap-btn--lg cap-btn--block ${className}`} onClick={onReset} data-testid="new-submission">
      <RotateCcw size={18} className="cap-icon" aria-hidden="true" />New submission
    </button>
  )
}

// C1: the result card. Green / red is a thin border, the badge and the gauge only; the title is plain text. `action` = the "New submission" button
// when the layout keeps it inside the card (desktop, tablet); on phones Verdict.jsx renders it in a sticky bar instead.
export default function VerdictCard({ result, action }) {
  const flagged = result.status === 'flagged'
  const tone = flagged ? 'fail' : 'ok'
  const Icon = flagged ? ShieldAlert : ShieldCheck
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(String(result.id))
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable (insecure context) */
    }
  }

  return (
    <section className={`cap-card cap-card--${tone} cap-vres`} aria-labelledby="vres-title" data-testid="verdict-card" data-status={result.status}>
      <div className="cap-vres__grid">
        <div className="cap-vres__head">
          <span className={`cap-badge cap-badge--${tone}`}>
            <Icon size={26} className="cap-icon" aria-hidden="true" />
            {!flagged && (
              <span className="cap-burst" aria-hidden="true">
                {BURST.map((p, i) => <i key={i} className="cap-burst__dot" style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--c': p.c }} />)}
              </span>
            )}
          </span>
          <div className="cap-vres__text">
            <div className="cap-eyebrow">Verification result</div>
            <h2 className="cap-vres__title" id="vres-title" tabIndex={-1}>{flagged ? 'FLAGGED FOR REVIEW' : 'VERIFIED'}</h2>
          </div>
        </div>
        <div className="cap-vres__gauge"><FraudGauge value={result.fraud_probability} tone={tone} /></div>
        <div className="cap-vres__id">
          <span className="cap-idrow">
            <span className="cap-idrow__id cap-mono" data-testid="submission-id">ID #{result.id}</span>
            <button type="button" className={`cap-icon-btn cap-idrow__btn${copied ? ' is-copied is-tip' : ''}`} onClick={copy} aria-label="Copy submission ID" data-tip={copied ? 'Copied' : 'Copy submission ID'} data-tip-pos="left">
              {copied ? <Check size={18} className="cap-icon" aria-hidden="true" /> : <Copy size={18} className="cap-icon" aria-hidden="true" />}
            </button>
            <span className="cap-sr" role="status" aria-live="polite">{copied ? 'Submission ID copied' : ''}</span>
          </span>
        </div>
        {action && <div className="cap-vres__foot">{action}</div>}
      </div>
    </section>
  )
}
