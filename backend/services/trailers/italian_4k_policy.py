"""Italian-first native trailer quality policy.

This overlay enriches StreamingCommunity trailer candidates that already point
to explicit public trailer media. It never resolves movie/episode streams and it
does not inspect Vixcloud embed internals.

Policy:
- reject candidates explicitly marked English/original when no Italian track is
  present;
- inspect direct SC HLS trailer manifests for native renditions/audio metadata;
- probe direct SC trailer files with ffprobe when available;
- keep Vixcloud trailer embeds as published by SC, without attempting to unwrap
  them;
- let the existing resolver rank Italian candidates first and then prefer native
  2160p, followed by 1440p/1080p/720p;
- never upscale or transcode a lower-resolution trailer into 4K;
- never hide an already-playable SC trailer while quality enrichment is pending.

All inspection happens in the trailer resolver workers, never in the homepage
render path.
"""
from __future__ import annotations

import asyncio
import re
from typing import Optional

from .base import TrailerCandidate, is_english_language, is_italian_language
from .manifest import inspect_hls, probe_direct_file
from .providers.common import client
from .providers import streamingcommunity as sc_provider
from .providers.streamingcommunity import StreamingCommunityTrailerProvider, _is_vixcloud_embed

POLICY_VERSION = "streamingcommunity-italian-native-4k-v2-nonblocking"
CURRENT_SC_BASE = "https://streamingunity-premium.to"
_INSTALLED = False
_DIRECT_FILE_RE = re.compile(r"\.(?:mp4|webm|mov|m4v)(?:$|[?#])", re.I)
_HLS_RE = re.compile(r"\.m3u8(?:$|[?#])", re.I)


def _clone(candidate: TrailerCandidate) -> TrailerCandidate:
    return TrailerCandidate.from_dict(candidate.to_dict())


def _merge_native_metadata(candidate: TrailerCandidate, metadata: Optional[dict] = None) -> dict:
    return {
        **(candidate.metadata or {}),
        **(metadata or {}),
        "native_sc_trailer": True,
        "italian_4k_policy": POLICY_VERSION,
    }


def _explicit_english_only(candidate: TrailerCandidate) -> bool:
    return bool(
        is_english_language(candidate.audio_language)
        and not is_italian_language(candidate.audio_language)
    )


def _finish_variant(candidate: TrailerCandidate, source: TrailerCandidate) -> TrailerCandidate:
    candidate.media_type = source.media_type
    candidate.duration_seconds = source.duration_seconds
    candidate.expires_at = source.expires_at
    candidate.confidence = max(float(candidate.confidence or 0), float(source.confidence or 0))
    candidate.verified = bool(source.verified and candidate.verified)
    candidate.browser_compatible = True
    candidate.metadata = _merge_native_metadata(source, candidate.metadata)
    return candidate


async def _enrich_hls(http, candidate: TrailerCandidate) -> list[TrailerCandidate]:
    url = candidate.manifest_url or candidate.trailer_url
    if not url:
        return []
    try:
        variants = await inspect_hls(
            http,
            url,
            source=candidate.source,
            confidence=float(candidate.confidence or 0),
            provider_id=candidate.provider_id,
            provider_page=candidate.provider_page,
            matched_title=candidate.matched_title,
            matched_year=candidate.matched_year,
            trailer_type=candidate.trailer_type,
            official=candidate.official,
            default_language=candidate.audio_language,
        )
    except Exception:
        variants = []

    if not variants:
        return [] if _explicit_english_only(candidate) else [candidate]

    out: list[TrailerCandidate] = []
    for row in variants:
        row = _finish_variant(row, candidate)
        if _explicit_english_only(row):
            continue
        out.append(row)
    return out


