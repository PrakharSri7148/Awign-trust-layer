import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { OVERALL_SEGMENTS, SEGMENTS, positionSegments, segmentTicks, toSegments } from '../../lib/photoQuality/segments.js'
import { fmtQuality } from '../../lib/photoQuality/display.js'
import { STATUS } from '../../lib/photoQuality/schema.js'

const KEY = 'trustlayer.hud'

// 'expanded' (every row with its meter and reason) or 'compact' (a two-column grid of small meters).
// Beside or under the preview there is room, so it starts expanded; on phones (the overlay layout) the
// panel sits over the camera, so it starts compact. The choice is remembered per layout kind. Storage
// can throw (private mode, blocked site data), so the HUD must work without it.
export function useHudMode(layout = 'side') {
  const overlay = layout === 'overlay'
  const key = overlay ? `${KEY}.overlay` : KEY
  const initial = () => {
    try {
      const saved = window.localStorage.getItem(key)
      if (saved === 'expanded' || saved === 'compact') return saved
    } catch {
      /* no storage: fall through */
    }
    return overlay ? 'compact' : 'expanded'
  }
  const [mode, setMode] = useState(initial)
  // The remembered choice is per layout kind, so crossing the phone breakpoint picks up that layout's own setting.
  useEffect(() => setMode(initial()), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () =>
    setMode((m) => {
      const next = m === 'expanded' ? 'compact' : 'expanded'
      try {
        window.localStorage.setItem(key, next)
      } catch {
        /* ignore */
      }
      return next
    })
  return [mode, toggle]
}

export const hudRaw = () => {
  try {
    return new URLSearchParams(window.location.search).get('hud') === 'raw'
  } catch {
    return false
  }
}

const TONE = { [STATUS.PASS]: 'pass', [STATUS.WARN]: 'warn', [STATUS.FAIL]: 'fail' }
const rawText = (raw) =>
  Object.entries(raw ?? {})
    .filter(([, v]) => v != null && typeof v !== 'object')
    .map(([k, v]) => `${k} ${typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : v}`)
    .join(' · ')

const clamp100 = (p) => (p == null || Number.isNaN(p) ? 0 : Math.max(0, Math.min(100, Math.round(p))))

// A row of small discrete segments (toSegments / positionSegments decide which are lit). Lit
// segments take the status colour so a bad reading never looks green; notches mark where the
// status changes. role="meter" so assistive tech reads the value; colour is never the only signal
// (the row also carries the status word in its label and the number beside it).
function Segments({ m, n, label }) {
  const position = !!m.positionBar
  const muted = m.score == null
  const seg = position ? positionSegments(m.pct, m.ticks, n, m.status) : toSegments(muted ? 0 : m.pct, n, m.status)
  const notch = position ? { warn: null, fail: null } : segmentTicks(m.ticks, n)
  return (
    <span
      className={`segm segm--${seg.tone}${muted ? ' segm--muted' : ''}${position ? ' segm--position' : ''}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={muted ? 0 : clamp100(m.pct)}
      aria-valuetext={label}
      data-segments={n}
      data-lit={position ? (muted ? 0 : 1) : seg.lit}
      data-at={position ? seg.at : undefined}
    >
      {seg.cells.map((on, i) => (
        <i
          key={i}
          className={`segm__cell${on && !muted ? ' segm__cell--on' : ''}${position && seg.zone[i] ? ' segm__cell--zone' : ''}${notch.warn === i ? ' segm__cell--n-warn' : ''}${notch.fail === i ? ' segm__cell--n-fail' : ''}`}
        />
      ))}
    </span>
  )
}

// Live numbers over the camera. Presentational: everything comes from analyzeLive().metrics.
// Not an aria-live region on purpose (it updates 5x a second); the headline hint keeps role="status".
export default function LiveHud({ summary, mode, onToggle, raw = false }) {
  const [, force] = useState(0)
  useEffect(() => {
    const on = () => force((n) => n + 1)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  if (!summary?.metrics) return null
  const { metrics, overall } = summary
  const expanded = mode === 'expanded'
  const overallStatus = overall.pct == null ? STATUS.PASS : overall.pct >= 75 ? STATUS.PASS : overall.pct >= 50 ? STATUS.WARN : STATUS.FAIL
  const overallM = { pct: overall.pct, score: overall.score, status: overallStatus, ticks: null }

  return (
    <section className={`hud hud--${mode}`} aria-label="Live quality metrics" data-mode={mode}>
      <header className="hud__head">
        <div className="hud__title">
          <span className="eyebrow">Live quality</span>
          <b className="num hud__overall" data-testid="hud-overall">{overall.score == null ? '—' : fmtQuality(overall.score)}</b>
        </div>
        <Segments m={overallM} n={OVERALL_SEGMENTS} label={`Live quality ${overall.score == null ? 'not available' : fmtQuality(overall.score)}`} />
        <button type="button" className="hud__toggle" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? 'Show fewer live metrics' : 'Show all live metrics'}>
          Metrics {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </header>
      {expanded && (
        <span className="hud__note" title="Live numbers are estimates at preview size; the photo is fully checked after capture.">
          Compression: checked when you capture
        </span>
      )}

      <ul className="hud__rows">
        {Object.keys(metrics).map((id) => {
          const m = metrics[id]
          const text = `${m.label} ${m.display}${m.status === STATUS.PASS ? '' : ` ${m.status}`}`
          return (
            <li key={id} className={`hud__row hud__row--${TONE[m.status]}${m.score == null ? ' hud__row--muted' : ''}`} data-metric={id} data-status={m.status} aria-label={text}>
              <span className="hud__label">{m.label}</span>
              <span className="hud__value num">{m.display}</span>
              <Segments m={m} n={SEGMENTS} label={text} />
              {expanded && <span className="hud__reason">{m.reason ?? ''}</span>}
              {raw && <span className="hud__raw">{rawText(m.raw)}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
