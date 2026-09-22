"""Persistent, cache-first Home snapshot for FlixIT.

Rows stay cache-first, while Hero editorial changes are detected independently so
an admin update is visible immediately without rebuilding the whole Home.
"""
from __future__ import annotations

import asyncio
import inspect
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter

SNAPSHOT_KEY = "public-home-v1"
SNAPSHOT_VERSION = "instant-home-v2-hero-live"
FRESH_FOR = timedelta(minutes=10)
MAX_STALE_AGE = timedelta(days=3)
MAX_ROWS = 18
MAX_ITEMS_PER_ROW = 30

_build_lock = asyncio.Lock()
_refresh_tasks: set[asyncio.Task] = set()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _section_type(section: dict) -> str:
    return str(section.get("section_type") or section.get("apiString") or "").strip()


def _media_type(section: dict) -> str:
    value = str(section.get("media_type") or section.get("mediaType") or "mixed").lower()
    return value if value in {"movie", "tv", "mixed"} else "mixed"


def _signature(section: dict) -> str:
    return "|".join(
        [
            _section_type(section),
            _media_type(section),
            str(section.get("genre_id") or ""),
            str(section.get("origin_country") or ""),
        ]
    )


def _normalise_section(section: dict, index: int) -> dict:
    return {
        "key": str(section.get("key") or section.get("id") or f"home-{index}-{_signature(section)}"),
        "name": str(section.get("name") or "").strip() or "Scopri",
        "section_type": _section_type(section),
        "media_type": _media_type(section),
        "genre_id": section.get("genre_id"),
        "origin_country": section.get("origin_country"),
        "order": int(section.get("order") or index),
    }


def _route_endpoint(app, path: str):
    for route in reversed(getattr(app, "routes", [])):
        if getattr(route, "path", None) != path:
            continue
        methods = set(getattr(route, "methods", set()) or set())
        if not methods or "GET" in methods:
            return getattr(route, "endpoint", None)
    return None


def _unwrap_response(value: Any) -> Any:
    body = getattr(value, "body", None)
    if body is None:
        return value
    try:
        if isinstance(body, bytes):
            return json.loads(body.decode("utf-8"))
        if isinstance(body, str):
            return json.loads(body)
    except Exception:
        return None
    return value


async def _call_public(app, path: str, **kwargs) -> dict:
    endpoint = _route_endpoint(app, path)
    if not callable(endpoint):
        return {}
    try:
        value = endpoint(**kwargs)
        if inspect.isawaitable(value):
            value = await value
        value = _unwrap_response(value)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _payload_items(payload: dict) -> list[dict]:
    candidates = [
        payload.get("items"),
        payload.get("results"),
        (payload.get("data") or {}).get("items") if isinstance(payload.get("data"), dict) else None,
        (payload.get("data") or {}).get("results") if isinstance(payload.get("data"), dict) else None,
    ]
    for value in candidates:
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _item_key(item: dict) -> str:
    raw_id = item.get("tmdbId") or item.get("tmdb_id") or item.get("id")
    try:
        tmdb_id = int(raw_id)
    except Exception:
        return ""
    media = str(item.get("type") or item.get("media_type") or "movie").lower()
    media = "tv" if media == "tv" or "series" in media else "movie"
    return f"{media}:{tmdb_id}"


