import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SCAN_LINES, SCAN_MARKS, SCAN_SLOW, finishingState, lineState, scanAnnouncement, scanNoteSentence, scanStage,
} from './scanProgress.js'

test('line 1 is active at the start, a new line every 650 ms', () => {
  assert.deepEqual(scanStage(0), { line: 1, finishing: false, slow: false })
  assert.equal(scanStage(649).line, 1)
  assert.equal(scanStage(650).line, 2)
  assert.equal(scanStage(1300).line, 3)
  assert.equal(scanStage(2600).line, 5)
})
test('after the fifth line has run for 650 ms every line is done and the card says "Finishing up…"', () => {
  assert.equal(scanStage(3249).finishing, false)
  assert.deepEqual(scanStage(3250), { line: 5, finishing: true, slow: false })
})
test('the slow line appears at 8 s and not before', () => {
  assert.equal(scanStage(7999).slow, false)
  assert.equal(scanStage(8000).slow, true)
  assert.equal(scanAnnouncement(scanStage(9000)), SCAN_SLOW)
})
test('line states: done above, active on the line, pending below; all done while finishing', () => {
  const s = scanStage(1300)
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => lineState(s, n)), ['done', 'done', 'active', 'pending', 'pending'])
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => lineState(scanStage(4000), n)), ['done', 'done', 'done', 'done', 'done'])
})
test('failure freezes the active line as "halt" and speaks nothing (the alert does)', () => {
  const s = scanStage(1300)
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => lineState(s, n, true)), ['done', 'done', 'halt', 'pending', 'pending'])
  assert.equal(scanAnnouncement(s, true), '')
  assert.equal(finishingState(scanStage(4000), true), 'halt')
  assert.equal(finishingState(s, true), 'off')
})
test('every change of what is on screen has a mark, and each mark gives a different announcement (nothing is spoken twice)', () => {
  const said = [scanAnnouncement(scanStage(0))]
  for (const ms of SCAN_MARKS) said.push(scanAnnouncement(scanStage(ms)))
  assert.equal(new Set(said).size, said.length)
  assert.equal(said.length, SCAN_LINES.length + 2) // 5 lines + "Finishing up…" is mark 6 of the lines; plus the slow line
  assert.ok(said[1].startsWith('Step 2 of 5: '))
})
test('the note sentence joins the notes with "; "', () => {
  assert.equal(scanNoteSentence(['GPS unavailable or denied']), 'Note: GPS unavailable or denied. Submitted anyway.')
  assert.equal(scanNoteSentence(['a', 'b', 'c']), 'Note: a; b; c. Submitted anyway.')
})
