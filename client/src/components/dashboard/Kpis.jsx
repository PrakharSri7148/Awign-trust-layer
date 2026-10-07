import CountUp from '../ui/CountUp.jsx'
import Spark from '../ui/Spark.jsx'

export default function Kpis({ rows }) {
  const total = rows.length
  const flagged = rows.filter((r) => r.status === 'flagged').length
  const accepted = total - flagged
  const rate = total ? (flagged / total) * 100 : 0
  const avg = total ? (rows.reduce((a, r) => a + r.fraud_probability, 0) / total) * 100 : 0

  // Cumulative series over the 24 most recent submissions (oldest first).
  const asc = [...rows].reverse().slice(-24)
  let f = 0
  let p = 0
  const series = { total: [], flagged: [], accepted: [], rate: [], avg: [] }
  asc.forEach((r, i) => {
    if (r.status === 'flagged') f++
    p += r.fraud_probability
    series.total.push(i + 1)
    series.flagged.push(f)
    series.accepted.push(i + 1 - f)
    series.rate.push((f / (i + 1)) * 100)
    series.avg.push((p / (i + 1)) * 100)
  })

  const items = [
    { label: 'Total submissions', node: <CountUp to={total} />, spark: series.total, color: '#22d3ee' },
    { label: 'Flagged', node: <CountUp to={flagged} />, spark: series.flagged, color: '#fb4b5c', tone: 'text-red' },
    { label: 'Accepted', node: <CountUp to={accepted} />, spark: series.accepted, color: '#34d399', tone: 'text-green' },
    { label: 'Flag rate', node: <CountUp to={rate} decimals={1} suffix="%" />, spark: series.rate, color: '#fbbf24' },
    { label: 'Avg fraud prob.', node: <CountUp to={avg} decimals={1} suffix="%" />, spark: series.avg, color: '#8b5cf6' },
  ]

  return (
    <section className="kpis" aria-label="Key metrics">
      {items.map((k) => (
        <div key={k.label} className="panel kpi">
          <div className="eyebrow">{k.label}</div>
          <div className={`kpi__value ${k.tone ?? ''}`}>{k.node}</div>
          <Spark values={k.spark} color={k.color} />
        </div>
      ))}
    </section>
  )
}
