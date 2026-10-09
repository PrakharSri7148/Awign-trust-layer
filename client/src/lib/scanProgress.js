// Timing and wording of the AI scan step (step 3 of 4). Pure, so it is unit-tested; the card only draws it. Design: redesign/capture-scan.
// The checklist is time-paced like the old terminal (a new line every 650 ms), NOT reported by the server: after the last line the card
// says "Finishing up…" and waits for the answer. The minimum on-screen time (MIN_ANALYSIS_MS) stays in Capture.jsx.

export const SCAN_LINES = [
  'Comparing the GPS trail with the phone\'s movement…',
  'Checking the network against the site…',
  'Re-checking the photo on the server…',
  'Running gradient-boosting classifier…',
  'Computing SHAP explanation…',
]
export const SCAN_LINE_MS = 650
export const SCAN_SLOW_MS = 8000 // after this long without an answer a quiet "still working" line appears
export const SCAN_FAIL_HOLD_MS = 1600 // a failed submission is shown this long before the Photo step opens

export const SCAN_FINISHING = 'Finishing up…'
export const SCAN_FINISHING_SUB = 'Waiting for the server’s answer.'
export const SCAN_SLOW = 'Still working. This can take a moment on a slow connection.'
export const SCAN_RETURNING = 'Going back to the Photo step…'
export const SCAN_WORD = { done: 'Done', active: 'Running', pending: 'Waiting', halt: 'Stopped' }

// The moments (ms after the scan starts) at which what is on screen changes: each new active line, "Finishing up…" (one line-time after
// the last line became active), and the slow-server line.
export const SCAN_MARKS = [...SCAN_LINES.map((_, i) => (i + 1) * SCAN_LINE_MS), SCAN_SLOW_MS]

// What is on screen `elapsedMs` after the scan started: the active line (1-based), whether every line is done, whether it is slow.
export function scanStage(elapsedMs) {
  const step = Math.floor(Math.max(0, elapsedMs) / SCAN_LINE_MS)
  return { line: Math.min(SCAN_LINES.length, step + 1), finishing: step >= SCAN_LINES.length, slow: elapsedMs >= SCAN_SLOW_MS }
}

// State of line n (1-based): 'done' | 'active' | 'pending' | 'halt' (the line the screen froze on when the submission failed).
export function lineState(stage, n, failed = false) {
  if (stage.finishing || n < stage.line) return 'done'
  if (n === stage.line) return failed ? 'halt' : 'active'
  return 'pending'
}

// State of the "Finishing up…" row: 'off' (not shown yet) | 'active' | 'halt'.
export function finishingState(stage, failed = false) {
  if (!stage.finishing) return 'off'
  return failed ? 'halt' : 'active'
}

// The one message a screen reader hears for this stage (spoken once, when it changes). Failure speaks through the alert banner instead.
export function scanAnnouncement(stage, failed = false) {
  if (failed) return ''
  if (stage.slow) return SCAN_SLOW
  if (stage.finishing) return `${SCAN_FINISHING} ${SCAN_FINISHING_SUB}`
  return `Step ${stage.line} of ${SCAN_LINES.length}: ${SCAN_LINES[stage.line - 1]}`
}

// The sentence under the scan when a reading was unavailable (same words as the Arrival notice and the verdict).
export const scanNoteSentence = (notes) => `Note: ${notes.join('; ')}. Submitted anyway.`
