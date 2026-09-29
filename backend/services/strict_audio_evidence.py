"""Harden TV episode language evidence.

A provider request made with ``lang=it`` can echo locale/routing information in
its JSON or embed URL even when the actual audio track is original/English.
Generic locale hints are therefore never proof of an Italian dub.
"""
from __future__ import annotations

from typing import Any

POLICY_VERSION = "strict-explicit-it-v8-audio-evidence-only"
AVAILABILITY_VERSION = "streamportal-live-v4-strict-audio-evidence"
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
    """Collect only evidence tied to an audio/dub/voice track.

    Top-level ``lang``, ``language`` and ``locale`` are ignored. A generic track
    object is accepted only when it explicitly identifies itself as audio (for
    example ``kind=audio`` or ``type=audio``).
    """

    def strict_language_hints(payload: dict) -> list[str]:
        hints: list[str] = []

        def add(value: Any) -> None:
            for item in _leaf_strings(value):
                if item not in hints:
                    hints.append(item)

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
                    is_track_container = key in {
                        "tracks",
                        "track",
                        "streams",
                        "stream",
                        "variants",
                        "renditions",
                    }
                    next_context = node_audio or is_audio_key

                    if is_audio_key:
                        add(value)
                    elif node_audio and key in {
                        "lang",
                        "language",
                        "locale",
                        "name",
                        "label",
                        "title",
                        "code",
                    }:
                        add(value)

                    if isinstance(value, (dict, list, tuple)):
                        # Containers themselves are neutral. Their child objects
                        # can opt into audio context via type/kind/role markers.
                        child_context = next_context if not is_track_container else node_audio
                        walk(value, child_context)
            elif isinstance(node, (list, tuple)):
                for child in node:
                    walk(child, audio_context)

        if isinstance(payload, dict):
            walk(payload, False)
        return hints[:40]

    return strict_language_hints


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

    # Old in-memory positives may have been produced from a generic lang=it echo.
    try:
        episode_policy._cache.clear()
    except Exception:
        pass

    try:
        if app is not None:
            app.state.flixit_strict_audio_evidence = {
                "installed": True,
                "policy": POLICY_VERSION,
                "mode": "explicit_audio_evidence_only_fail_closed",
                "generic_lang_locale_is_not_audio_evidence": True,
                "explicit_track_objects_supported": True,
            }
    except Exception:
        pass

    _INSTALLED = True
    return True


__all__ = ["install_strict_audio_evidence", "POLICY_VERSION", "AVAILABILITY_VERSION"]
