from .config import CHECK_IDS, FAIL, POLICY, SKIP, V_BLOCK, V_PASS, V_WARN, WARN

_RANK = {FAIL: 0, WARN: 1}


def combine_scores(scores):
    """Overall quality: half the worst check, half the mean.
    KEEP IN SYNC with client/src/lib/photoQuality/policy.js::combineScores (a test pins both to 0.4 for [0.2, 0.6, 1.0])."""
    return 0.5 * min(scores) + 0.5 * (sum(scores) / len(scores)) if scores else 1.0


def aggregate(results, task=None, policy=None):
    policy = policy or POLICY
    task = task or {}
    issues = []
    for r in results:
        if r["status"] not in (FAIL, WARN):
            continue
        block_on_fail = policy.get(r["id"], {}).get("blockOnFail", False)
        if r["id"] in ("face", "liveness") and task.get("face") == "optional":
            block_on_fail = False
        issues.append({"id": r["id"], "status": r["status"], "blocking": r["status"] == FAIL and block_on_fail,
                       "hint": r["hint"], "score": r["score"]})
    issues.sort(key=lambda i: (not i["blocking"], _RANK[i["status"]],
                               CHECK_IDS.index(i["id"]) if i["id"] in CHECK_IDS else 99))
    verdict = V_BLOCK if any(i["blocking"] for i in issues) else V_WARN if issues else V_PASS
    scores = [r["score"] for r in results if r["status"] != SKIP and r["score"] is not None]
    quality = combine_scores(scores)
    return verdict, issues, quality
