import { useEffect, useState } from 'react'
import { API_BASE } from '../../lib/api.js'
import { authHeaders } from '../../lib/auth.js'
import { DECISIONS, decisionLabel, validateReview } from '../../lib/reviews.js'

const NAME_KEY = 'tl.reviewer'
const readName = () => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }
const saveName = (n) => { try { localStorage.setItem(NAME_KEY, n) } catch { /* blocked */ } }

// Decide on a case: approve / reject / needs retake, with a reason. Stored with the reviewer's name and the time.
// The name is self-declared (NOT authentication): who may review is a deployment decision (REVIEWERS / a gateway).
export default function ReviewSection({ row, onDone }) {
  const [review, setReview] = useState(row.review ?? null)
  const [history, setHistory] = useState([])
  const [reviewer, setReviewer] = useState(readName)
  const [decision, setDecision] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const isDemo = String(row.id).startsWith('demo-')

  useEffect(() => {
    if (isDemo) return
    let alive = true
    fetch(`${API_BASE}/submissions/${row.id}/reviews`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : [])).then((h) => alive && setHistory(h)).catch(() => {})
    return () => { alive = false }
  }, [row.id, review, isDemo])

  async function save(e) {
    e.preventDefault()
    const bad = validateReview({ reviewer, decision, reason })
    if (bad) return setError(bad)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/submissions/${row.id}/review`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ reviewer: reviewer.trim(), decision, reason }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `Server responded ${res.status}`)
      const d = await res.json()
      saveName(reviewer.trim())
      setReview(d.review)
      setDecision('')
      setReason('')
      onDone?.()
    } catch (err) {
      setError(String(err.message))
    } finally {
      setBusy(false)
    }
  }

  if (isDemo) return null
  return (
    <section className="panel panel--tight" data-testid="review-section" aria-label="Review">
      <div className="eyebrow eyebrow--cyan">Review</div>
      {review ? (
        <p style={{ margin: '6px 0 0' }} data-testid="review-current">
          <b>{decisionLabel(review.decision)}</b> by {review.reviewer}, {new Date(review.at).toLocaleString()}
          {review.reason ? <span className="dim"> · “{review.reason}”</span> : null}
        </p>
      ) : (
        <p className="dim" style={{ fontSize: 13, margin: '6px 0 0' }}>{row.needs_review ? 'Waiting for a reviewer.' : 'Not reviewed.'}</p>
      )}
      <form onSubmit={save} className="rv">
        <label className="rv__field">Your name<input value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={60} autoComplete="name" /></label>
        <div className="rv__choices" role="radiogroup" aria-label="Decision">
          {DECISIONS.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={decision === d.id} className={`btn btn--sm${decision === d.id ? ' btn--primary' : ''}`} title={d.help} onClick={() => setDecision(d.id)}>{d.label}</button>
          ))}
        </div>
        <label className="rv__field">Reason{decision && decision !== 'approve' ? ' (required)' : ''}<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} /></label>
        {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>{busy ? 'Saving…' : review ? 'Record another decision' : 'Record decision'}</button>
      </form>
      {history.length > 1 && (
        <ul className="faint rv__hist">
          {history.slice(0, -1).reverse().map((h) => <li key={h.id}>{decisionLabel(h.decision)} by {h.reviewer} · {new Date(h.at).toLocaleString()}</li>)}
        </ul>
      )}
    </section>
  )
}
