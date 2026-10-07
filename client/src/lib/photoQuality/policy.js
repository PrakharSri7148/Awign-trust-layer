import { POLICY } from './config.js'
import { CHECK_IDS, STATUS, VERDICT } from './schema.js'

const RANK = { [STATUS.FAIL]: 0, [STATUS.WARN]: 1 }

// Turn per-check results into one verdict, an ordered issue list and a 0..1
// aggregate quality score.
export function aggregate(results, { policy = POLICY, task = {} } = {}) {
  const issues = []
  for (const r of results) {
    if (r.status !== STATUS.FAIL && r.status !== STATUS.WARN) continue
    let blockOnFail = policy[r.id]?.blockOnFail ?? false
    // A face that is only "optional" for this task never blocks.
    if (r.id === 'face' && task.face === 'optional') blockOnFail = false
    const blocking = r.status === STATUS.FAIL && blockOnFail
    issues.push({ id: r.id, status: r.status, blocking, hint: r.hint, score: r.score })
  }
  issues.sort(
    (a, b) =>
      Number(b.blocking) - Number(a.blocking) ||
      RANK[a.status] - RANK[b.status] ||
      CHECK_IDS.indexOf(a.id) - CHECK_IDS.indexOf(b.id),
  )

  const verdict = issues.some((i) => i.blocking)
    ? VERDICT.BLOCK
    : issues.length
      ? VERDICT.WARN
      : VERDICT.PASS

  const scores = results.filter((r) => r.status !== STATUS.SKIP && r.score != null).map((r) => r.score)
  const qualityScore = scores.length
    ? 0.5 * Math.min(...scores) + 0.5 * (scores.reduce((a, s) => a + s, 0) / scores.length)
    : 1

  return { verdict, issues, qualityScore }
}
