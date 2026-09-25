import html
import json

from services.trailers.base import TrailerCandidate, candidate_is_usable
from services.trailers.providers.streamingcommunity import _inertia_page, _native_trailer_url, _trailer_row


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


def test_native_sc_trailer_media_is_decoded():
    title = {
        "id": 42,
        "tmdb_id": 123,
        "trailers": [
            {
                "id": 9,
                "youtube_id": "abcdefghijk",
                "manifest_url": "https://cdn.streamingcommunity.example/trailers/42/master.m3u8",
            }
        ],
    }
    trailer, native_url = _trailer_row(title, "https://streamingcommunity.example")
    assert trailer["id"] == 9
    assert native_url == "https://cdn.streamingcommunity.example/trailers/42/master.m3u8"


def test_native_trailer_url_rejects_playback_and_youtube():
    assert _native_trailer_url("https://www.youtube.com/watch?v=abcdefghijk") is None
    assert _native_trailer_url("https://streamingcommunity.example/watch/42") is None
    assert _native_trailer_url("https://streamingcommunity.example/iframe/42") is None
    assert _native_trailer_url("https://cdn.streamingcommunity.example/trailers/42/trailer.mp4") is not None
