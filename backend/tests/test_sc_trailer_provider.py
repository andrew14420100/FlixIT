import html
import json

from services.trailers.base import TrailerCandidate, candidate_is_usable
from services.trailers.providers.streamingcommunity import (
    _inertia_page,
    _native_trailer_url,
    _trailer_row,
    _trailer_rows,
)


def test_sc_youtube_candidate_is_never_usable():
    candidate = TrailerCandidate(
        source="streamingcommunity",
        trailer_url="https://www.youtube.com/watch?v=abcdefghijk",
        confidence=1.0,
        verified=True,
        browser_compatible=True,
        metadata={"native_sc_trailer": True},
    )
    assert candidate_is_usable(candidate) is False


def test_sc_verified_native_candidate_is_usable_without_fake_resolution():
    candidate = TrailerCandidate(
        source="streamingcommunity",
        manifest_url="https://cdn.streamingcommunity.example/trailers/42/master.m3u8",
        confidence=1.0,
        verified=True,
        browser_compatible=True,
        metadata={"native_sc_trailer": True},
    )
    assert candidate.height is None
    assert candidate_is_usable(candidate) is True


def test_sc_native_candidate_still_requires_exact_verification():
    candidate = TrailerCandidate(
        source="streamingcommunity",
        trailer_url="https://cdn.streamingcommunity.example/trailers/42/trailer.mp4",
        confidence=1.0,
        verified=False,
        browser_compatible=True,
        metadata={"native_sc_trailer": True},
    )
    assert candidate_is_usable(candidate) is False


def test_inertia_youtube_only_trailer_is_ignored():
    page = {
        "props": {
            "title": {
                "id": 42,
                "tmdb_id": 123,
                "trailers": [{"youtube_id": "abcdefghijk"}],
                "trailerUrl": "https://www.youtube.com/watch?v=abcdefghijk",
            }
        }
    }
    document = f'<div id="app" data-page="{html.escape(json.dumps(page), quote=True)}"></div>'
    decoded = _inertia_page(document)
    trailer, native_url = _trailer_row(decoded["props"]["title"], "https://streamingcommunity.example")
    assert trailer is None
    assert native_url is None
    assert _trailer_rows(decoded["props"]["title"], "https://streamingcommunity.example") == []


def test_all_native_sc_trailer_media_are_decoded_and_deduplicated():
    title = {
        "id": 42,
        "tmdb_id": 123,
        "trailers": [
            {
                "id": 9,
                "youtube_id": "abcdefghijk",
                "manifest_url": "https://cdn.streamingcommunity.example/trailers/42/master.m3u8",
                "hls_url": "https://cdn.streamingcommunity.example/trailers/42/master.m3u8",
            },
            {
                "id": 10,
                "video_url": "https://cdn.streamingcommunity.example/trailers/42/trailer-2.mp4",
            },
        ],
    }
    rows = _trailer_rows(title, "https://streamingcommunity.example")
    assert len(rows) == 2
    assert rows[0][0]["id"] == 9
    assert rows[0][1].endswith("master.m3u8")
    assert rows[1][0]["id"] == 10
    assert rows[1][1].endswith("trailer-2.mp4")


def test_native_trailer_url_rejects_playback_and_youtube():
    assert _native_trailer_url("https://www.youtube.com/watch?v=abcdefghijk") is None
    assert _native_trailer_url("https://streamingcommunity.example/watch/42") is None
    assert _native_trailer_url("https://streamingcommunity.example/iframe/42") is None
    assert _native_trailer_url("https://cdn.streamingcommunity.example/trailers/42/trailer.mp4") is not None
