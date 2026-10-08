"""The report end to end on a tiny sample set: it runs, labels everything, and is deterministic."""
import json

import pandas as pd
import pytest

import generate_synthetic_data as gen
from tools import accuracy_report

from . import imgs
from .test_calibrate import BLURRY, DARK, GOOD, write


@pytest.fixture(scope="module")
def tiny_samples(tmp_path_factory):
    root = tmp_path_factory.mktemp("samples")
    write(root / "good", 12, GOOD)
    write(root / "blurry", 6, BLURRY)
    write(root / "dark", 6, DARK)
    (root / "overexposed").mkdir()
    (root / "overexposed" / "o.jpg").write_bytes(GOOD(99))
    return root


def run_report(samples, out):
    assert accuracy_report.main(["--samples", str(samples), "--out", str(out), "--n-boot", "50", "--workers", "1", "--skip-parity",
                                 "--fusion-scale", "0.05", "--fusion-samples", str(out / "no-traces")]) == 0
    return json.loads((out / "accuracy-report.json").read_text()), (out / "accuracy-report.md").read_text()


def test_report_is_written_labelled_and_complete(tiny_samples, tmp_path):
    data, md = run_report(tiny_samples, tmp_path)
    assert {"inventory", "checks", "cross_matrix", "face", "liveness", "latency", "fraud"} <= set(data)
    blur = next(c for c in data["checks"] if c["id"] == "blur")
    t = blur["tables"]["REAL"]
    assert (t["n_pos"], t["n_neg"]) == (6, 12) and t["flagged_level"]["tp"] == 6 and t["flagged_level"]["fp"] == 0
    assert t["flagged_level"]["small_sample"] is True
    assert "indicative only" in md.lower()
    assert "REAL" in md and "SYNTHETIC" in md
    assert "not evaluated, no real samples yet" in md  # liveness is honest about being unmeasured
    assert data["liveness"]["evaluated"] is False and data["liveness"]["synthetic_smoke"]["label"] == "SYNTHETIC"
    for line in md.splitlines():  # every table-introducing heading names its provenance
        if line.startswith("#### ") and "(" in line:
            assert "REAL" in line or "SYNTHETIC" in line, line


def test_overexposed_folder_is_observation_only_unless_trusted(tiny_samples, tmp_path):
    data, _ = run_report(tiny_samples, tmp_path)
    over = next(c for c in data["checks"] if c["id"] == "exposure_over")
    assert "REAL" not in over["tables"] and any("No REAL positives" in n for n in over["notes"])
    assert "SYNTHETIC" in over["tables"]  # generated from the good photos instead


def test_same_inputs_give_the_same_numbers(tiny_samples, tmp_path):
    a, _ = run_report(tiny_samples, tmp_path / "a")
    b, _ = run_report(tiny_samples, tmp_path / "b")
    assert accuracy_report.strip_volatile(a) == accuracy_report.strip_volatile(b)


def test_error_analysis_names_the_files(tiny_samples, tmp_path):
    data, _ = run_report(tiny_samples, tmp_path)
    dark = next(c for c in data["checks"] if c["id"] == "exposure_dark")["tables"]["REAL"]
    assert dark["false_negatives"] == [] and dark["flagged_level"]["recall"]["k"] == 6
    syn = next(c for c in data["checks"] if c["id"] == "obstruction")["tables"]["SYNTHETIC"]
    assert all(e["file"].startswith("synthetic_") for e in syn["false_negatives"])


def test_generator_defaults_still_reproduce_the_training_csv():
    old = pd.read_csv(gen.OUT_PATH)
    assert gen.generate().values == pytest.approx(old.values, abs=1e-12)


def test_heldout_generator_really_differs():
    a = gen.generate(seed=1234, n_per_case=50)
    b = gen.generate(seed=1234, n_per_case=50, sd_scale=1.5, mean_shift=0.05)
    assert len(a) == len(b) == 350 and not (a.values == b.values).all()


