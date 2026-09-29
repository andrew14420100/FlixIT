"""Harden TV episode language evidence.

A provider request made with ``lang=it`` can echo locale/routing information in
its JSON or embed URL even when the actual audio track is still original/English.
Those generic hints must never be treated as proof of an Italian dub.

This installer runs after the existing strict Italian policy.  It replaces only
the language-hint extractor used by that policy, bumps the policy version so old
false-positive Mongo verdicts are ignored, and clears in-process verdicts.
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
    """Collect only fields that describe audio/dubbing, never request locale.

    Generic top-level fields such as ``lang``, ``language`` and ``locale`` are
    intentionally ignored because providers often echo the requested interface
    locale there.  A language field is accepted only while walking inside an
    audio/dub/voice/track object.
    """

    def strict_language_hints(payload: dict) -> list[str]:
        hints: list[str] = []

        def add(value: Any) -> None:
            for item in _leaf_strings(value):
                if item not in hints:
                    hints.append(item)

        def walk(node: Any, audio_context: bool = False) -> None:
            if isinstance(node, dict):
                for raw_key, value in node.items():
                    key = policy_module._normal(raw_key).replace("-", "")
                    is_audio_key = any(
                        marker in key
                        for marker in (
                            "audio",
                            "dub",
                            "voice",
                            "soundtrack",
                            "audiotrack",
                        )
                    )
                    is_track_container = key in {
                        "tracks",
                        "track",
                        "streams",
                        "stream",
                        "variants",
                        "renditions",
                    }
                    next_context = audio_context or is_audio_key

                    if is_audio_key:
                        add(value)
                    elif audio_context and key in {
                        "lang",
                        "language",
                        "locale",
                        "name",
                        "label",
                        "title",
                        "code",
                    }:
                        add(value)

                    # A generic stream/track container is traversed but does not
                    # become audio evidence until one of its children explicitly
                    # identifies itself as audio/dub/voice.
                    child_context = next_context if not is_track_container else audio_context
                    if isinstance(value, (dict, list, tuple)):
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
            }
    except Exception:
        pass

    _INSTALLED = True
    return True


__all__ = ["install_strict_audio_evidence", "POLICY_VERSION", "AVAILABILITY_VERSION"]
