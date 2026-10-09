import { useMemo, useRef, useState } from 'react'
import { importanceAverage, lineSeries, pctText, qualitySummary } from '../../lib/dashboard/model.js'
import { EmptyState, Icon, Skeleton, cx, fmtDateTime, fmtDay } from './ui.jsx'

const KIND = {
  quality: { label: 'Photo problem', color: 'var(--color-warn)' },
  integrity: { label: 'Integrity concern', color: 'var(--color-crit)' },
  info: { label: 'Context', color: 'var(--color-neutral)' },
}
const TONE_COLOR = { ok: 'var(--color-ok)', warn: 'var(--color-warn)', bad: 'var(--color-crit)', neutral: 'var(--color-neutral)' }

function DataTable({ caption, head, rows }) {
  return (
    <details className={cx('data-table')}>
      <summary>View data</summary>
      <div className={cx('table-wrap')} style={{ maxHeight: 240, overflow: 'auto' }}>
        <table className={cx('table')}>
          <caption className={cx('sr-only')}>{caption}</caption>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  )
}

/* ---------- Fraud probability over time ---------- */
const W = 640
const H = 220
const L = 40
const R = 10
const T = 10
const B = 24

function LineChart({ rows }) {
  const series = useMemo(() => lineSeries(rows), [rows])
  const [idx, setIdx] = useState(-1)
  const svgRef = useRef(null)
  const iw = W - L - R
  const ih = H - T - B
  const x = (i) => L + (series.length < 2 ? iw / 2 : (i / (series.length - 1)) * iw)
  const y = (p) => T + (1 - p) * ih
  if (!series.length) return <EmptyState icon="activity" title="No data yet">The chart fills in as submissions arrive.</EmptyState>
  const pts = series.map((r, i) => `${x(i).toFixed(1)},${y(r.fraud_probability ?? 0).toFixed(1)}`)
  const at = idx >= 0 ? series[idx] : null
  const onMove = (e) => {
    const b = svgRef.current.getBoundingClientRect()
    const vx = ((e.clientX - b.left) / b.width) * W
    setIdx(Math.max(0, Math.min(series.length - 1, Math.round(((vx - L) / iw) * (series.length - 1)))))
  }
  const scale = svgRef.current ? svgRef.current.getBoundingClientRect().width / W : 1
  return (
    <>
      <div className={cx('chart')} tabIndex={0} aria-label="Chart. Use left and right arrows to read each submission."
        onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); setIdx(idx < 0 ? 0 : Math.min(series.length - 1, idx + 1)) } if (e.key === 'ArrowLeft') { e.preventDefault(); setIdx(idx < 0 ? series.length - 1 : Math.max(0, idx - 1)) } if (e.key === 'Escape') setIdx(-1) }} onBlur={() => setIdx(-1)}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={cx('chart__svg')} role="img" aria-label={`Fraud probability for the last ${series.length} submissions, with the 50% flag threshold. Data table below.`} onMouseMove={onMove} onMouseLeave={() => setIdx(-1)}>
          {[0, 0.25, 0.5, 0.75, 1].map((g) => <g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--color-border)" /><text x={L - 8} y={y(g) + 4} textAnchor="end" className={cx('chart__tick')}>{Math.round(g * 100)}%</text></g>)}
          {[0, 1, 2, 3, 4].map((k) => { const i = Math.round((k / 4) * (series.length - 1)); return <text key={k} x={x(i)} y={H - 6} textAnchor={k === 0 ? 'start' : k === 4 ? 'end' : 'middle'} className={cx('chart__tick')}>{fmtDay(series[i].timestamp)}</text> })}
          <line x1={L} x2={W - R} y1={y(0.5)} y2={y(0.5)} stroke="var(--color-warn)" strokeDasharray="5 4" />
          <polygon points={`${x(0)},${y(0)} ${pts.join(' ')} ${x(series.length - 1)},${y(0)}`} fill="var(--color-accent)" opacity=".10" />
          <polyline points={pts.join(' ')} fill="none" stroke="var(--color-accent-text)" strokeWidth="1.6" strokeLinejoin="round" />
          {at && <g><line x1={x(idx)} x2={x(idx)} y1={T} y2={T + ih} stroke="var(--color-text-2)" strokeDasharray="2 3" /><circle cx={x(idx)} cy={y(at.fraud_probability ?? 0)} r="4" fill="var(--color-accent-text)" stroke="var(--color-shell)" strokeWidth="2" /></g>}
        </svg>
        {at && (
          <div className={cx('chart__tip')} role="status" style={{ left: Math.max(4, x(idx) * scale + 12 + 150 > W * scale ? x(idx) * scale - 150 : x(idx) * scale + 12), top: Math.max(0, y(at.fraud_probability ?? 0) * scale - 44) }}>
            <div className={cx('text-2')}>{fmtDateTime(at.timestamp)}</div>Case <span className={cx('mono')}>#{at.id}</span> <b className={cx('num')}>{pctText(at.fraud_probability, 1)}</b>
          </div>
        )}
      </div>
      <DataTable caption="Fraud probability per submission" head={['Case', 'Time', 'Fraud probability']} rows={series.slice().reverse().map((r) => [`#${r.id}`, fmtDateTime(r.timestamp), pctText(r.fraud_probability, 1)])} />
    </>
  )
}

