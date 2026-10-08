"""P0: the backend serves the built client and the API from ONE origin (backend/serving.py)."""
import json

import pytest

import serving

INDEX = "<!doctype html><html><body><div id=root></div><script type=module src=/assets/app-abc123.js></script></body></html>"


@pytest.fixture()
def site(client, tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "mediapipe").mkdir()
    (dist / "index.html").write_text(INDEX)
    (dist / "assets" / "app-abc123.js").write_text("console.log('app')")
    (dist / "assets" / "app-abc123.css").write_text("body{}")
    (dist / "mediapipe" / "model.task").write_bytes(b"\x00" * 64)
    (dist / "favicon.svg").write_text("<svg/>")
    secret = tmp_path / "secret.txt"
    secret.write_text("outside the build")
    monkeypatch.setenv("CLIENT_DIST", str(dist))
    return client


def test_the_root_and_the_clients_own_routes_get_index_html_and_are_never_cached(site):
    for path in ("/", "/dashboard", "/dashboard/", "/some/deep/client/route"):
        r = site.get(path)
        assert r.status_code == 200 and r.text == INDEX, path
        assert r.headers["content-type"].startswith("text/html")
        assert r.headers["cache-control"] == "no-cache", path


def test_a_hard_refresh_on_the_dashboard_works_with_and_without_the_api_prefix_in_play(site):
    assert site.get("/dashboard").text == INDEX
    assert site.get("/api/health").json()["status"] == "ok"
    assert site.get("/health").json()["status"] == "ok"


def test_hashed_assets_are_cached_for_a_year_other_files_briefly(site):
    r = site.get("/assets/app-abc123.js")
    assert r.status_code == 200 and r.text == "console.log('app')" and r.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert site.get("/assets/app-abc123.css").headers["cache-control"] == serving.IMMUTABLE
    assert site.get("/mediapipe/model.task").headers["cache-control"] == serving.SHORT
    assert site.get("/favicon.svg").headers["cache-control"] == serving.SHORT


def test_a_missing_file_is_a_404_not_a_page_of_html(site):
    for path in ("/assets/missing.js", "/nothing.png", "/mediapipe/gone.wasm"):
        r = site.get(path)
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"}, path


def test_unknown_api_paths_are_a_json_404_never_index_html(site):
    for path in ("/api/nope", "/api/", "/api/a/b/c", "/api"):
        r = site.get(path)
        assert r.status_code == 404 and r.headers["content-type"].startswith("application/json"), path


def test_the_spa_fallback_never_shadows_an_api_route(site):
    r = site.get("/sites")  # an API route: JSON, not the app
    assert r.status_code == 200 and r.json() == [] and r.headers["content-type"].startswith("application/json")
    assert site.get("/submissions").json() == []
    assert site.get("/sites/nosuch").status_code == 404 and site.get("/sites/nosuch").json()["detail"] == "Site has no location yet"
    assert site.get("/submissions/999").json()["detail"] == "Submission not found"  # a 404 FROM the API, not the fallback


def test_every_api_route_works_under_the_api_prefix_too(site):
    r = site.put("/api/sites/s1", json={"lat": 12.9, "lng": 77.6, "radius_m": 50, "country": "IN"})
    assert r.status_code == 200 and r.json()["site_id"] == "s1"
    assert site.get("/sites/s1").json()["radius_m"] == 50
    assert site.get("/api/sites/s1/changes").json()[0]["kind"] == "create"
    assert site.post("/api/visits", json={"worker_id": "w", "task_id": "t", "site_id": "s1"}).status_code == 200


def test_a_submission_works_through_the_prefix(site):
    from . import imgs

    r = site.post("/api/submissions", data={"payload": json.dumps({"worker_id": "w1", "task_id": "t1", "site_id": "s1", "photo_quality_pass": True})},
                  files={"photo": ("p.jpg", imgs.good(seed=1), "image/jpeg")})
    assert r.status_code == 200 and r.json()["status"] in ("accepted", "flagged")


@pytest.mark.parametrize("path", ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/..%2fsecret.txt", "//etc/passwd", "/assets/%2e%2e%2f%2e%2e%2fsecret.txt"])
def test_path_traversal_never_leaves_the_build_folder(site, path):
    r = site.get(path)
    assert "outside the build" not in r.text and "root:" not in r.text
    assert r.status_code in (200, 404)  # the app (index.html) or a 404: never a file from outside


def test_head_works_and_post_to_a_client_route_is_refused(site):
    assert site.head("/dashboard").status_code == 200
    assert site.post("/dashboard").status_code in (404, 405)


def test_without_a_build_the_api_is_unchanged_and_the_fallback_is_a_404(client, tmp_path, monkeypatch):
    monkeypatch.setenv("CLIENT_DIST", str(tmp_path / "no-such-build"))
    assert client.get("/").status_code == 404 and client.get("/dashboard").status_code == 404
    assert client.get("/health").json()["status"] == "ok" and client.get("/sites").json() == []


def test_assetlinks_is_served_as_json_when_the_file_exists(client, tmp_path, monkeypatch):
    f = tmp_path / "assetlinks.json"
    f.write_text('[{"relation": ["delegate_permission/common.handle_all_urls"], "target": {"namespace": "android_app"}}]')
    monkeypatch.setattr(serving, "ASSETLINKS", f)
    r = client.get("/.well-known/assetlinks.json")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json") and r.json()[0]["target"]["namespace"] == "android_app"
    monkeypatch.setattr(serving, "ASSETLINKS", tmp_path / "gone.json")
    assert client.get("/.well-known/assetlinks.json").status_code == 404
