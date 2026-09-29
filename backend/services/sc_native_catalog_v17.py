"""StreamingCommunity-native catalogue index (v17).

Availability is derived from StreamingCommunity's own public catalogue structure:
- /it/search and the committed SC archive identify SC titles;
- /it/titles/{id}-{slug} exposes props.title and its exact tmdb_id/seasons;
- /it/titles/{id}-{slug}/season-{n} exposes props.loadedSeason.episodes.

No StreamingCommunity/VixSrc request is performed while Home, Detail or Player is
opening. A background worker persists SC title/season/episode membership in Mongo
and mirrors it in memory. TMDB is metadata-only; VixSrc remains playback-only.
"""
from __future__ import annotations

import asyncio
import html as html_lib
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter
from fastapi.routing import APIRoute

from services.sc_artwork_catalog import CATALOG, SC_CDN_BASE
from services.trailers.providers.streamingcommunity import (
    _base_urls,
    _detail_path,
    _query_variants,
    _search_rows,
)

POLICY_VERSION = "sc-native-catalog-v17"
SEASONS_PATH = "/api/public/tv/{tmdb_id}/seasons"
SEASON_PATH = "/api/public/tv/{tmdb_id}/season/{season_number}"
STATUS_PATH = "/api/public/sc-index/status"
LEGACY_STATUS_PATH = "/api/public/italian-index/status"

TITLE_COLLECTION = "sc_native_titles_v17"
EPISODE_COLLECTION = "sc_native_episodes_v17"
META_COLLECTION = "sc_native_catalog_meta_v17"

PRIORITY_REFRESH_SECONDS = max(120, int(os.environ.get("SC_V17_PRIORITY_REFRESH_SECONDS", "600")))
FULL_REFRESH_SECONDS = max(900, int(os.environ.get("SC_V17_FULL_REFRESH_SECONDS", "21600")))
CRAWL_BATCH_SIZE = max(20, min(400, int(os.environ.get("SC_V17_CRAWL_BATCH_SIZE", "120"))))
CRAWL_CONCURRENCY = max(2, min(12, int(os.environ.get("SC_V17_CRAWL_CONCURRENCY", "6"))))
SEASON_CONCURRENCY = max(2, min(8, int(os.environ.get("SC_V17_SEASON_CONCURRENCY", "4"))))
HTTP_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)

_INSTALLED = False
_db = None
_working_base = ""
_background_tasks: set[asyncio.Task] = set()
_priority_task: Optional[asyncio.Task] = None
_crawl_task: Optional[asyncio.Task] = None

_movie_ids: set[int] = set()
_tv_ids: set[int] = set()
_seasons_by_tv: dict[int, list[dict]] = {}
_episodes_by_season: dict[tuple[int, int], list[dict]] = {}
_title_paths: dict[int, str] = {}
_title_bases: dict[int, str] = {}
_hydrated = False
_catalog_complete = False
_last_refresh_at = ""
_last_error = ""
_crawl_cursor = 0


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _int(value: Any) -> Optional[int]:
    try:
        number = int(value)
    except Exception:
        return None
    return number if number > 0 else None


def _media_type(value: Any) -> str:
    text = str(value or "").strip().lower()
    return "tv" if text in {"tv", "series", "serie", "tvseries", "show"} or "tv" in text else "movie"


def _inertia_page(document: str) -> dict:
    match = re.search(r"\bdata-page\s*=\s*([\"'])(.*?)\1", document or "", re.I | re.S)
    if not match:
        return {}
    try:
        return json.loads(html_lib.unescape(match.group(2)))
    except Exception:
        return {}


def _title_from_document(document: str) -> dict:
    page = _inertia_page(document)
    props = page.get("props") if isinstance(page, dict) else None
    title = props.get("title") if isinstance(props, dict) else None
    return title if isinstance(title, dict) else {}


def _loaded_season_from_document(document: str) -> dict:
    page = _inertia_page(document)
    props = page.get("props") if isinstance(page, dict) else None
    loaded = props.get("loadedSeason") if isinstance(props, dict) else None
    return loaded if isinstance(loaded, dict) else {}


