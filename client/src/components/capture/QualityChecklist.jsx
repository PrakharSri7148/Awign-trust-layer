import { Check, CircleX, TriangleAlert } from 'lucide-react'
import { CHECK_IDS, CHECK_LABELS, STATUS, VERDICT } from '../../lib/photoQuality/schema.js'

const TITLES = {
  [VERDICT.PASS]: 'Photo verified',
  [VERDICT.WARN]: 'Photo accepted with warnings',
  [VERDICT.BLOCK]: 'Photo needs a retake',
}

// One row per check that ran. A failing check that does not block submission is
// shown amber (a flag), only blocking failures are red.
export default function QualityChecklist({ report }) {
  const blocking = new Set(report.issues.filter((i) => i.blocking).map((i) => i.id))
  const rows = CHECK_IDS.filter((id) => report.checks[id] && report.checks[id].status !== STATUS.SKIP)
  const tone = report.verdict === VERDICT.PASS ? 'green' : report.verdict === VERDICT.WARN ? 'amber' : 'red'

  return (
    <div className="qc">
      <div className="qc__head">
        <div className={`qc__title text-${tone}`}>{TITLES[report.verdict]}</div>
        <div className="eyebrow">quality {(report.qualityScore * 100).toFixed(0)}/100</div>
      </div>
      <ul className="qc__list">
        {rows.map((id) => {
          const c = report.checks[id]
          const kind = c.status === STATUS.PASS ? 'ok' : blocking.has(id) ? 'bad' : 'warn'
          const Icon = kind === 'ok' ? Check : kind === 'bad' ? CircleX : TriangleAlert
          return (
            <li key={id} className={`qc__row qc__row--${kind}`}>
              <Icon size={16} aria-hidden="true" />
              <div className="qc__body">
                <span className="qc__label">{CHECK_LABELS[id]}</span>
                {c.hint && <span className="qc__hint">{c.hint}</span>}
              </div>
              <span className="visually-hidden">{kind === 'ok' ? 'passed' : kind === 'bad' ? 'failed' : 'warning'}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
