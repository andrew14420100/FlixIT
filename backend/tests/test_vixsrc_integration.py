"""
Fresh backend tests for VixSrc integration + internal HLS proxy + admin settings.
Follows review_request features_or_bugs_to_test.
"""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "admin@admin.com"
ADMIN_PASSWORD = "Admin123!"

TIMEOUT = 45


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(session):
    r = session.post(f"{BASE_URL}/api/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=TIMEOUT)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"no token in login response: {data}"
    return token


# ---------- Health ----------
def test_health(session):
    r = session.get(f"{BASE_URL}/api/health", timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    # be lenient about key name
    status_val = body.get("status") or body.get("health") or ""
    assert "health" in str(body).lower() or status_val.lower() in ("healthy", "ok", "up"), body


# ---------- VixSrc movie resolution ----------
def _resolve_with_retry(session, url, retries=2):
    last = None
    for i in range(retries + 1):
        r = session.get(url, timeout=TIMEOUT)
        last = r
        if r.status_code == 200:
            try:
                b = r.json()
                if b.get("success"):
                    return r, b
            except Exception:
                pass
        time.sleep(2)
    return last, (last.json() if last is not None and last.headers.get("content-type","").startswith("application/json") else {})


def test_vixsrc_movie_resolution(session):
    r, body = _resolve_with_retry(session, f"{BASE_URL}/api/player/movie/27205")
    assert r.status_code == 200, r.text
    assert body.get("success") is True, body
    assert body.get("source") == "vixsrc", body
    assert body.get("type") == "hls", body
    assert body.get("proxied") is True, body
    stream = body.get("stream", "")
    assert stream.startswith("/api/proxy/hls?d="), stream


def test_vixsrc_tv_resolution(session):
    r, body = _resolve_with_retry(session, f"{BASE_URL}/api/player/tv/1399/1/1")
    assert r.status_code == 200, r.text
    assert body.get("success") is True, body
    assert body.get("source") == "vixsrc", body
    assert body.get("type") == "hls", body
    assert body.get("proxied") is True, body
    assert body.get("stream", "").startswith("/api/proxy/hls?d="), body


# ---------- Internal HLS proxy: master manifest ----------
@pytest.fixture(scope="module")
def master_manifest(session):
    _, body = _resolve_with_retry(session, f"{BASE_URL}/api/player/movie/27205")
    assert body.get("success"), body
    stream_path = body["stream"]
    r = session.get(f"{BASE_URL}{stream_path}", timeout=TIMEOUT)
    assert r.status_code == 200, f"master manifest fetch failed: {r.status_code} {r.text[:300]}"
    return r, stream_path


def test_proxy_master_manifest_headers_and_body(master_manifest):
    r, _ = master_manifest
    ctype = r.headers.get("content-type", "").lower()
    assert "application/vnd.apple.mpegurl" in ctype or "mpegurl" in ctype, ctype
    assert r.headers.get("Access-Control-Allow-Origin") == "*", dict(r.headers)
    text = r.text
    assert "#EXTM3U" in text, text[:200]
    # child URLs should be rewritten
    rewritten = [ln for ln in text.splitlines() if ln.strip().startswith("/api/proxy/")]
    assert rewritten, f"no rewritten /api/proxy/ URLs in master: {text[:500]}"


def test_proxy_child_variant_and_segment(session, master_manifest):
    r, _ = master_manifest
    lines = r.text.splitlines()
    # find first child variant playlist URL (non-comment line preceded by #EXT-X-STREAM-INF or plain)
    child_url = None
    for i, ln in enumerate(lines):
        s = ln.strip()
        if s and not s.startswith("#") and s.startswith("/api/proxy/hls"):
            child_url = s
            break
    assert child_url, "no child variant found in master"
    cr = session.get(f"{BASE_URL}{child_url}", timeout=TIMEOUT)
    assert cr.status_code == 200, f"child manifest failed: {cr.status_code} {cr.text[:300]}"
    assert "#EXTM3U" in cr.text
    ctext = cr.text

    # Find a segment line
    seg_url = None
    for ln in ctext.splitlines():
        s = ln.strip()
        if s and not s.startswith("#") and s.startswith("/api/proxy/seg"):
            seg_url = s
            break
    assert seg_url, f"no /api/proxy/seg line in child manifest: {ctext[:500]}"

    # Verify EXT-X-KEY URI (if any) is rewritten to /api/proxy/seg
    key_lines = [ln for ln in ctext.splitlines() if ln.startswith("#EXT-X-KEY")]
    for kl in key_lines:
        m = re.search(r'URI="([^"]+)"', kl)
        if m:
            uri = m.group(1)
            assert uri.startswith("/api/proxy/"), f"EXT-X-KEY URI not rewritten: {kl}"

    # Fetch segment - stream first chunk
    sr = session.get(f"{BASE_URL}{seg_url}", timeout=TIMEOUT, stream=True)
    assert sr.status_code == 200, f"segment fetch failed: {sr.status_code}"
    seg_ctype = sr.headers.get("content-type", "").lower()
    # accept video/mp2t or octet-stream
    assert "mp2t" in seg_ctype or "octet-stream" in seg_ctype or "video" in seg_ctype, seg_ctype
    chunk = next(sr.iter_content(chunk_size=4096), b"")
    assert isinstance(chunk, (bytes, bytearray)) and len(chunk) > 0, "empty segment body"
    sr.close()


# ---------- Admin login & settings ----------
def test_admin_login(admin_token):
    assert isinstance(admin_token, str) and len(admin_token) > 10


def test_admin_settings_vixsrc_toggle(session, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = session.get(f"{BASE_URL}/api/admin/settings", headers=headers, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    settings = r.json()
    assert "vixsrc_enabled" in settings, settings
    assert settings["vixsrc_enabled"] is True, settings

    # toggle off
    r2 = session.put(f"{BASE_URL}/api/admin/settings", headers=headers, json={"vixsrc_enabled": False}, timeout=TIMEOUT)
    assert r2.status_code == 200, r2.text

    r3 = session.get(f"{BASE_URL}/api/admin/settings", headers=headers, timeout=TIMEOUT)
    assert r3.status_code == 200
    assert r3.json().get("vixsrc_enabled") is False, r3.json()

    # restore
    r4 = session.put(f"{BASE_URL}/api/admin/settings", headers=headers, json={"vixsrc_enabled": True}, timeout=TIMEOUT)
    assert r4.status_code == 200, r4.text
    r5 = session.get(f"{BASE_URL}/api/admin/settings", headers=headers, timeout=TIMEOUT)
    assert r5.json().get("vixsrc_enabled") is True


# ---------- Home catalog ----------
def test_public_sections(session):
    r = session.get(f"{BASE_URL}/api/public/sections", timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    # accept list or dict with sections
    if isinstance(data, dict):
        data = data.get("sections", data.get("items", data))
    assert data, f"empty sections response: {data}"


def test_tmdb_backed_row(session):
    # Try common TMDB-backed endpoints
    candidates = [
        "/api/tmdb/trending",
        "/api/tmdb/movie/popular",
        "/api/catalog/trending",
        "/api/movies/popular",
        "/api/tmdb/trending/all/week",
    ]
    ok = False
    last = None
    for path in candidates:
        try:
            r = session.get(f"{BASE_URL}{path}", timeout=TIMEOUT)
            last = (path, r.status_code, r.text[:200])
            if r.status_code == 200:
                body = r.json()
                if isinstance(body, dict):
                    items = body.get("results") or body.get("items") or body.get("data") or []
                elif isinstance(body, list):
                    items = body
                else:
                    items = []
                if items:
                    ok = True
                    break
        except Exception as e:
            last = (path, "exc", str(e))
    assert ok, f"no TMDB-backed row returned items. last tried: {last}"
