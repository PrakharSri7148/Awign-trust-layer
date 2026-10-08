import { Check, Minus } from 'lucide-react'
import { fetchedSummary, NOT_AVAILABLE } from '../../lib/sensorFusion/display.js'

// "What was fetched": what the server received and used for this submission's sensor fusion, and what it could not get.
export default function FetchedPanel({ fusion }) {
  const rows = fetchedSummary(fusion)
  if (!rows) return null
  return (
    <div className="panel panel--tight" data-testid="fetched-panel">
      <div className="eyebrow eyebrow--cyan">What was fetched</div>
      <ul className="fetched">
        {rows.map((r) => (
          <li key={r.id} data-testid={`fetched-${r.id}`} className={r.tone ? `feed--${r.tone}` : r.ok ? '' : 'fetched--na'}>
            {r.ok ? <Check size={13} aria-hidden="true" /> : <Minus size={13} aria-hidden="true" />}
            <b>{r.label}</b>
            <span>{r.text}</span>
          </li>
        ))}
        {NOT_AVAILABLE.filter((n) => n.id === 'wifi' || n.id === 'cell' || n.id === 'mock').map((n) => (
          <li key={n.id} className="fetched--na">
            <Minus size={13} aria-hidden="true" />
            <b>{n.label}</b>
            <span>not available: {n.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
