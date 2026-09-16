"""Iteration 4: catalog availability filter, trailer, admin settings."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(client):
    r = client.post(f"{BASE_URL}/api/admin/login",
                    json={"email": "admin@admin.com", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json().get("access_token") or r.json().get("token")


# ---------------- Availability ----------------
def test_availability_get_available(client):
    r = client.get(f"{BASE_URL}/api/public/availability/movie/1084242", timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("catalog_loaded") is True
    assert j.get("available") is True


def test_availability_get_unavailable(client):
    r = client.get(f"{BASE_URL}/api/public/availability/movie/1", timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j.get("catalog_loaded") is True
    assert j.get("available") is False


def test_availability_bulk(client):
    items = [
        {"type": "movie", "id": 1084242},
        {"type": "movie", "id": 1},
        {"type": "tv", "id": 76479},
    ]
    r = client.post(f"{BASE_URL}/api/public/availability", json={"items": items}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("catalog_loaded") is True
    avail = j.get("available", [])
    # available should include 1084242 and 76479 but not 1
    ids = {(a.get("type"), int(a.get("id"))) for a in avail} if avail and isinstance(avail[0], dict) else set()
    if not ids:
        # fall back: available may just be list of ids
        ids = set(avail)
    assert ("movie", 1084242) in ids or 1084242 in ids
    assert ("tv", 76479) in ids or 76479 in ids
    assert ("movie", 1) not in ids and 1 not in ids


# ---------------- List filtering ----------------
def _extract_items(body):
    return body.get("items") or body.get("results") or []


def _extract_id_type(it):
    tid = it.get("tmdbId") or it.get("tmdb_id") or it.get("id")
    t = it.get("type") or it.get("media_type") or "movie"
    return t, tid


FILTERED_ENDPOINTS = [
    "/api/public/homepage/trending",
    "/api/public/tmdb/genre/37/movie",
    "/api/public/tmdb/popular/tv",
    "/api/public/top10",
]


@pytest.mark.parametrize("path", FILTERED_ENDPOINTS)
def test_filtered_endpoints_only_available(client, path):
    r = client.get(f"{BASE_URL}{path}", timeout=90)
    assert r.status_code == 200, r.text
    body = r.json()
    if "sections" in body and isinstance(body["sections"], list):
        # top10 case: multiple sections
        items = []
        for s in body["sections"]:
            items.extend(s.get("items") or [])
    else:
        items = _extract_items(body)
    assert len(items) >= 10, f"{path}: only {len(items)} items"
    # Spot check first 5
    for it in items[:5]:
        t, tid = _extract_id_type(it)
        rr = client.get(f"{BASE_URL}/api/public/availability/{t}/{tid}", timeout=15)
        assert rr.status_code == 200
        assert rr.json().get("available") is True, f"{path}: {t}/{tid} not available"


def test_upcoming_not_filtered(client):
    r = client.get(f"{BASE_URL}/api/public/tmdb/upcoming", timeout=60)
    assert r.status_code == 200
    items = _extract_items(r.json())
    assert len(items) >= 10


# ---------------- Trailer ----------------
def test_trailer_tv_ok(client):
    r = client.get(f"{BASE_URL}/api/public/trailer/tv/76479", timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert isinstance(j.get("trailer_key"), str) and len(j["trailer_key"]) > 0
    assert j.get("source") == "tmdb"


def test_trailer_movie_missing(client):
    r = client.get(f"{BASE_URL}/api/public/trailer/movie/1", timeout=30)
    assert r.status_code == 404


# ---------------- Admin settings ----------------
def test_admin_settings_unauth(client):
    r = client.get(f"{BASE_URL}/api/admin/settings", timeout=15)
    assert r.status_code in (401, 403)


def test_admin_settings_get(client, admin_token):
    r = client.get(f"{BASE_URL}/api/admin/settings",
                   headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "sc_base_url" in j
    vix = j.get("vixsrc") or {}
    assert vix.get("movie", {}).get("count", 0) > 1000
    assert vix.get("tv", {}).get("count", 0) > 500


def test_admin_settings_put_and_fallback(client, admin_token):
    hdr = {"Authorization": f"Bearer {admin_token}"}
    # Set bad domain
    r = client.put(f"{BASE_URL}/api/admin/settings",
                   json={"sc_base_url": "https://example.invalid"},
                   headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    # Verify
    g = client.get(f"{BASE_URL}/api/admin/settings", headers=hdr, timeout=15).json()
    assert g.get("sc_base_url") == "https://example.invalid"
    # Trailer still works (fallback tmdb)
    tr = client.get(f"{BASE_URL}/api/public/trailer/tv/76479", timeout=45)
    assert tr.status_code == 200, tr.text
    assert isinstance(tr.json().get("trailer_key"), str)
    # Reset
    r2 = client.put(f"{BASE_URL}/api/admin/settings", json={"sc_base_url": ""},
                    headers=hdr, timeout=30)
    assert r2.status_code == 200


def test_admin_refresh_catalog(client, admin_token):
    hdr = {"Authorization": f"Bearer {admin_token}"}
    r = client.post(f"{BASE_URL}/api/admin/settings/refresh-catalog", headers=hdr, timeout=120)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("success") is True
    vix = j.get("vixsrc") or {}
    assert vix.get("movie", 0) > 1000
    assert vix.get("tv", 0) > 500
