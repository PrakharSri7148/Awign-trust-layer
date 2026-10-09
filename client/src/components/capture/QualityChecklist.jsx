import { Check, CircleCheck, CircleX, RotateCcw, Send, TriangleAlert } from 'lucide-react'
import { fmtQuality } from '../../lib/photoQuality/display.js'
import { formatMetric } from '../../lib/format.js'
import { explainReport } from '../../lib/photoQuality/explain.js'
import { CHECK_IDS, CHECK_LABELS, STATUS, VERDICT } from '../../lib/photoQuality/schema.js'
import ChecksDebug from './ChecksDebug.jsx'
import { Accordion } from './ui.jsx'

const TITLES = {
  [VERDICT.PASS]: 'Photo verified',
  [VERDICT.WARN]: 'Photo accepted with warnings',
  [VERDICT.BLOCK]: 'Photo needs a retake',
}

// The result card after a photo: verdict, quality, why it is blocked, one row per check that ran (failing ones first, the
// passing ones in an accordion), the arrival hint and the actions. A failing check that does not block submission is shown
// amber (a flag); only blocking failures are red. A blocked card shakes once.
export default function QualityChecklist({ report, recording = false, onSend, onRetake, shake = false }) {
  const blocking = new Set(report.issues.filter((i) => i.blocking).map((i) => i.id))
  const ids = CHECK_IDS.filter((id) => report.checks[id] && report.checks[id].status !== STATUS.SKIP)
  const why = explainReport(report)
  const whyById = Object.fromEntries(why.map((w) => [w.id, w]))
  const blockers = why.filter((w) => w.blocking)
  const blocked = report.verdict === VERDICT.BLOCK
  const warned = report.verdict === VERDICT.WARN
  const tone = report.verdict === VERDICT.PASS ? 'ok' : warned ? 'warn' : 'fail'
  const TitleIcon = report.verdict === VERDICT.PASS ? CircleCheck : warned ? TriangleAlert : CircleX
  const attention = ids.filter((id) => report.checks[id].status !== STATUS.PASS)
  const passed = ids.filter((id) => report.checks[id].status === STATUS.PASS)
  const quality = fmtQuality(report.qualityScore).replace('%', '')

  const row = (id) => {
    const c = report.checks[id]
    const kind = c.status === STATUS.PASS ? 'ok' : blocking.has(id) ? 'bad' : 'warn'
    const Icon = kind === 'ok' ? Check : kind === 'bad' ? CircleX : TriangleAlert
    return (
      <li key={id} className={`cap-check cap-check--${kind}`}>
        <Icon size={18} className="cap-icon" aria-hidden="true" />
        <div>
          <div className="cap-check__line">
            <span className="cap-check__label">{CHECK_LABELS[id]}</span>
            {formatMetric(id, c) && <span className="cap-check__val">{formatMetric(id, c)}</span>}
          </div>
          {c.hint && <div className="cap-check__hint">{c.hint}</div>}
          {whyById[id]?.numbers && <div className="cap-check__nums">{whyById[id].numbers}</div>}
        </div>
        <span className="cap-sr">{kind === 'ok' ? 'passed' : kind === 'bad' ? 'failed' : 'warning'}</span>
      </li>
    )
  }

  return (
    <section className={`cap-card cap-card--${tone} cap-result cap-result--${report.verdict}${shake && blocked ? ' cap-shake' : ''}`} aria-label="Photo result" key={blocked ? 'b' : 'n'}>
      <div className="cap-card__head">
        <div>
          <div className="cap-eyebrow">Photo result</div>
          <h2 className="cap-result__title"><TitleIcon size={20} className="cap-icon" aria-hidden="true" /><span data-testid="result-title">{TITLES[report.verdict]}</span></h2>
        </div>
        <div className="cap-kpi cap-kpi--sm" style={{ textAlign: 'right' }}>
          <span className="cap-kpi__label">Quality</span>
          <b className="cap-kpi__value">{quality}<small>%</small></b>
        </div>
      </div>
      <div className="cap-card__body">
        {blockers.length > 0 && (
          <div className="cap-why" role="alert">
            <strong><CircleX size={16} className="cap-icon" aria-hidden="true" />Why this photo can't be submitted</strong>
            <ul>
              {blockers.map((b) => (
                <li key={b.id}>
                  <span className="cap-why__label">{b.label}</span>
                  {b.numbers ? ` · ${b.numbers}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="cap-checklist">
          {attention.length > 0 && <ul className="cap-checks">{attention.map(row)}</ul>}
          {passed.length > 0 && (
            <Accordion title="Passed checks" meta={`(${passed.length})`} defaultOpen={attention.length === 0} flat>
              <ul className="cap-checks">{passed.map(row)}</ul>
            </Accordion>
          )}
        </div>
        <ChecksDebug report={report} />
        {!blocked && (
          <p className="cap-result__hint" data-testid="arrival-hint">
            Photo checked. When you are standing at the site, tap the button: we then send your GPS location{recording ? ' and the movement recorded on the way' : ''} and verify you reached it.
            {!recording && ' (Without the visit recording only your location can be checked.)'}
          </p>
        )}
        <div className="cap-result__actions cap-result__actions--sticky">
          {!blocked && (
            <button type="button" className="cap-btn cap-btn--primary cap-btn--lg cap-btn--block" onClick={onSend} data-testid="arrived-btn">
              <Send size={16} className="cap-icon" aria-hidden="true" /> {warned ? "I've reached the site · send location anyway" : "I've reached the site · send my location"}
            </button>
          )}
          <button type="button" className={`cap-btn ${blocked ? 'cap-btn--primary ' : ''}cap-btn--lg cap-btn--block`} onClick={onRetake}>
            <RotateCcw size={16} className="cap-icon" aria-hidden="true" /> Retake
          </button>
        </div>
      </div>
    </section>
  )
}
