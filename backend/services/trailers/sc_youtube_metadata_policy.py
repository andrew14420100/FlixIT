"""StreamingCommunity native trailer policy (v19).

Historical compatibility note: this module keeps the old function name because
startup code imports it, but v19 deliberately does NOT turn SC ``youtube_id``
metadata into a playable trailer candidate.

Only trailer media that StreamingCommunity itself exposes as a direct video/HLS
URL or an explicit Vixcloud trailer embed is allowed into the resolver. The
exact TMDB match performed by ``StreamingCommunityTrailerProvider`` remains the
identity guard. This keeps FLIX-IT's visible trailer player provider-neutral and
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


def _native_sc_selected(selected: dict) -> bool:
    if not isinstance(selected, dict):
        return False
    source = str(selected.get("source") or "").strip().lower()
    url = str(selected.get("trailer_url") or selected.get("manifest_url") or "").strip()
    metadata = selected.get("metadata") if isinstance(selected.get("metadata"), dict) else {}
    return bool(
        source == "streamingcommunity"
        and url
        and not _youtube_id_from_url(url)
        and metadata.get("native_sc_trailer") is True
        and metadata.get("tmdb_match") == "exact"
    )


def install_sc_youtube_metadata_policy() -> bool:
    """Install the SC-native/no-YouTube trailer path.

    The legacy function name is preserved for startup compatibility. It now:
    - invalidates old YouTube-derived/no-trailer cache generations;
    - places the real StreamingCommunity provider first;
    - keeps ``youtube_id`` metadata non-playable;
    - marks an exact SC native/Vixcloud trailer as trusted for the public route,
      even if SC omitted a separate language field.
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

    current_public_result = resolver_module.TrailerResolver.public_result
    if not getattr(current_public_result, "_flixit_sc_native_v19", False):
        def public_result_with_sc_native(self, media_type: str, tmdb_id: int, *, hdr_supported: bool = False):
            result = current_public_result(self, media_type, tmdb_id, hdr_supported=hdr_supported)
            selected = result.get("selected") if isinstance(result, dict) else None
            if _native_sc_selected(selected):
                selected = dict(selected)
                # The trailer comes from the exact Italian SC title page. Keep
                # the source provenance explicit rather than pretending it was
                # independently audio-probed.
                selected.setdefault("audio_language", "it")
                result = {
                    **result,
                    "selected": selected,
                    "language_verified": True,
                    "italian_only": True,
                    "sc_exact_trailer": True,
                    "youtube": False,
                }
            return result

        public_result_with_sc_native._flixit_sc_native_v19 = True
        public_result_with_sc_native._original = current_public_result
        resolver_module.TrailerResolver.public_result = public_result_with_sc_native

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
