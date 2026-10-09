import { ArrowLeft, BrainCircuit, Check, CircleAlert, CircleDot, Clock, LoaderCircle, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  SCAN_FINISHING, SCAN_FINISHING_SUB, SCAN_LINES, SCAN_MARKS, SCAN_RETURNING, SCAN_SLOW, SCAN_WORD,
  finishingState, lineState, scanAnnouncement, scanNoteSentence, scanStage,
} from '../../lib/scanProgress.js'

const SEGMENTS = 20

// Step 3 of 4 (AI scan): the single card shown while the server re-checks the photo and scores the submission. No buttons: it moves on by itself
// (Capture.jsx keeps it up for at least MIN_ANALYSIS_MS and until the server answers). Design: redesign/capture-scan.
// `notes` = the unavailable sensor readings; `failure` = the "Submission failed: …" text while the failed scan is held on screen (SCAN_FAIL_HOLD_MS).
export default function ScanCard({ notes = [], photoUrl, taskLabel, failure = null }) {
  const failed = !!failure
  const [stage, setStage] = useState(() => scanStage(0))
  const [said, setSaid] = useState('')

  // The screen changes at fixed moments after it appeared, so no polling: one timeout per mark. A failure freezes whatever is showing.
  useEffect(() => {
    if (failed) return undefined
    const ids = SCAN_MARKS.map((ms) => setTimeout(() => setStage(scanStage(ms)), ms))
    return () => ids.forEach(clearTimeout)
  }, [failed])

  // One polite status region for the whole list. It is rendered empty and filled after mount, and its text only changes when the message does,
  // so every line is read once. The visible checklist itself is not a live region.
  useEffect(() => { setSaid(scanAnnouncement(stage, failed)) }, [stage, failed])

  const extra = finishingState(stage, failed)
  return (
    <section className={`cap-card cap-arr cap-scan${failed ? ' cap-card--fail' : ''}`} aria-labelledby="scan-title" aria-busy={!failed} data-testid="scan-card">
      <div className="cap-card__head">
        <div>
          <div className="cap-eyebrow"><BrainCircuit size={14} className="cap-icon" aria-hidden="true" />AI analysis</div>
          <h2 className="cap-card__title" id="scan-title">Neural scan in progress</h2>
        </div>
        {photoUrl && (
          <figure className="cap-thumb" role="img" aria-label="Your verified photo">
            <div className="cap-thumb__img"><img src={photoUrl} alt="" /></div>
            <span className="cap-thumb__badge" aria-hidden="true"><Check size={12} className="cap-icon" /></span>
          </figure>
        )}
      </div>
      <div className="cap-card__body">
        <div className="cap-scan__top">
          <span className={`cap-scanmark${failed ? ' cap-scanmark--stopped' : ''}`} aria-hidden="true">
            <svg className="cap-scanmark__svg" viewBox="0 0 64 64" focusable="false">
              <circle className="cap-scanmark__ring" cx="32" cy="32" r="30" />
              <circle className="cap-scanmark__arc" cx="32" cy="32" r="24" pathLength="100" />
              <circle className="cap-scanmark__ring cap-scanmark__ring--in" cx="32" cy="32" r="18" />
            </svg>
            <span className="cap-scanmark__core"><BrainCircuit size={18} className="cap-icon" /></span>
          </span>
          <div className="cap-scan__topbody">
            {taskLabel && <span className="cap-chip">{taskLabel}</span>}
            {/* indeterminate: no value, so role=progressbar without aria-valuenow (the Photo step's role=meter is for values that exist) */}
            <span className={`cap-meter cap-meter--20 cap-meter--busy${failed ? ' cap-meter--fail is-stopped' : ''}`} role="progressbar" aria-label={failed ? 'Scan stopped' : 'Scan in progress'}>
              {Array.from({ length: SEGMENTS }, (_, i) => <i key={i} className="cap-meter__cell" style={{ '--i': i }} />)}
            </span>
          </div>
        </div>

        <ol className="cap-steps" aria-label="Scan steps">
          {SCAN_LINES.map((text, i) => <ScanRow key={text} text={text} state={lineState(stage, i + 1, failed)} />)}
          {/* always in the layout (hidden until needed) so nothing below it jumps when it appears */}
          <ScanRow text={SCAN_FINISHING} sub={SCAN_FINISHING_SUB} state={extra} extra />
        </ol>

        {stage.slow && !failed && <p className="cap-scan__note"><Clock size={16} className="cap-icon" aria-hidden="true" /><span>{SCAN_SLOW}</span></p>}

        {failed && (
          <div className="cap-scan__fail">
            <div className="cap-banner cap-banner--error" role="alert">
              <CircleAlert size={18} className="cap-icon" aria-hidden="true" />
              <span className="cap-banner__text">{failure}</span>
            </div>
            <p className="cap-scan__note"><ArrowLeft size={16} className="cap-icon" aria-hidden="true" /><span>{SCAN_RETURNING}</span></p>
          </div>
        )}

        {notes.length > 0 && (
          <div className="cap-banner cap-banner--warn" role="note" data-testid="scan-notes">
            <ShieldAlert size={18} className="cap-icon" aria-hidden="true" />
            <span className="cap-banner__text">{scanNoteSentence(notes)}</span>
          </div>
        )}
      </div>
      <p className="cap-sr" role="status" aria-live="polite" aria-atomic="true">{said}</p>
    </section>
  )
}

function ScanRow({ text, sub, state, extra = false }) {
  const off = state === 'off'
  return (
    <li className={`cap-step cap-step--${state}${extra ? ' cap-step--extra' : ''}`} aria-current={state === 'active' ? 'step' : undefined} aria-hidden={off || undefined} data-state={state}>
      <span className="cap-step__icon">
        {state === 'done' && <Check size={14} className="cap-icon" aria-hidden="true" />}
        {state === 'active' && (
          <>
            <span className="cap-step__spin"><LoaderCircle size={16} className="cap-icon cap-spin" aria-hidden="true" /></span>
            <span className="cap-step__still"><CircleDot size={16} className="cap-icon" aria-hidden="true" /></span>
          </>
        )}
        {state === 'halt' && <CircleAlert size={16} className="cap-icon" aria-hidden="true" />}
      </span>
      <span className="cap-step__body">
        <span className="cap-step__text">{text}</span>
        {extra && state === 'active' && <span className="cap-step__sub">{sub}</span>}
      </span>
      <span className="cap-step__word">{off ? '' : SCAN_WORD[state]}</span>
    </li>
  )
}

