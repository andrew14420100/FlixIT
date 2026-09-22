"""SC-style, persistent, cache-first Home snapshot for FlixIT.

The Home is assembled once on the backend in a fixed StreamingCommunity-like
order. Rows are globally deduplicated before they reach React and only artwork-
ready cards are published, so lower rows never collapse into blank placeholders.
"""
from __future__ import annotations

import asyncio
import inspect
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter

SNAPSHOT_KEY = "public-home-v1"
SNAPSHOT_VERSION = "instant-home-v4-fuller"
FRESH_FOR = timedelta(minutes=10)
MAX_STALE_AGE = timedelta(days=3)
MAX_ITEMS_PER_ROW = 50
MAX_CANDIDATES_PER_ROW = 120
GENRE_PAGES = 5

# Current SC Home core order, followed by the thematic rows historically used
# by SC. Admin-created duplicate rows are intentionally not mixed into Home.
CANONICAL_SECTIONS = [
    {"key": "recent", "name": "Aggiunti di recente", "section_type": "latest", "media_type": "mixed", "limit": 50, "min_items": 8},
    {"key": "tv-updated", "name": "Serie TV Aggiornate", "section_type": "new_seasons", "media_type": "tv", "limit": 50, "min_items": 6},
    {"key": "top10", "name": "Top 10 titoli di oggi", "section_type": "top10", "media_type": "mixed", "limit": 10, "min_items": 5},
    {"key": "upcoming", "name": "In arrivo", "section_type": "upcoming", "media_type": "movie", "limit": 30, "min_items": 6},
    {"key": "comedy", "name": "Commedia", "section_type": "genre", "media_type": "mixed", "genre_id": 35, "limit": 50, "min_items": 8},
    {"key": "horror", "name": "Horror", "section_type": "genre", "media_type": "mixed", "genre_id": 27, "limit": 50, "min_items": 8},
    {"key": "action-adventure", "name": "Action & Adventure", "section_type": "genre", "media_type": "mixed", "genre_id": 28, "limit": 50, "min_items": 8},
    {"key": "fantasy", "name": "Fantasy", "section_type": "genre", "media_type": "mixed", "genre_id": 14, "limit": 50, "min_items": 8},
    {"key": "mystery", "name": "Mistero", "section_type": "genre", "media_type": "mixed", "genre_id": 9648, "limit": 50, "min_items": 8},
    {"key": "drama", "name": "Dramma", "section_type": "genre", "media_type": "mixed", "genre_id": 18, "limit": 50, "min_items": 8},
    {"key": "science-fiction", "name": "Fantascienza", "section_type": "genre", "media_type": "mixed", "genre_id": 878, "limit": 50, "min_items": 8},
    {"key": "thriller", "name": "Thriller", "section_type": "genre", "media_type": "mixed", "genre_id": 53, "limit": 50, "min_items": 8},
    {"key": "family", "name": "Famiglia", "section_type": "genre", "media_type": "mixed", "genre_id": 10751, "limit": 50, "min_items": 8},
    {"key": "animation", "name": "Animazione", "section_type": "genre", "media_type": "mixed", "genre_id": 16, "limit": 50, "min_items": 8},
    {"key": "history", "name": "Storia", "section_type": "genre", "media_type": "mixed", "genre_id": 36, "limit": 50, "min_items": 8},
    {"key": "crime", "name": "Crime", "section_type": "genre", "media_type": "mixed", "genre_id": 80, "limit": 50, "min_items": 8},
    {"key": "documentary", "name": "Documentario", "section_type": "genre", "media_type": "mixed", "genre_id": 99, "limit": 50, "min_items": 8},
    {"key": "romance", "name": "Romance", "section_type": "genre", "media_type": "mixed", "genre_id": 10749, "limit": 50, "min_items": 8},
    {"key": "war", "name": "Guerra", "section_type": "genre", "media_type": "mixed", "genre_id": 10752, "limit": 50, "min_items": 8},
    {"key": "music", "name": "Musica", "section_type": "genre", "media_type": "mixed", "genre_id": 10402, "limit": 50, "min_items": 8},
]

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


def _unique_items(items: list[dict], limit: int = MAX_CANDIDATES_PER_ROW) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for raw in items:
        key = _item_key(raw)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(dict(raw))
        if len(out) >= limit:
            break
    return out


async def _genre_payload(app, section: dict) -> dict:
    calls = [
        _call_public(
            app,
            "/api/public/tmdb/genre/{genre_id}/{media_type}",
            genre_id=int(section["genre_id"]),
            media_type="mixed",
            page=page,
            origin_country=section.get("origin_country"),
        )
        for page in range(1, GENRE_PAGES + 1)
    ]
    pages = await asyncio.gather(*calls)
    return {"items": [item for payload in pages for item in _payload_items(payload)]}


