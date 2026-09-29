"""StreamingCommunity native trailer policy (v19).

Historical compatibility note: this module keeps the old function name because
startup code imports it, but v19 deliberately does NOT turn SC ``youtube_id``
metadata into a playable trailer candidate.

Only trailer media that StreamingCommunity itself exposes as a direct video/HLS
URL or an explicit Vixcloud trailer embed is allowed into the resolver.  The
exact TMDB match performed by ``StreamingCommunityTrailerProvider`` remains the
identity guard.  This keeps FLIX-IT's visible trailer player provider-neutral and
removes YouTube controls/branding from the playback path.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse


_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_INSTALLED = False
SC_YOUTUBE_POLICY_VERSION = "streamingcommunity-native-trailer-v19-no-youtube"
CURRENT_SC_MIRROR = "https://streamingunity-premium.to"


def _youtube_id(value) -> str | None:
    text = str(value or "").strip()
    return text if _YOUTUBE_ID_RE.fullmatch(text) else None


def _youtube_id_from_url(value) -> str | None:
    """Compatibility helper used by old diagnostics; never enables playback."""
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
    url = getattr(candidate, "trailer_url", None) or getattr(candidate, "manifest_url", None)
    return bool(getattr(candidate, "source", None) == "streamingcommunity" and _youtube_id_from_url(url))


def install_sc_youtube_metadata_policy() -> bool:
    """Install the SC-native/no-YouTube trailer path.

    The legacy function name is intentionally preserved to avoid touching every
    startup hook.  It now invalidates old trailer cache generations, places the
    real StreamingCommunity provider first, and leaves ``youtube_id`` as metadata
    only.
    """
    global _INSTALLED
    if _INSTALLED:
        return True

    from services.trailers import queue_policy as queue_policy_module
    from services.trailers import resolver as resolver_module
    from services.trailers.providers import StreamingCommunityTrailerProvider
    from services.trailers.providers import streamingcommunity as sc_module

    bases = tuple(getattr(sc_module, "DEFAULT_BASE_URLS", ()) or ())
    sc_module.DEFAULT_BASE_URLS = (
        CURRENT_SC_MIRROR,
        *[base for base in bases if str(base).rstrip("/") != CURRENT_SC_MIRROR],
    )

    # Force old YouTube-derived/no-trailer rows to be rebuilt with the v19
    # native-SC policy.
    queue_policy_module.TRAILER_POLICY_VERSION = SC_YOUTUBE_POLICY_VERSION

    current_init = resolver_module.TrailerResolver.__init__
    if not getattr(current_init, "_flixit_sc_native_v19", False):
        def init_with_sc_native(self, *args, **kwargs):
            current_init(self, *args, **kwargs)
            providers = list(getattr(self, "providers", []) or [])
            providers = [p for p in providers if getattr(p, "name", "") != "streamingcommunity"]
            providers.insert(0, StreamingCommunityTrailerProvider())
            self.providers = providers

        init_with_sc_native._flixit_sc_native_v19 = True
        init_with_sc_native._original = current_init
        resolver_module.TrailerResolver.__init__ = init_with_sc_native

    # Keep the fast exact-SC identity discovery optimisation.  It does not add
    # YouTube candidates; it only accelerates title matching.
    try:
        from services.trailers.fast_sc_discovery import install_fast_sc_discovery
        install_fast_sc_discovery()
    except Exception:
        pass

    _INSTALLED = True
    return True


__all__ = [
    "install_sc_youtube_metadata_policy",
    "SC_YOUTUBE_POLICY_VERSION",
    "CURRENT_SC_MIRROR",
]
