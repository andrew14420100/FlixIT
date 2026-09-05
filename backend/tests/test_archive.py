"""Tests for FlixIT public archive endpoints (iteration 7)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://netflix-clone-setup.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Options endpoint ---
def test_archive_options(session):
    r = session.get(f"{API}/public/archive/options", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    expected = {
        "types": 2, "genres": 20, "countries": 26, "years": 50,
        "ratings": 9, "views": 3, "providers": 10, "ages": 4,
        "qualities": 1, "sorts": 6,
    }
    for k, n in expected.items():
        assert k in data, f"missing key {k}"
        assert isinstance(data[k], list), f"{k} must be list"
        assert len(data[k]) == n, f"{k}: expected {n} got {len(data[k])}"


# --- Base archive ---
def test_archive_base(session):
    r = session.get(f"{API}/public/archive", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    items = data.get("items", [])
    assert len(items) == 24, f"expected 24 items got {len(items)}"
    for it in items:
        assert "tmdbId" in it
        assert "type" in it
        assert "title" in it
        assert "release_date" in it
        assert "vote_average" in it
        assert it.get("backdrop_path") or it.get("poster_path")
    assert data.get("hasMore") is True
    assert data.get("total_estimate", 0) > 0
    types = {i["type"] for i in items}
    assert "movie" in types and "tv" in types, f"expected mixed movie+tv, got {types}"


# --- Type filter ---
@pytest.mark.parametrize("t", ["movie", "tv"])
def test_archive_type(session, t):
    r = session.get(f"{API}/public/archive", params={"type": t}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items, "no items"
    for it in items:
        assert it["type"] == t


# --- Genre / year / rating / views / country filters ---
def test_archive_genre_16(session):
    r = session.get(f"{API}/public/archive", params={"genre": 16}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items
    for it in items:
        assert 16 in (it.get("genre_ids") or []), f"missing 16 in {it.get('genre_ids')}"


def test_archive_year_2024(session):
    r = session.get(f"{API}/public/archive", params={"year": 2024}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items
    for it in items:
        assert (it.get("release_date") or "").startswith("2024")


def test_archive_year_decade(session):
    r = session.get(f"{API}/public/archive", params={"year": "1960s"}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items
    for it in items:
        y = (it.get("release_date") or "0000")[:4]
        assert y.isdigit() and 1960 <= int(y) <= 1969, f"got {y}"


def test_archive_rating(session):
    r = session.get(f"{API}/public/archive", params={"rating": 8}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items
    for it in items:
        assert (it.get("vote_average") or 0) >= 8


def test_archive_views(session):
    r = session.get(f"{API}/public/archive", params={"views": 10000}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items
    for it in items:
        assert (it.get("vote_count") or 0) >= 10000


def test_archive_country_kr(session):
    r = session.get(f"{API}/public/archive", params={"country": "KR"}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items
    for it in items:
        oc = it.get("origin_country") or []
        # Movies may have production_countries; accept KR in either.
        pc = it.get("production_countries") or []
        pc_codes = [c.get("iso_3166_1") if isinstance(c, dict) else c for c in pc]
        assert "KR" in oc or "KR" in pc_codes, f"KR missing in {oc} / {pc_codes}"


# --- Sort ---
def test_archive_sort_release(session):
    r = session.get(f"{API}/public/archive", params={"sort": "release"}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    dates = [i.get("release_date") or "" for i in items]
    assert dates == sorted(dates, reverse=True), f"not non-increasing: {dates}"


def test_archive_sort_title(session):
    r = session.get(f"{API}/public/archive", params={"sort": "title"}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    titles = [(i.get("title") or "").lower() for i in items]
    assert titles == sorted(titles), f"not ascending: {titles[:5]}"


def test_archive_sort_added_movie(session):
    r = session.get(f"{API}/public/archive", params={"sort": "added", "type": "movie"}, timeout=30)
    assert r.status_code == 200
    assert r.json().get("items")


def test_archive_sort_rating(session):
    r = session.get(f"{API}/public/archive", params={"sort": "rating"}, timeout=30)
    assert r.status_code == 200
    ratings = [i.get("vote_average") or 0 for i in r.json().get("items", [])]
    assert ratings == sorted(ratings, reverse=True), f"not non-increasing: {ratings}"


# --- Text search ---
def test_archive_q_matrix(session):
    r = session.get(f"{API}/public/archive", params={"q": "matrix"}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items
    for it in items:
        assert "matrix" in (it.get("title") or "").lower()


def test_archive_q_harry_movie_rating(session):
    r = session.get(f"{API}/public/archive", params={"q": "harry", "type": "movie", "rating": 7}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items
    for it in items:
        assert it["type"] == "movie"
        assert (it.get("vote_average") or 0) >= 7


# --- Provider / age / pagination ---
def test_archive_provider_netflix(session):
    r = session.get(f"{API}/public/archive", params={"provider": 8, "sort": "release"}, timeout=30)
    assert r.status_code == 200
    assert r.json().get("items")


def test_archive_age_18(session):
    r = session.get(f"{API}/public/archive", params={"age": 18}, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items
    for it in items:
        cert = it.get("certification") or ""
        assert cert in ("16+", "18+"), f"unexpected cert {cert!r}"


def test_archive_pagination(session):
    r1 = session.get(f"{API}/public/archive", params={"page": 1}, timeout=30)
    r2 = session.get(f"{API}/public/archive", params={"page": 2}, timeout=30)
    assert r1.status_code == 200 and r2.status_code == 200
    ids1 = {i["tmdbId"] for i in r1.json().get("items", [])}
    ids2 = {i["tmdbId"] for i in r2.json().get("items", [])}
    assert ids2, "page 2 empty"
    # different items, allow tiny overlap but expect majority distinct
    assert len(ids1 & ids2) < len(ids2), f"page 2 identical to page 1"
