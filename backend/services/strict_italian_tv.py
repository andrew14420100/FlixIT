"""Strict Italian-only TV availability overlay.

The existing VixSrc catalogue already uses ``lang=it``, but a title-level
catalogue hit does not prove that every episode returned by the public TV API
has Italian audio.  This overlay makes the TV policy fail closed:

- an episode is visible only when the provider payload contains an explicit
  Italian language/audio hint;
- English/original-only and language-unconfirmed episodes stay hidden;
- explicit TV playability checks use the same strict Italian metadata gate;
- old positive availability cache entries are invalidated by a policy-version
  bump.

The homepage/catalogue rendering path is deliberately kept separate from live
provider probes so page loading is never blocked by dozens of upstream HTTP
requests. The strict episode gate still applies on season/detail responses.

The module only inspects public provider metadata. It does not resolve or
inspect the underlying media stream.
"""
from __future__ import annotations

from typing import Any


STRICT_EPISODE_POLICY_VERSION = "strict-explicit-it-v6-confirmed-only"
STRICT_AVAILABILITY_POLICY_VERSION = "streamportal-live-v2-strict-it-tv"
_INSTALLED = False


def _strict_episode_result(policy_module, value: Any):
    """Convert ambiguous positive episode decisions into fail-closed results."""
    if not isinstance(value, dict) or value.get("italian_available") is not True:
        return value

    hints = value.get("detected_languages") or []
    if any(policy_module._is_italian(item) for item in hints):
        return {
            **value,
            "italian_audio_status": "italian",
            "italian_audio_policy_version": STRICT_EPISODE_POLICY_VERSION,
        }

    return {
        **value,
        "italian_available": False,
        "italian_audio_status": "language_unconfirmed",
        "italian_audio_policy_version": STRICT_EPISODE_POLICY_VERSION,
    }


def install_strict_italian_tv_policy(app) -> bool:
    global _INSTALLED
    if _INSTALLED:
        return True

    try:
        import services.italian_episode_policy as episode_policy
        import services.streamportal_availability as availability
    except Exception:
        return False

    _INSTALLED = True

    # Changing both versions makes persisted positive availability from the old
    # policy stale immediately after deploy.
    episode_policy.POLICY_VERSION = STRICT_EPISODE_POLICY_VERSION
    availability.POLICY_VERSION = STRICT_AVAILABILITY_POLICY_VERSION

    try:
        episode_policy._cache.clear()
    except Exception:
        pass

    current_cache_hit = episode_policy._cache_hit
    if not getattr(current_cache_hit, "_flixit_strict_it_v6", False):
        def strict_cache_hit(key):
            return _strict_episode_result(episode_policy, current_cache_hit(key))

        strict_cache_hit._flixit_strict_it_v6 = True
        strict_cache_hit._original = current_cache_hit
        episode_policy._cache_hit = strict_cache_hit

    current_inspect = episode_policy._inspect_source
    if not getattr(current_inspect, "_flixit_strict_it_v6", False):
        async def strict_inspect_source(tmdb_id: int, season: int, episode: int):
            result = await current_inspect(tmdb_id, season, episode)
            return _strict_episode_result(episode_policy, result)

        strict_inspect_source._flixit_strict_it_v6 = True
        strict_inspect_source._original = current_inspect
        episode_policy._inspect_source = strict_inspect_source

    verifier_cls = availability.VixSrcAvailabilityVerifier
    current_probe = verifier_cls._probe_endpoint
    if not getattr(current_probe, "_flixit_strict_it_v2", False):
        async def strict_probe_endpoint(
            self,
            media_type: str,
            tmdb_id: int,
            *,
            season: int = 1,
            episode: int = 1,
        ):
            result, reason = await current_probe(
                self,
                media_type,
                tmdb_id,
                season=season,
                episode=episode,
            )

            if str(media_type or "").lower() != "tv" or result is not True:
                return result, reason

            audio = await episode_policy._inspect_source(
                int(tmdb_id), int(season), int(episode)
            )
            if audio.get("italian_available") is True:
                return True, f"{reason}_italian_confirmed"

            status = str(audio.get("italian_audio_status") or "language_unconfirmed")
            if status == "checking":
                return None, "italian_audio_checking"
            if status == "original_only":
                return False, "english_or_original_audio"
            if status == "not_published":
                return False, "episode_not_published"
            return False, "italian_audio_unconfirmed"

        strict_probe_endpoint._flixit_strict_it_v2 = True
        strict_probe_endpoint._original = current_probe
        verifier_cls._probe_endpoint = strict_probe_endpoint

    # Register the fast catalogue-only rendering path after the live verifier
    # and the strict-TV overlay. This keeps home/archive loads instant while the
    # episode/detail policy above continues to reject English/unconfirmed audio.
    try:
        from services.fast_catalog_availability import install_fast_catalog_availability
        install_fast_catalog_availability(app, getattr(app.state, "db", None))
    except Exception:
        try:
            # The DB argument is currently unused by the overlay; keep a fallback
            # for applications that do not expose it on app.state.
            from services.fast_catalog_availability import install_fast_catalog_availability
            install_fast_catalog_availability(app, None)
        except Exception:
            pass

    try:
        app.state.flixit_strict_italian_tv_policy = {
            "installed": True,
            "episode_policy": STRICT_EPISODE_POLICY_VERSION,
            "availability_policy": STRICT_AVAILABILITY_POLICY_VERSION,
            "mode": "explicit_italian_only_fail_closed",
            "catalog_rendering": "cached_lang_it_no_live_probe",
        }
    except Exception:
        pass

    return True


__all__ = [
    "install_strict_italian_tv_policy",
    "STRICT_EPISODE_POLICY_VERSION",
    "STRICT_AVAILABILITY_POLICY_VERSION",
]
