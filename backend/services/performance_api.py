"""Small, cache-friendly APIs used by the performance-sensitive frontend paths.

The browser must never download the complete SC artwork catalogue. The backend
keeps the committed catalogue indexed in memory and returns only the artwork for
the titles currently needed by the UI.
"""
from __future__ import annotations

import asyncio
import os
import sys
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import services.artwork_card_policy as card_policy
from services.sc_artwork_catalog import CATALOG, _url_for

MAX_BATCH_ITEMS = 120
API_VERSION = "sc-artwork-batch-v3-fast-enrichment"
BUNDLE_CACHE_MAX = 30000
STARTUP_BACKGROUND_GRACE_SECONDS = 12.0
_bundle_cache: dict[tuple, dict] = {}
_asset_warm_inflight: set[tuple[str, int]] = set()
_asset_warm_tasks: set[asyncio.Task] = set()
_asset_warm_semaphore = asyncio.Semaphore(4)


def _media_type(raw: dict) -> str:
    value = str(raw.get("type") or raw.get("media_type") or "").lower()
    return "tv" if value == "tv" or "series" in value else "movie"


def _tmdb_id(raw: dict) -> int:
    try:
        return max(0, int(raw.get("tmdbId") or raw.get("tmdb_id") or raw.get("id") or 0))
    except Exception:
        return 0


def _first_url(images: dict, keys: tuple[str, ...]):
    for key in keys:
        value = images.get(key)
        if value:
            url = _url_for(value)
            if url:
                return url
    return None


def _bundle_uncached(raw: dict) -> dict | None:
    tmdb_id = _tmdb_id(raw)
    if not tmdb_id:
        return None
    media_type = _media_type(raw)
    title = str(raw.get("title") or raw.get("name") or "").strip()
    original_title = str(raw.get("original_title") or raw.get("original_name") or "").strip()
    year = raw.get("year") or raw.get("release_date") or raw.get("first_air_date")
    identity = {
        "type": media_type,
        "tmdbId": tmdb_id,
        "title": title,
        "original_title": original_title,
        "year": year,
    }

    candidates = CATALOG.candidates(identity)
    if not candidates:
        return {
            "active": False,
            "type": media_type,
            "tmdbId": tmdb_id,
            "title": title,
            "card_ready": False,
            "top10_ready": False,
            "version": API_VERSION,
        }

    ranked = sorted(
        ((float(card_policy._match_score(row, identity)), row) for row in candidates),
        key=lambda pair: pair[0],
        reverse=True,
    )
    confidence, record = ranked[0]
    if confidence < 0.62:
        return {
            "active": False,
            "type": media_type,
            "tmdbId": tmdb_id,
            "title": title,
            "card_ready": False,
            "top10_ready": False,
            "version": API_VERSION,
        }

    images = record.get("images") or {}
    landscape = _first_url(images, ("cover", "cover_desktop", "landscape", "card"))
    poster = _first_url(images, ("poster", "poster_mobile"))
    background = _first_url(images, ("background", "backdrop", "hero", "wallpaper")) or landscape or poster
    logo = _first_url(images, ("logo", "title_logo", "title-treatment", "title_treatment"))

    return {
        "active": bool(landscape or poster or background or logo),
        "type": media_type,
        "tmdbId": tmdb_id,
        "title": title or record.get("name") or "",
        "backdrop_url": landscape,
        "poster_url": poster,
        "hero_backdrop_url": background,
        "detail_backdrop_url": background,
        "logo_url": logo,
        "backdrop_source": "streamingcommunity" if landscape else None,
        "poster_source": "streamingcommunity" if poster else None,
        "hero_backdrop_source": "streamingcommunity" if background else None,
        "logo_source": "streamingcommunity" if logo else None,
        "backdrop_locale": "it" if landscape else None,
        "poster_locale": "it" if poster else None,
        "hero_backdrop_locale": "it" if background else None,
        "logo_locale": "it" if logo else None,
        "backdrop_embedded_title_treatment": bool(landscape),
        "poster_embedded_title_treatment": bool(poster),
        "hero_embedded_title_treatment": bool(background in {landscape, poster}),
        "embedded_title_treatment": bool(landscape),
        "landscape_card_ready": bool(landscape),
        "poster_card_ready": bool(poster),
        "card_ready": bool(landscape),
        "top10_ready": bool(poster),
        "complete": bool(landscape and poster),
        "sc_cover_imported": True,
        "sc_catalog_hit": True,
        "sc_catalog_size": len(CATALOG.records),
        "sc_provider_id": record.get("id") or record.get("slug"),
        "sc_provider_name": record.get("name"),
        "sc_confidence": round(min(confidence, 1.0), 4),
        "version": API_VERSION,
    }


