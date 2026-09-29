"""StreamingCommunity-direct Detail mirror (v19).

Public SC flow mirrored by FLIX-IT:
1) resolve the exact SC title and its Inertia ``props.title``;
2) read ``props.title.seasons``;
3) fetch each ``season-N`` page;
4) read ``props.loadedSeason.episodes``;
5) cache/persist all season snapshots before the user opens the Episodes tab.

VixSrc is playback-only. Catalogue membership and episode artwork come from SC.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter
from fastapi.routing import APIRoute

from services import sc_native_catalog_v17 as sc
from services.trailers.providers.streamingcommunity import _detail_path, _query_variants, _search_rows

POLICY_VERSION = "sc-direct-detail-v19-instant"
SEASONS_PATH = "/api/public/tv/{tmdb_id}/seasons"
SEASON_PATH = "/api/public/tv/{tmdb_id}/season/{season_number}"
STATUS_PATH = "/api/public/sc-direct/status"

TITLE_TTL_SECONDS = 30 * 60
SEASON_TTL_SECONDS = 30 * 60
SEASON_PREWARM_CONCURRENCY = 4

_INSTALLED = False
_db = None
_title_cache: dict[int, tuple[float, dict, str, str]] = {}
_season_cache: dict[tuple[int, int], tuple[float, dict]] = {}
_inflight_titles: dict[int, asyncio.Task] = {}
_inflight_seasons: dict[tuple[int, int], asyncio.Task] = {}
_prewarm_tasks: dict[int, asyncio.Task] = {}


def _fresh(saved_at: float, ttl: int) -> bool:
    return saved_at > 0 and (time.monotonic() - saved_at) < ttl


def _cache_title(tmdb_id: int, title: dict, base: str, path: str) -> None:
    _title_cache[int(tmdb_id)] = (time.monotonic(), dict(title), str(base), str(path))


def _cache_season(tmdb_id: int, season_number: int, loaded: dict) -> None:
    _season_cache[(int(tmdb_id), int(season_number))] = (time.monotonic(), dict(loaded))


def _persist_title(db, tmdb_id: int, title: dict, base: str, path: str) -> None:
    try:
        db["sc_direct_titles_v18"].update_one(
            {"tmdbId": int(tmdb_id)},
            {"$set": {
                "tmdbId": int(tmdb_id),
                "title": dict(title),
                "sc_base": str(base),
                "sc_path": str(path),
                "policy": POLICY_VERSION,
                "updated_at": time.time(),
            }},
            upsert=True,
        )
    except Exception:
        pass


def _persist_season(db, tmdb_id: int, season_number: int, loaded: dict) -> None:
    try:
        db["sc_direct_seasons_v18"].update_one(
            {"tmdbId": int(tmdb_id), "season_number": int(season_number)},
            {"$set": {
                "tmdbId": int(tmdb_id),
                "season_number": int(season_number),
                "loadedSeason": dict(loaded),
                "policy": POLICY_VERSION,
                "updated_at": time.time(),
            }},
            upsert=True,
        )
    except Exception:
        pass


def _load_persisted_title(db, tmdb_id: int):
    try:
        row = db["sc_direct_titles_v18"].find_one({"tmdbId": int(tmdb_id)}, {"_id": 0}) or {}
    except Exception:
        return None
    title = row.get("title")
    if not isinstance(title, dict) or not title:
        return None
    return title, str(row.get("sc_base") or ""), str(row.get("sc_path") or "")


def _load_persisted_season(db, tmdb_id: int, season_number: int):
    try:
        row = db["sc_direct_seasons_v18"].find_one(
            {"tmdbId": int(tmdb_id), "season_number": int(season_number)}, {"_id": 0}
        ) or {}
    except Exception:
        return None
    loaded = row.get("loadedSeason")
    return loaded if isinstance(loaded, dict) and loaded else None


def _cdn_base(base: str = "") -> str:
    configured = str(os.environ.get("SC_CDN_BASE") or "").strip().rstrip("/")
    if configured:
        return configured + "/"
    chosen = str(base or sc._working_base or os.environ.get("SC_BASE_URL") or sc.SC_BASE_URL or "").strip()
    try:
        host = (urlparse(chosen).hostname or "").strip(".")
    except Exception:
        host = ""
    if not host:
        return str(getattr(sc, "SC_CDN_BASE", "") or "").rstrip("/") + "/"
    if not host.startswith("cdn."):
        host = f"cdn.{host}"
    return f"https://{host}/images/"


def _episode_image(row: dict, base: str = "") -> str:
    images = row.get("images") if isinstance(row, dict) else None
    candidates: list[dict] = []
    if isinstance(images, dict):
        for kind, value in images.items():
            if isinstance(value, dict):
                candidates.append({"type": value.get("type") or kind, **value})
            elif value:
                candidates.append({"type": kind, "filename": value})
    elif isinstance(images, list):
        candidates = [item for item in images if isinstance(item, dict)]

    preferred = []
    fallback = []
    for image in candidates:
        kind = str(image.get("type") or image.get("kind") or "").strip().lower()
        bucket = preferred if kind in {"cover", "still", "background", "backdrop", "card"} else fallback
        bucket.append(image)

    for image in [*preferred, *fallback]:
        original = str(image.get("original_url_field") or image.get("original_url") or "").strip()
        if original.startswith("http://") or original.startswith("https://"):
            return original
        raw = str(
            image.get("filename")
            or image.get("file")
            or image.get("path")
            or image.get("url")
            or image.get("src")
            or ""
        ).strip()
        if not raw:
            continue
        if raw.startswith("http://") or raw.startswith("https://"):
            return raw
        filename = raw.rsplit("/", 1)[-1].split("?", 1)[0]
        if filename:
            return f"{_cdn_base(base)}{filename}"
    return ""


def _episodes_from_loaded(loaded: dict, season_number: int, base: str = "") -> list[dict]:
    raw = loaded.get("episodes") if isinstance(loaded, dict) else []
    out: list[dict] = []
    seen: set[int] = set()
    if not isinstance(raw, list):
        return out
    for row in raw:
        if not isinstance(row, dict):
            continue
        try:
            number = int(row.get("number") or row.get("episode_number") or 0)
        except Exception:
            number = 0
        try:
            sc_episode_id = int(row.get("id") or 0)
        except Exception:
            sc_episode_id = 0
        if number <= 0 or number in seen:
            continue
        seen.add(number)
        try:
            runtime = int(row.get("duration") or row.get("runtime") or 0) or None
        except Exception:
            runtime = None
        out.append({
            "season_number": int(season_number),
            "episode_number": number,
            "sc_episode_id": sc_episode_id or None,
            "name": str(row.get("name") or f"Episodio {number}"),
            "overview": str(row.get("plot") or row.get("overview") or ""),
            "runtime": runtime,
            "still_path": _episode_image(row, base),
        })
    return sorted(out, key=lambda item: int(item["episode_number"]))


async def _verify_candidate(client: httpx.AsyncClient, tmdb_id: int, path: str, preferred_base: str = ""):
    title, base = await sc._get_title(client, path, preferred_base)
    if not title:
        return None
    found = sc._int(title.get("tmdb_id") or title.get("tmdbId"))
    if found != int(tmdb_id):
        return None
    return title, base, path


async def _resolve_title_uncached(tmdb_id: int):
    tmdb_id = int(tmdb_id)
    existing_path = sc._title_paths.get(tmdb_id)
    existing_base = sc._title_bases.get(tmdb_id, "")

    async with httpx.AsyncClient(
        timeout=sc.HTTP_TIMEOUT,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
    ) as client:
        if existing_path:
            hit = await _verify_candidate(client, tmdb_id, existing_path, existing_base)
            if hit:
                return hit

        identity = await sc._identity_for_tmdb(_db, tmdb_id, "tv")
        seen: set[str] = set()

        try:
            sc.CATALOG.load()
            candidates = sc.CATALOG.candidates(identity)[:20]
        except Exception:
            candidates = []

        for row in candidates:
            path = _detail_path(row)
            if not path or path in seen:
                continue
            seen.add(path)
            hit = await _verify_candidate(client, tmdb_id, path)
            if hit:
                return hit

        for base in sc._ordered_bases():
            for query in _query_variants(identity):
                if not query:
                    continue
                try:
                    response = await client.get(
                        f"{base}/it/search", params={"q": query}, headers=sc._headers(True)
                    )
                    if response.status_code != 200:
                        continue
                    rows = _search_rows(response.json())[:24]
                except Exception:
                    continue
                for row in rows:
                    path = _detail_path(row)
                    if not path or path in seen:
                        continue
                    seen.add(path)
                    hit = await _verify_candidate(client, tmdb_id, path, base)
                    if hit:
                        return hit
    return None


def _schedule_all_seasons(tmdb_id: int, title: dict) -> None:
    if not isinstance(title, dict):
        return
    descriptors = sc._season_descriptors(title)
    if not descriptors:
        return
    current = _prewarm_tasks.get(int(tmdb_id))
    if current is not None and not current.done():
        return

    async def run() -> None:
        semaphore = asyncio.Semaphore(SEASON_PREWARM_CONCURRENCY)

        async def one(number: int) -> None:
            key = (int(tmdb_id), int(number))
            cached = _season_cache.get(key)
            if cached and _fresh(cached[0], SEASON_TTL_SECONDS):
                return
            async with semaphore:
                try:
                    await _resolve_season(int(tmdb_id), int(number))
                except Exception:
                    return

        await asyncio.gather(
            *(one(int(row["season_number"])) for row in descriptors if int(row.get("season_number") or 0) > 0),
            return_exceptions=True,
        )

    task = asyncio.create_task(run())
    _prewarm_tasks[int(tmdb_id)] = task

    def cleanup(done: asyncio.Task) -> None:
        if _prewarm_tasks.get(int(tmdb_id)) is done:
            _prewarm_tasks.pop(int(tmdb_id), None)

    task.add_done_callback(cleanup)


async def _resolve_title(tmdb_id: int):
    tmdb_id = int(tmdb_id)
    cached = _title_cache.get(tmdb_id)
    if cached and _fresh(cached[0], TITLE_TTL_SECONDS):
        _schedule_all_seasons(tmdb_id, cached[1])
        return cached[1], cached[2], cached[3]

    persisted = await asyncio.to_thread(_load_persisted_title, _db, tmdb_id)
    if persisted:
        title, base, path = persisted
        _cache_title(tmdb_id, title, base, path)
        _schedule_all_seasons(tmdb_id, title)
        return title, base, path

    task = _inflight_titles.get(tmdb_id)
    if task is None or task.done():
        task = asyncio.create_task(_resolve_title_uncached(tmdb_id))
        _inflight_titles[tmdb_id] = task
    try:
        result = await task
    finally:
        if _inflight_titles.get(tmdb_id) is task and task.done():
            _inflight_titles.pop(tmdb_id, None)
    if result:
        title, base, path = result
        _cache_title(tmdb_id, title, base, path)
        await asyncio.to_thread(_persist_title, _db, tmdb_id, title, base, path)
        _schedule_all_seasons(tmdb_id, title)
        return title, base, path
    return None


async def _resolve_season(tmdb_id: int, season_number: int):
    key = (int(tmdb_id), int(season_number))
    cached = _season_cache.get(key)
    if cached and _fresh(cached[0], SEASON_TTL_SECONDS):
        return cached[1]

    persisted = await asyncio.to_thread(_load_persisted_season, _db, *key)
    if persisted:
        _cache_season(*key, persisted)
        return persisted

    title_hit = await _resolve_title(key[0])
    if not title_hit:
        return None
    title, base, path = title_hit
    valid_seasons = {int(row["season_number"]) for row in sc._season_descriptors(title)}
    if key[1] not in valid_seasons:
        return None

    task = _inflight_seasons.get(key)
    if task is None or task.done():
        async def fetch_one():
            async with httpx.AsyncClient(
                timeout=sc.HTTP_TIMEOUT,
                follow_redirects=True,
                limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
            ) as client:
                loaded = await sc._get_season(client, base, path, key[1])
                if not loaded:
                    return loaded
                enriched = dict(loaded)
                enriched["__flixit_sc_base"] = base
                return enriched
        task = asyncio.create_task(fetch_one())
        _inflight_seasons[key] = task
    try:
        loaded = await task
    finally:
        if _inflight_seasons.get(key) is task and task.done():
            _inflight_seasons.pop(key, None)
    if loaded:
        _cache_season(*key, loaded)
        await asyncio.to_thread(_persist_season, _db, *key, loaded)
        return loaded
    return None


def _episodes_payload(tmdb_id: int, season_number: int, loaded: dict) -> dict:
    cache_row = _title_cache.get(int(tmdb_id))
    cached_base = cache_row[2] if cache_row else ""
    base = str((loaded or {}).get("__flixit_sc_base") or cached_base or sc._working_base or "")
    episodes = _episodes_from_loaded(loaded or {}, int(season_number), base)
    rows = []
    for row in episodes:
        number = int(row.get("episode_number") or 0)
        if number <= 0:
            continue
        rows.append({
            **row,
            "tmdbId": int(tmdb_id),
            "season_number": int(season_number),
            "episode_number": number,
            "italian_available": True,
            "sc_available": True,
            "vixsrc_available": True,
            "italian_audio_status": "streamingcommunity_catalog",
            "italian_audio_evidence_explicit": True,
            "italian_audio_evidence_source": "streamingcommunity_loadedSeason_direct",
            "italian_audio_policy_version": POLICY_VERSION,
            "language_validation_pending": False,
        })
    return {
        "tmdbId": int(tmdb_id),
        "season_number": int(season_number),
        "episodes": rows,
        "index_ready": True,
        "sc_index_ready": True,
        "italian_audio_policy": "streamingcommunity_direct_loadedSeason",
        "italian_audio_policy_version": POLICY_VERSION,
        "snapshot_source": "streamingcommunity_loadedSeason_direct",
        "validation_pending_count": 0,
        "pending_recheck_seconds": 0,
        "episode_artwork_source": "streamingcommunity_episode_images",
        "episode_artwork_cdn": _cdn_base(base),
    }


def install_sc_direct_detail_v18(app, db) -> bool:
    global _INSTALLED, _db
    if _INSTALLED or getattr(app.state, "flixit_sc_direct_detail_v18", False):
        return True
    _db = db

    kept = []
    for route in app.router.routes:
        if isinstance(route, APIRoute) and "GET" in (route.methods or set()) and route.path in {SEASONS_PATH, SEASON_PATH}:
            continue
        kept.append(route)
    app.router.routes[:] = kept

    router = APIRouter()

    @router.get(SEASONS_PATH, tags=["catalog"])
    async def direct_sc_seasons(tmdb_id: int):
        hit = await _resolve_title(int(tmdb_id))
        if not hit:
            cached = sc._season_payload(int(tmdb_id))
            return {**cached, "policy": POLICY_VERSION, "direct_sc_ready": False}
        title, _base, _path = hit
        seasons = sc._season_descriptors(title)
        _schedule_all_seasons(int(tmdb_id), title)
        return {
            "tmdbId": int(tmdb_id),
            "seasons": seasons,
            "total_seasons": len(seasons),
            "sc_index_ready": True,
            "direct_sc_ready": True,
            "policy": POLICY_VERSION,
            "source": "StreamingCommunity props.title.seasons",
            "prewarm_all_seasons": True,
        }

    @router.get(SEASON_PATH, tags=["catalog"])
    async def direct_sc_episodes(tmdb_id: int, season_number: int):
        loaded = await _resolve_season(int(tmdb_id), int(season_number))
        if loaded:
            return _episodes_payload(int(tmdb_id), int(season_number), loaded)
        cached = sc._episodes_payload(int(tmdb_id), int(season_number))
        if cached.get("episodes"):
            return {
                **cached,
                "italian_audio_policy_version": POLICY_VERSION,
                "snapshot_source": "streamingcommunity_v17_cache_fallback",
            }
        return {
            "tmdbId": int(tmdb_id),
            "season_number": int(season_number),
            "episodes": [],
            "index_ready": False,
            "sc_index_ready": False,
            "italian_audio_policy": "streamingcommunity_direct_loadedSeason",
            "italian_audio_policy_version": POLICY_VERSION,
            "snapshot_source": "streamingcommunity_direct_unavailable",
            "validation_pending_count": 0,
            "pending_recheck_seconds": 1,
        }

    @router.get(STATUS_PATH, tags=["catalog"])
    async def direct_status():
        return {
            "policy": POLICY_VERSION,
            "source": "StreamingCommunity data-page",
            "title_source": "props.title.seasons",
            "episode_source": "props.loadedSeason.episodes",
            "episode_artwork": "https://cdn.<sc-domain>/images/<filename>",
            "cached_titles": len(_title_cache),
            "cached_seasons": len(_season_cache),
            "prewarming_titles": len(_prewarm_tasks),
            "vixsrc_role": "playback_only",
            "tmdb_role": "identity_metadata_only",
        }

    app.include_router(router)
    app.state.flixit_sc_direct_detail_v18 = True
    _INSTALLED = True
    return True


__all__ = ["install_sc_direct_detail_v18", "POLICY_VERSION"]
