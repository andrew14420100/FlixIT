"""Strict Italian-only TV availability overlay.

Only explicitly confirmed Italian-audio episodes are public. Unknown language,
English/original-only and future/unpublished episodes fail closed. Confirmed
results are persisted so the Detail page can reuse them immediately after a
backend restart instead of probing every episode again.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any


STRICT_EPISODE_POLICY_VERSION = "strict-explicit-it-v7-persistent-confirmed-only"
STRICT_AVAILABILITY_POLICY_VERSION = "streamportal-live-v3-strict-it-tv"
_INSTALLED = False


def _strict_episode_result(policy_module, value: Any):
    """Accept a positive episode decision only with an explicit Italian hint."""
    if not isinstance(value, dict):
        return value

    if value.get("italian_available") is not True:
        return {
            **value,
            "italian_audio_policy_version": STRICT_EPISODE_POLICY_VERSION,
        }

    hints = value.get("detected_languages") or []
    if any(policy_module._is_italian(item) for item in hints):
        return {
            **value,
            "italian_available": True,
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
        import server_core as core
        import services.italian_episode_policy as episode_policy
        import services.streamportal_availability as availability
    except Exception:
        return False

    # The strict wrapper used to patch helper functions without guaranteeing that
    # the actual public season route had been installed. Install it explicitly
    # first, then patch the globals it reads at request time.
    try:
        episode_policy.install_italian_episode_policy(app)
    except Exception:
        pass

    _INSTALLED = True
    episode_policy.POLICY_VERSION = STRICT_EPISODE_POLICY_VERSION
    availability.POLICY_VERSION = STRICT_AVAILABILITY_POLICY_VERSION

    try:
        episode_policy._cache.clear()
    except Exception:
        pass

    # Never fill missing Italian episode text from en-US. If Italian metadata is
    # missing the frontend shows its neutral "Episodio N" fallback instead.
    async def no_english_episode_map(_tmdb_id: int, _season_number: int):
        return {}

    episode_policy._english_episode_map = no_english_episode_map

    # Title-level catalogue checks must also fail closed. The old helper returned
    # True when the lang=it catalogue had not loaded yet, which could temporarily
    # expose English/unverified titles after a restart.
    def strict_is_on_vixsrc(media_type: str, tmdb_id: int) -> bool:
        kind = "tv" if str(media_type or "").lower() == "tv" else "movie"
        try:
            tmdb_id = int(tmdb_id)
        except Exception:
            return False
        try:
            if core._stream_blocklist.is_blocked(kind, tmdb_id):
                return False
        except Exception:
            return False
        ids = (getattr(core, "_vix_ids", {}) or {}).get(kind) or set()
        return bool(ids) and tmdb_id in ids

    core.is_on_vixsrc = strict_is_on_vixsrc

    # Persist per-episode language decisions. This is deliberately separate from
    # source URLs: only the language/availability verdict is stored.
    persistent = None
    try:
        persistent = core.db["italian_episode_audio_cache"]
        persistent.create_index(
            [("tmdbId", 1), ("season", 1), ("episode", 1)], unique=True
        )
        persistent.create_index("expires_at")
    except Exception:
        persistent = None

    current_cache_hit = episode_policy._cache_hit

    def persistent_cache_hit(key):
        result = _strict_episode_result(episode_policy, current_cache_hit(key))
        if isinstance(result, dict):
            return result
        if persistent is None:
            return None
        try:
            tmdb_id, season, episode = (int(key[0]), int(key[1]), int(key[2]))
            doc = persistent.find_one(
                {"tmdbId": tmdb_id, "season": season, "episode": episode},
                {"_id": 0},
            ) or {}
            if doc.get("policy") != STRICT_EPISODE_POLICY_VERSION:
                return None
            expires_at = doc.get("expires_at")
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if not expires_at or expires_at <= datetime.now(timezone.utc):
                return None
            value = _strict_episode_result(episode_policy, doc.get("result") or {})
            if not isinstance(value, dict):
                return None
            seconds = max(1.0, (expires_at - datetime.now(timezone.utc)).total_seconds())
            episode_policy._cache[(tmdb_id, season, episode)] = (
                time.monotonic() + seconds,
                dict(value),
            )
            return dict(value)
        except Exception:
            return None

    persistent_cache_hit._flixit_strict_it_v7 = True
    persistent_cache_hit._original = current_cache_hit
    episode_policy._cache_hit = persistent_cache_hit

    current_inspect = episode_policy._inspect_source

    async def strict_inspect_source(tmdb_id: int, season: int, episode: int):
        result = _strict_episode_result(
            episode_policy,
            await current_inspect(tmdb_id, season, episode),
        )
        if not isinstance(result, dict):
            return result

        status = str(result.get("italian_audio_status") or "checking")
        if result.get("italian_available") is True:
            ttl = timedelta(hours=24)
        elif status in {"original_only", "not_published", "not_aired", "language_unconfirmed"}:
            ttl = timedelta(minutes=20)
        else:
            ttl = timedelta(seconds=45)

        key = (int(tmdb_id), int(season), int(episode))
        episode_policy._cache[key] = (
            time.monotonic() + ttl.total_seconds(),
            dict(result),
        )
        if persistent is not None:
            try:
                now = datetime.now(timezone.utc)
                persistent.update_one(
                    {"tmdbId": key[0], "season": key[1], "episode": key[2]},
                    {"$set": {
                        "tmdbId": key[0],
                        "season": key[1],
                        "episode": key[2],
                        "result": dict(result),
                        "policy": STRICT_EPISODE_POLICY_VERSION,
                        "checked_at": now.isoformat(),
                        "expires_at": (now + ttl).isoformat(),
                    }},
                    upsert=True,
                )
            except Exception:
                pass
        return result

    strict_inspect_source._flixit_strict_it_v7 = True
    strict_inspect_source._original = current_inspect
    episode_policy._inspect_source = strict_inspect_source

    verifier_cls = availability.VixSrcAvailabilityVerifier
    current_probe = verifier_cls._probe_endpoint
    if not getattr(current_probe, "_flixit_strict_it_v3", False):
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
            if status in {"not_published", "not_aired"}:
                return False, "episode_not_published"
            return False, "italian_audio_unconfirmed"

        strict_probe_endpoint._flixit_strict_it_v3 = True
        strict_probe_endpoint._original = current_probe
        verifier_cls._probe_endpoint = strict_probe_endpoint

    try:
        from services.fast_catalog_availability import install_fast_catalog_availability
        install_fast_catalog_availability(app, core.db)
    except Exception:
        pass

    try:
        app.state.flixit_strict_italian_tv_policy = {
            "installed": True,
            "episode_policy": STRICT_EPISODE_POLICY_VERSION,
            "availability_policy": STRICT_AVAILABILITY_POLICY_VERSION,
            "mode": "explicit_italian_only_fail_closed_persistent",
            "catalog_rendering": "cached_lang_it_no_live_probe",
            "english_episode_metadata_fallback": False,
        }
    except Exception:
        pass

    return True


__all__ = [
    "install_strict_italian_tv_policy",
    "STRICT_EPISODE_POLICY_VERSION",
    "STRICT_AVAILABILITY_POLICY_VERSION",
]
