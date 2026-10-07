import { motion } from 'framer-motion'
import { Check, Copy, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import CountUp from '../ui/CountUp.jsx'
import Gauge from '../ui/Gauge.jsx'
import ShapBars from '../ui/ShapBars.jsx'

const BURST = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2
  const d = 70 + (i % 3) * 24
  return { x: Math.cos(a) * d, y: Math.sin(a) * d, c: i % 2 ? '#34d399' : '#22d3ee' }
})

export default function Verdict({ result, onReset }) {
  const flagged = result.status === 'flagged'
  const color = flagged ? 'var(--red)' : 'var(--green)'
  const Icon = flagged ? ShieldAlert : ShieldCheck
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(String(result.id))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable (insecure context) */
    }
  }

  return (
    <div className="stack stack--lg">
      <motion.div
        className={`panel brackets panel--glow-${flagged ? 'red' : 'green'} verdict`}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      >
        <div className="verdict__burst" style={{ color }}>
          {!flagged &&
            BURST.map((p, i) => (
              <motion.span
                key={i}
                className="particle"
                style={{ background: p.c }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.3 }}
                transition={{ duration: 1.1, delay: 0.2, ease: 'easeOut' }}
              />
            ))}
          <motion.div
            className="verdict__icon"
            initial={{ scale: 0, rotate: -40 }}
            animate={flagged ? { scale: [0, 1.15, 1], rotate: 0 } : { scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 16 }}
          >
            <Icon size={44} strokeWidth={1.6} />
          </motion.div>
        </div>

        <div>
          <div className="eyebrow">Verification result</div>
          <h2 className="verdict__title" style={{ color, marginTop: 6 }}>
            {flagged ? (
              <span className="glitch" data-text="FLAGGED FOR REVIEW">FLAGGED FOR REVIEW</span>
            ) : (
              'VERIFIED'
            )}
          </h2>
        </div>

        <Gauge value={result.fraud_probability} mark={0.5} color={color} size={190} stroke={12}>
          <div className="eyebrow">Fraud prob.</div>
          <div className="num" style={{ fontSize: 34, fontWeight: 700, color }}>
            <CountUp to={result.fraud_probability * 100} decimals={1} suffix="%" duration={1400} />
          </div>
          <div className="eyebrow">threshold 50%</div>
        </Gauge>

        <div className="mono-id">
          ID #{result.id}
          <button className="icon-btn" onClick={copy} aria-label="Copy submission ID">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </motion.div>

      <div className="panel">
        <div className="reason">
          <div className="eyebrow eyebrow--cyan">Why?</div>
          <p className="reason__text">{result.top_reason}</p>
          <div className="eyebrow" style={{ marginTop: 8 }}>SHAP factor breakdown</div>
          <ShapBars importances={result.feature_importances} />
        </div>
      </div>

      <button className="btn btn--primary btn--block" onClick={onReset}>
        <RotateCcw size={16} /> New submission
      </button>
    </div>
  )
}