async def _enrich_direct(candidate: TrailerCandidate) -> list[TrailerCandidate]:
    url = candidate.trailer_url or candidate.manifest_url
    if not url:
        return []
    try:
        info = await probe_direct_file(url, timeout=10.0)
    except Exception:
        info = None

    if not info:
        return [] if _explicit_english_only(candidate) else [candidate]

    row = _clone(candidate)
    for key in (
        "width",
        "height",
        "bitrate",
        "codec",
        "fps",
        "audio_codec",
        "audio_bitrate",
    ):
        value = info.get(key)
        if value is not None:
            setattr(row, key, value)

    detected_language = info.get("audio_language")
    if detected_language:
        row.audio_language = str(detected_language)
    row.metadata = _merge_native_metadata(candidate, {"direct_probe": True})

    if _explicit_english_only(row):
        return []
    return [row]


async def _enrich_candidate(http, candidate: TrailerCandidate) -> list[TrailerCandidate]:
    url = candidate.manifest_url or candidate.trailer_url or ""

    # Vixcloud remains the SC-published iframe candidate. It is not unwrapped or
    # inspected internally. Unknown language is allowed so a previously working
    # embed is not hidden merely because SC omitted language metadata.
    if _is_vixcloud_embed(url):
        if _explicit_english_only(candidate):
            return []
        row = _clone(candidate)
        row.metadata = _merge_native_metadata(candidate, {"quality_from_embed": False})
        return [row]

    if _HLS_RE.search(url):
        return await _enrich_hls(http, candidate)
    if _DIRECT_FILE_RE.search(url):
        return await _enrich_direct(candidate)

    return [] if _explicit_english_only(candidate) else [candidate]


def _install_current_sc_base() -> None:
    """Prefer the currently observed SC/StreamingUnity host for trailer metadata."""
    try:
        bases = tuple(getattr(sc_provider, "DEFAULT_BASE_URLS", ()) or ())
        if CURRENT_SC_BASE not in bases:
            sc_provider.DEFAULT_BASE_URLS = (CURRENT_SC_BASE, *bases)
    except Exception:
        pass


def install_italian_4k_trailer_policy() -> bool:
    """Patch SC discovery so workers enrich native trailer quality/audio."""
    global _INSTALLED
    _install_current_sc_base()
    if _INSTALLED:
        return True

    current = StreamingCommunityTrailerProvider.discover
    if getattr(current, "_flixit_italian_4k_v2", False):
        _INSTALLED = True
        return True

    async def discover_italian_4k(self, identity: dict) -> list[TrailerCandidate]:
        rows = await current(self, identity)
        if not rows:
            return []

        semaphore = asyncio.Semaphore(2)
        async with client() as http:
            async def one(candidate: TrailerCandidate) -> list[TrailerCandidate]:
                async with semaphore:
                    return await _enrich_candidate(http, candidate)

            groups = await asyncio.gather(*(one(row) for row in rows), return_exceptions=True)

        out: list[TrailerCandidate] = []
        for original, group in zip(rows, groups):
            if isinstance(group, Exception):
                if not _explicit_english_only(original):
                    out.append(original)
                continue
            out.extend(group)

        if not out:
            out = [row for row in rows if not _explicit_english_only(row)]

        deduped: dict[str, TrailerCandidate] = {}
        for row in out:
            deduped[row.candidate_id] = row
        return list(deduped.values())

    discover_italian_4k._flixit_italian_4k_v2 = True
    discover_italian_4k._original = current
    StreamingCommunityTrailerProvider.discover = discover_italian_4k
    _INSTALLED = True
    return True


def install_italian_4k_result_policy(resolver) -> None:
    """Non-blocking compatibility hook.

    4K/Italian inspection is an enhancement, never a requirement for visibility.
    Existing SC trailer selections therefore stay playable immediately. Workers
    may refresh them in the background and the normal resolver will pick the best
    enriched Italian rendition when one is available.
    """
    if getattr(resolver, "italian_4k_result_policy", None) == POLICY_VERSION:
        return

    resolver.italian_4k_result_policy = POLICY_VERSION
    try:
        resolver.enqueue_catalog(limit=0)
    except Exception:
        pass


__all__ = [
    "install_italian_4k_trailer_policy",
    "install_italian_4k_result_policy",
    "POLICY_VERSION",
    "_explicit_english_only",
]
