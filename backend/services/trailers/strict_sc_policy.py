"""Strict StreamingCommunity-only trailer policy.

This module removes every legacy/manual playback path from the public trailer
experience. It is intentionally small and can be installed around the existing
resolver without changing the movie/episode player.
"""
from __future__ import annotations

from types import MethodType

SC_SOURCE = "streamingcommunity"


def install_strict_sc_policy(resolver):
    """Force public/automatic trailer playback to use StreamingCommunity only."""

    # Old manual overrides were previously preserved across resolver refreshes.
    # Remove them once when the service boots so they cannot keep blocking SC
    # discovery in TrailerResolver.resolve().
    resolver.results.update_many({}, {"$unset": {"manual": ""}})

    base_public_result = resolver.public_result
    base_resolve = resolver.resolve
    base_set_manual_url = resolver.set_manual_url
    base_set_manual_candidate = resolver.set_manual_candidate

    def public_result(self, media_type: str, tmdb_id: int, *, hdr_supported: bool = False):
        result = base_public_result(media_type, tmdb_id, hdr_supported=hdr_supported)
        selected = result.get("selected") or {}
        source = str(selected.get("source") or result.get("source") or "").strip().lower()

        if result.get("available") and source == SC_SOURCE:
            return {**result, "source": SC_SOURCE, "source_policy": "streamingcommunity-only"}

        # Never expose a manual/legacy provider as a temporary fallback.
        self.enqueue(media_type, int(tmdb_id), priority=1, reason="strict_sc_only")
        return {
            **result,
            "available": False,
            "selected": None,
            "source": SC_SOURCE,
            "source_policy": "streamingcommunity-only",
            "refresh_pending": True,
            "reason": "streamingcommunity_trailer_required",
        }

    async def resolve(self, media_type: str, tmdb_id: int, *, force: bool = False):
        # Defensive cleanup for rows created before/after service boot.
        normalized_type = "tv" if media_type == "tv" else "movie"
        normalized_id = int(tmdb_id)
        self.results.update_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {"$unset": {"manual": ""}},
        )
        return await base_resolve(media_type, normalized_id, force=force)

    def set_manual_url(self, media_type: str, tmdb_id: int, url: str):
        raise ValueError("Override manuali disabilitati: i trailer automatici usano solo StreamingCommunity")

    async def set_manual_candidate(self, media_type: str, tmdb_id: int, candidate_id: str):
        raise ValueError("Override manuali disabilitati: i trailer automatici usano solo StreamingCommunity")

    resolver.public_result = MethodType(public_result, resolver)
    resolver.resolve = MethodType(resolve, resolver)
    resolver.set_manual_url = MethodType(set_manual_url, resolver)
    resolver.set_manual_candidate = MethodType(set_manual_candidate, resolver)
    resolver.strict_sc_source = SC_SOURCE
    resolver.legacy_manual_setters = (base_set_manual_url, base_set_manual_candidate)
    return resolver
