"""Tests for watch-progress endpoints and player-bug related backend."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://flix-it-preview.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def token():
    ts = int(time.time())
    email = f"test_wp_{ts}@example.com"
    password = "Testpass123!"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password, "name": "WP Tester"}, timeout=15)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    if not tok:
        r2 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
        assert r2.status_code == 200
        tok = r2.json().get("token") or r2.json().get("access_token")
    assert tok, f"No token from register/login: {data}"
    # save credentials
    with open("/app/memory/test_credentials.md", "a") as f:
        f.write(f"\n- Watch-progress test user: {email} / {password}\n")
    return tok


@pytest.fixture(scope="module")
def trending_movie_id():
    r = requests.get(f"{BASE_URL}/api/public/homepage/trending", timeout=15)
    assert r.status_code == 200
    items = r.json().get("items", []) if isinstance(r.json(), dict) else r.json()
    movie = None
    for it in items:
        if it.get("type") == "movie" and it.get("tmdbId"):
            movie = it
            break
    assert movie, f"no trending movie found: {items[:2]}"
    return movie["tmdbId"]


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def test_watch_progress_skipped_when_below_threshold(token, trending_movie_id):
    r = requests.post(
        f"{BASE_URL}/api/auth/watch-progress",
        headers=_auth(token),
        json={"tmdb_id": trending_movie_id, "media_type": "movie", "progress": 5, "duration": 7200,
              "title": "Test", "backdrop_path": "", "poster_path": ""},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "skipped"


def test_watch_progress_saved_at_threshold_10s(token, trending_movie_id):
    r = requests.post(
        f"{BASE_URL}/api/auth/watch-progress",
        headers=_auth(token),
        json={"tmdb_id": trending_movie_id, "media_type": "movie", "progress": 12, "duration": 7200,
              "title": "Test WP", "backdrop_path": "/b.jpg", "poster_path": "/p.jpg"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") == "saved", body
    assert body.get("progress") == 12


def test_watch_progress_get_single(token, trending_movie_id):
    # ensure saved with progress 600 (used by frontend resume test)
    requests.post(
        f"{BASE_URL}/api/auth/watch-progress",
        headers=_auth(token),
        json={"tmdb_id": trending_movie_id, "media_type": "movie", "progress": 600, "duration": 7200,
              "title": "Test WP", "backdrop_path": "", "poster_path": ""},
        timeout=15,
    )
    r = requests.get(f"{BASE_URL}/api/auth/watch-progress/{trending_movie_id}", headers=_auth(token), timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("tmdb_id") == trending_movie_id
    assert data.get("progress") == 600
    assert data.get("title") == "Test WP"


def test_watch_progress_list_contains_item(token, trending_movie_id):
    r = requests.get(f"{BASE_URL}/api/auth/watch-progress", headers=_auth(token), timeout=15)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert any(i.get("tmdb_id") == trending_movie_id for i in items), items


def test_watch_progress_requires_auth():
    r = requests.post(
        f"{BASE_URL}/api/auth/watch-progress",
        headers={"Content-Type": "application/json"},
        json={"tmdb_id": 1, "media_type": "movie", "progress": 20, "duration": 100},
        timeout=15,
    )
    assert r.status_code in (401, 403)


def test_trending_enriched():
    r = requests.get(f"{BASE_URL}/api/public/homepage/trending", timeout=15)
    assert r.status_code == 200
    items = r.json().get("items", []) if isinstance(r.json(), dict) else r.json()
    assert len(items) > 0
    # at least one enriched with titled_backdrop_path or backdrop_path
    assert any(("titled_backdrop_path" in it) or ("backdrop_path" in it) for it in items)
