"""Allow YouTube trailers only when StreamingCommunity publishes a youtube_id.

This policy is deliberately narrow:
- it does not search YouTube;
- it does not accept arbitrary/manual YouTube URLs;
- it only converts ``youtube_id`` values found inside the exact TMDB-matched
  StreamingCommunity title metadata into trailer candidates;
- the rest of the trailer resolver keeps using the normal SC-only identity and
  cache rules.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse


_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_INSTALLED = False
SC_YOUTUBE_POLICY_VERSION = "streamingcommunity-vixcloud-youtube-v10-review-mirror"
CURRENT_SC_MIRROR = "https://streamingcommunityz.review"


def _youtube_id(value) -> str | None:
    text = str(value or "").strip()
    return text if _YOUTUBE_ID_RE.fullmatch(text) else None


def _youtube_id_from_url(value) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = urlparse(text)
    except Exception:
        return None
    host = (parsed.hostname or "").lower().strip(".")
    if host == "youtu.be" or host.endswith(".youtu.be"):
        return _youtube_id((parsed.path or "").strip("/").split("/")[0])
    if not (
        host == "youtube.com"
        or host.endswith(".youtube.com")
        or host == "youtube-nocookie.com"
        or host.endswith(".youtube-nocookie.com")
    ):
        return None
    query_id = _youtube_id((parse_qs(parsed.query or "").get("v") or [None])[0])
    if query_id:
        return query_id
    parts = [part for part in (parsed.path or "").split("/") if part]
    if len(parts) >= 2 and parts[0].lower() in {"embed", "shorts", "live"}:
        return _youtube_id(parts[1])
    return None


def _youtube_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _is_sc_metadata_youtube(candidate) -> bool:
    metadata = getattr(candidate, "metadata", None) or {}
    url = getattr(candidate, "trailer_url", None) or getattr(candidate, "manifest_url", None)
    return bool(
        getattr(candidate, "source", None) == "streamingcommunity"
        and isinstance(metadata, dict)
        and metadata.get("sc_youtube_metadata") is True
        and metadata.get("tmdb_match") == "exact"
        and _youtube_id_from_url(url)
    )


def install_sc_youtube_metadata_policy() -> bool:
    global _INSTALLED
    if _INSTALLED:
        return True

    from services.trailers import base as base_module
    from services.trailers import queue_policy as queue_policy_module
    from services.trailers import resolver as resolver_module
    from services.trailers.providers import streamingcommunity as sc_module

    # Keep the currently reachable public SC mirror first. Mirrors change over
    # time, so the rest of the configured list remains as fallback.
    bases = tuple(getattr(sc_module, "DEFAULT_BASE_URLS", ()) or ())
    sc_module.DEFAULT_BASE_URLS = (
        CURRENT_SC_MIRROR,
        *[base for base in bases if str(base).rstrip("/") != CURRENT_SC_MIRROR],
    )

    # Make all old "no trailer" cache rows stale immediately. Otherwise titles
    # checked just before this feature was deployed would wait for their old TTL
    # before being re-scanned for youtube_id metadata.
    queue_policy_module.TRAILER_POLICY_VERSION = SC_YOUTUBE_POLICY_VERSION

    original_rows = sc_module._trailer_rows
    if not getattr(original_rows, "_flixit_sc_youtube_metadata", False):
        def trailer_rows_with_sc_youtube(title: dict, base=None):
            rows = list(original_rows(title, base))
            seen = {url for _row, url in rows}
            trailers = (title.get("trailers") or []) if isinstance(title, dict) else []
            if isinstance(trailers, dict):
                trailers = [trailers]
            if isinstance(trailers, list):
                for row in trailers:
                    if not isinstance(row, dict):
                        continue
                    video_id = _youtube_id(row.get("youtube_id") or row.get("youtubeId"))
                    if not video_id:
                        continue
                    url = _youtube_url(video_id)
                    if url in seen:
                        continue
                    seen.add(url)
                    rows.append((row, url))
            return rows

        trailer_rows_with_sc_youtube._flixit_sc_youtube_metadata = True
        trailer_rows_with_sc_youtube._original = original_rows
        sc_module._trailer_rows = trailer_rows_with_sc_youtube

    # Install the bounded parallel SC metadata pass before wrapping discover for
    # youtube_id provenance. This means fast-path YouTube candidates still flow
    # through the exact same SC-only provenance marking below.
    try:
        from services.trailers.fast_sc_discovery import install_fast_sc_discovery
        install_fast_sc_discovery()
    except Exception:
        pass

    current_discover = sc_module.StreamingCommunityTrailerProvider.discover
    if not getattr(current_discover, "_flixit_sc_youtube_metadata", False):
        async def discover_with_sc_youtube(self, identity: dict):
            candidates = await current_discover(self, identity)
            for candidate in candidates or []:
                url = candidate.trailer_url or candidate.manifest_url
                video_id = _youtube_id_from_url(url)
                if not video_id:
                    continue
                metadata = dict(candidate.metadata or {})
                # A YouTube URL can only reach this point because the patched
                # _trailer_rows read an explicit youtube_id from SC metadata.
                metadata.update({
                    "native_sc_trailer": True,
                    "sc_youtube_metadata": True,
                    "sc_youtube_id": video_id,
                    "tmdb_match": "exact",
                })
                candidate.metadata = metadata
                candidate.compatibility = "sc-youtube-metadata"
                candidate.browser_compatible = True
                candidate.verified = True
                candidate.confidence = max(float(candidate.confidence or 0), 1.0)
            return candidates

        discover_with_sc_youtube._flixit_sc_youtube_metadata = True
        discover_with_sc_youtube._original = current_discover
        sc_module.StreamingCommunityTrailerProvider.discover = discover_with_sc_youtube

    original_usable = base_module.candidate_is_usable
    if not getattr(original_usable, "_flixit_sc_youtube_metadata", False):
        def candidate_is_usable_with_sc_youtube(candidate, *, allow_manual: bool = False):
            if _is_sc_metadata_youtube(candidate):
                if float(getattr(candidate, "confidence", 0) or 0) < 0.90:
                    return False
                if not bool(getattr(candidate, "verified", False)):
                    return False
                if not bool(getattr(candidate, "browser_compatible", False)):
                    return False
                duration = getattr(candidate, "duration_seconds", None)
                try:
                    if duration is not None and float(duration) < base_module.MIN_KNOWN_TRAILER_DURATION_SECONDS:
                        return False
                except Exception:
                    pass
                return True
            return original_usable(candidate, allow_manual=allow_manual)

        candidate_is_usable_with_sc_youtube._flixit_sc_youtube_metadata = True
        candidate_is_usable_with_sc_youtube._original = original_usable
        base_module.candidate_is_usable = candidate_is_usable_with_sc_youtube
        # resolver.py imports the function by name, so patch that bound symbol too.
        resolver_module.candidate_is_usable = candidate_is_usable_with_sc_youtube

    _INSTALLED = True
    return True


__all__ = [
    "install_sc_youtube_metadata_policy",
    "SC_YOUTUBE_POLICY_VERSION",
    "CURRENT_SC_MIRROR",
]
