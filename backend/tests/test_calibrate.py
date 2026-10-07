import json
import shutil

import pytest

from photo_quality import config
from tools import calibrate

from . import imgs


# Smaller than real photos so the suite stays fast (1100x800 is just over the resolution floor).
def _img(transform=lambda g: g):
    return lambda seed: imgs.jpeg(imgs.rgb(transform(imgs.scene(1100, 800, seed))))


GOOD = _img()
BLURRY = _img(lambda g: __import__("scipy.ndimage", fromlist=["x"]).uniform_filter(__import__("scipy.ndimage", fromlist=["x"]).uniform_filter(g, 20), 20))
DARK = _img(lambda g: g * 0.15)


def write(folder, n, maker):
    folder.mkdir(parents=True)
    for i in range(n):
        (folder / f"{i}.jpg").write_bytes(maker(i))


@pytest.fixture()
def samples(tmp_path):
    root = tmp_path / "samples"
    write(root / "good", 12, GOOD)
    write(root / "blurry", 6, BLURRY)
    write(root / "dark", 6, DARK)
    return root


def test_no_photos_explains_what_to_do(tmp_path, capsys):
    assert calibrate.main(["--samples", str(tmp_path / "nothing")]) == 1
    assert "samples/<issue>" in capsys.readouterr().out


def test_needs_good_photos_to_measure_false_rejections(tmp_path, capsys):
    write(tmp_path / "s" / "blurry", 3, BLURRY)
    assert calibrate.main(["--samples", str(tmp_path / "s")]) == 1
    assert "no samples/good" in capsys.readouterr().out


def test_report_measures_catch_rate_and_false_rejections(samples, capsys):
    assert calibrate.main(["--samples", str(samples)]) == 0
    out = capsys.readouterr().out
    assert "blurry" in out and "6/6 = 100%  (blur)" in out
    assert "dark" in out and "6/6 = 100%  (exposure)" in out
    assert "FALSE REJECTIONS among 12 good photos: 0 blocked" in out
    assert "separation (AUC) 1.00" in out  # blur separates cleanly here


def test_suggestions_are_written_to_a_separate_file_and_never_touch_the_real_one(samples, tmp_path, monkeypatch, capsys):
    real = tmp_path / "thresholds.json"
    shutil.copy(config._PATH, real)
    before = real.read_text()
    monkeypatch.setattr(config, "_PATH", real)
    assert calibrate.main(["--samples", str(samples), "--write"]) == 0
    assert real.read_text() == before
    suggested = json.loads((tmp_path / "thresholds.suggested.json").read_text())
    assert suggested["thresholds"]["blur"]["warnBelow"] != json.loads(before)["thresholds"]["blur"]["warnBelow"]
    assert set(suggested) == set(json.loads(before))  # same structure, only numbers differ


def test_demo_mode_runs_without_any_photos(capsys):
    assert calibrate.main(["--demo"]) == 0
    out = capsys.readouterr().out
    assert "DEMO MODE" in out and "suggested" in out
