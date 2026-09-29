"""Final fail-closed guard for Italian TV episode audio.

A provider request made with ``lang=it`` can echo locale/routing information in
JSON or URLs even while the media audio is original/English.  The public
catalogue therefore accepts an episode only when an audio/dub/voice track carries
an explicit Italian language marker.  Generic page/request locale never counts.

This module is installed after the legacy Italian policy.  It replaces the hint
extractor, wraps the final source inspector, bumps the policy version (invalidating
older Mongo snapshots/verdicts), and exposes an explicit evidence bit that the
frontend can also require as a last line of defence.
"""
from __future__ import annotations

import time
from typing import Any

POLICY_VERSION = "strict-explicit-it-v9-confirmed-audio-track-only"
AVAILABILITY_VERSION = "streamportal-live-v5-confirmed-audio-track-only"
_INSTALLED = False


def _leaf_strings(value: Any, limit: int = 40) -> list[str]:
    out: list[str] = []

    def walk(node: Any) -> None:
        if len(out) >= limit:
            return
        if isinstance(node, (str, int, float, bool)):
            text = str(node).strip()
            if text:
                out.append(text)
            return
        if isinstance(node, dict):
            for child in node.values():
                walk(child)
                if len(out) >= limit:
                    return
        elif isinstance(node, (list, tuple, set)):
            for child in node:
                walk(child)
                if len(out) >= limit:
                    return

    walk(value)
    return out


def _strict_language_hints_factory(policy_module):
    """Return only language evidence that belongs to an audio context.

    Top-level ``lang``, ``language`` and ``locale`` are deliberately ignored.
    Generic stream/track arrays are neutral until a child identifies itself as
    audio/dub/voice via a key or ``type/kind/role`` marker.
    """

    def strict_language_hints(payload: dict) -> list[str]:
        hints: list[str] = []

        def add(value: Any) -> None:
            for item in _leaf_strings(value):
                text = str(item).strip()
                # URLs frequently contain ?lang=it for the UI/player request.
                # A URL itself is never audio-language evidence.
                if not text or "://" in text or text.startswith("/"):
                    continue
                if text not in hints:
                    hints.append(text)

        def marker_is_audio(value: Any) -> bool:
            text = policy_module._normal(value).replace("-", "")
            return any(
                marker in text
                for marker in ("audio", "dub", "voice", "soundtrack", "audiotrack")
            )

        def walk(node: Any, audio_context: bool = False) -> None:
            if isinstance(node, dict):
                node_audio = audio_context or any(
                    marker_is_audio(node.get(key))
                    for key in ("type", "kind", "role", "stream_type", "content_type")
                    if node.get(key) is not None
                )

                for raw_key, value in node.items():
                    key = policy_module._normal(raw_key).replace("-", "")
                    is_audio_key = any(
                        marker in key
                        for marker in ("audio", "dub", "voice", "soundtrack", "audiotrack")
                    )
                    is_neutral_container = key in {
                        "tracks", "track", "streams", "stream", "variants", "renditions"
                    }
                    next_context = node_audio or is_audio_key

                    if is_audio_key:
                        # Explicit fields such as audio_language, dubbing,
                        # audioTracks etc. are allowed to contribute evidence.
                        add(value)
                    elif node_audio and key in {
                        "lang", "language", "locale", "name", "label", "title", "code"
                    }:
                        add(value)

                    if isinstance(value, (dict, list, tuple)):
                        child_context = next_context if not is_neutral_container else node_audio
                        walk(value, child_context)
            elif isinstance(node, (list, tuple)):
                for child in node:
                    walk(child, audio_context)

        if isinstance(payload, dict):
            walk(payload, False)
        return hints[:40]

    return strict_language_hints


def _explicit_italian(policy_module, hints: Any) -> bool:
    values = hints if isinstance(hints, (list, tuple, set)) else []
    has_it = any(policy_module._is_italian(value) for value in values)
    has_original = any(policy_module._is_original_only(value) for value in values)
    return bool(has_it and not has_original)


def install_strict_audio_evidence(app=None) -> bool:
    global _INSTALLED
    if _INSTALLED:
        return True

    try:
        import services.italian_episode_policy as episode_policy
        import services.strict_italian_tv as strict_tv
        import services.streamportal_availability as availability
    except Exception:
        return False

    episode_policy._language_hints = _strict_language_hints_factory(episode_policy)
    episode_policy.POLICY_VERSION = POLICY_VERSION
    strict_tv.STRICT_EPISODE_POLICY_VERSION = POLICY_VERSION
    strict_tv.STRICT_AVAILABILITY_POLICY_VERSION = AVAILABILITY_VERSION
    availability.POLICY_VERSION = AVAILABILITY_VERSION

    # Wrap the *final* inspector as well.  The legacy implementation used to
    # interpret "stream exists + no explicit English" as Italian.  Unknown audio
    # must instead fail closed.
    current_inspect = episode_policy._inspect_source
    if not getattr(current_inspect, "_flixit_confirmed_audio_v9", False):
        async def confirmed_audio_inspect(tmdb_id: int, season: int, episode: int):
            result = await current_inspect(tmdb_id, season, episode)
            if not isinstance(result, dict):
                return result

            out = dict(result)
            hints = out.get("detected_languages") or []
            explicit_it = _explicit_italian(episode_policy, hints)
            source_available = bool(out.get("source_available"))

            if explicit_it and source_available:
                out["italian_available"] = True
                out["italian_audio_status"] = "italian"
                ttl = 24 * 60 * 60.0
            else:
                out["italian_available"] = False
                if source_available and any(episode_policy._is_original_only(value) for value in hints):
                    out["italian_audio_status"] = "original_only"
                    ttl = 20 * 60.0
                elif source_available:
                    out["italian_audio_status"] = "language_unconfirmed"
                    ttl = 10 * 60.0
                else:
                    ttl = 45.0

            out["italian_audio_evidence_explicit"] = bool(explicit_it and source_available)
            out["italian_audio_policy_version"] = POLICY_VERSION

            try:
                key = (int(tmdb_id), int(season), int(episode))
                episode_policy._cache[key] = (time.monotonic() + ttl, dict(out))
            except Exception:
                pass
            return out

        confirmed_audio_inspect._flixit_confirmed_audio_v9 = True
        confirmed_audio_inspect._original = current_inspect
        episode_policy._inspect_source = confirmed_audio_inspect

    # Anything produced by v8 or the legacy policy must be recomputed under v9.
    try:
        episode_policy._cache.clear()
    except Exception:
        pass

    try:
        if app is not None:
            app.state.flixit_strict_audio_evidence = {
                "installed": True,
                "policy": POLICY_VERSION,
                "mode": "explicit_audio_track_only_fail_closed",
                "generic_lang_locale_is_not_audio_evidence": True,
                "unknown_audio_is_italian": False,
                "frontend_evidence_bit": "italian_audio_evidence_explicit",
            }
    except Exception:
        pass

    _INSTALLED = True
    return True


__all__ = [
    "install_strict_audio_evidence",
    "POLICY_VERSION",
    "AVAILABILITY_VERSION",
    "_explicit_italian",
]
