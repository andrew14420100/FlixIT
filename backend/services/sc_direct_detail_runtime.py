"""Per-app runtime registrar for StreamingCommunity direct Detail routes.

Every call removes the previous public TV seasons/episodes/status handlers from
the supplied FastAPI app and binds the SC-direct handlers directly with
``app.add_api_route``. This avoids process-global installer state and avoids an
intermediate APIRouter while routes are being replaced dynamically.

Catalogue data uses the same public SC flow implemented in
``sc_direct_detail_v18``: title data-page -> props.title.seasons -> season-N ->
props.loadedSeason.episodes. VixSrc remains playback-only.
"""
from __future__ import annotations

from fastapi.routing import APIRoute

from services import sc_direct_detail_v18 as direct
from services import sc_native_catalog_v17 as sc


def install_sc_direct_detail_runtime(app, db) -> bool:
    direct._db = db

    kept = []
    for route in app.router.routes:
        if isinstance(route, APIRoute) and "GET" in (route.methods or set()):
            if route.path in {direct.SEASONS_PATH, direct.SEASON_PATH, direct.STATUS_PATH}:
                continue
        kept.append(route)
    app.router.routes[:] = kept

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
            "registration": "per_app_add_api_route",
        }

    app.add_api_route(
        direct.SEASONS_PATH,
        direct_sc_seasons,
        methods=["GET"],
        tags=["catalog"],
        name="sc_direct_tv_seasons_v18",
    )
    app.add_api_route(
        direct.SEASON_PATH,
        direct_sc_episodes,
        methods=["GET"],
        tags=["catalog"],
        name="sc_direct_tv_episodes_v18",
    )
    app.add_api_route(
        direct.STATUS_PATH,
        direct_status,
        methods=["GET"],
        tags=["catalog"],
        name="sc_direct_status_v18",
    )

    app.state.flixit_sc_direct_detail_runtime = True
    app.state.flixit_sc_direct_detail_v18 = True
    return True


__all__ = ["install_sc_direct_detail_runtime"]
