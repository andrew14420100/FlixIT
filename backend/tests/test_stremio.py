"""Backend tests for the Stremio addon integration (iteration 11)."""
import os
import pytest
import requests

# All tests here mutate the shared `app_settings` document; force serial run.
pytestmark = pytest.mark.xdist_group(name="stremio_serial")


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to local backend but do not hardcode external url
    BASE_URL = "http://127.0.0.1:8001"

MOCK = "http://127.0.0.1:9876"
MOCK_MANIFEST = f"{MOCK}/manifest.json"
UNREACHABLE = "http://127.0.0.1:9999"
CINEMETA = "https://v3-cinemeta.strem.io/manifest.json"

ADMIN_EMAIL = "admin@admin.com"
ADMIN_PASS = "Admin123!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module", autouse=True)
def _ensure_mock_running():
    r = requests.get(MOCK_MANIFEST, timeout=5)
    assert r.status_code == 200 and r.json().get("name") == "FlixIT Mock Addon"


@pytest.fixture(scope="module", autouse=True)
def _reset_admin_source(auth):
    # cleanup: no admin source for 10378
    requests.delete(f"{BASE_URL}/api/admin/contents/10378/stream", headers=auth, timeout=15)
    yield
    # after all tests restore default state: mock enabled + admin source
    requests.put(f"{BASE_URL}/api/admin/settings", headers=auth,
                 json={"stremio_addon_url": MOCK, "stremio_enabled": True}, timeout=15)
    requests.put(f"{BASE_URL}/api/admin/contents/10378/stream",
                 params={"media_type": "movie"},
                 json={"stream_url": "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"},
                 headers=auth, timeout=15)