/* ---------- Accepted vs flagged ---------- */
function Donut({ rows }) {
  const flagged = rows.filter((r) => r.status === 'flagged').length
  const acc = rows.length - flagged
  const C = 2 * Math.PI * 52
  const fl = rows.length ? (flagged / rows.length) * C : 0
  const gap = rows.length && flagged && acc ? 3 : 0
  return (
    <>
      <div className={cx('donut')}>
        <svg viewBox="0 0 140 140" className={cx('donut__svg')} role="img" aria-label={`${acc} accepted and ${flagged} flagged out of ${rows.length} submissions`}>
          <circle cx="70" cy="70" r="52" fill="none" stroke="var(--color-ok)" strokeWidth="10" opacity={rows.length ? 1 : 0.2} />
          {flagged > 0 && <circle cx="70" cy="70" r="52" fill="none" stroke="var(--color-crit)" strokeWidth="10" strokeDasharray={`${Math.max(0, fl - gap)} ${C}`} transform="rotate(-90 70 70)" />}
        </svg>
        <div className={cx('donut__center')}><div className={cx('donut__value', 'num')}>{rows.length ? Math.round((flagged / rows.length) * 100) : 0}%</div><div className={cx('text-xs', 'text-2')}>flagged</div></div>
      </div>
      <ul className={cx('legend-list')}>
        <li><i style={{ background: 'var(--color-ok)' }} />Accepted <b className={cx('num')}>{acc}</b></li>
        <li><i style={{ background: 'var(--color-crit)' }} />Flagged <b className={cx('num')}>{flagged}</b></li>
      </ul>
    </>
  )
}

/* ---------- Signal importance (three horizontal bars; replaces the radar, which is unreadable with three axes) ---------- */
function Importance({ rows }) {
  const avg = importanceAverage(rows)
  const max = Math.max(...avg.map((a) => a.value), 1)
  return (
    <>
      <ul className={cx('hbars')} aria-label="Average importance of each signal group">
        {avg.map((a) => (
          <li key={a.key}>
            <div className={cx('hbars__label')}><span>{a.label}</span><b className={cx('num')}>{a.value.toFixed(1)}%</b></div>
            <div className={cx('hbars__track')}><span style={{ width: `${(a.value / max) * 100}%`, background: 'var(--color-accent-text)' }} /></div>
          </li>
        ))}
      </ul>
      <p className={cx('text-xs', 'text-2')} style={{ marginTop: 12 }}>How much each group of signals contributed to scores, averaged over all submissions.</p>
    </>
  )
}

export function Charts({ rows, loading }) {
  const panel = (title, children, wide, extra) => (
    <div className={cx('insight', 'panel', wide && 'insight--wide')}>
      <div className={cx('panel__head')}><h2 className={cx('panel__title')}>{title}</h2>{extra}</div>
      <div className={cx('insight__body')}>{loading ? <Skeleton h={180} /> : children}</div>
    </div>
  )
  return (
    <section className={cx('area-insights', 'insights')} id="insights" aria-label="Charts">
      {panel('Fraud probability over time', <LineChart rows={rows} />, true, <span className={cx('pill', 'pill--plain')}>threshold 50%</span>)}
      {panel('Accepted vs flagged', <Donut rows={rows} />)}
      {panel('Signal importance', <Importance rows={rows} />)}
    </section>
  )
}

/* ---------- Photo quality ---------- */
export function PhotoQuality({ rows, loading }) {
  const q = useMemo(() => qualitySummary(rows), [rows])
  const max = q.flags[0]?.value || 1
  const stats = [['Avg photo quality', `${Math.round(q.avgQuality * 100)}/100`], ['Submitted anyway', q.overrides], ['Device report mismatch', q.mismatches], ['Duplicate photos', q.dupes]]
  return (
    <section className={cx('panel', 'area-quality')} id="quality" aria-labelledby="quality-title">
      <div className={cx('panel__head')}>
        <div><h2 className={cx('panel__title')} id="quality-title">Photo quality</h2><p className={cx('panel__sub')}>Where photos go wrong</p></div>
        <span className={cx('pill', 'pill--plain')}>server-measured</span>
      </div>
      {loading ? <div className={cx('quality')}><Skeleton h={140} /><Skeleton h={140} /></div> : (
        <div className={cx('quality')}>
          <div>
            <h3 className={cx('quality__h')}>Verdicts</h3>
            <div className={cx('vbar')} role="img" aria-label={`Photo verdict split: ${q.verdicts.map((v) => `${v.label} ${v.value}`).join(', ')}`}>
              {q.verdicts.filter((v) => v.value).map((v) => <i key={v.key} style={{ flex: v.value, background: TONE_COLOR[v.tone] }} title={`${v.label}: ${v.value}`} />)}
            </div>
            <ul className={cx('legend-list')}>{q.verdicts.map((v) => <li key={v.key}><i style={{ background: TONE_COLOR[v.tone] }} />{v.label} <b className={cx('num')}>{v.value}</b></li>)}</ul>
            <dl className={cx('qstats')}>{stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={cx('num')}>{v}</dd></div>)}</dl>
          </div>
          <div>
            <h3 className={cx('quality__h')}>Most common photo flags</h3>
            {q.flags.length ? (
              <ul className={cx('hbars')}>{q.flags.map((f) => <li key={f.key}><div className={cx('hbars__label')}><span>{f.label}</span><b className={cx('num')}>{f.value}</b></div><div className={cx('hbars__track')}><span style={{ width: `${(f.value / max) * 100}%`, background: KIND[f.kind]?.color ?? KIND.info.color }} /></div></li>)}</ul>
            ) : <EmptyState icon="image" title="No photo flags yet" />}
            <ul className={cx('legend-list')} style={{ marginTop: 12 }}>{Object.values(KIND).map((k) => <li key={k.label}><i style={{ background: k.color }} />{k.label}</li>)}</ul>
          </div>
        </div>
      )}
    </section>
  )
}
