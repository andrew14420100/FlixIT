import os

from services import stremio


def test_omni_env_url_takes_precedence(monkeypatch):
    monkeypatch.setenv("OMNI_ADDON_URL", "https://example.test/config/manifest.json")
    monkeypatch.setenv("OMNI_ENABLED", "true")

    def get_setting(key, default=None):
        values = {
            "stremio_addon_url": "https://legacy.example.test",
            "stremio_enabled": False,
        }
        return values.get(key, default)

    cfg = stremio.get_config(get_setting)
    assert cfg["url"] == "https://example.test/config"
    assert cfg["enabled"] is True
    assert cfg["source"] == "env"


def test_omni_lazy_resolve_is_hls():
    streams = stremio.parse_streams({
        "streams": [
            {
                "name": "Omni AW",
                "url": "https://omni.example.test/resolve/aw/abc/1",
            }
        ]
    })
    assert len(streams) == 1
    assert streams[0]["type"] == "hls"


def test_omni_hls_proxy_path_is_hls():
    streams = stremio.parse_streams({
        "streams": [
            {
                "name": "Omni SC",
                "url": "https://omni.example.test/hls/sc/123/movie/movie/master.m3u8",
            }
        ]
    })
    assert streams[0]["type"] == "hls"
