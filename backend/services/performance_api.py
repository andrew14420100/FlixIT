"""Small, cache-friendly APIs used by the performance-sensitive frontend paths.

The browser must never download the complete SC artwork catalogue.  The backend
keeps the committed catalogue indexed in memory and returns only the artwork for
the titles currently needed by the UI.
"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import services.artwork_card_policy as card_policy
from services.sc_artwork_catalog import CATALOG, _url_for

MAX_BATCH_ITEMS = 120
API_VERSION = "sc-artwork-batch-v1"


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


def _bundle(raw: dict) -> dict | None:
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
    # Never use cover_mobile as a ranked poster: Top 10 and mobile poster rows
    # require a real vertical poster asset.
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


def install_performance_api(app) -> bool:
    if getattr(app.state, "flixit_performance_api_registered", False):
        return True

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
