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
    assert config.THRESHOLDS["blur"]["failBelow"] == 0.16


def test_heic_photos_from_iphones_are_decoded():
    """iPhones can deliver HEIC (a file picker may not convert it); it must not be rejected as undecodable."""
    import io

    pillow_heif = pytest.importorskip("pillow_heif")
    from PIL import Image

    pillow_heif.register_heif_opener()
    buf = io.BytesIO()
    Image.fromarray(imgs.rgb(imgs.scene(1100, 800, 3))).save(buf, "HEIF", quality=90)
    r = analyze_image(buf.getvalue(), "image/heic")
    assert r["metrics"]["width"] == 1100 and r["verdict"] == "pass", r["issues"]


def test_a_flat_cream_wall_is_not_a_covered_lens():
    """Regression (found on real iPhone photos): beige/cream walls sit just outside the skin hue range."""
    import io

    import numpy as np
    from PIL import Image

    def run(rgb):
        a = np.zeros((900, 1600, 3), np.uint8)
        a[:] = rgb
        b = io.BytesIO()
        Image.fromarray(a).save(b, "JPEG", quality=92)
        return analyze_image(b.getvalue(), "image/jpeg")["checks"]["obstruction"]

    assert run((215, 190, 140))["status"] == "pass"  # cream wall, hue ~40
    assert run((205, 140, 115))["status"] == "fail"  # finger colour, hue ~17, still caught


def test_combine_scores_matches_the_client_definition():
    """client/src/lib/photoQuality/policy.js::combineScores is pinned to the same value in its own tests."""
    from photo_quality.policy import aggregate, combine_scores

    assert abs(combine_scores([0.2, 0.6, 1.0]) - 0.4) < 1e-12
    assert combine_scores([]) == 1.0
    results = [{"id": "blur", "status": "pass", "score": s, "hint": None} for s in (0.2, 0.6, 1.0)]
    assert abs(aggregate(results)[2] - 0.4) < 1e-12  # the report's qualityScore uses it