# --- POST /api/admin/settings/stremio/test ---------------------------------
class TestAddonTest:
    def test_mock_reachable(self, auth):
        r = requests.post(f"{BASE_URL}/api/admin/settings/stremio/test",
                          json={"stremio_addon_url": MOCK_MANIFEST}, headers=auth, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is True
        assert d.get("name") == "FlixIT Mock Addon"
        assert d.get("supports_stream") is True
        assert "tt" in (d.get("id_prefixes") or [])

    def test_cinemeta(self, auth):
        r = requests.post(f"{BASE_URL}/api/admin/settings/stremio/test",
                          json={"stremio_addon_url": CINEMETA}, headers=auth, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is True
        assert d.get("supports_stream") is False

    def test_unreachable(self, auth):
        r = requests.post(f"{BASE_URL}/api/admin/settings/stremio/test",
                          json={"stremio_addon_url": UNREACHABLE}, headers=auth, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is False
        assert "non raggiungibile" in (d.get("detail") or "").lower()

    def test_invalid_scheme(self, auth):
        r = requests.post(f"{BASE_URL}/api/admin/settings/stremio/test",
                          json={"stremio_addon_url": "ftp://x"}, headers=auth, timeout=10)
        assert r.status_code == 400


# --- PUT /api/admin/settings ------------------------------------------------
class TestAdminSettings:
    def test_put_and_get_normalization(self, auth):
        r = requests.put(f"{BASE_URL}/api/admin/settings", headers=auth,
                         json={"stremio_addon_url": MOCK_MANIFEST, "stremio_enabled": True}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("stremio_addon_url") == MOCK
        assert d.get("stremio_active") is True

        g = requests.get(f"{BASE_URL}/api/admin/settings", headers=auth, timeout=15)
        assert g.status_code == 200
        gd = g.json()
        assert gd.get("stremio_addon_url") == MOCK
        assert gd.get("stremio_enabled") is True
        ids = [r.get("id") for r in (gd.get("player_resolvers") or [])]
        assert "stremio_addon" in ids


# --- GET /api/player and /api/streams ---------------------------------------
class TestStreamsAndPlayer:
    def test_player_movie_10378(self, auth):
        # ensure settings correct
        requests.put(f"{BASE_URL}/api/admin/settings", headers=auth,
                     json={"stremio_addon_url": MOCK, "stremio_enabled": True}, timeout=15)
        requests.delete(f"{BASE_URL}/api/admin/contents/10378/stream", headers=auth, timeout=15)
        r = requests.get(f"{BASE_URL}/api/player/movie/10378", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("success") is True
        assert d.get("source") == "stremio_addon"
        assert d.get("imdb_id") == "tt1254207"
        assert d.get("type") == "hls"
        assert d.get("proxied") is True
        assert d.get("stream", "").startswith(
            "https://mediaflow-proxy-deploy.onrender.com/proxy/hls/manifest.m3u8?d="
        )
        assert d.get("original_stream") == "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"

    def test_streams_movie(self, auth):
        r = requests.get(f"{BASE_URL}/api/streams/movie/10378", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("count") == 2
        streams = d.get("streams") or []
        # HLS first
        assert streams[0]["type"] == "hls"
        # MP4 second with not_web_ready and h_referer= via proxy
        mp4 = streams[1]
        assert mp4.get("not_web_ready") is True
        assert "h_referer=" in mp4.get("url", "")
        assert mp4.get("proxied") is True

    def test_streams_movie_no_proxy(self, auth):
        r = requests.get(f"{BASE_URL}/api/streams/movie/10378", params={"proxy": "false"}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        for s in d.get("streams") or []:
            assert s.get("proxied") is False
        urls = [s["url"] for s in d["streams"]]
        assert "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" in urls

    def test_streams_series(self, auth):
        r = requests.get(f"{BASE_URL}/api/streams/tv/1399", params={"season": 1, "episode": 1}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("imdb_id") == "tt0944947"
        streams = d.get("streams") or []
        assert len(streams) == 1
        assert "h_user-agent=MockUA" in streams[0]["url"]

    def test_player_tv(self, auth):
        r = requests.get(f"{BASE_URL}/api/player/tv/1399/1/1", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("source") == "stremio_addon"
        headers = d.get("headers") or {}
        assert headers.get("User-Agent") == "MockUA"


# --- Error handling ---------------------------------------------------------
class TestErrors:
    def test_tv_missing_season(self):
        r = requests.get(f"{BASE_URL}/api/streams/tv/1399", timeout=15)
        assert r.status_code == 400

    def test_movie_not_found(self):
        r = requests.get(f"{BASE_URL}/api/streams/movie/1101383", timeout=20)
        assert r.status_code == 404
        assert "Nessuno stream disponibile" in (r.json().get("detail") or "")

    def test_invalid_tmdb_id(self):
        r = requests.get(f"{BASE_URL}/api/streams/movie/abc", timeout=15)
        assert r.status_code == 422

    def test_unreachable_addon(self, auth):
        requests.put(f"{BASE_URL}/api/admin/settings", headers=auth,
                     json={"stremio_addon_url": UNREACHABLE, "stremio_enabled": True}, timeout=15)
        s = requests.get(f"{BASE_URL}/api/streams/movie/10378", timeout=20)
        assert s.status_code == 404
        assert "Addon non raggiungibile" in (s.json().get("detail") or "")
        p = requests.get(f"{BASE_URL}/api/player/movie/10378", timeout=25)
        assert p.status_code == 200
        # restore mock for next tests
        requests.put(f"{BASE_URL}/api/admin/settings", headers=auth,
                     json={"stremio_addon_url": MOCK, "stremio_enabled": True}, timeout=15)

    def test_no_addon_configured(self, auth):
        requests.put(f"{BASE_URL}/api/admin/settings", headers=auth,
                     json={"stremio_addon_url": "", "stremio_enabled": True}, timeout=15)
        s = requests.get(f"{BASE_URL}/api/streams/movie/10378", timeout=20)
        assert s.status_code == 404
        assert "Nessun addon Stremio configurato" in (s.json().get("detail") or "")
        # restore
        requests.put(f"{BASE_URL}/api/admin/settings", headers=auth,
                     json={"stremio_addon_url": MOCK, "stremio_enabled": True}, timeout=15)
