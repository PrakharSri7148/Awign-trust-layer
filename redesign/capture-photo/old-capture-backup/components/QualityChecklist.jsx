import { Check, CircleX, TriangleAlert } from 'lucide-react'
import { fmtQuality } from '../../lib/photoQuality/display.js'
import { formatMetric } from '../../lib/format.js'
import { explainReport } from '../../lib/photoQuality/explain.js'
import { CHECK_IDS, CHECK_LABELS, STATUS, VERDICT } from '../../lib/photoQuality/schema.js'
import ChecksDebug from './ChecksDebug.jsx'

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
  const why = explainReport(report)
  const whyById = Object.fromEntries(why.map((w) => [w.id, w]))
  const blockers = why.filter((w) => w.blocking)

  return (
    <div className="qc">
      <div className="qc__head">
        <div className={`qc__title text-${tone}`}>{TITLES[report.verdict]}</div>
        <div className="eyebrow">Quality {fmtQuality(report.qualityScore)}</div>
      </div>
      {blockers.length > 0 && (
        <div className="qc__why" role="alert">
          <strong>Why this photo can't be submitted</strong>
          <ul>
            {blockers.map((b) => (
              <li key={b.id}>
                <span className="qc__why-label">{b.label}</span>
                {b.numbers ? ` · ${b.numbers}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="qc__list">
        {rows.map((id) => {
          const c = report.checks[id]
          const kind = c.status === STATUS.PASS ? 'ok' : blocking.has(id) ? 'bad' : 'warn'
          const Icon = kind === 'ok' ? Check : kind === 'bad' ? CircleX : TriangleAlert
          return (
            <li key={id} className={`qc__row qc__row--${kind}`}>
              <Icon size={16} aria-hidden="true" />
              <div className="qc__body">
                <span className="qc__label">
                  {CHECK_LABELS[id]}
                  {formatMetric(id, c) && <span className="qc__val num">{formatMetric(id, c)}</span>}
                </span>
                {c.hint && <span className="qc__hint">{c.hint}</span>}
                {whyById[id]?.numbers && <span className="qc__nums num">{whyById[id].numbers}</span>}
              </div>
              <span className="visually-hidden">{kind === 'ok' ? 'passed' : kind === 'bad' ? 'failed' : 'warning'}</span>
            </li>
          )
        })}
      </ul>
      <ChecksDebug report={report} />
    </div>
  )
}
