"""MediaFlow Proxy integration tests (iteration 8)."""
import os
import pytest
import requests
from urllib.parse import urlparse, parse_qs, unquote

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://flixit-hero-rebuild.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@admin.com"
ADMIN_PASSWORD = "Admin123!"

MOVIE_TMDB = 10378
TV_TMDB = 1399
HLS_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
MP4_URL = "https://example.com/video.mp4"
MEDIAFLOW_URL = "https://mediaflow.example.com"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE_URL}/api/admin/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _put_settings(headers, **kwargs):
    return requests.put(f"{BASE_URL}/api/admin/settings", json=kwargs, headers=headers, timeout=15)


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin_headers):
    yield
    # Cleanup at end
    _put_settings(admin_headers, mediaflow_url="", mediaflow_api_password="", mediaflow_enabled=True)
    requests.delete(f"{BASE_URL}/api/admin/contents/{MOVIE_TMDB}/stream", headers=admin_headers, timeout=10)
    requests.delete(f"{BASE_URL}/api/admin/contents/{TV_TMDB}/stream", headers=admin_headers, timeout=10)


# --- Admin login ---
def test_admin_login_returns_token():
    r = requests.post(f"{BASE_URL}/api/admin/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "token" in body and isinstance(body["token"], str)
    assert body["role"] in ("admin", "superadmin")


# --- GET settings has MediaFlow fields ---
def test_get_settings_has_mediaflow_fields(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/settings", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    body = r.json()
    for key in ("mediaflow_url", "mediaflow_api_password", "mediaflow_enabled", "mediaflow_active"):
        assert key in body, f"missing {key}"


# --- URL normalization ---
def test_put_settings_normalizes_trailing_slash(admin_headers):
    r = _put_settings(admin_headers,
                      mediaflow_url=MEDIAFLOW_URL + "/",
                      mediaflow_api_password="testpwd",
                      mediaflow_enabled=True)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mediaflow_url"] == MEDIAFLOW_URL
    assert body["mediaflow_active"] is True


def test_put_settings_invalid_url_returns_400(admin_headers):
    r = _put_settings(admin_headers, mediaflow_url="ftp://x")
    assert r.status_code == 400


# --- Stream routing HLS ---
def test_player_movie_hls_wrapped_when_mediaflow_enabled(admin_headers):
    # enable mediaflow
    _put_settings(admin_headers, mediaflow_url=MEDIAFLOW_URL,
                  mediaflow_api_password="testpwd", mediaflow_enabled=True)
    # set admin stream
    r = requests.put(f"{BASE_URL}/api/admin/contents/{MOVIE_TMDB}/stream",
                     params={"media_type": "movie"},
                     json={"stream_url": HLS_URL},
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text

    r = requests.get(f"{BASE_URL}/api/player/movie/{MOVIE_TMDB}", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("success") is True
    assert data.get("proxied") is True
    assert data.get("original_stream") == HLS_URL
    stream = data["stream"]
    assert stream.startswith(f"{MEDIAFLOW_URL}/proxy/hls/manifest.m3u8?")
    qs = parse_qs(urlparse(stream).query)
    assert unquote(qs["d"][0]) == HLS_URL
    assert qs.get("api_password", [""])[0] == "testpwd"


# --- Stream routing MP4/TV ---
def test_player_tv_mp4_wrapped_via_stream_endpoint(admin_headers):
    _put_settings(admin_headers, mediaflow_url=MEDIAFLOW_URL,
                  mediaflow_api_password="testpwd", mediaflow_enabled=True)
    r = requests.put(f"{BASE_URL}/api/admin/contents/{TV_TMDB}/stream",
                     params={"media_type": "tv"},
                     json={"stream_url": MP4_URL, "season": 1, "episode": 1},
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text

    r = requests.get(f"{BASE_URL}/api/player/tv/{TV_TMDB}/1/1", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("proxied") is True
    assert data["stream"].startswith(f"{MEDIAFLOW_URL}/proxy/stream?")
    qs = parse_qs(urlparse(data["stream"]).query)
    assert unquote(qs["d"][0]) == MP4_URL


# --- Fallback: mediaflow disabled ---
def test_fallback_when_mediaflow_disabled(admin_headers):
    _put_settings(admin_headers, mediaflow_url=MEDIAFLOW_URL,
                  mediaflow_api_password="testpwd", mediaflow_enabled=False)
    r = requests.get(f"{BASE_URL}/api/player/movie/{MOVIE_TMDB}", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("proxied") is False
    assert data["stream"] == HLS_URL


def test_fallback_when_mediaflow_url_empty(admin_headers):
    _put_settings(admin_headers, mediaflow_url="", mediaflow_enabled=True)
    r = requests.get(f"{BASE_URL}/api/player/movie/{MOVIE_TMDB}", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("proxied") is False
    assert data["stream"] == HLS_URL


# --- MediaFlow test health endpoint ---
def test_mediaflow_test_endpoint_unreachable(admin_headers):
    r = requests.post(f"{BASE_URL}/api/admin/settings/mediaflow/test",
                      json={"mediaflow_url": MEDIAFLOW_URL},
                      headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is False
    assert "detail" in body
