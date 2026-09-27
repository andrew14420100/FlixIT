"""FastAPI integration for the central multi-provider TrailerResolver."""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel

from .resolver import TrailerResolver
from .queue_policy import install_queue_policy
from .providers import TherystonTrailerProvider
from .base import is_blocked_url

logger = logging.getLogger(__name__)
SOURCE_POLICY = "direct-multiprovider-no-youtube-italian-only"


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
    # Theryston is a direct-media bridge for supported official provider pages;
    # YouTube URLs are still rejected by the shared candidate filter.
    resolver.providers.insert(1, TherystonTrailerProvider())
    app.state.trailer_resolver = resolver
    app.state.flixit_trailer_resolver_registered = True

    # Remove the old public trailer route. The strict Italian-only contract below
    # is the single public path and never falls back to legacy/YouTube trailers.
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
            "quality_mode": "max_available",
            "preferred_resolution": 2160,
            "preferred_label": "4K UHD",
            "minimum_resolution": 1080,
            "fallback_resolution": 720,
            "upscaling": False,
            "automatic": True,
            "italian_preferred": True,
            "italian_only": True,
            "youtube_enabled": False,
            "source_policy": SOURCE_POLICY,
            "providers": [getattr(provider, "name", provider.__class__.__name__) for provider in resolver.providers],
        }

    def _language(value) -> str:
        return str(value or "").strip().lower().replace("_", "-")

    def _is_italian_language(value) -> bool:
        lang = _language(value)
        return bool(
            lang == "it"
            or lang.startswith("it-")
            or lang in {"ita", "italian", "italiano", "italiana"}
            or lang.startswith("italian-")
        )

    @router.get("/api/public/trailer-config")
    async def public_trailer_config():
        cfg = quality_config()
        return {
            **cfg,
            "enabled": cfg["enabled"],
            "youtube_enabled": False,
            "fallback_language": None,
            "theryston_enabled": True,
            "theryston_api_url": os.environ.get("THERYSTON_TRAILERS_API_URL", "http://127.0.0.1:3011"),
            "language_priority": ["it-IT", "ita", "it"],
        }

    @router.get("/api/public/trailer/{media_type}/{tmdb_id}")
    async def public_trailer(media_type: str, tmdb_id: int, hdr: bool = Query(False)):
        result = resolver.public_result(media_type, tmdb_id, hdr_supported=bool(hdr))
        if not result.get("enabled"):
            return {
                "trailer_key": None,
                "trailer_url": None,
                "manifest_url": None,
                "source": None,
                "selected": None,
                "enabled": False,
                "resolved": True,
                "available": False,
                "candidate": None,
                "italian_preferred": True,
                "italian_only": True,
                "language_verified": False,
                "fallback_original": False,
                "youtube": False,
                "reason": "italian_trailer_resolver_disabled",
                "source_policy": SOURCE_POLICY,
            }

        selected = result.get("selected") or {}
        selected_url = selected.get("trailer_url") or selected.get("manifest_url")
        if selected_url and is_blocked_url(str(selected_url)):
            selected_url = None

        selected_language = selected.get("audio_language") or selected.get("language")
        italian = _is_italian_language(selected_language)
        language_verified = bool(result.get("language_verified"))

        if selected_url and italian and language_verified:
            return {
                "trailer_key": selected_url,
                "trailer_url": selected_url,
                "manifest_url": selected.get("manifest_url"),
                "source": result.get("source") or selected.get("source"),
                "selected": selected,
                "enabled": True,
                "resolved": True,
                "available": True,
                "candidate": selected,
                "cached": result.get("cached", True),
                "stale": result.get("stale", False),
                "quality_mode": "max_available",
                "preferred_resolution": 2160,
                "minimum_resolution": 1080,
                "fallback_resolution": 720,
                "language": selected_language,
                "language_priority": ["it-IT", "ita", "it"],
                "italian_preferred": True,
                "italian_only": True,
                "language_verified": True,
                "fallback_original": False,
                "refresh_pending": False,
                "automatic": True,
                "youtube": False,
                "source_policy": SOURCE_POLICY,
            }

        return {
            "trailer_key": None,
            "trailer_url": None,
            "manifest_url": None,
            "source": None,
            "selected": None,
            "enabled": True,
            "resolved": True,
            "available": False,
            "candidate": None,
            "cached": result.get("cached", bool(selected)),
            "stale": result.get("stale", bool(selected)),
            "quality_mode": "max_available",
            "preferred_resolution": 2160,
            "minimum_resolution": 1080,
            "fallback_resolution": 720,
            "language_priority": ["it-IT", "ita", "it"],
            "italian_preferred": True,
            "italian_only": True,
            "language_verified": False,
            "fallback_original": False,
            "reason": result.get("reason") or "verified_italian_trailer_unavailable",
            "refresh_pending": result.get("refresh_pending", False),
            "automatic": True,
            "youtube": False,
            "source_policy": SOURCE_POLICY,
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

    @router.get("/api/public/theryston-file/{filename}")
    async def theryston_file(filename: str):
        if not filename or not re.fullmatch(r"[A-Za-z0-9._-]+", filename):
            raise HTTPException(status_code=400, detail="Invalid trailer filename")
        files_dir = (Path(os.environ.get("THERYSTON_TRAILERS_DATA_DIR", "/app/trailers-data")) / "files").resolve()
        path = (files_dir / filename).resolve()
        try:
            path.relative_to(files_dir)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid trailer file path")
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="Trailer non disponibile")
        return FileResponse(
            path,
            media_type="video/mp4",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    @router.get("/api/admin/trailers/config")
    async def admin_trailer_config(admin=Depends(get_current_admin)):
        return quality_config()

    @router.post("/api/admin/trailers/catalog/queue")
    async def admin_queue_catalog(body: QueueBody, admin=Depends(get_current_admin)):
        result = resolver.enqueue_catalog(limit=body.limit)
        log_admin_action("QUEUE_TRAILER_CATALOG", metadata=result)
        return {**result, **resolver.queue_status()}

    @router.get("/api/admin/trailers/jobs/status")
    async def admin_get_trailer_jobs(admin=Depends(get_current_admin)):
        return resolver.queue_status()

    @router.get("/api/admin/trailers/{media_type}/{tmdb_id}")
    async def admin_get_trailer(media_type: str, tmdb_id: int, admin=Depends(get_current_admin)):
        return resolver.get_admin(media_type, tmdb_id)

    @router.post("/api/admin/trailers/{media_type}/{tmdb_id}/refresh")
    async def admin_refresh_trailer(media_type: str, tmdb_id: int, admin=Depends(get_current_admin)):
        before = resolver.get_admin(media_type, tmdb_id)
        manual = (before.get("manual") or {}).get("enabled")
        doc = await resolver.resolve(media_type, tmdb_id, force=True)
        log_admin_action("REFRESH_TRAILER", str(tmdb_id), {"media_type": media_type, "manual_preserved": bool(manual)})
        return {**doc, "manual_preserved": bool(manual)}

    @router.put("/api/admin/trailers/{media_type}/{tmdb_id}/manual")
    async def admin_set_manual_trailer(media_type: str, tmdb_id: int, body: ManualTrailerBody, admin=Depends(get_current_admin)):
        try:
            if body.candidate_id:
                doc = await resolver.set_manual_candidate(media_type, tmdb_id, body.candidate_id)
            elif body.url:
                doc = resolver.set_manual_url(media_type, tmdb_id, body.url)
            else:
                raise ValueError("Specificare url oppure candidate_id")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        log_admin_action("SET_MANUAL_TRAILER", str(tmdb_id), {"media_type": media_type, "candidate_id": body.candidate_id, "has_url": bool(body.url)})
        return doc

    @router.delete("/api/admin/trailers/{media_type}/{tmdb_id}/manual")
    async def admin_reset_manual_trailer(media_type: str, tmdb_id: int, admin=Depends(get_current_admin)):
        doc = resolver.reset_manual(media_type, tmdb_id)
        resolver.enqueue(media_type, tmdb_id, priority=0, reason="manual_reset_seek_italian")
        log_admin_action("RESET_MANUAL_TRAILER", str(tmdb_id), {"media_type": media_type})
        return doc

    @router.put("/api/admin/trailers/{media_type}/{tmdb_id}/provider-page")
    async def admin_set_provider_page(media_type: str, tmdb_id: int, body: ProviderPageBody, admin=Depends(get_current_admin)):
        try:
            doc = resolver.set_provider_page(media_type, tmdb_id, body.provider, body.url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        resolver.enqueue(media_type, tmdb_id, priority=0, reason="provider_page_changed_seek_italian")
        return doc

    app.include_router(router)
    app.add_event_handler("startup", resolver.start)
    app.add_event_handler("shutdown", resolver.stop)
    return resolver


__all__ = ["TrailerResolver", "register_trailer_service"]
