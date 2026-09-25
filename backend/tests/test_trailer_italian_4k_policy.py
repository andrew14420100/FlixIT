from services.trailers.base import TrailerCandidate, pick_best
from services.trailers.italian_4k_policy import (
    POLICY_VERSION,
    _explicit_english_only,
    _merge_native_metadata,
)


def _candidate(*, height, language, url):
    return TrailerCandidate(
        source="streamingcommunity",
        trailer_url=url,
        provider_id=f"{language or 'unknown'}-{height}",
        trailer_type="Trailer",
        width=3840 if height == 2160 else 1920,
        height=height,
        bitrate=18_000_000 if height == 2160 else 7_000_000,
        audio_language=language,
        confidence=1.0,
        verified=True,
        browser_compatible=True,
        metadata={"native_sc_trailer": True, "italian_4k_policy": POLICY_VERSION},
    )


def test_italian_2160p_wins_over_italian_1080p():
    full_hd = _candidate(
        height=1080,
        language="it-IT",
        url="https://cdn.example/trailer-1080.mp4",
    )
    ultra_hd = _candidate(
        height=2160,
        language="it-IT",
        url="https://cdn.example/trailer-2160.mp4",
    )
    assert pick_best([full_hd, ultra_hd]) is ultra_hd


def test_italian_1080p_wins_over_unknown_2160p():
    italian = _candidate(
        height=1080,
        language="it",
        url="https://cdn.example/trailer-it-1080.mp4",
    )
    unknown = _candidate(
        height=2160,
        language=None,
        url="https://cdn.example/trailer-unknown-2160.mp4",
    )
    assert pick_best([unknown, italian]) is italian


def test_explicit_english_candidate_is_rejected_by_policy():
    english = _candidate(
        height=2160,
        language="en-US",
        url="https://cdn.example/trailer-en-2160.mp4",
    )
    assert _explicit_english_only(english) is True


def test_native_metadata_records_policy_version():
    candidate = _candidate(
        height=1080,
        language="it",
        url="https://cdn.example/trailer-it-1080.mp4",
    )
    metadata = _merge_native_metadata(candidate, {"direct_probe": True})
    assert metadata["native_sc_trailer"] is True
    assert metadata["italian_4k_policy"] == POLICY_VERSION
    assert metadata["direct_probe"] is True
