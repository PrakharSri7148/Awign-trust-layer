import { POLICY } from './config.js'
import { CHECK_IDS, STATUS, VERDICT } from './schema.js'

// Overall quality from per-check scores: half the worst, half the mean (one bad check should
// drag the overall down, but not to zero). The live HUD uses the same function.
// KEEP IN SYNC with backend/photo_quality/policy.py::combine_scores (a test pins both to 0.4
// for [0.2, 0.6, 1.0]).
export function combineScores(scores) {
  if (!scores.length) return 1
  return 0.5 * Math.min(...scores) + 0.5 * (scores.reduce((a, s) => a + s, 0) / scores.length)
}

const RANK = { [STATUS.FAIL]: 0, [STATUS.WARN]: 1 }

// Turn per-check results into one verdict, an ordered issue list and a 0..1
// aggregate quality score.
export function aggregate(results, { policy = POLICY, task = {} } = {}) {
  const issues = []
  for (const r of results) {
    if (r.status !== STATUS.FAIL && r.status !== STATUS.WARN) continue
    let blockOnFail = policy[r.id]?.blockOnFail ?? false
    // A face (and its liveness check) that is only "optional" for this task never blocks.
    if ((r.id === 'face' || r.id === 'liveness') && task.face === 'optional') blockOnFail = false
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
  const qualityScore = combineScores(scores)

  return { verdict, issues, qualityScore }
}
