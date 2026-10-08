// Reviewer workflow helpers (pure). The server validates the same rules (backend/reviews.py); this keeps the form honest.
export const DECISIONS = [
  { id: 'approve', label: 'Approve', help: 'The photo is fine; the flag was a false alarm.' },
  { id: 'reject', label: 'Reject', help: 'The submission is not valid (spoof, wrong photo, fraud).' },
  { id: 'needs_retake', label: 'Needs retake', help: 'Honest worker, unusable photo: ask for a new one.' },
]
export const decisionLabel = (id) => DECISIONS.find((d) => d.id === id)?.label ?? id

// Why a case is in the queue, in words.
const WHY = { fraud_model: 'Fraud model flagged it', photo_blocked: 'Photo blocked by the server check' }
export const whyLabel = (r, flagLabel = (f) => f) => WHY[r] ?? flagLabel(r)

// Cases that need a human and have none yet, model-flagged first then newest (the server already sets needs_review).
export function queueFrom(rows) {
  return rows
    .filter((r) => r.needs_review)
    .sort((a, b) => Number(b.status === 'flagged') - Number(a.status === 'flagged') || new Date(b.timestamp) - new Date(a.timestamp))
}

// -> error text or null
export function validateReview({ reviewer, decision, reason }) {
  const name = (reviewer ?? '').trim()
  if (name.length < 2 || name.length > 60) return 'Enter your name (2-60 characters).'
  if (!DECISIONS.some((d) => d.id === decision)) return 'Choose approve, reject or needs retake.'
  if (decision !== 'approve' && (reason ?? '').trim().length < 3) return 'Say why (a few words) when you reject or ask for a retake.'
  if ((reason ?? '').length > 1000) return 'The reason is too long (max 1000 characters).'
  return null
}
