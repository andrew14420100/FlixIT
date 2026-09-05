"""Smoke tests for FlixIT clone - iteration 5."""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def test_health(client):
    r = client.get(f"{BASE_URL}/api/health", timeout=20)
    assert r.status_code == 200


def test_trending(client):
    r = client.get(f"{BASE_URL}/api/public/homepage/trending", timeout=60)
    assert r.status_code == 200
    items = r.json().get("items") or []
    assert len(items) > 0


def test_content_movie_550(client):
    r = client.get(f"{BASE_URL}/api/public/content/550", timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    title = data.get("title") or data.get("name")
    assert title == "Fight Club", f"got title={title}"


def test_content_tv_1399(client):
    r = client.get(f"{BASE_URL}/api/public/content/1399?type=tv", timeout=60)
    assert r.status_code == 200, r.text


def test_search(client):
    r = client.get(f"{BASE_URL}/api/public/search", params={"q": "matrix"}, timeout=60)
    assert r.status_code == 200
    items = r.json().get("items") or r.json().get("results") or []
    assert len(items) > 0


def test_admin_login(client):
    r = client.post(
        f"{BASE_URL}/api/admin/login",
        json={"email": "admin@admin.com", "password": "admin123"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok


def test_public_sections(client):
    r = client.get(f"{BASE_URL}/api/public/sections", timeout=30)
    assert r.status_code == 200
    body = r.json()
    sections = body.get("sections") or []
    names = [s.get("name") for s in sections]
    expected = [
        "I titoli del momento",
        "Aggiunti di recente",
        "Top 10 titoli oggi",
        "In arrivo",
    ]
    for e in expected:
        assert e in names, f"missing section {e}; got {names}"
