import io

from PIL import Image

from tools.reportlib import inventory


def put(folder, name, color, size=(64, 48), fmt="PNG"):
    folder.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, fmt)
    (folder / name).write_bytes(buf.getvalue())
    return buf.getvalue()


def test_scan_hashes_files_and_ignores_other_extensions(tmp_path):
    put(tmp_path / "good", "a.png", (10, 20, 30))
    (tmp_path / "good" / "notes.txt").write_text("x")
    recs = inventory.scan(tmp_path)
    assert [r["name"] for r in recs] == ["a.png"] and len(recs[0]["sha256"]) == 64


def test_same_file_in_two_bad_folders_is_counted_once_in_the_earlier_folder(tmp_path):
    for folder in ("low_resolution", "noisy_compressed"):
        put(tmp_path / folder, "x.png", (1, 2, 3))
    put(tmp_path / "low_resolution", "y.png", (9, 9, 9))
    recs = inventory.scan(tmp_path)
    dup = inventory.find_duplicates(recs)
    assert dup["groups"] == 1 and dup["cross_folder_pairs"] == {"low_resolution = noisy_compressed": 1}
    excl = inventory.resolve_exclusions(recs)
    assert ("noisy_compressed", "x.png") in excl and ("low_resolution", "x.png") not in excl
    assert ("low_resolution", "y.png") not in excl


def test_a_file_that_is_both_good_and_bad_is_dropped_from_both(tmp_path):
    put(tmp_path / "good", "p.png", (5, 5, 5))
    put(tmp_path / "blurry", "p.png", (5, 5, 5))
    excl = inventory.resolve_exclusions(inventory.scan(tmp_path))
    assert set(excl) == {("good", "p.png"), ("blurry", "p.png")}
    assert "label conflict" in excl[("good", "p.png")]


def test_duplicates_inside_one_folder_keep_one_copy(tmp_path):
    put(tmp_path / "good", "a.png", (7, 7, 7))
    put(tmp_path / "good", "b.png", (7, 7, 7))
    recs = inventory.scan(tmp_path)
    assert inventory.find_duplicates(recs)["within_folder_extra_copies"] == {"good": 1}
    assert set(inventory.resolve_exclusions(recs)) == {("good", "b.png")}


def test_distinct_files_produce_no_exclusions(tmp_path):
    put(tmp_path / "good", "a.png", (1, 1, 1))
    put(tmp_path / "blurry", "b.png", (200, 1, 1))
    assert inventory.resolve_exclusions(inventory.scan(tmp_path)) == {}


def test_roles_observation_folders_need_explicit_trust():
    assert inventory.role_of("overexposed")[0] == "observation"
    assert inventory.role_of("overexposed", trusted=("overexposed",))[0] == "positive"
    assert inventory.role_of("mystery")[0] == "unknown"


def test_near_duplicates_across_folders(tmp_path):
    from photo_quality.evidence import dhash_hex
    a = put(tmp_path / "good", "a.png", (30, 60, 90), size=(200, 150))
    h = dhash_hex(a)
    assert inventory.near_duplicates([("good", "a.png", h), ("blurry", "a2.png", h), ("blurry", "z.png", "0" * 16 if h != "0" * 16 else "f" * 16)]) == [("good/a.png", "blurry/a2.png")]


def test_folder_summary_counts_excluded_and_formats(tmp_path):
    put(tmp_path / "good", "a.png", (1, 1, 1))
    put(tmp_path / "good", "b.png", (1, 1, 1))
    recs = inventory.scan(tmp_path)
    excl = inventory.resolve_exclusions(recs)
    descs = {(r["folder"], r["name"]): inventory.describe(r["path"]) for r in recs}
    s = inventory.folder_summary(recs, descs, excl)["good"]
    assert (s["files"], s["excluded"], s["counted"]) == (2, 1, 1) and s["formats"] == {"png": 2} and s["provenance"] == "REAL"
