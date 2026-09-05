"""FlixIT backend regression tests for iteration 2."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://flix-it-preview.preview.emergentagent.com").rstrip("/")

MEDIA_ASSET_FIELDS = [
    "titled_backdrop_path",
    "logo_path",
    "trailer_key",
    "runtime",
    "number_of_seasons",
    "certification",
]


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# Health
def test_health(client):
    r = client.get(f"{BASE_URL}/api/health", timeout=20)
    assert r.status_code == 200
    assert r.json().get("status") == "healthy"


# ---------- media-assets ----------
def test_media_assets_tv_76479(client):
    r = client.get(f"{BASE_URL}/api/public/media-assets/tv/76479", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("type") == "tv"
    assert str(data.get("tmdbId")) == "76479"
    for f in ["titled_backdrop_path", "logo_path", "trailer_key", "number_of_seasons", "certification"]:
        assert f in data, f"missing {f}"


def test_media_assets_movie_runtime(client):
    # Grab a movie tmdb_id from trending
    r = client.get(f"{BASE_URL}/api/public/homepage/trending", timeout=60)
    assert r.status_code == 200
    items = r.json().get("items") or r.json().get("results") or []
    movie = next((i for i in items if i.get("type") == "movie" or i.get("media_type") == "movie"), None)
    assert movie, "No movie in trending"
    mid = movie.get("tmdbId") or movie.get("tmdb_id") or movie.get("id")
    r2 = client.get(f"{BASE_URL}/api/public/media-assets/movie/{mid}", timeout=30)
    assert r2.status_code == 200, r2.text
    data = r2.json()
    assert "runtime" in data


def test_media_assets_invalid(client):
    r = client.get(f"{BASE_URL}/api/public/media-assets/movie/1", timeout=30)
    assert r.status_code == 404


# ---------- list endpoints have media asset fields ----------
LIST_ENDPOINTS = [
    "/api/public/homepage/trending",
    "/api/public/homepage/latest",
    "/api/public/top10",
    "/api/public/tmdb/upcoming",
    "/api/public/tmdb/genre/16/movie",
    "/api/public/tmdb/genre/18/tv?origin_country=KR",
    "/api/public/tmdb/popular/tv",
]


@pytest.mark.parametrize("path", LIST_ENDPOINTS)
def test_list_endpoints_have_media_fields(client, path):
    r = client.get(f"{BASE_URL}{path}", timeout=90)
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    body = r.json()
    items = body.get("items") or body.get("results") or body.get("sections") or []
    assert isinstance(items, list) and len(items) > 0, f"{path} no items"
    for it in items:
        for f in MEDIA_ASSET_FIELDS:
            assert f in it, f"{path}: item missing {f}: keys={list(it.keys())}"
    # most items have non-null titled_backdrop_path
    non_null = sum(1 for it in items if it.get("titled_backdrop_path"))
    assert non_null >= max(1, len(items) // 2), f"{path}: only {non_null}/{len(items)} have titled_backdrop_path"


# ---------- sections ----------
def test_available_sections(client):
    r = client.get(f"{BASE_URL}/api/public/available-sections", timeout=30)
    assert r.status_code == 200
    body = r.json()
    sections = body.get("sections")
    assert isinstance(sections, list)
    assert len(sections) >= 20, f"Expected ~30, got {len(sections)}"
    for s in sections:
        assert "name" in s and "section_type" in s and "media_type" in s


def test_public_sections(client):
    r = client.get(f"{BASE_URL}/api/public/sections", timeout=30)
    assert r.status_code == 200
    assert isinstance(r.json().get("sections"), list)


# ---------- admin regression ----------
def test_admin_login_and_sections(client):
    r = client.post(f"{BASE_URL}/api/admin/login", json={"email": "admin@admin.com", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    token = r.json().get("access_token") or r.json().get("token")
    assert token
    r2 = client.get(f"{BASE_URL}/api/admin/sections", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r2.status_code == 200
    body = r2.json()
    assert isinstance(body, (list, dict))
