"""Force the VixSrc direct-HLS resolver to keep the Italian audio preference.

The public VixSrc player documents ``lang=it`` as the preferred audio-track
selector. FlixIT bypasses the iframe and resolves the master playlist directly,
so the preference must be carried onto that final playlist URL as well.
"""
from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_INSTALLED = False


def _with_italian_lang(url: str) -> str:
    text = str(url or "").strip()
    if not text:
        return text
    try:
        parts = urlsplit(text)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        query["lang"] = "it"
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
    except Exception:
        separator = "&" if "?" in text else "?"
        return text if "lang=it" in text else f"{text}{separator}lang=it"


def install_vixsrc_italian_audio() -> bool:
    global _INSTALLED
    if _INSTALLED:
        return True

    try:
        import services.resolvers.vixsrc as resolver
        current_build = resolver._build_playlist_url
        if not getattr(current_build, "_flixit_force_it", False):
            def build_it(raw_url, token, expires, can_fhd):
                return _with_italian_lang(current_build(raw_url, token, expires, can_fhd))
            build_it._flixit_force_it = True
            build_it._original = current_build
            resolver._build_playlist_url = build_it
    except Exception:
        pass

    try:
        import services.vixsrc as legacy
        current_append = legacy._append_auth_params
        if not getattr(current_append, "_flixit_force_it", False):
            def append_it(playlist_url, token, expires):
                return _with_italian_lang(current_append(playlist_url, token, expires))
            append_it._flixit_force_it = True
            append_it._original = current_append
            legacy._append_auth_params = append_it
    except Exception:
        pass

    _INSTALLED = True
    return True


__all__ = ["install_vixsrc_italian_audio", "_with_italian_lang"]
