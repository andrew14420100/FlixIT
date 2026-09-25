"""FastAPI integration for the StreamingCommunity-only trailer resolver."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel

from .resolver import TrailerResolver
from .queue_policy import install_queue_policy

logger = logging.getLogger(__name__)
SC_SOURCE = "streamingcommunity"


class ManualTrailerBody(BaseModel):
    url: Optional[str] = None
    candidate_id: Optional[str] = None


class ProviderPageBody(BaseModel):
    provider: str
    url: Optional[str] = None


class QueueBody(BaseModel):
    limit: int = 250


def register_trailer_service(app, db, get_current_admin, log_admin_action, fetch_tmdb_data):
    if getattr(app.state, "flixit_trailer_resolver_registered", False):
        return getattr(app.state, "trailer_resolver", None)

    resolver = install_queue_policy(TrailerResolver(db, fetch_tmdb_data, logger=logger))
    app.state.trailer_resolver = resolver
    app.state.flixit_trailer_resolver_registered = True

    # Remove any previously registered public trailer route. Do not retain or
    # call it as a fallback: automatic playback is StreamingCommunity-only.
    kept_routes = []
    for route in app.router.routes:
        if isinstance(route, APIRoute) and route.path == "/api/public/trailer/{media_type}/{tmdb_id}" and "GET" in route.methods:
            continue
        kept_routes.append(route)
    app.router.routes[:] = kept_routes

    router = APIRouter()

    def quality_config() -> dict:
        cfg = resolver.config()
        return {
            **cfg,
            "automatic": True,
            "source": SC_SOURCE,
            "source_policy": "streamingcommunity-only",
            "playback": "youtube-embed",
            "tmdb_match_required": True,
            "legacy_fallback": False,
            "manual_override": False,
        }

    @router.get("/api/public/trailer-config")
    async def public_trailer_config():
        return quality_config()

    @router.get("/api/public/trailer/{media_type}/{tmdb_id}")
    async def public_trailer(media_type: str, tmdb_id: int, hdr: bool = Query(False)):
        result = resolver.public_result(media_type, tmdb_id, hdr_supported=bool(hdr))
        selected = result.get("selected") or {}
        selected_url = selected.get("trailer_url") or selected.get("manifest_url")
        selected_source = str(selected.get("source") or result.get("source") or "").strip().lower()

        # SC metadata is accepted only after the provider has already matched the
        # exact TMDB id. Language metadata is optional on SC and must not cause a
        # valid SC trailer to be replaced by an older provider or hidden.
        if result.get("available") and selected_url and selected_source == SC_SOURCE:
            return {
                "trailer_key": selected_url,
                "trailer_url": selected_url,
                "manifest_url": selected.get("manifest_url"),
                "source": SC_SOURCE,
                "selected": selected,
                "candidate": selected,
                "enabled": True,
                "resolved": True,
                "available": True,
                "cached": result.get("cached", True),
                "stale": result.get("stale", False),
                "refresh_pending": False,
                "automatic": True,
                "source_policy": "streamingcommunity-only",
                "tmdb_match": (selected.get("metadata") or {}).get("tmdb_match"),
                "youtube": True,
                "language": selected.get("audio_language") or selected.get("language"),
            }

        return {
            "trailer_key": None,
            "trailer_url": None,
            "manifest_url": None,
            "source": SC_SOURCE,
            "selected": None,
            "candidate": None,
            "enabled": True,
            "resolved": True,
            "available": False,
            "cached": result.get("cached", bool(selected)),
            "stale": result.get("stale", bool(selected)),
            "refresh_pending": result.get("refresh_pending", True),
            "automatic": True,
            "source_policy": "streamingcommunity-only",
            "reason": result.get("reason") or "streamingcommunity_trailer_unavailable",
            "youtube": True,
        }

    @router.get("/api/public/trailer-file/{cache_key}")
    async def trailer_file(cache_key: str):
        if not cache_key.isalnum() or len(cache_key) > 64:
            raise HTTPException(status_code=400, detail="Invalid trailer cache key")
        path = (resolver.cache_dir / f"{cache_key}.mp4").resolve()
        try:
            path.relative_to(resolver.cache_dir.resolve())
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid trailer cache path")
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="Trailer temporaneo scaduto")
        return FileResponse(path, media_type="video/mp4")

    @router.get("/api/admin/trailers/config")
    async def admin_trailer_config(admin=Depends(get_current_admin)):
        return quality_config()

    @router.post("/api/admin/trailers/catalog/queue")
    async def admin_queue_catalog(body: QueueBody, admin=Depends(get_current_admin)):
        result = resolver.enqueue_catalog(limit=body.limit)
        log_admin_action("QUEUE_TRAILER_CATALOG", metadata=result)
        return {**result, **resolver.queue_status()}

    @router.get("/api/admin/trailers/jobs/status")
    async def admin_trailer_jobs(admin=Depends(get_current_admin)):
        return resolver.queue_status()

    @router.get("/api/admin/trailers/{media_type}/{tmdb_id}")
    async def admin_get_trailer(media_type: str, tmdb_id: int, admin=Depends(get_current_admin)):
        return resolver.get_admin(media_type, tmdb_id)

    @router.post("/api/admin/trailers/{media_type}/{tmdb_id}/refresh")
    async def admin_refresh_trailer(media_type: str, tmdb_id: int, admin=Depends(get_current_admin)):
        doc = await resolver.resolve(media_type, tmdb_id, force=True)
        log_admin_action("REFRESH_TRAILER", str(tmdb_id), {"media_type": media_type, "source": SC_SOURCE})
        return {**doc, "manual_preserved": False, "source_policy": "streamingcommunity-only"}

    @router.put("/api/admin/trailers/{media_type}/{tmdb_id}/manual")
    async def admin_set_manual_trailer(media_type: str, tmdb_id: int, body: ManualTrailerBody, admin=Depends(get_current_admin)):
        raise HTTPException(
            status_code=400,
            detail="Override manuali disabilitati: i trailer usano solo StreamingCommunity",
        )

    @router.delete("/api/admin/trailers/{media_type}/{tmdb_id}/manual")
    async def admin_reset_manual_trailer(media_type: str, tmdb_id: int, admin=Depends(get_current_admin)):
        doc = resolver.reset_manual(media_type, tmdb_id)
        resolver.enqueue(media_type, tmdb_id, priority=1, reason="manual_reset_sc_only")
        log_admin_action("RESET_MANUAL_TRAILER", str(tmdb_id), {"media_type": media_type})
        return doc

    @router.put("/api/admin/trailers/{media_type}/{tmdb_id}/provider-page")
    async def admin_set_provider_page(media_type: str, tmdb_id: int, body: ProviderPageBody, admin=Depends(get_current_admin)):
        raise HTTPException(
            status_code=400,
            detail="Provider page legacy disabilitate: i trailer usano solo StreamingCommunity",
        )

    app.include_router(router)
    app.add_event_handler("startup", resolver.start)
    app.add_event_handler("shutdown", resolver.stop)
    return resolver


__all__ = ["TrailerResolver", "register_trailer_service"]
