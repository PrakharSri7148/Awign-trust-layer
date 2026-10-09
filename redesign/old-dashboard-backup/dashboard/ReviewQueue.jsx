import { ClipboardCheck } from 'lucide-react'
import { flagMeta, relTime } from '../../lib/format.js'
import { queueFrom, whyLabel } from '../../lib/reviews.js'

// Cases a human has to look at and nobody has yet: the first real labels come from here.
export default function ReviewQueue({ rows, onOpen, limit = 8 }) {
  const queue = queueFrom(rows.filter((r) => !String(r.id).startsWith('demo-')))
  return (
    <section className="panel" aria-label="Review queue" data-testid="review-queue">
      <div className="chart-title">
        <ClipboardCheck size={16} aria-hidden="true" /> Review queue <span className="num" data-testid="review-count">{queue.length}</span>
      </div>
      {queue.length === 0 ? (
        <p className="dim" style={{ fontSize: 13, margin: 0 }}>Nothing is waiting for a reviewer.</p>
      ) : (
        <ul className="rq">
          {queue.slice(0, limit).map((r) => (
            <li key={r.id}>
              <button type="button" className="rq__row" onClick={() => onOpen(r)}>
                <span className="mono text-cyan">#{r.id}</span>
                <span className="mono dim">{r.worker_id}</span>
                <span className="rq__why">{(r.review_reasons ?? []).map((x) => whyLabel(x, (f) => flagMeta(f).label)).join(' · ')}</span>
                <span className="dim">{relTime(r.timestamp)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {queue.length > limit && <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>+ {queue.length - limit} more (open them from the feed)</p>}
    </section>
  )
}