def test_fraud_section_is_synthetic_and_reports_leakage():
    from tools.reportlib import fraud
    r = fraud.run(n_boot=30, shap_seeds=2)
    assert r["label"] == "SYNTHETIC" and len(r["leakage"]) >= 3
    assert {"in_distribution_test_split", "different_seed", "shifted_parameters"} <= set(r["evaluations"])
    assert r["evaluations"]["shifted_parameters"]["auc"]["value"] < r["evaluations"]["in_distribution_test_split"]["auc"]["value"]
    assert all(p["ok"] for p in r["probes"])


def _spoof_jpeg(seed, grid=True, frame=True):
    import io

    import numpy as np
    from PIL import Image

    from scipy import ndimage

    # imgs.scene has a periodic texture of its own (which the moire detector would, rightly, notice): smooth it away
    g = ndimage.gaussian_filter(imgs.scene(900, 700, seed), 3) + np.random.default_rng(seed).normal(0, 2, (700, 900))
    a = np.stack([g] * 3, axis=-1)
    if grid:
        y, x = np.mgrid[0:700, 0:900]
        t = np.deg2rad(11)
        u, v = x * np.cos(t) + y * np.sin(t), -x * np.sin(t) + y * np.cos(t)
        a = a + (16 * (np.cos(2 * np.pi * u / 3.3) + np.cos(2 * np.pi * v / 3.3)) / 2)[..., None]
    if frame:
        a[:50], a[-50:], a[:, :50], a[:, -50:] = 10, 10, 10, 10
    buf = io.BytesIO()
    Image.fromarray(np.clip(a, 0, 255).astype("uint8")).save(buf, "JPEG", quality=95)
    return buf.getvalue()


def test_liveness_section_computes_apcer_bpcer_acer_from_real_folders(tmp_path):
    """The folders here are generated stand-ins: the point is the pipeline and the maths, not the numbers."""
    import numpy as np
    from tools.reportlib import liveness_eval  # noqa: F401

    root = tmp_path / "samples"
    write(root / "good", 8, GOOD)
    write(root / "live_selfies", 6, lambda i: _spoof_jpeg(100 + i, grid=False, frame=False))
    write(root / "spoof_screen", 6, lambda i: _spoof_jpeg(200 + i))  # grid + frame: flagged
    write(root / "spoof_print", 4, lambda i: _spoof_jpeg(300 + i, grid=False, frame=False))  # nothing to see: slips through
    (root / "live_selfies" / "labels.txt").write_text("0.jpg: light=low, device=a\n1.jpg: light=low, device=a\n2.jpg: light=high, device=b\n")
    data, md = run_report(root, tmp_path / "out")
    lv = data["liveness"]
    assert lv["evaluated"] and lv["label"] == "REAL"
    po = lv["passive_only"]
    assert po["apcer_by_type"]["screen replay"]["value"] == 0.0  # every grid+frame photo caught
    assert po["apcer_by_type"]["print"]["value"] == 1.0  # a clean print photo is invisible to the passive layer (the challenge is what stops it)
    assert po["apcer"] == 1.0 and po["apcer_worst_type"] == "print"
    assert po["bpcer"]["value"] == 0.0 and po["acer"] == 0.5
    assert lv["small_sample"]["live_selfies"] is True and "Indicative only" in md
    assert {"light=low", "device=a"} <= set(lv["slices"])
    assert len(lv["errors"]["attacks_accepted (missed)"]) == 4 and all(e["file"] for e in lv["errors"]["attacks_accepted (missed)"])
    assert "challenge" not in lv  # no evidence sidecars: the active layer is NOT evaluated, and the report says so
    assert "was NOT evaluated" in md
    # live_selfies/spoof_* are not mistaken for photo-quality folders
    assert not any(r["folder"] in ("live_selfies", "spoof_screen", "spoof_print") for r in data["cross_matrix"])


