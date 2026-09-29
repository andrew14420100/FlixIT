"""Zero-blank migration bridge for StreamingCommunity-native v17.

The SC index is authoritative, but a freshly deployed v17 database may need time
before the background crawler reaches a TV title. During that short window we
reuse the last *already persisted* v16 Italian episode membership from Mongo so
Detail never regresses to an empty episode list merely because migration is still
warming. No provider/network call is awaited in a user request.

As soon as a fallback title is requested we schedule that exact TMDB title for an
SC refresh in the background. Once SC data exists, the normal v17 payload wins
and this bridge becomes dormant for that title.
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

POLICY = "sc-native-catalog-v17"
LEGACY_COLLECTION = "italian_media_index_v16"
LEGACY_META = "italian_media_index_meta_v16"
LEGACY_SEED = "vixsrc_episode_catalog_it"

# Historical user-confirmed originals must never reappear during migration.
_HARD_NEGATIVE = {
    (65334, 6, 19),
    (65334, 6, 20),
    (65334, 6, 21),
}

_legacy_keys: set[tuple[int, int, int]] = set()
_legacy_loaded = False
_refreshing: set[int] = set()


def _positive_int(value: Any) -> int:
    try:
        number = int(value)
    except Exception:
        return 0
    return number if number > 0 else 0


def _load_legacy_membership(db) -> None:
    global _legacy_keys, _legacy_loaded
    keys: set[tuple[int, int, int]] = set()

    generation = ""
    try:
        row = db[LEGACY_META].find_one({"kind": "episode"}, {"_id": 0, "generation": 1}) or {}
        generation = str(row.get("generation") or "")
    except Exception:
        generation = ""

    if generation:
        try:
            rows = db[LEGACY_COLLECTION].find(
                {"kind": "episode", "generation": generation},
                {"_id": 0, "tmdbId": 1, "season": 1, "episode": 1},
            )
            for row in rows:
                key = (
                    _positive_int(row.get("tmdbId")),
                    _positive_int(row.get("season")),
                    _positive_int(row.get("episode")),
                )
                if all(key):
                    keys.add(key)
        except Exception:
            keys = set()

    # First v17 boot may predate the v16 generation collection. Reuse the legacy
    # persisted episode catalogue in that case; it is still local Mongo data.
    if not keys:
        try:
            rows = db[LEGACY_SEED].find(
                {}, {"_id": 0, "tmdbId": 1, "season": 1, "episode": 1}
            )
            for row in rows:
                key = (
                    _positive_int(row.get("tmdbId")),
                    _positive_int(row.get("season")),
                    _positive_int(row.get("episode")),
                )
                if all(key):
                    keys.add(key)
        except Exception:
            pass

    # Manual overrides remain final during migration.
    try:
        rows = db["italian_audio_overrides"].find(
            {},
            {
                "_id": 0,
                "tmdbId": 1,
                "season": 1,
                "episode": 1,
                "italian_available": 1,
            },
        )
        for row in rows:
            key = (
                _positive_int(row.get("tmdbId")),
                _positive_int(row.get("season")),
                _positive_int(row.get("episode")),
            )
            if not all(key):
                continue
            if row.get("italian_available") is True:
                keys.add(key)
            elif row.get("italian_available") is False:
                keys.discard(key)
    except Exception:
        pass

    keys.difference_update(_HARD_NEGATIVE)
    _legacy_keys = keys
    _legacy_loaded = True


def _legacy_numbers(tmdb_id: int, season: int) -> list[int]:
    tmdb_id = int(tmdb_id)
    season = int(season)
    return sorted(
        episode
        for media, season_number, episode in _legacy_keys
        if media == tmdb_id and season_number == season
    )


def _schedule_sc_priority(base, tmdb_id: int) -> None:
    tmdb_id = int(tmdb_id)
    if tmdb_id in _refreshing or not getattr(base, "_db", None):
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    _refreshing.add(tmdb_id)

    async def refresh_one() -> None:
        try:
            async with httpx.AsyncClient(
                timeout=base.HTTP_TIMEOUT,
                follow_redirects=True,
                limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
            ) as client:
                await base._find_and_index_tmdb(client, base._db, tmdb_id, "tv")
        except Exception:
            pass
        finally:
            _refreshing.discard(tmdb_id)

    try:
        base._keep(loop.create_task(refresh_one()))
    except Exception:
        _refreshing.discard(tmdb_id)


def install_sc_v17_migration_bridge() -> None:
    from services import sc_native_catalog_v17 as base

    if getattr(base, "_flixit_sc_v17_migration_bridge", False):
        return

    original_hydrate = base._hydrate
    original_episodes_payload = base._episodes_payload

    def hydrate_with_legacy(db) -> None:
        original_hydrate(db)
        _load_legacy_membership(db)

    hydrate_with_legacy._original = original_hydrate
    base._hydrate = hydrate_with_legacy

    def episodes_payload_with_bridge(tmdb_id: int, season_number: int) -> dict:
        exact = original_episodes_payload(tmdb_id, season_number)
        # If SC has indexed this TV title, even an empty SC season is authoritative.
        if int(tmdb_id) in base._tv_ids:
            return exact

        _schedule_sc_priority(base, int(tmdb_id))
        numbers = _legacy_numbers(int(tmdb_id), int(season_number)) if _legacy_loaded else []
        if not numbers:
            return {
                **exact,
                "index_ready": False,
                "sc_index_ready": False,
                "snapshot_source": "sc_index_warming",
                "pending_recheck_seconds": 2,
            }

        episodes = [
            {
                "tmdbId": int(tmdb_id),
                "season_number": int(season_number),
                "episode_number": int(number),
                "name": f"Episodio {number}",
                "overview": "",
                "still_path": "",
                "italian_available": True,
                # Compatibility flag so the existing v17 frontend renders this
                # verified local bridge. snapshot_source/evidence clearly state
                # that SC has not taken over this title yet.
                "sc_available": True,
                "vixsrc_available": True,
                "italian_audio_status": "verified_migration_snapshot",
                "italian_audio_evidence_explicit": True,
                "italian_audio_evidence_source": "italian_media_index_v16_bridge",
                "italian_audio_policy_version": POLICY,
                "language_validation_pending": False,
                "migration_fallback": True,
            }
            for number in numbers
        ]
        return {
            **exact,
            "episodes": episodes,
            "index_ready": True,
            "sc_index_ready": False,
            "italian_audio_policy_version": POLICY,
            "snapshot_source": "italian_media_index_v16_migration_bridge",
            "migration_fallback": True,
            "pending_recheck_seconds": 2,
        }

    episodes_payload_with_bridge._original = original_episodes_payload
    base._episodes_payload = episodes_payload_with_bridge
    base._flixit_sc_v17_migration_bridge = True


__all__ = [
    "install_sc_v17_migration_bridge",
    "_load_legacy_membership",
    "_legacy_numbers",
]
