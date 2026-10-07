import pytest

from photo_quality import analyze_image
from photo_quality.frame import ImageDecodeError

from . import imgs


def test_good_photo_passes_with_no_issues():
    r = analyze_image(imgs.good(), "image/jpeg")
    assert r["verdict"] == "pass", r["issues"]
    assert r["issues"] == []
    assert r["metrics"]["width"] == 1600 and r["metrics"]["height"] == 1200


def test_blurry_photo_is_blocked_for_blur():
    r = analyze_image(imgs.blurry(), "image/jpeg")
    assert r["verdict"] == "block"
    assert r["issues"][0]["id"] == "blur" and r["issues"][0]["blocking"]


def test_dark_photo_is_blocked_for_exposure():
    r = analyze_image(imgs.dark(), "image/jpeg")
    assert r["verdict"] == "block"
    assert any(i["id"] == "exposure" and i["blocking"] for i in r["issues"])


def test_small_photo_is_blocked_for_resolution_using_original_size():
    r = analyze_image(imgs.jpeg(imgs.rgb(imgs.scene(500, 400))), "image/jpeg")
    assert any(i["id"] == "resolution" and i["blocking"] for i in r["issues"])


def test_undecodable_bytes_raise():
    with pytest.raises(ImageDecodeError):
        analyze_image(b"definitely not an image")


def test_report_has_every_check():
    r = analyze_image(imgs.good(), "image/jpeg")
    assert set(r["checks"]) == {"blur", "resolution", "exposure", "obstruction", "glare", "shake", "noise"}


def test_thresholds_are_the_shared_client_file():
    from photo_quality import config

    assert str(config._PATH).endswith("client/src/lib/photoQuality/thresholds.json")
    assert config.THRESHOLDS["blur"]["failBelow"] == 0.14