def _unique_items(items: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for raw in items:
        key = _item_key(raw)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(dict(raw))
        if len(out) >= MAX_ITEMS_PER_ROW:
            break
    return out


async def _load_section(app, section: dict) -> dict:
    section_type = _section_type(section)
    media_type = _media_type(section)
    media_slug = "tv" if media_type == "tv" else "movie" if media_type == "movie" else "mixed"

    if section_type == "trending":
        payload = await _call_public(app, "/api/public/homepage/trending")
    elif section_type == "latest":
        payload = await _call_public(app, "/api/public/homepage/latest")
    elif section_type == "top10":
        payload = await _call_public(app, "/api/public/flixit-top10", hours=48)
    elif section_type == "upcoming":
        payload = await _call_public(app, "/api/public/tmdb/upcoming", page=1)
    elif section_type == "new_releases":
        payload = await _call_public(app, "/api/public/new-releases/{media}", media="movie")
    elif section_type == "new_seasons":
        payload = await _call_public(app, "/api/public/new-releases/{media}", media="tv")
    elif section_type == "now_playing":
        payload = await _call_public(app, "/api/public/tmdb/now_playing", page=1)
    elif section_type == "airing_today":
        payload = await _call_public(app, "/api/public/tmdb/airing_today", page=1)
    elif section_type == "on_the_air":
        payload = await _call_public(app, "/api/public/tmdb/on_the_air", page=1)
    elif section_type == "popular":
        payload = await _call_public(
            app,
            "/api/public/tmdb/popular/{media_type}",
            media_type="tv" if media_slug == "tv" else "movie",
            page=1,
            verify_vixsrc=False,
        )
    elif section_type == "top_rated":
        payload = await _call_public(
            app,
            "/api/public/tmdb/top_rated/{media_type}",
            media_type="tv" if media_slug == "tv" else "movie",
            page=1,
            verify_vixsrc=False,
        )
    elif section_type == "genre" and section.get("genre_id"):
        payload = await _call_public(
            app,
            "/api/public/tmdb/genre/{genre_id}/{media_type}",
            genre_id=int(section["genre_id"]),
            media_type=media_slug,
            page=1,
            origin_country=section.get("origin_country"),
        )
    else:
        payload = {}

    return {**section, "items": _unique_items(_payload_items(payload))}


def _ordered_sections(core) -> list[dict]:
    try:
        admin = list(core.sections.find({"active": True}, {"_id": 0}).sort("order", 1))
    except Exception:
        admin = []
    templates = [dict(row) for row in getattr(core, "AVAILABLE_SECTIONS", []) if isinstance(row, dict)]

    preferred_types = ("top10", "trending", "latest")
    source = []
    for wanted in preferred_types:
        source.extend([row for row in admin if _section_type(row) == wanted])
        if not any(_section_type(row) == wanted for row in source):
            source.extend([row for row in templates if _section_type(row) == wanted][:1])
    source.extend(admin)
    source.extend(templates)

    seen: set[str] = set()
    out: list[dict] = []
    for index, raw in enumerate(source):
        section = _normalise_section(raw, index)
        if not section["section_type"]:
            continue
        sig = _signature(section)
        if sig in seen:
            continue
        seen.add(sig)
        out.append(section)
        if len(out) >= MAX_ROWS:
            break
    return out


async def _attach_artwork(rows: list[dict]) -> None:
    try:
        from services.performance_api import _bundle
        from services.sc_artwork_catalog import CATALOG

        if not CATALOG.loaded:
            await asyncio.to_thread(CATALOG.load)
        for row in rows:
            for item in row.get("items") or []:
                try:
                    artwork = _bundle(item)
                except Exception:
                    artwork = None
                if isinstance(artwork, dict):
                    item["__artwork"] = artwork
    except Exception:
        return


def _hero_fingerprint(hero: dict | None) -> tuple[str, ...]:
    hero = hero or {}
    return tuple(
        str(hero.get(key) or "")
        for key in (
            "contentId",
            "mediaType",
            "customTitle",
            "customDescription",
            "customBackdrop",
            "seasonLabel",
            "updatedAt",
        )
    )


def _current_hero_settings(core) -> dict:
    try:
        return core.hero_settings.find_one({}, {"_id": 0}) or {}
    except Exception:
        return {}


async def _hydrate_hero_artwork(hero: dict | None) -> dict | None:
    if not isinstance(hero, dict) or not hero.get("contentId"):
        return hero
    result = dict(hero)
    try:
        from services.performance_api import _bundle
        from services.sc_artwork_catalog import CATALOG

        if not CATALOG.loaded:
            await asyncio.to_thread(CATALOG.load)
        detail = result.get("detail") if isinstance(result.get("detail"), dict) else {}
        identity = {
            "tmdbId": int(result.get("contentId")),
            "type": "tv" if result.get("mediaType") == "tv" else "movie",
            "title": detail.get("name") or detail.get("title") or result.get("customTitle") or "",
            "name": detail.get("name") or detail.get("title") or result.get("customTitle") or "",
            "original_title": detail.get("original_name") or detail.get("original_title") or "",
            "release_date": detail.get("release_date") or "",
            "first_air_date": detail.get("first_air_date") or "",
        }
        artwork = _bundle(identity)
        if isinstance(artwork, dict) and artwork.get("active"):
            existing = result.get("assets") if isinstance(result.get("assets"), dict) else {}
            hero_backdrop = (
                artwork.get("hero_backdrop_url")
                or artwork.get("detail_backdrop_url")
                or artwork.get("backdrop_url")
            )
            result["assets"] = {
                **existing,
                "logo_path": artwork.get("logo_url") or existing.get("logo_path"),
                "fallback_logo_path": existing.get("fallback_logo_path"),
                "backdrop_path": hero_backdrop or existing.get("backdrop_path"),
                "hero_backdrop_path": hero_backdrop or existing.get("hero_backdrop_path"),
                "detail_backdrop_path": artwork.get("detail_backdrop_url") or hero_backdrop or existing.get("detail_backdrop_path"),
                "poster_path": artwork.get("poster_url") or existing.get("poster_path"),
                "logo_source": artwork.get("logo_source") or existing.get("logo_source"),
                "hero_backdrop_source": artwork.get("hero_backdrop_source") or existing.get("hero_backdrop_source"),
            }
    except Exception:
        pass
    return result


async def _load_current_hero(app) -> dict | None:
    hero = await _call_public(app, "/api/public/hero")
    return await _hydrate_hero_artwork(hero or None)


def _persist_snapshot_payload(core, payload: dict, generated: datetime | None) -> None:
    try:
        core.db["home_snapshots"].update_one(
            {"key": SNAPSHOT_KEY},
            {
                "$set": {
                    "payload": payload,
                    "generated_at": generated or _now(),
                }
            },
            upsert=True,
        )
    except Exception:
        pass


async def _refresh_cached_hero_if_needed(app, core, payload: dict, generated: datetime | None) -> dict:
    current_settings = _current_hero_settings(core)
    cached_hero = payload.get("hero") if isinstance(payload.get("hero"), dict) else {}
    if _hero_fingerprint(current_settings) == _hero_fingerprint(cached_hero):
        return payload

    fresh_hero = await _load_current_hero(app)
    if not fresh_hero:
        return payload

    updated = dict(payload)
    updated["version"] = SNAPSHOT_VERSION
    updated["hero"] = fresh_hero
    _persist_snapshot_payload(core, updated, generated)
    return updated


async def _build_snapshot(app, core) -> dict:
    async with _build_lock:
        sections = _ordered_sections(core)
        semaphore = asyncio.Semaphore(4)

        async def one(section: dict) -> dict:
            async with semaphore:
                return await _load_section(app, section)

        rows = await asyncio.gather(*(one(section) for section in sections))
        rows = [row for row in rows if row.get("items")]
        await _attach_artwork(rows)
        hero = await _load_current_hero(app)
        generated = _now()
        payload = {
            "version": SNAPSHOT_VERSION,
            "generated_at": generated.isoformat(),
            "hero": hero or None,
            "rows": rows,
            "row_count": len(rows),
        }
        try:
            core.db["home_snapshots"].replace_one(
                {"key": SNAPSHOT_KEY},
                {"key": SNAPSHOT_KEY, "generated_at": generated, "payload": payload},
                upsert=True,
            )
        except Exception:
            pass
        return payload


def _read_snapshot(core) -> tuple[dict | None, datetime | None]:
    try:
        doc = core.db["home_snapshots"].find_one({"key": SNAPSHOT_KEY}, {"_id": 0}) or {}
    except Exception:
        return None, None
    payload = doc.get("payload")
    generated = _as_utc(doc.get("generated_at") or (payload or {}).get("generated_at"))
    return (payload if isinstance(payload, dict) else None), generated


def _schedule_refresh(app, core) -> None:
    if any(not task.done() for task in _refresh_tasks):
        return

    async def runner():
        try:
            await _build_snapshot(app, core)
        except Exception:
            pass

    task = asyncio.create_task(runner())
    _refresh_tasks.add(task)
    task.add_done_callback(_refresh_tasks.discard)


def install_home_bootstrap(app) -> bool:
    if getattr(app.state, "flixit_home_bootstrap_registered", False):
        return True

    import server_core as core

    try:
        core.db["home_snapshots"].create_index("key", unique=True)
    except Exception:
        pass

    router = APIRouter()

    @router.get("/api/public/home-bootstrap", tags=["catalog"])
    async def public_home_bootstrap():
        payload, generated = _read_snapshot(core)
        now = _now()
        if payload and generated:
            payload = await _refresh_cached_hero_if_needed(app, core, payload, generated)
            age = now - generated
            if age < FRESH_FOR:
                return payload
            if age < MAX_STALE_AGE:
                _schedule_refresh(app, core)
                return payload
        try:
            return await _build_snapshot(app, core)
        except Exception:
            if payload:
                return payload
            return {
                "version": SNAPSHOT_VERSION,
                "generated_at": now.isoformat(),
                "hero": None,
                "rows": [],
                "row_count": 0,
            }

    async def warm_after_startup() -> None:
        await asyncio.sleep(0.5)
        payload, generated = _read_snapshot(core)
        if not payload or not generated or _now() - generated >= FRESH_FOR:
            _schedule_refresh(app, core)

    @app.on_event("startup")
    async def _warm_home_snapshot_on_startup():
        asyncio.create_task(warm_after_startup())

    app.include_router(router)
    app.state.flixit_home_bootstrap_registered = True
    return True


__all__ = ["install_home_bootstrap", "SNAPSHOT_VERSION"]
