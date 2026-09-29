"""Per-app runtime registrar for StreamingCommunity direct Detail routes.

This deliberately avoids the process-global `_INSTALLED` guard used by the
legacy v18 installer. Emergent/reload setups can import modules against more than
one FastAPI instance in the same process; catalogue routes must be attached to
the actual app instance being served.

The data flow itself is unchanged and remains the SC-public flow implemented in
`sc_direct_detail_v18`: title data-page -> props.title.seasons -> season-N ->
props.loadedSeason.episodes. VixSrc is playback-only.
"""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.routing import APIRoute

from services import sc_direct_detail_v18 as direct
from services import sc_native_catalog_v17 as sc


def install_sc_direct_detail_runtime(app, db) -> bool:
    if getattr(app.state, "flixit_sc_direct_detail_runtime", False):
        return True

    direct._db = db

    # Make these handlers the final authority for seasons/episodes on this app.
    kept = []
    for route in app.router.routes:
        if isinstance(route, APIRoute) and "GET" in (route.methods or set()):
            if route.path in {direct.SEASONS_PATH, direct.SEASON_PATH, direct.STATUS_PATH}:
                continue
        kept.append(route)
    app.router.routes[:] = kept

    router = APIRouter()

    @router.get(direct.SEASONS_PATH, tags=["catalog"])
    async def direct_sc_seasons(tmdb_id: int):
        hit = await direct._resolve_title(int(tmdb_id))
        if not hit:
            cached = sc._season_payload(int(tmdb_id))
            return {
                **cached,
                "policy": direct.POLICY_VERSION,
                "direct_sc_ready": False,
            }
        title, _base, _path = hit
        seasons = sc._season_descriptors(title)
        return {
            "tmdbId": int(tmdb_id),
            "seasons": seasons,
            "total_seasons": len(seasons),
            "sc_index_ready": True,
            "direct_sc_ready": True,
            "policy": direct.POLICY_VERSION,
            "source": "StreamingCommunity props.title.seasons",
        }

    @router.get(direct.SEASON_PATH, tags=["catalog"])
    async def direct_sc_episodes(tmdb_id: int, season_number: int):
        loaded = await direct._resolve_season(int(tmdb_id), int(season_number))
        if loaded:
            return direct._episodes_payload(int(tmdb_id), int(season_number), loaded)

        cached = sc._episodes_payload(int(tmdb_id), int(season_number))
        if cached.get("episodes"):
            return {
                **cached,
                "italian_audio_policy_version": direct.POLICY_VERSION,
                "snapshot_source": "streamingcommunity_v17_cache_fallback",
            }

        return {
            "tmdbId": int(tmdb_id),
            "season_number": int(season_number),
            "episodes": [],
            "index_ready": False,
            "sc_index_ready": False,
            "italian_audio_policy": "streamingcommunity_direct_loadedSeason",
            "italian_audio_policy_version": direct.POLICY_VERSION,
            "snapshot_source": "streamingcommunity_direct_unavailable",
            "validation_pending_count": 0,
            "pending_recheck_seconds": 2,
        }

    @router.get(direct.STATUS_PATH, tags=["catalog"])
    async def direct_status():
        return {
            "policy": direct.POLICY_VERSION,
            "source": "StreamingCommunity data-page",
            "title_source": "props.title.seasons",
            "episode_source": "props.loadedSeason.episodes",
            "cached_titles": len(direct._title_cache),
            "cached_seasons": len(direct._season_cache),
            "vixsrc_role": "playback_only",
            "tmdb_role": "identity_metadata_only",
            "registration": "per_app_runtime",
        }

    app.include_router(router)
    app.state.flixit_sc_direct_detail_runtime = True
    app.state.flixit_sc_direct_detail_v18 = True
    return True


__all__ = ["install_sc_direct_detail_runtime"]
