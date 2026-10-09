import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../../lib/api.js'
import { authHeaders } from '../../lib/auth.js'
import { DECISIONS, validateReview } from '../../lib/reviews.js'
import { decisionMeta, isDemoRow } from '../../lib/dashboard/model.js'
import { readReviewer, saveReviewer } from './hooks.js'
import { Icon, cx, fmtDateTime } from './ui.jsx'

const ICON = { approve: 'circle-check', reject: 'circle-x', needs_retake: 'rotate-ccw' }

// Pinned at the bottom of the case file. Decide: approve / reject / needs retake, with a reason; stored with the reviewer's name and the time.
// The name is self-declared (NOT authentication): who may review is a deployment decision (REVIEWERS / a gateway).
export default function DecisionBar({ row, review, onSaved, initialDecision }) {
  const [reviewer, setReviewer] = useState(readReviewer)
  const [decision, setDecision] = useState(initialDecision ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const reasonRef = useRef(null)
  const demo = isDemoRow(row)

  useEffect(() => { if (initialDecision && initialDecision !== 'approve') reasonRef.current?.focus() }, [initialDecision])

  async function save(e) {
    e.preventDefault()
    const bad = validateReview({ reviewer, decision, reason })
    if (bad) { setError(bad); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/submissions/${row.id}/review`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ reviewer: reviewer.trim(), decision, reason }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `Server responded ${res.status}`)
      const d = await res.json()
      saveReviewer(reviewer.trim())
      setDecision('')
      setReason('')
      onSaved(d.review)
    } catch (err) {
      setError(String(err.message))
    } finally {
      setBusy(false)
    }
  }

  if (demo) {
    return <div className={cx('decision-bar')} data-testid="review-section"><p className={cx('text-2', 'text-sm')}>This is a demo case, so it cannot be reviewed. Turn demo data off in Settings to work on real submissions.</p></div>
  }

  return (
    <form className={cx('decision-bar', 'rv')} onSubmit={save} data-testid="review-section" aria-label="Decision" noValidate>
      {review ? (
        <p className={cx('decision-bar__current')} data-testid="review-current">
          <b>{decisionMeta(review.decision).label}</b> by {review.reviewer}, {fmtDateTime(review.at)}{review.reason ? <span className={cx('text-2')}> · “{review.reason}”</span> : null}
        </p>
      ) : (
        <p className={cx('decision-bar__current', 'text-2')}>{row.needs_review ? 'Waiting for a reviewer.' : 'Not reviewed.'}</p>
      )}
      <div className={cx('decision-bar__choices')} role="radiogroup" aria-label="Decision">
        {DECISIONS.map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={decision === d.id} data-testid={`review-choice-${d.id}`} data-decision={d.id} className={cx('decision-choice')} title={d.help}
            tabIndex={decision === d.id || (!decision && d.id === 'approve') ? 0 : -1} onClick={() => { setDecision(d.id); setError(null) }}>
            <Icon name={ICON[d.id]} />{d.label}
          </button>
        ))}
      </div>
      <div className={cx('decision-bar__row')}>
        <div className={cx('field')} style={{ flex: '0 0 36%' }}>
          <label className={cx('sr-only')} htmlFor="decision-name">Your name</label>
          <input id="decision-name" data-testid="review-name" className={cx('input')} value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={60} autoComplete="name" placeholder="Your name" />
        </div>
        <div className={cx('field')}>
          <label className={cx('sr-only')} htmlFor="decision-reason">Reason</label>
          <textarea id="decision-reason" ref={reasonRef} data-testid="review-reason" className={cx('textarea')} rows={1} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000}
            placeholder={`Reason${decision && decision !== 'approve' ? ' (required)' : ' (required for reject and retake)'}`} />
        </div>
      </div>
      {error && <div className={cx('field__error', 'banner')} role="alert" data-testid="review-error"><Icon name="circle-alert" />{error}</div>}
      <button type="submit" data-testid="review-submit" className={cx('btn', 'btn--primary', 'btn--block')} disabled={busy}>{busy ? 'Saving…' : review ? 'Record another decision' : 'Record decision'}</button>
    </form>
  )
}
