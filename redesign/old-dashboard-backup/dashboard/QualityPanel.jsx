import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { VERDICT_META, flagMeta } from '../../lib/format.js'

const AXIS = { fill: '#8190ab', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }
const TONE = { green: '#34d399', amber: '#fbbf24', red: '#fb4b5c', muted: '#8190ab' }
const KIND_COLOR = { quality: '#fbbf24', integrity: '#fb4b5c', info: '#8190ab' }

// Where photos go wrong: the verdict split, the most common problems, and the signals
// that say a photo's story may not hold up.
export default function QualityPanel({ rows }) {
  const n = rows.length
  const verdicts = Object.keys(VERDICT_META).map((v) => ({
    key: v,
    name: VERDICT_META[v].label,
    value: rows.filter((r) => (r.photo_verdict ?? 'unverified') === v).length,
    color: TONE[VERDICT_META[v].tone],
  }))

  const counts = {}
  rows.forEach((r) => (r.quality_flags ?? []).forEach((f) => (counts[f] = (counts[f] ?? 0) + 1)))
  const flags = Object.entries(counts)
    .map(([f, value]) => ({ f, name: flagMeta(f).label, kind: flagMeta(f).kind, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  const overrides = rows.filter((r) => r.photo_override).length
  const mismatches = rows.filter((r) => r.client_mismatch).length
  const dupes = rows.filter((r) => (r.quality_flags ?? []).some((f) => f.includes('duplicate'))).length
  const avg = n ? rows.reduce((a, r) => a + (r.photo_quality_score ?? 0), 0) / n : 0

  const stats = [
    ['Avg photo quality', `${(avg * 100).toFixed(0)}/100`],
    ['Submitted anyway', overrides],
    ['Device report mismatch', mismatches],
    ['Duplicate photos', dupes],
  ]

  return (
    <section className="panel" aria-label="Photo quality">
      <div className="chart-title">
        <h3>Photo quality</h3>
        <span className="chip">server-measured</span>
      </div>
      <div className="qpanel">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Verdicts</div>
          <div className="vbar" role="img" aria-label="Photo verdict split">
            {verdicts.filter((v) => v.value).map((v) => <i key={v.key} style={{ flex: v.value, background: v.color }} title={`${v.name}: ${v.value}`} />)}
          </div>
          <div className="legend">
            {verdicts.map((v) => <span key={v.key}><i style={{ background: v.color }} />{v.name} {v.value}</span>)}
          </div>
          <div className="qstats">
            {stats.map(([k, v]) => (
              <div key={k}>
                <div className="eyebrow">{k}</div>
                <div className="num qstats__v">{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Most common photo flags</div>
          {flags.length === 0 ? (
            <div className="faint" style={{ fontSize: 13, padding: '24px 0' }}>No photo flags yet.</div>
          ) : (
            <div style={{ height: Math.max(120, flags.length * 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flags} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                  <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={170} tick={AXIS} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={{ background: '#0a0f1c', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }} />
                  <Bar dataKey="value" name="Submissions" radius={[0, 4, 4, 0]}>
                    {flags.map((d) => <Cell key={d.f} fill={KIND_COLOR[d.kind]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="legend">
            <span><i style={{ background: KIND_COLOR.quality }} />Photo problem</span>
            <span><i style={{ background: KIND_COLOR.integrity }} />Integrity concern</span>
            <span><i style={{ background: KIND_COLOR.info }} />Context</span>
          </div>
        </div>
      </div>
    </section>
  )
}
