"""Unit tests for the in-process Omni-compatible stream core."""
from services import omni_embedded, stremio


class Cursor(list):
    def limit(self, n):
        return Cursor(self[:n])


class Collection:
    def __init__(self, docs):
        self.docs = docs

    @staticmethod
    def _matches(doc, query):
        for key, expected in query.items():
            actual = doc.get(key)
            if isinstance(expected, dict):
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
                if "$in" in expected and actual not in expected["$in"]:
                    return False
            elif actual != expected:
                return False
        return True

    def find(self, query, _projection=None):
        return Cursor([d.copy() for d in self.docs if self._matches(d, query)])

    def find_one(self, query, _projection=None):
        rows = self.find(query, _projection)
        return rows[0] if rows else None


class DB(dict):
    def __getitem__(self, key):
        return super().__getitem__(key)


def test_zero_config_uses_embedded(monkeypatch):
    monkeypatch.delenv("OMNI_ADDON_URL", raising=False)
    monkeypatch.delenv("OMNI_ENABLED", raising=False)

    def get_setting(_key, default=None):
        return default

    cfg = stremio.get_config(get_setting)
    assert cfg["enabled"] is True
    assert cfg["source"] == "embedded"
    assert cfg["url"] == ""


def test_embedded_multi_source_hls():
    db = DB(
        omni_stream_sources=Collection([
            {
                "imdb_id": "tt123",
                "media_type": "movie",
                "season": None,
                "episode": None,
                "url": "https://media.example/master.m3u8",
                "name": "Authorized HLS",
                "enabled": True,
            }
        ]),
        external_ids=Collection([]),
        stream_sources=Collection([]),
    )
    streams = omni_embedded.resolve_streams(db, "tt123", "movie")
    assert len(streams) == 1
    assert streams[0]["type"] == "hls"
    assert streams[0]["name"] == "Authorized HLS"


def test_embedded_falls_back_to_admin_source():
    db = DB(
        omni_stream_sources=Collection([]),
        external_ids=Collection([
            {"imdb_id": "tt456", "media_type": "tv", "tmdbId": 99}
        ]),
        stream_sources=Collection([
            {
                "tmdbId": 99,
                "media_type": "tv",
                "season": 2,
                "episode": 3,
                "stream_url": "https://media.example/episode.mp4",
            }
        ]),
    )
    streams = omni_embedded.resolve_streams(db, "tt456", "tv", 2, 3)
    assert len(streams) == 1
    assert streams[0]["url"].endswith("episode.mp4")
    assert streams[0]["type"] == "mp4"
