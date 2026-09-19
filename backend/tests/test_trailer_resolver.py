from services.trailers.base import (
    TrailerCandidate,
    candidate_is_usable,
    confidence_for_identity,
    is_blocked_url,
    pick_best,
)
from services.trailers.providers.imdb import _height_from_label, _trailer_type


def c(height, lang="en", bitrate=5_000_000, hdr=False, url=None):
    return TrailerCandidate(
        source="test",
        trailer_url=url or f"https://cdn.example.com/{height}-{lang}.mp4",
        height=height,
        width=3840 if height == 2160 else 2560 if height == 1440 else 1920,
        bitrate=bitrate,
        codec="h264",
        audio_language=lang,
        trailer_type="Official Trailer",
        official=True,
        confidence=0.99,
        verified=True,
        browser_compatible=True,
        hdr=hdr,
    )


def test_native_4k_beats_italian_1080():
    best = pick_best([c(2160, "en"), c(1080, "it")])
    assert best.height == 2160
    assert best.audio_language == "en"


def test_native_2k_beats_italian_1080():
    best = pick_best([c(1440, "en"), c(1080, "it")])
    assert best.height == 1440


def test_bitrate_wins_at_same_resolution_when_display_compatibility_matches():
    best = pick_best([c(1080, "en", 12_000_000), c(1080, "it", 5_000_000)])
    assert best.audio_language == "en"
    assert best.bitrate == 12_000_000


def test_sdr_default_and_hdr_when_supported():
    hdr = c(2160, "it", 10_000_000, hdr=True, url="https://cdn.example.com/hdr.mp4")
    sdr = c(2160, "it", 9_000_000, hdr=False, url="https://cdn.example.com/sdr.mp4")
    assert pick_best([hdr, sdr], hdr_supported=False).hdr is False
    assert pick_best([hdr, sdr], hdr_supported=True).hdr is True


def test_4k_hdr_is_not_hidden_by_lower_resolution_sdr():
    hdr_4k = c(2160, "it", 10_000_000, hdr=True, url="https://cdn.example.com/4k-hdr.mp4")
    sdr_1080 = c(1080, "it", 20_000_000, hdr=False, url="https://cdn.example.com/1080-sdr.mp4")
    assert pick_best([hdr_4k, sdr_1080], hdr_supported=False).height == 2160


def test_720_is_valid_fallback_but_480_is_rejected():
    assert candidate_is_usable(c(720, "it")) is True
    assert candidate_is_usable(c(480, "it")) is False


def test_youtube_is_rejected_even_at_4k():
    candidate = c(2160, "it", url="https://www.youtube.com/watch?v=abc")
    assert is_blocked_url(candidate.trailer_url)
    assert candidate_is_usable(candidate) is False
    assert is_blocked_url("https://youtu.be/abc")
    assert is_blocked_url("https://www.youtube-nocookie.com/embed/abc")


def test_same_title_different_year_is_not_auto_match():
    identity = {"type": "movie", "title": "Gladiator", "original_title": "Gladiator", "year": 2000}
    assert confidence_for_identity(identity, "Gladiator", 2024, "movie") < 0.90


def test_exact_title_year_type_is_high_confidence():
    identity = {"type": "movie", "title": "Dune", "original_title": "Dune", "year": 2021}
    assert confidence_for_identity(identity, "Dune", 2021, "movie") >= 0.97
    assert confidence_for_identity(identity, "Dune", 2021, "tv") == 0.0


def test_imdb_quality_label_parser():
    assert _height_from_label("1080p") == 1080
    assert _height_from_label("720p") == 720
    assert _height_from_label("SD") is None


def test_imdb_trailer_type_priority_labels():
    assert _trailer_type("Official Trailer", "trailer") == "Official Trailer"
    assert _trailer_type("Final Trailer", "trailer") == "Final Trailer"
    assert _trailer_type("Official Teaser", "video") == "Official Teaser"
    assert _trailer_type("Clip 1", "clip") == "Clip"