def _season_descriptors(title: dict) -> list[dict]:
    raw = title.get("seasons") if isinstance(title, dict) else []
    out: list[dict] = []
    seen: set[int] = set()
    if isinstance(raw, list):
        for row in raw:
            if not isinstance(row, dict):
                continue
            number = _int(row.get("number") or row.get("season_number"))
            if not number or number in seen:
                continue
            seen.add(number)
            out.append({
                "season_number": number,
                "name": str(row.get("name") or row.get("title") or f"Stagione {number}"),
                "sc_title_id": _int(row.get("title_id")) or _int(title.get("id")),
            })
    count = _int(title.get("seasons_count")) or 0
    if not out and count:
        for number in range(1, count + 1):
            out.append({
                "season_number": number,
                "name": f"Stagione {number}",
                "sc_title_id": _int(title.get("id")),
            })
    return sorted(out, key=lambda row: int(row["season_number"]))


def _asset_url(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return f"{SC_CDN_BASE}{text.lstrip('/')}"


def _episode_still(row: dict) -> str:
    images = row.get("images") if isinstance(row, dict) else None
    if isinstance(images, dict):
        for key in ("cover", "still", "background", "backdrop", "poster", "card"):
            value = images.get(key)
            if isinstance(value, dict):
                value = value.get("url") or value.get("filename") or value.get("path")
            if value:
                return _asset_url(value)
    if isinstance(images, list):
        preferred = []
        rest = []
        for image in images:
            if not isinstance(image, dict):
                continue
            kind = str(image.get("type") or image.get("kind") or "").lower()
            (preferred if kind in {"cover", "still", "background", "backdrop", "card"} else rest).append(image)
        for image in [*preferred, *rest]:
            value = image.get("url") or image.get("filename") or image.get("path") or image.get("src")
            if value:
                return _asset_url(value)
    return ""


def _episodes_from_loaded(loaded: dict, season_number: int) -> list[dict]:
    raw = loaded.get("episodes") if isinstance(loaded, dict) else []
    out: list[dict] = []
    seen: set[int] = set()
    if not isinstance(raw, list):
        return out
    for row in raw:
        if not isinstance(row, dict):
            continue
        number = _int(row.get("number") or row.get("episode_number"))
        sc_episode_id = _int(row.get("id"))
        if not number or not sc_episode_id or number in seen:
            continue
        seen.add(number)
        duration = _int(row.get("duration") or row.get("runtime"))
        out.append({
            "season_number": int(season_number),
            "episode_number": number,
            "sc_episode_id": sc_episode_id,
            "name": str(row.get("name") or f"Episodio {number}"),
            "overview": str(row.get("plot") or row.get("overview") or ""),
            "runtime": duration,
            "still_path": _episode_still(row),
        })
    return sorted(out, key=lambda row: int(row["episode_number"]))


def _ensure_indexes(db) -> None:
    try:
        db[TITLE_COLLECTION].create_index("tmdbId", unique=True)
        db[TITLE_COLLECTION].create_index([("type", 1), ("updated_at", 1)])
        db[TITLE_COLLECTION].create_index("sc_id")
        db[EPISODE_COLLECTION].create_index(
            [("tmdbId", 1), ("generation", 1), ("season_number", 1), ("episode_number", 1)],
            unique=True,
        )
        db[EPISODE_COLLECTION].create_index([("tmdbId", 1), ("generation", 1)])
        db[META_COLLECTION].create_index("key", unique=True)
    except Exception:
        pass


def _hydrate(db) -> None:
    global _movie_ids, _tv_ids, _seasons_by_tv, _episodes_by_season
    global _title_paths, _title_bases, _hydrated, _catalog_complete, _crawl_cursor

    movie_ids: set[int] = set()
    tv_ids: set[int] = set()
    seasons_map: dict[int, list[dict]] = {}
    paths: dict[int, str] = {}
    bases: dict[int, str] = {}
    generations: dict[int, str] = {}

    try:
        for row in db[TITLE_COLLECTION].find({"active": {"$ne": False}}, {"_id": 0}):
            tmdb_id = _int(row.get("tmdbId"))
            if not tmdb_id:
                continue
            kind = _media_type(row.get("type"))
            if kind == "tv":
                tv_ids.add(tmdb_id)
                seasons_map[tmdb_id] = [dict(item) for item in (row.get("seasons") or []) if isinstance(item, dict)]
                generations[tmdb_id] = str(row.get("episode_generation") or "")
            else:
                movie_ids.add(tmdb_id)
            if row.get("sc_path"):
                paths[tmdb_id] = str(row.get("sc_path"))
            if row.get("sc_base"):
                bases[tmdb_id] = str(row.get("sc_base"))
    except Exception:
        pass

    episodes_map: dict[tuple[int, int], list[dict]] = {}
    try:
        for row in db[EPISODE_COLLECTION].find({}, {"_id": 0}):
            tmdb_id = _int(row.get("tmdbId"))
            season = _int(row.get("season_number"))
            episode = _int(row.get("episode_number"))
            if not tmdb_id or not season or not episode:
                continue
            wanted_generation = generations.get(tmdb_id)
            if not wanted_generation or str(row.get("generation") or "") != wanted_generation:
                continue
            episodes_map.setdefault((tmdb_id, season), []).append(dict(row))
    except Exception:
        pass
    for values in episodes_map.values():
        values.sort(key=lambda row: int(row.get("episode_number") or 0))

    meta = {}
    try:
        meta = db[META_COLLECTION].find_one({"key": "catalog"}, {"_id": 0}) or {}
    except Exception:
        pass

    _movie_ids = movie_ids
    _tv_ids = tv_ids
    _seasons_by_tv = seasons_map
    _episodes_by_season = episodes_map
    _title_paths = paths
    _title_bases = bases
    _catalog_complete = bool(meta.get("full_pass_completed_at"))
    _crawl_cursor = max(0, int(meta.get("crawl_cursor") or 0))
    _hydrated = True


def _commit_title(db, *, title: dict, base: str, path: str, seasons: list[dict], episodes: list[dict]) -> int:
    tmdb_id = _int(title.get("tmdb_id") or title.get("tmdbId"))
    if not tmdb_id:
        return 0
    kind = _media_type(title.get("type") or ("tv" if seasons else "movie"))
    now = _utcnow()
    sc_id = _int(title.get("id"))
    generation = f"{int(time.time())}-{tmdb_id}"

    if kind == "tv":
        docs = []
        for row in episodes:
            docs.append({
                **row,
                "tmdbId": tmdb_id,
                "generation": generation,
                "policy": POLICY_VERSION,
                "updated_at": now,
            })
        if docs:
            try:
                db[EPISODE_COLLECTION].insert_many(docs, ordered=False)
            except Exception:
                # Duplicate generation is harmless on a same-second retry.
                pass

    title_doc = {
        "tmdbId": tmdb_id,
        "sc_id": sc_id,
        "sc_slug": str(title.get("slug") or path.rstrip("/").split("-")[-1] or ""),
        "sc_path": path,
        "sc_base": base,
        "type": kind,
        "name": str(title.get("name") or title.get("title") or ""),
        "seasons": seasons if kind == "tv" else [],
        "episode_generation": generation if kind == "tv" else "",
        "active": True,
        "policy": POLICY_VERSION,
        "updated_at": now,
    }
    db[TITLE_COLLECTION].update_one({"tmdbId": tmdb_id}, {"$set": title_doc}, upsert=True)
    if kind == "tv":
        try:
            db[EPISODE_COLLECTION].delete_many({"tmdbId": tmdb_id, "generation": {"$ne": generation}})
        except Exception:
            pass

    _apply_title_to_memory(title_doc, episodes)
    return tmdb_id


def _apply_title_to_memory(title_doc: dict, episodes: list[dict]) -> None:
    tmdb_id = _int(title_doc.get("tmdbId"))
    if not tmdb_id:
        return
    kind = _media_type(title_doc.get("type"))
    if kind == "movie":
        _movie_ids.add(tmdb_id)
        _tv_ids.discard(tmdb_id)
    else:
        _tv_ids.add(tmdb_id)
        _movie_ids.discard(tmdb_id)
        _seasons_by_tv[tmdb_id] = [dict(row) for row in (title_doc.get("seasons") or []) if isinstance(row, dict)]
        grouped: dict[int, list[dict]] = {}
        for row in episodes:
            season = _int(row.get("season_number"))
            if season:
                grouped.setdefault(season, []).append(dict(row))
        for season in [int(row.get("season_number") or 0) for row in _seasons_by_tv.get(tmdb_id, [])]:
            if season > 0:
                _episodes_by_season[(tmdb_id, season)] = sorted(
                    grouped.get(season, []), key=lambda item: int(item.get("episode_number") or 0)
                )
    if title_doc.get("sc_path"):
        _title_paths[tmdb_id] = str(title_doc["sc_path"])
    if title_doc.get("sc_base"):
        _title_bases[tmdb_id] = str(title_doc["sc_base"])


def _headers(json_request: bool = False) -> dict:
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept": "application/json, text/plain, */*" if json_request else "text/html,application/xhtml+xml",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.5",
        "X-Requested-With": "XMLHttpRequest" if json_request else "",
    }


def _ordered_bases(preferred: str = "") -> list[str]:
    values = _base_urls()
    first = preferred or _working_base
    if first and first in values:
        return [first, *[value for value in values if value != first]]
    return values


async def _get_title(client: httpx.AsyncClient, path: str, preferred_base: str = "") -> tuple[dict, str]:
    global _working_base
    for base in _ordered_bases(preferred_base):
        try:
            response = await client.get(f"{base}{path}", headers=_headers(False))
        except Exception:
            continue
        if response.status_code != 200:
            continue
        title = _title_from_document(response.text)
        if not title:
            continue
        _working_base = base
        return title, base
    return {}, ""


async def _get_season(client: httpx.AsyncClient, base: str, title_path: str, season: int) -> Optional[dict]:
    try:
        response = await client.get(
            f"{base}{title_path.rstrip('/')}/season-{int(season)}",
            headers=_headers(False),
        )
    except Exception:
        return None
    if response.status_code != 200:
        return None
    loaded = _loaded_season_from_document(response.text)
    return loaded if loaded else None


async def _index_title_path(client: httpx.AsyncClient, db, path: str, preferred_base: str = "", expected_tmdb: int = 0) -> int:
    title, base = await _get_title(client, path, preferred_base)
    if not title:
        return 0
    tmdb_id = _int(title.get("tmdb_id") or title.get("tmdbId"))
    if not tmdb_id or (expected_tmdb and tmdb_id != int(expected_tmdb)):
        return 0

    kind = _media_type(title.get("type"))
    seasons = _season_descriptors(title) if kind == "tv" else []
    all_episodes: list[dict] = []
    if kind == "tv":
        if not seasons:
            return 0
        semaphore = asyncio.Semaphore(SEASON_CONCURRENCY)

        async def load_one(descriptor: dict):
            number = int(descriptor["season_number"])
            async with semaphore:
                loaded = await _get_season(client, base, path, number)
            if loaded is None:
                return None
            return number, _episodes_from_loaded(loaded, number)

        results = await asyncio.gather(*(load_one(row) for row in seasons), return_exceptions=True)
        if any(item is None or isinstance(item, Exception) for item in results):
            return 0
        counts: dict[int, int] = {}
        for number, rows in results:
            counts[int(number)] = len(rows)
            all_episodes.extend(rows)
        for descriptor in seasons:
            descriptor["episode_count"] = int(counts.get(int(descriptor["season_number"]), 0))
            descriptor["sc_available"] = True
            descriptor["vixsrc_available"] = True
            descriptor["is_aired"] = True

    return await asyncio.to_thread(
        _commit_title,
        db,
        title=title,
        base=base,
        path=path,
        seasons=seasons,
        episodes=all_episodes,
    )


async def _identity_for_tmdb(db, tmdb_id: int, kind: str) -> dict:
    row = None
    try:
        row = await asyncio.to_thread(
            lambda: db["contents"].find_one(
                {"tmdbId": int(tmdb_id)},
                {"_id": 0, "tmdbId": 1, "type": 1, "title": 1, "name": 1, "original_title": 1, "original_name": 1},
            )
        )
    except Exception:
        row = None
    row = row or {}
    title = str(row.get("title") or row.get("name") or "").strip()
    original = str(row.get("original_title") or row.get("original_name") or "").strip()
    if title:
        return {"tmdbId": int(tmdb_id), "type": kind, "title": title, "original_title": original}

    try:
        import server_core as core
        data = await core.fetch_tmdb_data(f"/{kind}/{int(tmdb_id)}")
    except Exception:
        data = None
    data = data or {}
    return {
        "tmdbId": int(tmdb_id),
        "type": kind,
        "title": str(data.get("title") or data.get("name") or ""),
        "original_title": str(data.get("original_title") or data.get("original_name") or ""),
    }


async def _find_and_index_tmdb(client: httpx.AsyncClient, db, tmdb_id: int, kind: str) -> int:
    existing = _title_paths.get(int(tmdb_id))
    if existing:
        return await _index_title_path(
            client, db, existing, _title_bases.get(int(tmdb_id), ""), expected_tmdb=int(tmdb_id)
        )

    identity = await _identity_for_tmdb(db, int(tmdb_id), kind)
    if not identity.get("title") and not identity.get("original_title"):
        return 0

    try:
        CATALOG.load()
        candidate_rows = CATALOG.candidates(identity)[:16]
    except Exception:
        candidate_rows = []
    seen_paths: set[str] = set()
    for row in candidate_rows:
        path = _detail_path(row)
        if not path or path in seen_paths:
            continue
        seen_paths.add(path)
        result = await _index_title_path(client, db, path, expected_tmdb=int(tmdb_id))
        if result:
            return result

    for base in _ordered_bases():
        for query in _query_variants(identity):
            if not query:
                continue
            try:
                response = await client.get(
                    f"{base}/it/search", params={"q": query}, headers=_headers(True)
                )
                if response.status_code != 200:
                    continue
                rows = _search_rows(response.json())[:20]
            except Exception:
                continue
            for row in rows:
                path = _detail_path(row)
                if not path or path in seen_paths:
                    continue
                seen_paths.add(path)
                result = await _index_title_path(
                    client, db, path, preferred_base=base, expected_tmdb=int(tmdb_id)
                )
                if result:
                    return result
    return 0


def _priority_ids(db) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()

    def add(kind: str, value: Any) -> None:
        tmdb_id = _int(value)
        if not tmdb_id:
            return
        key = (_media_type(kind), tmdb_id)
        if key not in seen:
            seen.add(key)
            out.append(key)

    try:
        rows = db["watch_progress"].find({}, {"_id": 0, "tmdb_id": 1, "media_type": 1}).sort("updated_at", -1).limit(80)
        for row in rows:
            add(row.get("media_type") or "tv", row.get("tmdb_id"))
    except Exception:
        pass
    try:
        rows = db["contents"].find({"available": {"$ne": False}}, {"_id": 0, "tmdbId": 1, "type": 1}).sort("createdAt", -1).limit(180)
        for row in rows:
            add(row.get("type") or "movie", row.get("tmdbId"))
    except Exception:
        pass
    try:
        for value in db["tv_seasons"].distinct("tmdbId")[:180]:
            add("tv", value)
    except Exception:
        pass
    try:
        stale = db[TITLE_COLLECTION].find({"type": "tv", "active": {"$ne": False}}, {"_id": 0, "tmdbId": 1}).sort("updated_at", 1).limit(120)
        for row in stale:
            add("tv", row.get("tmdbId"))
    except Exception:
        pass
    return out[:420]


async def _refresh_priority(db) -> int:
    pairs = await asyncio.to_thread(_priority_ids, db)
    if not pairs:
        return 0
    semaphore = asyncio.Semaphore(CRAWL_CONCURRENCY)
    count = 0
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=16, max_keepalive_connections=10),
    ) as client:
        async def run_one(pair):
            kind, tmdb_id = pair
            async with semaphore:
                return await _find_and_index_tmdb(client, db, tmdb_id, kind)

        results = await asyncio.gather(*(run_one(pair) for pair in pairs), return_exceptions=True)
        count = sum(1 for value in results if isinstance(value, int) and value > 0)
    return count


async def _crawl_batch(db) -> tuple[int, bool]:
    global _crawl_cursor, _catalog_complete
    try:
        CATALOG.load()
        records = list(CATALOG.records or [])
    except Exception:
        records = []
    if not records:
        return 0, False

    start = _crawl_cursor if 0 <= _crawl_cursor < len(records) else 0
    end = min(len(records), start + CRAWL_BATCH_SIZE)
    batch = records[start:end]
    semaphore = asyncio.Semaphore(CRAWL_CONCURRENCY)

    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=16, max_keepalive_connections=10),
    ) as client:
        async def run_one(row):
            path = _detail_path(row)
            if not path:
                return 0
            async with semaphore:
                return await _index_title_path(client, db, path)

        results = await asyncio.gather(*(run_one(row) for row in batch), return_exceptions=True)
    success = sum(1 for value in results if isinstance(value, int) and value > 0)
    finished = end >= len(records)
    _crawl_cursor = 0 if finished else end
    if finished:
        _catalog_complete = True

    try:
        update = {
            "crawl_cursor": _crawl_cursor,
            "catalog_count": len(records),
            "last_batch_success": success,
            "updated_at": _utcnow(),
            "policy": POLICY_VERSION,
        }
        if finished:
            update["full_pass_completed_at"] = _utcnow()
        await asyncio.to_thread(
            db[META_COLLECTION].update_one,
            {"key": "catalog"},
            {"$set": {"key": "catalog", **update}},
            True,
        )
    except Exception:
        pass
    return success, finished


def movie_allowed(tmdb_id: int) -> bool:
    try:
        return int(tmdb_id) in _movie_ids
    except Exception:
        return False


def tv_allowed(tmdb_id: int) -> bool:
    try:
        return int(tmdb_id) in _tv_ids
    except Exception:
        return False


def episode_allowed(tmdb_id: int, season: int, episode: int) -> bool:
    try:
        rows = _episodes_by_season.get((int(tmdb_id), int(season)), [])
        return any(int(row.get("episode_number") or 0) == int(episode) for row in rows)
    except Exception:
        return False


def _season_payload(tmdb_id: int) -> dict:
    seasons = [dict(row) for row in _seasons_by_tv.get(int(tmdb_id), [])]
    return {
        "tmdbId": int(tmdb_id),
        "seasons": seasons,
        "total_seasons": len(seasons),
        "sc_index_ready": bool(seasons),
        "sc_catalog_complete": _catalog_complete,
        "policy": POLICY_VERSION,
    }


def _episodes_payload(tmdb_id: int, season_number: int) -> dict:
    rows = [dict(row) for row in _episodes_by_season.get((int(tmdb_id), int(season_number)), [])]
    episodes = []
    for row in rows:
        number = int(row.get("episode_number") or 0)
        episodes.append({
            **row,
            "tmdbId": int(tmdb_id),
            "season_number": int(season_number),
            "episode_number": number,
            "name": row.get("name") or f"Episodio {number}",
            "overview": row.get("overview") or "",
            "still_path": row.get("still_path") or "",
            "italian_available": True,
            "sc_available": True,
            "vixsrc_available": True,
            "italian_audio_status": "catalogued_by_streamingcommunity",
            "italian_audio_evidence_explicit": True,
            "italian_audio_evidence_source": "streamingcommunity_loadedSeason",
            "italian_audio_policy_version": POLICY_VERSION,
            "language_validation_pending": False,
        })
    return {
        "tmdbId": int(tmdb_id),
        "season_number": int(season_number),
        "episodes": episodes,
        "index_ready": bool(int(tmdb_id) in _tv_ids),
        "sc_catalog_complete": _catalog_complete,
        "italian_audio_policy": "streamingcommunity_catalog_is_authority",
        "italian_audio_policy_version": POLICY_VERSION,
        "snapshot_source": "streamingcommunity_loadedSeason",
        "validation_pending_count": 0,
        "pending_recheck_seconds": 0,
    }


def _filter_home_payload(payload: dict) -> dict:
    if not isinstance(payload, dict) or not _catalog_complete:
        return payload

    def allowed(item: Any) -> bool:
        if not isinstance(item, dict):
            return False
        tmdb_id = _int(item.get("tmdbId") or item.get("tmdb_id") or item.get("id"))
        if not tmdb_id:
            return False
        return tv_allowed(tmdb_id) if _media_type(item.get("type") or item.get("media_type")) == "tv" else movie_allowed(tmdb_id)

    rows = []
    first = None
    for row in payload.get("rows") or []:
        if not isinstance(row, dict):
            continue
        items = [item for item in (row.get("items") or []) if allowed(item)]
        if first is None and items:
            first = items[0]
        rows.append({**row, "items": items})
    hero = payload.get("hero")
    if not allowed(hero):
        hero = first
    return {**payload, "hero": hero, "rows": rows}


def _keep(task: asyncio.Task) -> asyncio.Task:
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


async def _worker(db) -> None:
    global _last_refresh_at, _last_error
    try:
        await asyncio.to_thread(_ensure_indexes, db)
        await asyncio.to_thread(_hydrate, db)
    except Exception as exc:
        _last_error = f"hydrate:{exc.__class__.__name__}"

    # Priority content (recently watched/admin/current TV) is indexed first so
    # existing Detail pages become exact before the broad SC archive sweep.
    while True:
        try:
            await _refresh_priority(db)
            _last_refresh_at = _utcnow()
            _last_error = ""
        except Exception as exc:
            _last_error = f"priority:{exc.__class__.__name__}"

        # Walk the committed SC archive in small background batches. A failed
        # title never deletes a previously indexed title.
        cycle_started = time.monotonic()
        finished = False
        while not finished and time.monotonic() - cycle_started < PRIORITY_REFRESH_SECONDS * 0.75:
            try:
                _, finished = await _crawl_batch(db)
            except Exception as exc:
                _last_error = f"crawl:{exc.__class__.__name__}"
                break
            await asyncio.sleep(0.5)

        await asyncio.sleep(PRIORITY_REFRESH_SECONDS if not finished else min(FULL_REFRESH_SECONDS, PRIORITY_REFRESH_SECONDS))


def install_sc_native_catalog_v17(app, db) -> bool:
    """Install SC as the final catalogue authority without blocking startup."""
    global _INSTALLED, _db
    if _INSTALLED or getattr(app.state, "flixit_sc_native_catalog_v17", False):
        return True
    _db = db

    old_seasons_endpoint = None
    old_season_endpoint = None
    kept = []
    for route in app.router.routes:
        if isinstance(route, APIRoute) and "GET" in (route.methods or set()):
            if route.path == SEASONS_PATH:
                old_seasons_endpoint = route.endpoint
                continue
            if route.path == SEASON_PATH:
                old_season_endpoint = route.endpoint
                continue
            if route.path in {STATUS_PATH, LEGACY_STATUS_PATH}:
                continue
        kept.append(route)
    app.router.routes[:] = kept

    router = APIRouter()

    @router.get(SEASONS_PATH, tags=["catalog"])
    async def sc_tv_seasons(tmdb_id: int):
        payload = _season_payload(int(tmdb_id))
        if payload["seasons"] or _catalog_complete:
            return payload
        # Migration-safe only: old endpoint may provide season labels while the
        # first SC background pass is still building. Frontend v17 will not cache
        # this as an authoritative SC snapshot.
        if callable(old_seasons_endpoint):
            try:
                fallback = await old_seasons_endpoint(tmdb_id=int(tmdb_id))
                if isinstance(fallback, dict):
                    return {**fallback, "sc_index_ready": False, "policy": POLICY_VERSION}
            except Exception:
                pass
        return payload

    @router.get(SEASON_PATH, tags=["catalog"])
    async def sc_tv_episodes(tmdb_id: int, season_number: int):
        # No provider request happens here: this is a pure in-memory SC snapshot.
        return _episodes_payload(int(tmdb_id), int(season_number))

    async def status_payload():
        return {
            "policy": POLICY_VERSION,
            "source": "StreamingCommunity title/seasons/loadedSeason.episodes",
            "hydrated": _hydrated,
            "catalog_complete": _catalog_complete,
            "movie_count": len(_movie_ids),
            "tv_count": len(_tv_ids),
            "season_count": sum(len(value) for value in _seasons_by_tv.values()),
            "episode_count": sum(len(value) for value in _episodes_by_season.values()),
            "crawl_cursor": _crawl_cursor,
            "working_base": _working_base or None,
            "last_refresh_at": _last_refresh_at or None,
            "last_error": _last_error or None,
            "request_time_provider_checks": False,
            "vixsrc_role": "playback_only",
            "tmdb_role": "metadata_only",
        }

    router.add_api_route(STATUS_PATH, status_payload, methods=["GET"], tags=["catalog"])
    router.add_api_route(LEGACY_STATUS_PATH, status_payload, methods=["GET"], tags=["catalog"])
    app.include_router(router)

    async def apply_runtime_guards():
        import player
        import server_core as core
        from services import fast_catalog_availability as fast_catalog
        from services import home_bootstrap_fast as home_fast

        original_member = fast_catalog._catalog_member
        if not getattr(original_member, "_flixit_sc_v17", False):
            def sc_member(core_arg, media_type: str, tmdb_id: int) -> bool:
                try:
                    tmdb_id = int(tmdb_id)
                except Exception:
                    return False
                if not _catalog_complete:
                    return original_member(core_arg, media_type, tmdb_id)
                try:
                    blocklist = getattr(core_arg, "_stream_blocklist", None)
                    if blocklist and blocklist.is_blocked(_media_type(media_type), tmdb_id):
                        return False
                except Exception:
                    return False
                return tv_allowed(tmdb_id) if _media_type(media_type) == "tv" else movie_allowed(tmdb_id)

            sc_member._flixit_sc_v17 = True
            sc_member._original = original_member
            fast_catalog._catalog_member = sc_member

        original_loaded = fast_catalog._ensure_local_catalog
        if not getattr(original_loaded, "_flixit_sc_v17", False):
            def sc_loaded(core_arg):
                if _catalog_complete:
                    return {"movie": True, "tv": True}
                return original_loaded(core_arg)
            sc_loaded._flixit_sc_v17 = True
            sc_loaded._original = original_loaded
            fast_catalog._ensure_local_catalog = sc_loaded

        current_compact = home_fast._compact
        if not getattr(current_compact, "_flixit_sc_v17", False):
            def compact_sc(payload: dict) -> dict:
                return _filter_home_payload(current_compact(payload))
            compact_sc._flixit_sc_v17 = True
            compact_sc._original = current_compact
            home_fast._compact = compact_sc

        # Full Home/archive rows also use core.filter_available. Once the first
        # complete SC pass exists, the SC index is the only catalogue membership.
        current_filter = getattr(core, "filter_available", None)
        if callable(current_filter) and not getattr(current_filter, "_flixit_sc_v17", False):
            async def sc_filter_available(items: list, limit: int = 24):
                if not _catalog_complete:
                    return await current_filter(items, limit)
                out = []
                wanted = max(1, int(limit or 24))
                for item in items or []:
                    tmdb_id = _int(item.get("tmdbId") or item.get("tmdb_id") or item.get("id")) if isinstance(item, dict) else None
                    if not tmdb_id:
                        continue
                    kind = _media_type(item.get("type") or item.get("media_type"))
                    if (tv_allowed(tmdb_id) if kind == "tv" else movie_allowed(tmdb_id)):
                        out.append(item)
                        if len(out) >= wanted:
                            break
                return out
            sc_filter_available._flixit_sc_v17 = True
            sc_filter_available._original = current_filter
            core.filter_available = sc_filter_available

        # Unwrap an old v16 gate if one was installed by a stale process/order,
        # then apply SC membership. VixSrc is called only after SC approves.
        current_resolve = player.resolve_stream
        while getattr(current_resolve, "_flixit_preindexed_it_v16", False) and callable(getattr(current_resolve, "_original", None)):
            current_resolve = current_resolve._original
        if not getattr(player.resolve_stream, "_flixit_sc_v17", False):
            async def sc_resolve(media_type: str, tmdb_id: int, season=None, episode=None):
                kind = _media_type(media_type)
                tmdb_id = int(tmdb_id)
                if _catalog_complete:
                    if kind == "movie" and not movie_allowed(tmdb_id):
                        return {"success": False, "reason": "not_in_streamingcommunity_catalog", "message": "Titolo non disponibile nel catalogo"}
                    if kind == "tv":
                        season_number = max(1, int(season or 1))
                        episode_number = max(1, int(episode or 1))
                        if not episode_allowed(tmdb_id, season_number, episode_number):
                            return {"success": False, "reason": "not_in_streamingcommunity_catalog", "message": "Episodio non disponibile nel catalogo"}
                return await current_resolve(kind, tmdb_id, season, episode)
            sc_resolve._flixit_sc_v17 = True
            sc_resolve._original = current_resolve
            player.resolve_stream = sc_resolve

        try:
            core.clear_response_cache()
        except Exception:
            pass

        global _priority_task
        if _priority_task is None or _priority_task.done():
            _priority_task = _keep(asyncio.create_task(_worker(db)))
        app.state.flixit_sc_native_catalog_worker = _priority_task

    app.add_event_handler("startup", apply_runtime_guards)
    app.state.flixit_sc_native_catalog_v17 = {
        "installed": True,
        "policy": POLICY_VERSION,
        "availability": "StreamingCommunity catalog",
        "seasons": "props.title.seasons",
        "episodes": "props.loadedSeason.episodes",
        "player": "VixSrc playback after SC membership",
        "request_time_provider_checks": False,
    }
    _INSTALLED = True
    return True


__all__ = [
    "install_sc_native_catalog_v17",
    "movie_allowed",
    "tv_allowed",
    "episode_allowed",
    "POLICY_VERSION",
    "_title_from_document",
    "_loaded_season_from_document",
    "_season_descriptors",
    "_episodes_from_loaded",
]
