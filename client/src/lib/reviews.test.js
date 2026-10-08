import { test } from 'node:test'
import assert from 'node:assert/strict'
import { queueFrom, validateReview, whyLabel } from './reviews.js'

test('the queue holds only cases that need review, model-flagged first, then newest', () => {
  const rows = [
    { id: 1, needs_review: true, status: 'accepted', timestamp: '2026-10-07T10:00:00Z' },
    { id: 2, needs_review: false, status: 'flagged', timestamp: '2026-10-07T11:00:00Z' },
    { id: 3, needs_review: true, status: 'flagged', timestamp: '2026-10-07T09:00:00Z' },
    { id: 4, needs_review: true, status: 'accepted', timestamp: '2026-10-07T12:00:00Z' },
  ]
  assert.deepEqual(queueFrom(rows).map((r) => r.id), [3, 4, 1])
})

test('the form rule matches the server: a name, a decision, and a reason unless approving', () => {
  assert.match(validateReview({ reviewer: 'a', decision: 'approve' }), /name/)
  assert.match(validateReview({ reviewer: 'alice', decision: 'maybe' }), /Choose/)
  assert.match(validateReview({ reviewer: 'alice', decision: 'reject', reason: ' ' }), /why/i)
  assert.equal(validateReview({ reviewer: 'alice', decision: 'approve' }), null)
  assert.equal(validateReview({ reviewer: 'alice', decision: 'needs_retake', reason: 'too dark' }), null)
})

test('reasons read as words', () => {
  assert.equal(whyLabel('fraud_model'), 'Fraud model flagged it')
  assert.equal(whyLabel('spoof_suspected', (f) => `L:${f}`), 'L:spoof_suspected')
})
