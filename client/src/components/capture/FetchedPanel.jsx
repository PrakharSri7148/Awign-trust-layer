import { Check, ChevronDown, Minus, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { fetchedSummary, NOT_AVAILABLE } from '../../lib/sensorFusion/display.js'

function Row({ id, label, ok, text, tone }) {
  const kind = tone === 'red' ? 'bad' : ok ? 'ok' : 'na'
  const Icon = kind === 'bad' ? TriangleAlert : ok ? Check : Minus
  const word = kind === 'bad' ? 'Problem' : ok ? 'Received' : 'Not available'
  return (
    <li className={`cap-frow cap-frow--${kind}`} data-testid={`fetched-${id}`}>
      <span className="cap-frow__ic"><Icon size={16} className="cap-icon" aria-hidden="true" /></span>
      <b className="cap-frow__label">{label}<span className="cap-sr">: {word}</span></b>
      <span className="cap-frow__text">{text}</span>
    </li>
  )
}

// C3: "What was fetched": what the server received and used for this submission's sensor fusion, and what it could not get.
// Phones: collapsed behind "Details" (the two counts stay visible); desktop and tablet always show every row. Renders nothing without fusion.
export default function FetchedPanel({ fusion, phone }) {
  const rows = fetchedSummary(fusion)
  const [expanded, setExpanded] = useState(false)
  if (!rows) return null
  const open = !phone || expanded
  const got = rows.filter((r) => r.ok).length
  const na = rows.length - got + 3
  return (
    <section className="cap-card cap-vfet" aria-labelledby="vfet-h" data-testid="fetched-panel">
      <div className="cap-card__head">
        <h2 className="cap-eyebrow" id="vfet-h">What was fetched</h2>
        <button type="button" className={`cap-btn cap-btn--sm cap-vfet__toggle${open ? ' is-open' : ''}`} aria-expanded={open} aria-controls="vfet-list" onClick={() => setExpanded((e) => !e)}>
          Details<ChevronDown size={16} className="cap-icon cap-vfet__chev" aria-hidden="true" />
        </button>
      </div>
      <div className="cap-card__body">
        <div className="cap-vfet__sum">
          <span className="cap-pill cap-pill--pass"><Check size={12} className="cap-icon" aria-hidden="true" />{got} received</span>
          <span className="cap-pill cap-pill--skip"><Minus size={12} className="cap-icon" aria-hidden="true" />{na} not available</span>
        </div>
        <ul className="cap-frows" id="vfet-list" hidden={!open}>
          {rows.map((r) => <Row key={r.id} {...r} />)}
          {NOT_AVAILABLE.filter((n) => n.id === 'wifi' || n.id === 'cell' || n.id === 'mock').map((n) => (
            <Row key={n.id} id={n.id} label={n.label} ok={false} text={`not available: ${n.reason}`} />
          ))}
        </ul>
      </div>
    </section>
  )
}