async def _upcoming_payload(app) -> dict:
    pages = await asyncio.gather(
        *(_call_public(app, "/api/public/tmdb/upcoming", page=page) for page in range(1, 4))
    )
    merged = [item for payload in pages for item in _payload_items(payload)]
    return {"items": merged}


async def _load_section(app, section: dict) -> dict:
    section_type = str(section.get("section_type") or "")
    if section_type == "latest":
        payload = await _call_public(app, "/api/public/homepage/latest")
    elif section_type == "new_seasons":
        payload = await _call_public(app, "/api/public/new-releases/{media}", media="tv")
    elif section_type == "top10":
        payload = await _call_public(app, "/api/public/flixit-top10", hours=48)
    elif section_type == "upcoming":
        payload = await _upcoming_payload(app)
    elif section_type == "genre" and section.get("genre_id"):
        payload = await _genre_payload(app, section)
    else:
        payload = {}
    return {**section, "items": _unique_items(_payload_items(payload))}


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


def _artwork_ready(item: dict, *, top10: bool = False) -> bool:
    artwork = item.get("__artwork") if isinstance(item.get("__artwork"), dict) else {}
    if not artwork.get("active"):
        return False
    if top10:
        return bool(artwork.get("top10_ready") and artwork.get("poster_url"))
    return bool(artwork.get("card_ready") and artwork.get("backdrop_url"))


def _select_row_items(row: dict, blocked: set[str], limit: int) -> list[dict]:
    top10 = row.get("section_type") == "top10"
    selected: list[dict] = []
    local_seen: set[str] = set()
    for item in row.get("items") or []:
        key = _item_key(item)
        if not key or key in local_seen or key in blocked:
            continue
        if not _artwork_ready(item, top10=top10):
            continue
        local_seen.add(key)
        selected.append(item)
        if len(selected) >= limit:
            break
    return selected


def _finalize_rows(rows: list[dict]) -> list[dict]:
    """Reserve SC core rows first, then globally dedupe every visible card."""
    by_key = {str(row.get("key")): row for row in rows}

    reserved_rows: dict[str, list[dict]] = {}
    reserved_keys: set[str] = set()
    for key in ("top10", "upcoming"):
        row = by_key.get(key)
        if not row:
            continue
        selected = _select_row_items(row, reserved_keys, int(row.get("limit") or MAX_ITEMS_PER_ROW))
        if len(selected) >= int(row.get("min_items") or 1):
            reserved_rows[key] = selected
            reserved_keys.update(_item_key(item) for item in selected)

    claimed: set[str] = set(reserved_keys)
    final: list[dict] = []
    for row in rows:
        key = str(row.get("key") or "")
        if key in reserved_rows:
            selected = reserved_rows[key]
        else:
            selected = _select_row_items(row, claimed, int(row.get("limit") or MAX_ITEMS_PER_ROW))

        minimum = int(row.get("min_items") or 1)
        if len(selected) < minimum:
            continue

        claimed.update(_item_key(item) for item in selected)
        clean = {
            "key": key,
            "name": row.get("name"),
            "section_type": row.get("section_type"),
            "media_type": row.get("media_type", "mixed"),
            "genre_id": row.get("genre_id"),
            "items": selected,
        }
        final.append(clean)
    return final


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
            hero_backdrop = artwork.get("hero_backdrop_url") or artwork.get("detail_backdrop_url") or artwork.get("backdrop_url")
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
            {"$set": {"payload": payload, "generated_at": generated or _now()}},
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
        semaphore = asyncio.Semaphore(4)

        async def load(section: dict) -> dict:
            async with semaphore:
                return await _load_section(app, dict(section))

        rows = await asyncio.gather(*(load(section) for section in CANONICAL_SECTIONS))
        await _attach_artwork(rows)
        rows = _finalize_rows(rows)
        hero = await _load_current_hero(app)
        generated = _now()
        payload = {
            "version": SNAPSHOT_VERSION,
            "structure": "sc-canonical",
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

        if payload and payload.get("version") != SNAPSHOT_VERSION:
            old_payload = payload
            try:
                return await _build_snapshot(app, core)
            except Exception:
                payload = old_payload

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
                "structure": "sc-canonical",
                "generated_at": now.isoformat(),
                "hero": None,
                "rows": [],
                "row_count": 0,
            }

    async def warm_after_startup() -> None:
        await asyncio.sleep(0.5)
        payload, generated = _read_snapshot(core)
        if (
            not payload
            or payload.get("version") != SNAPSHOT_VERSION
            or not generated
            or _now() - generated >= FRESH_FOR
        ):
            _schedule_refresh(app, core)

    @app.on_event("startup")
    async def _warm_home_snapshot_on_startup():
        asyncio.create_task(warm_after_startup())

    app.include_router(router)
    app.state.flixit_home_bootstrap_registered = True
    return True


__all__ = ["install_home_bootstrap", "SNAPSHOT_VERSION", "CANONICAL_SECTIONS"]
