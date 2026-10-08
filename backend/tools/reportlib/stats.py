"""The report's maths: small, dependency-light (numpy only), seeded and unit-tested.

Conventions: "positive" = the thing a detector is trying to catch (a blurry photo, a spoof, a
fraudulent submission). `scores` are oriented so that HIGHER = more likely positive; callers flip
the sign of metrics where lower is worse.
"""
import math

import numpy as np

SMALL_N = 30  # fewer than this per class -> "indicative only"


def wilson(k, n, z=1.96):
    """Wilson score interval for a proportion k/n -> (low, high). (0, 1) when n == 0."""
    if n <= 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, centre - half), min(1.0, centre + half))


def rate(k, n):
    """A proportion with its Wilson interval, as a dict the renderer understands."""
    lo, hi = wilson(k, n)
    return {"k": int(k), "n": int(n), "value": (k / n) if n else None, "lo": lo, "hi": hi}


def confusion(y_true, y_pred):
    """Counts and rates from boolean arrays (True = positive). Rates carry Wilson 95% CIs."""
    t = np.asarray(y_true, dtype=bool)
    p = np.asarray(y_pred, dtype=bool)
    tp, fp = int((t & p).sum()), int((~t & p).sum())
    fn, tn = int((t & ~p).sum()), int((~t & ~p).sum())
    precision, recall, spec = rate(tp, tp + fp), rate(tp, tp + fn), rate(tn, tn + fp)
    pr, rc = precision["value"], recall["value"]
    f1 = None if pr is None or rc is None or pr + rc == 0 else 2 * pr * rc / (pr + rc)
    return {
        "tp": tp, "fp": fp, "fn": fn, "tn": tn, "n_pos": tp + fn, "n_neg": tn + fp,
        "precision": precision, "recall": recall, "specificity": spec,
        "false_positive_rate": rate(fp, fp + tn), "f1": f1,
        "accuracy": rate(tp + tn, tp + tn + fp + fn),
        "small_sample": (tp + fn) < SMALL_N or (tn + fp) < SMALL_N,
    }


def roc_auc(pos, neg):
    """P(random positive scores higher than random negative) with ties counted half (Mann-Whitney U)."""
    pos, neg = np.asarray(pos, dtype=float), np.asarray(neg, dtype=float)
    if not len(pos) or not len(neg):
        return float("nan")
    allv = np.concatenate([pos, neg])
    order = allv.argsort(kind="mergesort")
    ranks = np.empty(len(allv))
    sorted_v = allv[order]
    i = 0
    while i < len(sorted_v):  # average ranks over ties
        j = i
        while j + 1 < len(sorted_v) and sorted_v[j + 1] == sorted_v[i]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2 + 1
        i = j + 1
    u = ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2
    return float(u / (len(pos) * len(neg)))


def bootstrap_auc(pos, neg, n_boot=1000, seed=0, alpha=0.05):
    """AUC with a percentile bootstrap CI (each class resampled separately) -> (auc, lo, hi)."""
    pos, neg = np.asarray(pos, dtype=float), np.asarray(neg, dtype=float)
    auc = roc_auc(pos, neg)
    if math.isnan(auc):
        return auc, float("nan"), float("nan")
    rng = np.random.default_rng(seed)
    draws = [roc_auc(rng.choice(pos, len(pos)), rng.choice(neg, len(neg))) for _ in range(n_boot)]
    return auc, float(np.quantile(draws, alpha / 2)), float(np.quantile(draws, 1 - alpha / 2))


def sweep(pos, neg, thresholds, *, higher_is_positive=True):
    """Flag when score >= t (or <= t). One row per threshold: the false-flag rate on negatives (the
    'false block' rate when negatives are good photos), recall on positives, precision, F1."""
    pos, neg = np.asarray(pos, dtype=float), np.asarray(neg, dtype=float)
    rows = []
    for t in thresholds:
        flag = (lambda x: x >= t) if higher_is_positive else (lambda x: x <= t)
        tp, fp = int(flag(pos).sum()), int(flag(neg).sum())
        prec = tp / (tp + fp) if tp + fp else None
        rec = tp / len(pos) if len(pos) else None
        f1 = None if not prec or not rec else 2 * prec * rec / (prec + rec)
        rows.append({"t": float(t), "fpr": rate(fp, len(neg)), "recall": rate(tp, len(pos)), "precision": prec, "f1": f1})
    return rows


def brier(y, p):
    y, p = np.asarray(y, dtype=float), np.asarray(p, dtype=float)
    return float(((p - y) ** 2).mean())


def reliability(y, p, bins=10):
    """Calibration curve: per probability bin, mean predicted vs observed rate. Plus ECE."""
    y, p = np.asarray(y, dtype=float), np.asarray(p, dtype=float)
    idx = np.minimum((p * bins).astype(int), bins - 1)
    rows, ece = [], 0.0
    for b in range(bins):
        m = idx == b
        if not m.any():
            continue
        pm, ym = float(p[m].mean()), float(y[m].mean())
        rows.append({"bin": f"{b / bins:.1f}-{(b + 1) / bins:.1f}", "n": int(m.sum()), "mean_pred": pm, "observed": ym})
        ece += m.mean() * abs(pm - ym)
    return rows, float(ece)


def pad_metrics(bonafide_rejected, attacks_accepted):
    """ISO/IEC 30107-3 presentation-attack-detection errors.

    bonafide_rejected: list of bool, one per genuine attempt (True = wrongly rejected)
    attacks_accepted: {attack_type: list of bool} (True = attack wrongly accepted)
    BPCER = share of genuine attempts rejected; APCER_type = share of that attack type accepted;
    APCER (overall) = the WORST attack type, as the standard specifies; ACER = (APCER + BPCER) / 2.
    """
    bp = rate(sum(bonafide_rejected), len(bonafide_rejected))
    per = {k: rate(sum(v), len(v)) for k, v in attacks_accepted.items() if len(v)}
    worst = max(per.values(), key=lambda r: r["value"]) if per else None
    apcer = worst["value"] if worst else None
    acer = None if apcer is None or bp["value"] is None else (apcer + bp["value"]) / 2
    return {"bpcer": bp, "apcer_by_type": per, "apcer": apcer,
            "apcer_worst_type": next((k for k, v in per.items() if v is worst), None), "acer": acer}
