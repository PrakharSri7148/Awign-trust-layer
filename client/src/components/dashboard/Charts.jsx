import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, PolarAngleAxis, PolarGrid, Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FACTORS } from '../../lib/format.js'

const AXIS = { fill: '#8190ab', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }

function Tip({ active, payload, label, unit = '%' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rc-tip">
      {label && <div className="faint">{label}</div>}
      {payload.map((p) => (
        <div key={p.name ?? p.dataKey}>
          {p.name ?? p.dataKey}: <b>{Number(p.value).toFixed(1)}{unit}</b>
        </div>
      ))}
    </div>
  )
}

export default function Charts({ rows }) {
  const flagged = rows.filter((r) => r.status === 'flagged').length
  const accepted = rows.length - flagged

  const series = [...rows]
    .reverse()
    .slice(-60)
    .map((r) => ({
      t: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      p: r.fraud_probability * 100,
    }))

  const donut = [
    { name: 'Accepted', value: accepted, color: '#34d399' },
    { name: 'Flagged', value: flagged, color: '#fb4b5c' },
  ]

  const radar = FACTORS.map((f) => ({
    factor: f.label.split(' ')[0],
    v: rows.length ? (rows.reduce((a, r) => a + (r.feature_importances?.[f.key] ?? 0), 0) / rows.length) * 100 : 0,
  }))

  return (
    <section className="charts" aria-label="Charts">
      <div className="panel">
        <div className="chart-title">
          <h3>Fraud probability over time</h3>
          <span className="chip">threshold 50%</span>
        </div>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="t" tick={AXIS} tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} unit="%" />
              <Tooltip content={<Tip />} cursor={{ stroke: 'rgba(34,211,238,0.4)' }} />
              <ReferenceLine y={50} stroke="#fbbf24" strokeDasharray="5 4" />
              <Area type="monotone" dataKey="p" name="Fraud prob." stroke="#22d3ee" strokeWidth={2} fill="url(#gp)" isAnimationActive />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <div className="chart-title"><h3>Accepted vs flagged</h3></div>
        <div className="chart-box donut-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={donut} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="86%" paddingAngle={rows.length ? 3 : 0} stroke="none">
                {donut.map((d) => <Cell key={d.name} fill={d.color} />)}
              </Pie>
              <Tooltip content={<Tip unit="" />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center">
            <div className="kpi__value num">{rows.length ? Math.round((flagged / rows.length) * 100) : 0}%</div>
            <div className="eyebrow">flagged</div>
          </div>
        </div>
        <div className="legend">
          {donut.map((d) => <span key={d.name}><i style={{ background: d.color }} />{d.name} {d.value}</span>)}
        </div>
      </div>

      <div className="panel">
        <div className="chart-title"><h3>Signal importance</h3></div>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radar} outerRadius="72%">
              <PolarGrid stroke="rgba(255,255,255,0.12)" />
              <PolarAngleAxis dataKey="factor" tick={{ ...AXIS, fontSize: 11 }} />
              <Radar dataKey="v" name="Avg importance" stroke="#22d3ee" strokeWidth={2} fill="#22d3ee" fillOpacity={0.25} />
              <Tooltip content={<Tip />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  )
}
