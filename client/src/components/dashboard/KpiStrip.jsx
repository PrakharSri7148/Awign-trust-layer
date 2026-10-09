import { useMemo } from 'react'
import { DAY, KPIS, dayBuckets, deltaPct, statsOf, withinDays } from '../../lib/dashboard/model.js'
import { Icon, Skeleton, cx } from './ui.jsx'

function Trend({ values, w = 64, h = 20 }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)])
  const last = pts[pts.length - 1]
  return (
    <svg className={cx('trend')} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false">
      <polyline points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".7" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2" fill="currentColor" />
    </svg>
  )
}

// Five tab-like cards. The selected one drives the review queue and the map. Numbers cover the last 7 days; the change pill compares
// with the 7 days before (no pill when there is nothing to compare with).
export default function KpiStrip({ rows, kpi, onKpi, loading }) {
  const m = useMemo(() => {
    const now = Date.now()
    const cur = withinDays(rows, 7, now)
    const prev = rows.filter((r) => { const a = now - new Date(r.timestamp).getTime(); return a > 7 * DAY && a <= 14 * DAY })
    const c = statsOf(cur)
    const p = statsOf(prev)
    const f = {
      submissions: (rs) => rs.length,
      flagged: (rs) => rs.filter((r) => r.status === 'flagged').length,
      accepted: (rs) => rs.filter((r) => r.status !== 'flagged').length,
      rate: (rs) => (rs.length ? statsOf(rs).rate : 0),
      avg: (rs) => (rs.length ? statsOf(rs).avg : 0),
    }
    const fmt = { submissions: (v) => String(v), flagged: (v) => String(v), accepted: (v) => String(v), rate: (v) => `${Math.round(v * 100)}%`, avg: (v) => `${Math.round(v * 100)}%` }
    const curV = { submissions: c.n, flagged: c.flagged, accepted: c.accepted, rate: c.rate, avg: c.avg }
    const prevV = { submissions: p.n, flagged: p.flagged, accepted: p.accepted, rate: p.rate, avg: p.avg }
    return Object.fromEntries(KPIS.map((k) => [k.key, { text: fmt[k.key](curV[k.key]), delta: prev.length ? deltaPct(curV[k.key], prevV[k.key]) : null, trend: dayBuckets(rows, f[k.key], now) }]))
  }, [rows])

  const onKey = (e, i) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? KPIS.length - 1 : null
    if (n === null) return
    e.preventDefault()
    const k = KPIS[(n + KPIS.length) % KPIS.length].key
    onKpi(k)
    requestAnimationFrame(() => document.getElementById(`kpi-${k}`)?.focus())
  }

  return (
    <div className={cx('kpi-strip')} role="tablist" aria-label="Metrics. The selected metric filters the review queue and the map.">
      {KPIS.map((k, i) => {
        const x = m[k.key]
        const on = kpi === k.key
        // more submissions or accepted is neutral / good; more flags, a higher flag rate or fraud probability is bad
        const tone = x.delta == null ? null : k.key === 'submissions' ? 'neutral' : k.key === 'accepted' ? (x.delta >= 0 ? 'ok' : 'bad') : x.delta <= 0 ? 'ok' : 'bad'
        return (
          <button key={k.key} id={`kpi-${k.key}`} type="button" role="tab" aria-selected={on} aria-controls="queue-panel" tabIndex={on ? 0 : -1} className={cx('kpi-tab')} onClick={() => onKpi(k.key)} onKeyDown={(e) => onKey(e, i)}>
            <span className={cx('kpi-tab__label')}>{k.label}</span>
            <span className={cx('kpi-tab__value')}>{loading ? <Skeleton w={56} h={28} /> : x.text}</span>
            <span className={cx('kpi-tab__meta')}>
              {!loading && <Trend values={x.trend} />}
              {!loading && tone && (
                <span className={cx('pill', `pill--${tone}`)}>
                  <Icon name={x.delta >= 0 ? 'arrow-up' : 'arrow-down'} size={12} />
                  {x.delta >= 0 ? '+' : '−'}{Math.abs(x.delta)}%<span className={cx('sr-only')}> versus the previous 7 days</span>
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
