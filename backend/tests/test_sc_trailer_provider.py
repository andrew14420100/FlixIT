import html
import json

from services.trailers.base import TrailerCandidate, candidate_is_usable
from services.trailers.providers.streamingcommunity import _inertia_page, _trailer_row, _youtube_id


def test_sc_verified_youtube_candidate_is_usable_without_fake_resolution():
    candidate = TrailerCandidate(
        source="streamingcommunity",
        trailer_url="https://www.youtube.com/watch?v=abcdefghijk",
        confidence=1.0,
        verified=True,
        browser_compatible=True,
    )
    assert candidate.height is None
    assert candidate_is_usable(candidate) is True


def test_sc_youtube_candidate_still_requires_exact_verification():
    candidate = TrailerCandidate(
        source="streamingcommunity",
        trailer_url="https://youtu.be/abcdefghijk",
        confidence=1.0,
        verified=False,
        browser_compatible=True,
    )
    assert candidate_is_usable(candidate) is False


def test_inertia_title_payload_and_trailer_id_are_decoded():
    page = {
        "props": {
            "title": {
                "id": 42,
                "tmdb_id": 123,
                "trailers": [{"youtube_id": "abcdefghijk"}],
            }
        }
    }
    document = f'<div id="app" data-page="{html.escape(json.dumps(page), quote=True)}"></div>'
    decoded = _inertia_page(document)
    trailer, youtube_id = _trailer_row(decoded["props"]["title"])
    assert trailer["youtube_id"] == "abcdefghijk"
    assert youtube_id == "abcdefghijk"


def test_youtube_id_parser_accepts_sc_supported_forms():
    assert _youtube_id("abcdefghijk") == "abcdefghijk"
    assert _youtube_id("https://www.youtube.com/watch?v=abcdefghijk") == "abcdefghijk"
    assert _youtube_id("https://youtu.be/abcdefghijk") == "abcdefghijk"
    assert _youtube_id("https://www.youtube-nocookie.com/embed/abcdefghijk") == "abcdefghijk"