def test_liveness_section_replays_evidence_sidecars(tmp_path):
    import json
    import numpy as np  # noqa: F401
    from tests.test_liveness_server import evidence_for

    root = tmp_path / "samples"
    write(root / "good", 8, GOOD)
    write(root / "live_selfies", 3, lambda i: _spoof_jpeg(100 + i, grid=False, frame=False))
    write(root / "spoof_video", 3, lambda i: _spoof_jpeg(400 + i, grid=False, frame=False))
    for i in range(3):  # a live person completes the challenge; the video replay does too (the challenge cannot tell)
        for folder in ("live_selfies", "spoof_video"):
            (root / folder / f"{i}.evidence.json").write_text(json.dumps(evidence_for(["blink", "smile"], "n")))
    data, md = run_report(root, tmp_path / "out")
    c = data["liveness"]["challenge"]
    assert c["live_completion"]["value"] == 1.0 and c["median_ms_to_pass"] > 0
    assert c["attacks_accepted_by_challenge"]["video replay"]["value"] == 1.0
    assert data["liveness"]["combined"]["apcer"] == 1.0  # honest: a video that performs the actions beats the challenge; only the passive layer could catch it
    assert "Active challenge, replayed" in md


def test_fusion_section_is_present_labelled_synthetic_and_honest_about_real_traces(tiny_samples, tmp_path):
    data, md = run_report(tiny_samples, tmp_path)
    fu = data["fusion"]
    assert fu["label"] == "SYNTHETIC" and len(fu["leakage"]) >= 5 and fu["real"]["evaluated"] is False
    assert {"in_distribution_test_split", "different_seed", "shifted_world"} <= set(fu["evaluations"])
    assert {"genuine", "hard_genuine", "fraud", "fraud_hard"} <= set(fu["groups"]["shifted_world"])
    assert fu["evaluations"]["shifted_world"]["auc"]["value"] < fu["evaluations"]["different_seed"]["auc"]["value"]  # a different world costs accuracy
    assert all(p["ok"] for p in fu["probes"]) and len(fu["ablation"]) == 4 and fu["jump_sensitivity"]
    assert "## 5b. Sensor fusion" in md and "**Not evaluated.**" in md and "hard genuine" in md.lower()
    for line in md.split("## 5b.")[1].split("## 6.")[0].splitlines():
        if line.startswith("#### ") and "(" in line:
            assert "REAL" in line or "SYNTHETIC" in line, line
    assert "Sensor fusion has no real trace behind it" in md  # ranked among the weakest areas


def test_the_legacy_fraud_section_now_evaluates_the_v1_model_and_says_so(tiny_samples, tmp_path):
    data, md = run_report(tiny_samples, tmp_path)
    assert "LEGACY v1" in data["fraud"]["model"] and "Legacy fraud classifier v1" in md


def test_real_traces_are_read_from_scenario_folders(tmp_path):
    import json

    from fusion import trail as trail_mod  # noqa: F401
    from tools.reportlib import fusion as report_fusion

    from .fusion_fixtures import genuine_walk, teleport_still

    root = tmp_path / "samples"
    for i in range(3):
        (root / "walk_to_site").mkdir(parents=True, exist_ok=True)
        (root / "walk_to_site" / f"w{i}.json").write_text(json.dumps({"trail": genuine_walk(i + 1)}))
        (root / "spoof_teleport").mkdir(parents=True, exist_ok=True)
        (root / "spoof_teleport" / f"s{i}.json").write_text(json.dumps({"trail": teleport_still()}))
    (root / "spoof_teleport" / "broken.json").write_text("{nope")
    (root / "site.json").write_text(json.dumps({"lat": 12.9716, "lng": 77.5946, "radius_m": 60}))
    r = report_fusion.real_traces(root)
    assert r["evaluated"] and r["label"] == "REAL" and r["small_sample"] is True
    assert r["folders"]["walk_to_site"]["flagged"]["k"] == 0 and r["folders"]["spoof_teleport"]["flagged"]["k"] == 3
    assert r["false_flag"]["n"] == 3 and r["recall"]["value"] == 1.0
    assert any(x.get("error") for x in r["folders"]["spoof_teleport"]["rows"])  # an unreadable file is reported, not hidden
    assert report_fusion.real_traces(tmp_path / "missing")["evaluated"] is False
    assert report_fusion.real_traces(tmp_path)["evaluated"] is False
