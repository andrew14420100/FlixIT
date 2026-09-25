"""FastAPI integration for the StreamingCommunity trailer resolver."""
from __future__ import annotations

import asyncio
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
SC_POLICY = "streamingcommunity-vixcloud-direct-or-youtube-metadata"


class ManualTrailerBody(BaseModel):
    url: Optional[str] = None
    candidate_id: Optional[str] = None


class ProviderPageBody(BaseModel):
    provider: str
    url: Optional[str] = None


class QueueBody(BaseModel):
    # 0 means the complete FLIX-IT catalog.
    limit: int = 0


def register_trailer_service(app, db, get_current_admin, log_admin_action, fetch_tmdb_data):
    if getattr(app.state, "flixit_trailer_resolver_registered", False):
        return getattr(app.state, "trailer_resolver", None)

    resolver = install_queue_policy(TrailerResolver(db, fetch_tmdb_data, logger=logger))
    app.state.trailer_resolver = resolver
    app.state.flixit_trailer_resolver_registered = True

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
            "source_policy": SC_POLICY,
            "catalog_import": "all",
            "playback": "vixcloud-embed-direct-or-sc-youtube-metadata",
            "youtube_enabled": True,
            "youtube_policy": "only-explicit-streamingcommunity-youtube-id",
            "tmdb_match_required": True,
            "legacy_fallback": False,
            "manual_override": False,
        }

    @router.get("/api/public/trailer-config")
    async def public_trailer_config():
        return quality_config()

    def public_payload(result: dict, *, attempted_now: bool = False) -> dict:
        selected = result.get("selected") or {}
        selected_url = selected.get("trailer_url") or selected.get("manifest_url")
        selected_source = str(selected.get("source") or result.get("source") or "").strip().lower()
        selected_meta = selected.get("metadata") or {}
        is_native = selected_meta.get("native_sc_trailer") is True
        is_sc_youtube = bool(selected_meta.get("sc_youtube_metadata"))

        if result.get("available") and selected_url and selected_source == SC_SOURCE and is_native:
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
                "source_policy": SC_POLICY,
                "tmdb_match": selected_meta.get("tmdb_match"),
                "native_sc_trailer": True,
                "vixcloud_embed": bool(selected_meta.get("sc_vixcloud_embed")),
                "youtube": is_sc_youtube,
                "youtube_from_sc_metadata": is_sc_youtube,
                "language": selected.get("audio_language") or selected.get("language"),
                "attempted_now": attempted_now,
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
            "source_policy": SC_POLICY,
            "reason": result.get("reason") or "streamingcommunity_trailer_unavailable",
            "native_sc_trailer": False,
            "vixcloud_embed": False,
            "youtube": False,
            "youtube_from_sc_metadata": False,
            "attempted_now": attempted_now,
        }

    async def resolve_visible_fast(media_type: str, tmdb_id: int) -> Optional[dict]:
        """Discover one visible title without waiting for the background lock.

        Only a positive, usable StreamingCommunity trailer is persisted. A fast
        miss never writes an empty resolution and therefore cannot hide a trailer
        while the complete background scan is still running.
        """
        from . import queue_policy as queue_policy_module
        from . import resolver as resolver_module
        from .fast_sc_discovery import begin_interactive_fast_only, end_interactive_fast_only

        normalized_type = "tv" if media_type == "tv" else "movie"
        normalized_id = int(tmdb_id)
        identity = await resolver.identity(normalized_type, normalized_id)
        if not identity:
            return None

        provider = resolver.providers[0]
        token = begin_interactive_fast_only()
        try:
            candidates = await provider.discover(identity)
        finally:
            end_interactive_fast_only(token)

        ready = []
        for candidate in candidates or []:
            if candidate.source != SC_SOURCE:
                continue
            if not resolver_module.candidate_is_usable(candidate):
                continue
            candidate.expires_at = resolver._expires(candidate)
            ready.append(candidate)

        deduped = {candidate.candidate_id: candidate for candidate in ready}
        ready = list(deduped.values())
        best = resolver_module.pick_best(ready, hdr_supported=False)
        if not best:
            return None

        now = resolver_module._now()
        provider_pages = {SC_SOURCE: best.provider_page} if best.provider_page else {}
        doc = {
            "type": normalized_type,
            "tmdbId": normalized_id,
            "title": identity.get("title"),
            "originalTitle": identity.get("original_title"),
            "year": identity.get("year"),
            "externalIds": identity.get("external_ids") or {},
            "providerPages": provider_pages,
            "selected": best.to_dict(),
            "alternatives": [row.to_dict() for row in ready],
            "resolvedAt": now.isoformat(),
            "metadataExpiresAt": (now + resolver.metadata_ttl()).isoformat(),
            "lastError": None,
            "sourcePolicy": "streamingcommunity-vixcloud-or-direct",
            "minimumResolution": None,
            "youtubeRejected": False,
            "policyVersion": queue_policy_module.TRAILER_POLICY_VERSION,
            "scNativeCheckedAt": now.isoformat(),
            "scNativeTrailerCount": len(ready),
        }
        resolver.results.update_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {"$set": doc, "$unset": {"manual": ""}},
            upsert=True,
        )
        return doc

    @router.get("/api/public/trailer/{media_type}/{tmdb_id}")
    async def public_trailer(
        media_type: str,
        tmdb_id: int,
        hdr: bool = Query(False),
        debug: bool = Query(False),
    ):
        """Return a visible trailer quickly and leave exhaustive work to workers."""
        result = resolver.public_result(media_type, tmdb_id, hdr_supported=bool(hdr))
        if result.get("available"):
            payload = public_payload(result, attempted_now=False)
            payload["interactive_lookup"] = "cache-hit"
            return payload

        normalized_type = "tv" if media_type == "tv" else "movie"
        attempted_now = True
        interactive_lookup = "fast-miss"
        try:
            fast_doc = await asyncio.wait_for(
                resolve_visible_fast(normalized_type, tmdb_id),
                timeout=11.0,
            )
            if fast_doc and (fast_doc.get("selected") or {}).get("source") == SC_SOURCE:
                interactive_lookup = "fast-hit"
            else:
                resolver.enqueue(
                    normalized_type,
                    tmdb_id,
                    priority=0,
                    reason="interactive_fast_miss_full_scan",
                )
        except asyncio.TimeoutError:
            interactive_lookup = "fast-timeout"
            resolver.enqueue(
                normalized_type,
                tmdb_id,
                priority=0,
                reason="interactive_fast_timeout_full_scan",
            )
        except Exception as exc:
            interactive_lookup = "fast-error"
            logger.warning(
                "Immediate fast SC trailer resolve failed for %s:%s: %s",
                normalized_type,
                tmdb_id,
                exc,
            )
            resolver.enqueue(
                normalized_type,
                tmdb_id,
                priority=0,
                reason="interactive_fast_error_full_scan",
            )

        result = resolver.public_result(normalized_type, tmdb_id, hdr_supported=bool(hdr))
        payload = public_payload(result, attempted_now=attempted_now)
        payload["interactive_lookup"] = interactive_lookup

        if debug and interactive_lookup != "fast-hit":
            try:
                from .sc_trailer_diagnostics import diagnose_sc_title

                identity = await resolver.identity(normalized_type, int(tmdb_id))
                if identity:
                    payload["sc_diagnostic"] = await asyncio.wait_for(
                        diagnose_sc_title(resolver.providers[0], identity),
                        timeout=9.0,
                    )
                else:
                    payload["sc_diagnostic"] = {"result": "identity_unavailable"}
            except asyncio.TimeoutError:
                payload["sc_diagnostic"] = {"result": "diagnostic_timeout"}
            except Exception as exc:
                payload["sc_diagnostic"] = {
                    "result": "diagnostic_error",
                    "error_type": exc.__class__.__name__,
                }
        return payload

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
        return {**doc, "manual_preserved": False, "source_policy": SC_POLICY}

    @router.put("/api/admin/trailers/{media_type}/{tmdb_id}/manual")
    async def admin_set_manual_trailer(media_type: str, tmdb_id: int, body: ManualTrailerBody, admin=Depends(get_current_admin)):
        raise HTTPException(
            status_code=400,
            detail="Override manuali disabilitati: i trailer usano solo StreamingCommunity",
        )

    @router.delete("/api/admin/trailers/{media_type}/{tmdb_id}/manual")
    async def admin_reset_manual_trailer(media_type: str, tmdb_id: int, admin=Depends(get_current_admin)):
        doc = resolver.reset_manual(media_type, tmdb_id)
        resolver.enqueue(media_type, tmdb_id, priority=0, reason="manual_reset_sc_only")
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
