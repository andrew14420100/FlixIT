"""Iteration 6 backend tests: mixed genre rows, hero fallback, sections, auth, cache."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://netflix-clone-setup.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# Genre mixed endpoint
def test_genre_16_mixed_has_both_types():
    r = requests.get(f"{API}/public/tmdb/genre/16/mixed", timeout=30)
    assert r.status_code == 200
    data = r.json()
    items = data.get("items") or data.get("results") or data
    assert isinstance(items, list) and len(items) > 0
    types = {(it.get("type") or it.get("media_type")) for it in items}
    assert "movie" in types, f"missing movie in types: {types}"
    assert "tv" in types, f"missing tv in types: {types}"


# Sections use mixed and no banned names
def test_available_sections_are_mixed_no_banned():
    r = requests.get(f"{API}/public/available-sections", timeout=30)
    assert r.status_code == 200
    data = r.json()
    sections = data.get("sections") or data.get("items") or data
    assert isinstance(sections, list)
    genre_sections = [s for s in sections if (s.get("kind") == "genre" or "genre" in (s.get("type", "") or "").lower() or s.get("genre_id") or s.get("tmdb_genre_id"))]
    # Fallback: consider all if we cannot distinguish
    to_check = genre_sections if genre_sections else sections
    banned = ["Sci-Fi & Fantasy", "Action & Adventure", "War & Politics", "Kids", "Televisione film"]
    for s in to_check:
        mt = s.get("media_type") or s.get("mediaType")
        if s.get("kind") == "genre" or s.get("genre_id") or s.get("tmdb_genre_id"):
            assert mt == "mixed", f"section {s.get('name')} media_type={mt}"
        name = s.get("name") or s.get("title") or ""
        for b in banned:
            assert b not in name, f"banned name found: {name}"


# Hero endpoint
def test_hero_returns_content():
    r = requests.get(f"{API}/public/hero", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data.get("contentId") or data.get("content_id") or data.get("tmdb_id")
    assert data.get("mediaType") or data.get("media_type") or data.get("type")


# Basic public endpoints
@pytest.mark.parametrize("path", [
    "/public/search?q=matrix",
    "/public/homepage/trending",
    "/public/homepage/latest",
    "/public/top10",
    "/public/tmdb/upcoming",
])
def test_public_endpoints(path):
    r = requests.get(f"{API}{path}", timeout=30)
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    data = r.json()
    items = data.get("items") or data.get("results") or data
    if path != "/public/tmdb/upcoming":
        assert isinstance(items, list) and len(items) > 0, f"{path} empty"


# Auth: register new + login existing + wrong password
def test_register_new_user():
    email = f"TEST_{uuid.uuid4().hex[:10]}@flixit.local"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "test1234", "name": "TestUser"}, timeout=30)
    assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
    data = r.json()
    assert data.get("token") or data.get("access_token")


def test_login_existing():
    r = requests.post(f"{API}/auth/login", json={"email": "testutente@flixit.local", "password": "test1234"}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("token") or r.json().get("access_token")


def test_login_wrong_password():
    r = requests.post(f"{API}/auth/login", json={"email": "testutente@flixit.local", "password": "WRONGPASS"}, timeout=30)
    assert 400 <= r.status_code < 500


# Cache: repeated call still works
def test_repeated_tmdb_call_cache():
    r1 = requests.get(f"{API}/public/homepage/trending", timeout=30)
    r2 = requests.get(f"{API}/public/homepage/trending", timeout=30)
    assert r1.status_code == 200 and r2.status_code == 200
