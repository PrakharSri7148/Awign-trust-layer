import { Check, ChevronDown, ChevronUp, CircleX, Info, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { OVERALL_SEGMENTS, SEGMENTS, positionSegments, segmentTicks, toSegments } from '../../lib/photoQuality/segments.js'
import { fmtQuality } from '../../lib/photoQuality/display.js'
import { HUD_LABELS, hudOrder } from '../../lib/photoQuality/liveMetrics.js'
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
const STATUS_ICON = { pass: Check, warn: TriangleAlert, fail: CircleX }
const rawText = (raw) =>
  Object.entries(raw ?? {})
    .filter(([, v]) => v != null && typeof v !== 'object')
    .map(([k, v]) => `${k} ${typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : v}`)
    .join(' · ')

const clamp100 = (p) => (p == null || Number.isNaN(p) ? 0 : Math.max(0, Math.min(100, Math.round(p))))

// A row of small discrete segments (toSegments / positionSegments decide which are lit). Lit segments take the status
// colour so a bad reading never looks green; notches mark where the status changes. role="meter" so assistive tech
// reads the value; colour is never the only signal (the row also carries the status icon and word).
function Meter({ m, n, label }) {
  const position = !!m.positionBar
  const muted = m.score == null
  const seg = position ? positionSegments(m.pct, m.ticks, n, m.status) : toSegments(muted ? 0 : m.pct, n, m.status)
  const notch = position ? { warn: null, fail: null } : segmentTicks(m.ticks, n)
  return (
    <span
      className={`cap-meter cap-meter--${seg.tone}${n === OVERALL_SEGMENTS ? ' cap-meter--20' : ''}${muted ? ' cap-meter--muted' : ''}${position ? ' cap-meter--position' : ''} cap-hud__meter`}
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
          className={`cap-meter__cell${on && !muted ? ' cap-meter__cell--on' : ''}${position && seg.zone[i] ? ' cap-meter__cell--zone' : ''}${notch.warn === i ? ' cap-meter__cell--n-warn' : ''}${notch.fail === i ? ' cap-meter__cell--n-fail' : ''}`}
        />
      ))}
    </span>
  )
}

// Live numbers over the camera. Presentational: everything comes from analyzeLive().metrics. `summary` is null before the
// camera runs: the rows then show as muted placeholders ("no score yet").
// Not an aria-live region on purpose (it updates 5x a second); the headline hint keeps role="status".
// variant 'overlay' = the compact panel above the shutter on phones (dark scrim, sits on the camera); 'side' = a card.
export default function LiveHud({ summary, mode, onToggle, raw = false, variant = 'side', faceMode = 'off' }) {
  const [, force] = useState(0)
  useEffect(() => {
    const on = () => force((n) => n + 1)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const expanded = mode === 'expanded'
  const overlay = variant === 'overlay'
  const ready = !!summary?.metrics
  const overall = ready ? summary.overall : { pct: null, score: null }
  const overallStatus = overall.pct == null ? STATUS.PASS : overall.pct >= 75 ? STATUS.PASS : overall.pct >= 50 ? STATUS.WARN : STATUS.FAIL
  const overallM = { pct: overall.pct, score: overall.score, status: overallStatus, ticks: null }
  const OverallIcon = STATUS_ICON[TONE[overallStatus]]
  const rows = ready
    ? Object.keys(summary.metrics).map((id) => summary.metrics[id])
    : hudOrder(faceMode).map((id) => ({ id, label: HUD_LABELS[id], display: '—', status: STATUS.PASS, score: null, pct: 0, ticks: null, reason: null }))

  return (
    <section className={`cap-hud cap-hud--${mode}${overlay ? ' cap-hud--overlay cap-scrimbox cap-on-camera' : ''}`} aria-label="Live quality metrics" data-mode={mode} aria-busy={!ready || undefined}>
      <header className="cap-hud__head">
        <div className="cap-kpi">
          <span className="cap-kpi__label cap-eyebrow">Live quality</span>
          <div className="cap-kpi__row">
            <b className="cap-kpi__value" data-testid="hud-overall">
              {overall.score == null ? '—' : <>{fmtQuality(overall.score).replace('%', '')}<small>%</small></>}
            </b>
            {overall.score != null && (
              <span className={`cap-pill cap-pill--${TONE[overallStatus]}`}><OverallIcon size={12} className="cap-icon" aria-hidden="true" />{overallStatus === STATUS.PASS ? 'Good' : overallStatus === STATUS.WARN ? 'Fair' : 'Poor'}</span>
            )}
          </div>
        </div>
        <button type="button" className="cap-hud__toggle" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? 'Show fewer live metrics' : 'Show all live metrics'}>
          Metrics {expanded ? <ChevronDown size={14} className="cap-icon" aria-hidden="true" /> : <ChevronUp size={14} className="cap-icon" aria-hidden="true" />}
        </button>
      </header>
      <Meter m={overallM} n={OVERALL_SEGMENTS} label={`Live quality ${overall.score == null ? 'not available' : fmtQuality(overall.score)}`} />
      {expanded && (
        <span className="cap-hud__note" tabIndex={0} title="Live numbers are estimates at preview size; the photo is fully checked after capture.">
          <Info size={12} className="cap-icon" aria-hidden="true" />Compression: checked when you capture
        </span>
      )}

      <ul className="cap-hud__rows">
        {rows.map((m) => {
          const tone = TONE[m.status]
          const muted = m.score == null
          const text = `${m.label} ${m.display}${m.status === STATUS.PASS ? '' : ` ${m.status}`}`
          const Icon = STATUS_ICON[tone]
          const word = !muted && m.status !== STATUS.PASS ? (m.status === STATUS.FAIL ? 'Failed' : 'Warning') : null
          return (
            <li key={m.id} className={`cap-hud__row cap-hud__row--${tone}${muted ? ' cap-hud__row--muted' : ''}`} data-metric={m.id} data-status={m.status} aria-label={text}>
              <span className="cap-hud__label">{m.label}</span>
              <Meter m={m} n={SEGMENTS} label={text} />
              <span className="cap-hud__value">{m.display}{!muted && <Icon size={14} className="cap-icon" aria-hidden="true" />}</span>
              {expanded && (m.reason || word) && (
                <span className="cap-hud__reason">{word && <><span className="cap-hud__word">{word}</span>{m.reason ? ' · ' : ''}</>}{m.reason ?? ''}</span>
              )}
              {raw && <span className="cap-hud__raw">{rawText(m.raw)}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