def _bundle(raw: dict) -> dict | None:
    """Memoize expensive title matching for the static committed catalogue."""
    tmdb_id = _tmdb_id(raw)
    if not tmdb_id:
        return None
    key = (
        _media_type(raw),
        tmdb_id,
        str(raw.get("title") or raw.get("name") or "").strip(),
        str(raw.get("original_title") or raw.get("original_name") or "").strip(),
        str(raw.get("year") or raw.get("release_date") or raw.get("first_air_date") or ""),
    )
    cached = _bundle_cache.get(key)
    if cached is not None:
        return dict(cached)

    result = _bundle_uncached(raw)
    if result is not None:
        if len(_bundle_cache) >= BUNDLE_CACHE_MAX:
            _bundle_cache.clear()
        _bundle_cache[key] = dict(result)
        return dict(result)
    return None


def _install_nonblocking_enrichment(app) -> None:
    """Return list/catalogue JSON without waiting for cold per-title asset calls."""
    if getattr(app.state, "flixit_nonblocking_enrichment_registered", False):
        return
    try:
        import server_core as core
    except Exception:
        return

    fields = tuple(
        getattr(
            core,
            "ASSET_FIELDS",
            (
                "titled_backdrop_path",
                "logo_path",
                "trailer_key",
                "runtime",
                "number_of_seasons",
                "certification",
            ),
        )
    )
    media_assets = getattr(core, "media_assets", None)
    resolver = getattr(core, "get_media_assets", None)
    if media_assets is None or not callable(resolver):
        return

    async def warm_one(media_type: str, tmdb_id: int) -> None:
        key = (media_type, tmdb_id)
        try:
            async with _asset_warm_semaphore:
                await resolver(media_type, tmdb_id)
        except Exception:
            pass
        finally:
            _asset_warm_inflight.discard(key)

    def schedule_warm(keys: list[tuple[str, int]]) -> None:
        for key in keys[:12]:
            if key in _asset_warm_inflight:
                continue
            _asset_warm_inflight.add(key)
            task = asyncio.create_task(warm_one(*key))
            _asset_warm_tasks.add(task)
            task.add_done_callback(_asset_warm_tasks.discard)

    async def enrich_items_fast(items: list) -> list:
        if not items:
            return items

        movie_ids: list[int] = []
        tv_ids: list[int] = []
        seen: set[tuple[str, int]] = set()
        for item in items:
            if not isinstance(item, dict):
                continue
            tmdb_id = _tmdb_id(item)
            if not tmdb_id:
                continue
            media_type = _media_type(item)
            key = (media_type, tmdb_id)
            if key in seen:
                continue
            seen.add(key)
            (tv_ids if media_type == "tv" else movie_ids).append(tmdb_id)

        clauses = []
        if movie_ids:
            clauses.append({"type": "movie", "tmdbId": {"$in": movie_ids}})
        if tv_ids:
            clauses.append({"type": "tv", "tmdbId": {"$in": tv_ids}})

        cached_rows = []
        if clauses:
            projection = {"_id": 0, "type": 1, "tmdbId": 1, "backdrop_path": 1}
            projection.update({field: 1 for field in fields})
            try:
                cached_rows = list(media_assets.find({"$or": clauses}, projection))
            except Exception:
                cached_rows = []

        cached = {
            (str(row.get("type") or "movie"), int(row.get("tmdbId") or 0)): row
            for row in cached_rows
            if row.get("tmdbId")
        }
        missing: list[tuple[str, int]] = []

        for item in items:
            if not isinstance(item, dict):
                continue
            tmdb_id = _tmdb_id(item)
            if not tmdb_id:
                continue
            key = (_media_type(item), tmdb_id)
            assets = cached.get(key)
            for field in fields:
                if item.get(field) is None:
                    item[field] = (assets or {}).get(field)
            if not item.get("backdrop_path") and assets and assets.get("backdrop_path"):
                item["backdrop_path"] = assets.get("backdrop_path")
            if assets is None:
                missing.append(key)

        if missing:
            schedule_warm(missing)
        return items

    core.enrich_items = enrich_items_fast
    app.state.flixit_nonblocking_enrichment_registered = True


