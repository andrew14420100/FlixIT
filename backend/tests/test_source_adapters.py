"""Unit tests for the replacement source adapters."""

from services import italianprovider
from services.resolvers import (
    ItalianProviderBridgeResolver,
    OmniAddonResolver,
    StremioAddonResolver,
    VixSrcResolver,
)


def test_player_compatibility_aliases():
    assert StremioAddonResolver is OmniAddonResolver
    assert VixSrcResolver is ItalianProviderBridgeResolver
    assert OmniAddonResolver.id == "stremio_addon"
    assert ItalianProviderBridgeResolver.id == "vixsrc"


def test_italianprovider_disabled_without_bridge(monkeypatch):
    monkeypatch.delenv("ITALIANPROVIDER_BRIDGE_URL", raising=False)
    monkeypatch.delenv("ITALIANPROVIDER_ENABLED", raising=False)

    def get_setting(key, default=None):
        values = {"vixsrc_enabled": True}
        return values.get(key, default)

    cfg = italianprovider.get_config(get_setting)
    assert cfg["url"] == ""
    assert cfg["enabled"] is False


def test_italianprovider_env_bridge(monkeypatch):
    monkeypatch.setenv("ITALIANPROVIDER_BRIDGE_URL", "https://bridge.example.test/")
    monkeypatch.setenv("ITALIANPROVIDER_ENABLED", "true")

    cfg = italianprovider.get_config(None)
    assert cfg["url"] == "https://bridge.example.test"
    assert cfg["enabled"] is True
    assert cfg["repo"] == "https://github.com/Gian-Fr/ItalianProvider"


def test_italianprovider_parses_http_stream_only():
    parsed = italianprovider._parse_stream({
        "url": "https://cdn.example.test/master.m3u8",
        "headers": {"Referer": "https://example.test/"},
    })
    assert parsed is not None
    assert parsed["type"] == "hls"
    assert parsed["headers"]["Referer"] == "https://example.test/"

    assert italianprovider._parse_stream({"url": "magnet:?xt=urn:btih:abc"}) is None


def test_omni_adapter_metadata():
    assert OmniAddonResolver.label == "Omni (Stremio)"
