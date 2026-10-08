import math

import numpy as np
import pytest

from tools.reportlib import stats


def test_wilson_matches_known_values():
    lo, hi = stats.wilson(8, 10)  # textbook: 0.4902 .. 0.9433
    assert lo == pytest.approx(0.4902, abs=1e-3) and hi == pytest.approx(0.9433, abs=1e-3)
    assert stats.wilson(0, 10)[0] == 0.0 and stats.wilson(10, 10)[1] == 1.0
    assert stats.wilson(0, 0) == (0.0, 1.0)
    lo0, hi0 = stats.wilson(0, 100)
    assert lo0 == 0.0 and 0.03 < hi0 < 0.04  # "0 of 100" still allows ~3.7% (never claim a perfect 0%)


def test_confusion_toy_set():
    t = [1, 1, 1, 1, 0, 0, 0, 0, 0, 0]
    p = [1, 1, 1, 0, 1, 0, 0, 0, 0, 0]
    c = stats.confusion(t, p)
    assert (c["tp"], c["fp"], c["fn"], c["tn"]) == (3, 1, 1, 5)
    assert c["precision"]["value"] == pytest.approx(0.75) and c["recall"]["value"] == pytest.approx(0.75)
    assert c["specificity"]["value"] == pytest.approx(5 / 6) and c["f1"] == pytest.approx(0.75)
    assert c["small_sample"] is True  # 4 and 6 are far below 30
    lo, hi = c["recall"]["lo"], c["recall"]["hi"]
    assert lo < 0.75 < hi


def test_confusion_degenerate_cases_do_not_divide_by_zero():
    c = stats.confusion([0, 0, 0], [0, 0, 0])
    assert c["precision"]["value"] is None and c["recall"]["value"] is None and c["f1"] is None


def test_auc_perfect_random_inverted_and_ties():
    assert stats.roc_auc([3, 4, 5], [0, 1, 2]) == 1.0
    assert stats.roc_auc([0, 1, 2], [3, 4, 5]) == 0.0
    assert stats.roc_auc([1, 1], [1, 1]) == 0.5
    assert stats.roc_auc([2, 3], [1, 2]) == pytest.approx(0.875)  # 3 wins + 1 tie of 4 pairs = 3.5/4
    assert math.isnan(stats.roc_auc([], [1]))


def test_auc_agrees_with_brute_force():
    rng = np.random.default_rng(3)
    pos, neg = rng.normal(1, 1, 60), rng.normal(0, 1, 80)
    brute = np.mean([(p > n) + 0.5 * (p == n) for p in pos for n in neg])
    assert stats.roc_auc(pos, neg) == pytest.approx(brute)


def test_bootstrap_ci_is_seeded_and_brackets_the_estimate():
    rng = np.random.default_rng(1)
    pos, neg = rng.normal(1, 1, 40), rng.normal(0, 1, 40)
    a1 = stats.bootstrap_auc(pos, neg, n_boot=300, seed=5)
    a2 = stats.bootstrap_auc(pos, neg, n_boot=300, seed=5)
    assert a1 == a2  # deterministic
    auc, lo, hi = a1
    assert lo < auc < hi and 0.5 < lo and hi < 1.0
    # more data -> narrower interval
    big = stats.bootstrap_auc(rng.normal(1, 1, 400), rng.normal(0, 1, 400), n_boot=300, seed=5)
    assert (big[2] - big[1]) < (hi - lo)


def test_sweep_trades_false_flags_for_recall():
    pos, neg = [0.1, 0.2, 0.3, 0.9], [0.5, 0.6, 0.7, 0.8]
    rows = stats.sweep(pos, neg, [0.25, 0.55], higher_is_positive=False)  # flag when <= t
    assert rows[0]["recall"]["k"] == 2 and rows[0]["fpr"]["k"] == 0
    assert rows[1]["recall"]["k"] == 3 and rows[1]["fpr"]["k"] == 1
    assert rows[1]["precision"] == pytest.approx(0.75)


def test_brier_and_reliability():
    assert stats.brier([1, 0], [1.0, 0.0]) == 0.0
    assert stats.brier([1, 0], [0.0, 1.0]) == 1.0
    y, p = [1, 1, 0, 0], [0.9, 0.9, 0.1, 0.1]
    rows, ece = stats.reliability(y, p, bins=10)
    assert {r["bin"] for r in rows} == {"0.1-0.2", "0.9-1.0"} and ece == pytest.approx(0.1)


def test_apcer_bpcer_acer_on_a_toy_set():
    # 10 genuine attempts, 1 wrongly rejected; screen replay: 2 of 10 accepted; print: 0 of 5; video: 3 of 6
    m = stats.pad_metrics([True] + [False] * 9,
                          {"screen": [True] * 2 + [False] * 8, "print": [False] * 5, "video": [True] * 3 + [False] * 3})
    assert m["bpcer"]["value"] == pytest.approx(0.1)
    assert m["apcer_by_type"]["screen"]["value"] == pytest.approx(0.2)
    assert m["apcer_by_type"]["print"]["value"] == 0.0
    assert m["apcer"] == pytest.approx(0.5) and m["apcer_worst_type"] == "video"  # ISO: the worst attack type
    assert m["acer"] == pytest.approx((0.5 + 0.1) / 2)
    # intervals stay wide with so few samples
    assert m["apcer_by_type"]["print"]["hi"] > 0.4


def test_pad_metrics_without_attacks_has_no_acer():
    m = stats.pad_metrics([False, False], {})
    assert m["acer"] is None and m["apcer"] is None