def _install_startup_load_shed(app) -> None:
    """Keep deploy-time maintenance from competing with the first users."""
    if getattr(app.state, "flixit_startup_load_shed_registered", False):
        return

    async def shed_startup_work() -> None:
        enabled = str(os.environ.get("SC_STARTUP_WARM_ENABLED", "false")).strip().lower() in {
            "1", "true", "yes", "on", "enabled"
        }

        # server.py launches a broad artwork import 2.5 seconds after startup.
        # Home now has its own persistent snapshot and on-demand artwork bundle,
        # so the bulk import should be opt-in instead of stealing CPU/network
        # from the first real requests after every deployment.
        server_module = sys.modules.get("server")
        if not enabled and server_module is not None and hasattr(server_module, "_startup_sc_cover_import"):
            async def no_startup_cover_import(_stop) -> None:
                return None
            server_module._startup_sc_cover_import = no_startup_cover_import
            try:
                state = getattr(server_module, "_sc_import_state", None)
                if isinstance(state, dict):
                    state["startup_warm_disabled"] = True
            except Exception:
                pass

        core = sys.modules.get("server_core")
        if core is None:
            return

        # The old startup loop also warmed nine Home rows independently. The
        # persistent Home snapshot already owns this job; leaving both enabled
        # doubled TMDB/catalogue work immediately after deploy.
        current_home_warm = getattr(core, "warm_home_rows", None)
        if callable(current_home_warm) and not getattr(current_home_warm, "_flixit_snapshot_owned", False):
            async def snapshot_owned_home_warm() -> None:
                return None
            snapshot_owned_home_warm._flixit_snapshot_owned = True
            snapshot_owned_home_warm._original = current_home_warm
            core.warm_home_rows = snapshot_owned_home_warm

        # Availability refresh is still useful, but not in the first seconds of
        # a fresh process. Delay only its first automatic execution; explicit
        # Admin refreshes (force=True) and all later periodic runs stay immediate.
        current_refresh = getattr(core, "refresh_vixsrc_catalog", None)
        if callable(current_refresh) and not getattr(current_refresh, "_flixit_startup_deferred", False):
            first_automatic = True

            async def deferred_catalog_refresh(*args, **kwargs):
                nonlocal first_automatic
                force = bool(kwargs.get("force", False))
                if first_automatic and not force:
                    first_automatic = False
                    await asyncio.sleep(STARTUP_BACKGROUND_GRACE_SECONDS)
                return await current_refresh(*args, **kwargs)

            deferred_catalog_refresh._flixit_startup_deferred = True
            deferred_catalog_refresh._original = current_refresh
            core.refresh_vixsrc_catalog = deferred_catalog_refresh

    app.add_event_handler("startup", shed_startup_work)
    app.state.flixit_startup_load_shed_registered = True


def install_performance_api(app) -> bool:
    if getattr(app.state, "flixit_performance_api_registered", False):
        return True

    _install_startup_load_shed(app)
    _install_nonblocking_enrichment(app)
    router = APIRouter()

    @router.post("/api/public/sc-artwork/batch", tags=["artwork"])
    async def sc_artwork_batch(payload: dict = Body(...)):
        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            raise HTTPException(status_code=400, detail="items deve essere una lista")
        if len(items) > MAX_BATCH_ITEMS:
            raise HTTPException(status_code=400, detail=f"Massimo {MAX_BATCH_ITEMS} titoli per batch")

        if not CATALOG.loaded:
            await asyncio.to_thread(CATALOG.load)

        out = []
        seen = set()
        for raw in items:
            if not isinstance(raw, dict):
                continue
            key = (_media_type(raw), _tmdb_id(raw))
            if not key[1] or key in seen:
                continue
            seen.add(key)
            row = _bundle(raw)
            if row is not None:
                out.append(row)

        return {
            "items": out,
            "count": len(out),
            "catalog_count": len(CATALOG.records),
            "version": API_VERSION,
            "max_batch_size": MAX_BATCH_ITEMS,
        }

    app.include_router(router)
    app.state.flixit_performance_api_registered = True
    return True


__all__ = ["install_performance_api", "API_VERSION", "MAX_BATCH_ITEMS"]
