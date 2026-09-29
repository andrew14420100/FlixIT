"""FlixIT v16 pre-indexed Italian media catalogue.

The user-facing application must never verify language while a page is opening.
This service keeps a persistent Italian-only index in MongoDB and mirrors the
active generation in process memory. Home, Detail/season and Player perform only
constant-time membership lookups against that already-built index.

Upstream/provider work happens exclusively in background workers:
- /api/list/movie?lang=it -> Italian movie ids
- /api/list/episode?lang=it -> Italian TV episode keys
- trusted explicit HLS/manual episode verdicts are merged as overlays

A new generation is written atomically (meta pointer swap) so a failed refresh
never replaces a known-good index with a partial one.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter
from fastapi.routing import APIRoute

POLICY_VERSION = "italian-media-index-v16"
ROUTE_PATH = "/api/public/tv/{tmdb_id}/season/{season_number}"
STATUS_PATH = "/api/public/italian-index/status"
VIXSRC_BASE = os.environ.get("VIXSRC_BASE_URL", "https://vixsrc.to").rstrip("/")
REFRESH_SECONDS = max(300, int(os.environ.get("ITALIAN_MEDIA_INDEX_REFRESH_SECONDS", "900")))
MAX_CATALOG_PAGES = max(1, int(os.environ.get("ITALIAN_MEDIA_INDEX_MAX_PAGES", "500")))
FETCH_CONCURRENCY = max(2, min(20, int(os.environ.get("ITALIAN_MEDIA_INDEX_FETCH_CONCURRENCY", "10"))))
COLLECTION = "italian_media_index_v16"
META_COLLECTION = "italian_media_index_meta_v16"

_INSTALLED = False
_db = None
_movie_ids: set[int] = set()
_episode_keys: set[tuple[int, int, int]] = set()
_tv_ids: set[int] = set()
_movie_generation = ""
_episode_generation = ""
_movie_ready = False
_episode_ready = False
_last_refresh_at = ""
_refresh_task: Optional[asyncio.Task] = None
_background_tasks: set[asyncio.Task] = set()

# User-confirmed original/English episodes stay excluded even if an upstream
# catalogue temporarily contains a stale row.
_HARD_NEGATIVE_EPISODES = {
    (65334, 6, 19),
    (65334, 6, 20),
    (65334, 6, 21),
}

_TRUSTED_POSITIVE_EVIDENCE = {
    "hls_audio_language",
    "manual_override",
    "vixsrc_episode_catalog_it",
}

_TRUSTED_NEGATIVE_STATUSES = {
    "english_or_original_audio",
    "original_only",
    "user_confirmed_original_audio",
    "manual_original_audio",
}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _positive_int(value: Any) -> Optional[int]:
    try:
        number = int(str(value).strip())
    except Exception:
        return None
    return number if number > 0 else None


def _first_int(row: dict, keys: tuple[str, ...]) -> Optional[int]:
    for key in keys:
        if key not in row:
            continue
        value = _positive_int(row.get(key))
        if value is not None:
            return value
    return None


def _catalog_rows(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("results", "items", "episodes", "movies", "data", "catalog"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for nested in ("results", "items", "episodes", "movies", "data"):
                nested_value = value.get(nested)
                if isinstance(nested_value, list):
                    return nested_value
    return []


def _movie_id_from_row(row: Any) -> Optional[int]:
    if not isinstance(row, dict):
        return None
    tmdb_id = _first_int(
        row,
        ("tmdb_id", "tmdbId", "tmdb", "themoviedb_id", "theMovieDbId"),
    )
    if tmdb_id:
        return tmdb_id
    for nested_key in ("media", "data", "movie", "meta"):
        nested = row.get(nested_key)
        if isinstance(nested, dict):
            tmdb_id = _first_int(
                nested,
                ("tmdb_id", "tmdbId", "tmdb", "themoviedb_id", "theMovieDbId"),
            )
            if tmdb_id:
                return tmdb_id
    return None


def _episode_key_from_row(row: Any) -> Optional[tuple[int, int, int]]:
    if not isinstance(row, dict):
        return None
    tmdb_id = _first_int(
        row,
        ("tmdb_id", "tmdbId", "tmdb", "themoviedb_id", "theMovieDbId"),
    )
    season = _first_int(
        row,
        ("season", "season_number", "seasonNumber", "season_num", "s"),
    )
    episode = _first_int(
        row,
        ("episode", "episode_number", "episodeNumber", "episode_num", "e"),
    )
    for nested_key in ("media", "data", "episode_data", "episodeData", "meta"):
        nested = row.get(nested_key)
        if not isinstance(nested, dict):
            continue
        tmdb_id = tmdb_id or _first_int(
            nested,
            ("tmdb_id", "tmdbId", "tmdb", "themoviedb_id", "theMovieDbId"),
        )
        season = season or _first_int(
            nested,
            ("season", "season_number", "seasonNumber", "season_num", "s"),
        )
        episode = episode or _first_int(
            nested,
            ("episode", "episode_number", "episodeNumber", "episode_num", "e"),
        )
    if tmdb_id and season and episode:
        return int(tmdb_id), int(season), int(episode)
    return None


def _page_number(payload: Any, key: str, default: int) -> int:
    if not isinstance(payload, dict):
        return default
    try:
        value = int(payload.get(key, default))
        return value if value > 0 else default
    except Exception:
        return default


async def _fetch_complete_catalog(kind: str):
    """Return a complete parsed set or None when the refresh is incomplete."""
    url = f"{VIXSRC_BASE}/api/list/{kind}/"
    timeout = httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=5.0)
    limits = httpx.Limits(max_connections=20, max_keepalive_connections=12)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "it-IT,it;q=0.9",
    }

    async with httpx.AsyncClient(
        timeout=timeout,
        limits=limits,
        follow_redirects=True,
        headers=headers,
    ) as client:
        try:
            first = await client.get(url, params={"lang": "it"})
        except Exception:
            return None
        if first.status_code != 200:
            return None
        try:
            first_payload = first.json()
        except Exception:
            return None

        payloads = [first_payload]
        current = _page_number(first_payload, "current_page", 1)
        last = _page_number(first_payload, "last_page", current)
        if last < current or last > MAX_CATALOG_PAGES:
            return None

        if last > current:
            semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)

            async def fetch_page(page: int):
                async with semaphore:
                    try:
                        response = await client.get(url, params={"lang": "it", "page": page})
                        if response.status_code != 200:
                            return None
                        return response.json()
                    except Exception:
                        return None

            rest = await asyncio.gather(
                *(fetch_page(page) for page in range(current + 1, last + 1)),
                return_exceptions=True,
            )
            for item in rest:
                if item is None or isinstance(item, Exception):
                    return None
                payloads.append(item)

    if kind == "movie":
        out: set[int] = set()
        for payload in payloads:
            for row in _catalog_rows(payload):
                tmdb_id = _movie_id_from_row(row)
                if tmdb_id:
                    out.add(int(tmdb_id))
        return out if out else None

    out_episode: set[tuple[int, int, int]] = set()
    for payload in payloads:
        for row in _catalog_rows(payload):
            key = _episode_key_from_row(row)
            if key:
                out_episode.add(key)
    return out_episode if out_episode else None


def _ensure_indexes(db) -> None:
    try:
        collection = db[COLLECTION]
        collection.create_index([("kind", 1), ("generation", 1)])
        collection.create_index([("kind", 1), ("tmdbId", 1)])
        collection.create_index(
            [("kind", 1), ("generation", 1), ("tmdbId", 1), ("season", 1), ("episode", 1)],
            unique=True,
        )
        db[META_COLLECTION].create_index("kind", unique=True)
    except Exception:
        pass


def _active_generation(db, kind: str) -> str:
    try:
        row = db[META_COLLECTION].find_one({"kind": kind}, {"_id": 0, "generation": 1}) or {}
        return str(row.get("generation") or "")
    except Exception:
        return ""


def _load_generation(db, kind: str, generation: str):
    if not generation:
        return set()
    try:
        rows = db[COLLECTION].find(
            {"kind": kind, "generation": generation},
            {"_id": 0, "tmdbId": 1, "season": 1, "episode": 1},
        )
        if kind == "movie":
            return {
                int(row["tmdbId"])
                for row in rows
                if row.get("tmdbId") and int(row.get("tmdbId")) > 0
            }
        return {
            (int(row["tmdbId"]), int(row["season"]), int(row["episode"]))
            for row in rows
            if row.get("tmdbId") and row.get("season") and row.get("episode")
        }
    except Exception:
        return set()


def _legacy_episode_seed(db) -> set[tuple[int, int, int]]:
    """Reuse the already-persisted Italian episode catalogue on first v16 boot."""
    out: set[tuple[int, int, int]] = set()
    try:
        rows = db["vixsrc_episode_catalog_it"].find(
            {}, {"_id": 0, "tmdbId": 1, "season": 1, "episode": 1}
        )
        for row in rows:
            try:
                key = (int(row["tmdbId"]), int(row["season"]), int(row["episode"]))
                if all(value > 0 for value in key):
                    out.add(key)
            except Exception:
                continue
    except Exception:
        pass
    return out


def _legacy_movie_seed(db) -> set[int]:
    out: set[int] = set()
    try:
        rows = db["italian_movie_audio_cache"].find(
            {"available": True, "status": "italian"},
            {"_id": 0, "tmdbId": 1},
        )
        for row in rows:
            try:
                value = int(row.get("tmdbId") or 0)
                if value > 0:
                    out.add(value)
            except Exception:
                continue
    except Exception:
        pass
    return out


def _apply_episode_overlays(db, keys: set[tuple[int, int, int]]) -> set[tuple[int, int, int]]:
    out = set(keys)
    out.difference_update(_HARD_NEGATIVE_EPISODES)

    # Manual overrides have final authority.
    try:
        rows = db["italian_audio_overrides"].find(
            {}, {"_id": 0, "tmdbId": 1, "season": 1, "episode": 1, "italian_available": 1}
        )
        for row in rows:
            try:
                key = (int(row["tmdbId"]), int(row["season"]), int(row["episode"]))
            except Exception:
                continue
            if row.get("italian_available") is True:
                out.add(key)
            elif row.get("italian_available") is False:
                out.discard(key)
    except Exception:
        pass

    # Merge only strong HLS/manual evidence from previous validators. Plain
    # ?lang=it results are deliberately ignored.
    try:
        rows = db["italian_episode_audio_cache"].find(
            {},
            {
                "_id": 0,
                "tmdbId": 1,
                "season": 1,
                "episode": 1,
                "result": 1,
            },
        )
        for row in rows:
            result = row.get("result") if isinstance(row.get("result"), dict) else {}
            try:
                key = (int(row["tmdbId"]), int(row["season"]), int(row["episode"]))
            except Exception:
                continue
            evidence = str(result.get("italian_audio_evidence_source") or "").strip().lower()
            status = str(result.get("italian_audio_status") or "").strip().lower()
            if result.get("italian_available") is True and evidence in _TRUSTED_POSITIVE_EVIDENCE:
                out.add(key)
            elif result.get("italian_available") is False and status in _TRUSTED_NEGATIVE_STATUSES:
                out.discard(key)
    except Exception:
        pass

    out.difference_update(_HARD_NEGATIVE_EPISODES)
    return out


def _write_generation(db, kind: str, values) -> str:
    generation = f"{int(time.time())}-{uuid.uuid4().hex[:10]}"
    now = _utcnow_iso()
    collection = db[COLLECTION]

    batch: list[dict] = []
    if kind == "movie":
        iterable = sorted(int(value) for value in values if int(value) > 0)
        for tmdb_id in iterable:
            batch.append({
                "kind": "movie",
                "generation": generation,
                "tmdbId": tmdb_id,
                "season": 0,
                "episode": 0,
                "updated_at": now,
                "policy": POLICY_VERSION,
            })
            if len(batch) >= 1000:
                collection.insert_many(batch, ordered=False)
                batch = []
    else:
        iterable = sorted(values)
        for tmdb_id, season, episode in iterable:
            batch.append({
                "kind": "episode",
                "generation": generation,
                "tmdbId": int(tmdb_id),
                "season": int(season),
                "episode": int(episode),
                "updated_at": now,
                "policy": POLICY_VERSION,
            })
            if len(batch) >= 1000:
                collection.insert_many(batch, ordered=False)
                batch = []
    if batch:
        collection.insert_many(batch, ordered=False)

    # Atomic pointer swap: readers continue using the old generation until every
    # document for the new generation exists.
    db[META_COLLECTION].update_one(
        {"kind": kind},
        {"$set": {
            "kind": kind,
            "generation": generation,
            "count": len(values),
            "updated_at": now,
            "policy": POLICY_VERSION,
        }},
        upsert=True,
    )
    try:
        collection.delete_many({"kind": kind, "generation": {"$ne": generation}})
    except Exception:
        pass
    return generation


def _set_episode_memory(values: set[tuple[int, int, int]], generation: str = "") -> None:
    global _episode_keys, _tv_ids, _episode_generation, _episode_ready
    _episode_keys = set(values)
    _tv_ids = {key[0] for key in values}
    if generation:
        _episode_generation = generation
    _episode_ready = bool(values)


def _set_movie_memory(values: set[int], generation: str = "") -> None:
    global _movie_ids, _movie_generation, _movie_ready
    _movie_ids = {int(value) for value in values if int(value) > 0}
    if generation:
        _movie_generation = generation
    _movie_ready = bool(_movie_ids)


def hydrate_index(db) -> None:
    """Hydrate process memory synchronously before FastAPI starts serving."""
    _ensure_indexes(db)

    movie_generation = _active_generation(db, "movie")
    movie_values = _load_generation(db, "movie", movie_generation)
    if not movie_values:
        movie_values = _legacy_movie_seed(db)
    _set_movie_memory(set(movie_values), movie_generation)

    episode_generation = _active_generation(db, "episode")
    episode_values = _load_generation(db, "episode", episode_generation)
    if not episode_values:
        episode_values = _legacy_episode_seed(db)
    episode_values = _apply_episode_overlays(db, set(episode_values))
    _set_episode_memory(episode_values, episode_generation)


def movie_allowed(tmdb_id: int) -> bool:
    try:
        return int(tmdb_id) in _movie_ids
    except Exception:
        return False


def episode_allowed(tmdb_id: int, season: int, episode: int) -> bool:
    try:
        return (int(tmdb_id), int(season), int(episode)) in _episode_keys
    except Exception:
        return False


def tv_allowed(tmdb_id: int) -> bool:
    try:
        return int(tmdb_id) in _tv_ids
    except Exception:
        return False


def _metadata_rows(db, tmdb_id: int, season_number: int) -> dict[int, dict]:
    out: dict[int, dict] = {}
    try:
        rows = db["tv_episodes"].find(
            {"tmdbId": int(tmdb_id), "season_number": int(season_number)},
            {"_id": 0},
        ).sort("episode_number", 1)
        for row in rows:
            try:
                number = int(row.get("episode_number") or row.get("episode") or 0)
            except Exception:
                continue
            if number > 0:
                out[number] = dict(row)
    except Exception:
        pass
    return out


def _indexed_episode_numbers(tmdb_id: int, season_number: int) -> list[int]:
    target = (int(tmdb_id), int(season_number))
    return sorted(
        key[2] for key in _episode_keys if (key[0], key[1]) == target
    )


def _episode_payload(db, tmdb_id: int, season_number: int) -> dict:
    numbers = _indexed_episode_numbers(tmdb_id, season_number)
    metadata = _metadata_rows(db, tmdb_id, season_number)
    episodes: list[dict] = []
    for number in numbers:
        row = dict(metadata.get(number) or {})
        row.update({
            "tmdbId": int(tmdb_id),
            "season_number": int(season_number),
            "episode_number": int(number),
            "name": row.get("name") or f"Episodio {number}",
            "overview": row.get("overview") or "",
            "still_path": row.get("still_path") or "",
            "italian_available": True,
            "italian_audio_status": "italian",
            "italian_audio_evidence_explicit": True,
            "italian_audio_evidence_source": "preindexed_italian_catalog",
            "italian_audio_policy_version": POLICY_VERSION,
            "language_validation_pending": False,
        })
        episodes.append(row)
    return {
        "tmdbId": int(tmdb_id),
        "season_number": int(season_number),
        "episodes": episodes,
        "italian_audio_policy": "preindexed_catalog_only_no_request_time_validation",
        "italian_audio_policy_version": POLICY_VERSION,
        "index_ready": bool(_episode_ready),
        "index_generation": _episode_generation,
        "index_episode_count": len(numbers),
        "instant_snapshot": True,
        "snapshot_source": "italian_media_index_v16",
        "validation_pending_count": 0,
        "pending_recheck_seconds": 0,
    }


def _filter_home_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return payload

    def item_allowed(item: Any) -> bool:
        if not isinstance(item, dict):
            return False
        try:
            tmdb_id = int(item.get("tmdbId") or item.get("tmdb_id") or item.get("id") or 0)
        except Exception:
            return False
        kind = str(item.get("type") or item.get("media_type") or "movie").lower()
        return tv_allowed(tmdb_id) if kind == "tv" else movie_allowed(tmdb_id)

    rows = []
    first_allowed = None
    for row in payload.get("rows") or []:
        if not isinstance(row, dict):
            continue
        items = [item for item in (row.get("items") or []) if item_allowed(item)]
        if first_allowed is None and items:
            first_allowed = items[0]
        rows.append({**row, "items": items})

    hero = payload.get("hero")
    if not item_allowed(hero):
        hero = first_allowed
    return {**payload, "hero": hero, "rows": rows}


async def refresh_index(db) -> dict:
    """Refresh provider catalogues in background and atomically swap memory."""
    global _movie_generation, _episode_generation, _last_refresh_at
    movie_task = asyncio.create_task(_fetch_complete_catalog("movie"))
    episode_task = asyncio.create_task(_fetch_complete_catalog("episode"))
    movie_values, episode_values = await asyncio.gather(movie_task, episode_task)

    result = {
        "movie_refreshed": False,
        "episode_refreshed": False,
        "movie_count": len(_movie_ids),
        "episode_count": len(_episode_keys),
    }

    if isinstance(movie_values, set) and movie_values:
        generation = await asyncio.to_thread(_write_generation, db, "movie", movie_values)
        _set_movie_memory(movie_values, generation)
        _movie_generation = generation
        result["movie_refreshed"] = True
        result["movie_count"] = len(movie_values)

    if isinstance(episode_values, set) and episode_values:
        episode_values = await asyncio.to_thread(_apply_episode_overlays, db, episode_values)
        generation = await asyncio.to_thread(_write_generation, db, "episode", episode_values)
        _set_episode_memory(episode_values, generation)
        _episode_generation = generation
        result["episode_refreshed"] = True
        result["episode_count"] = len(episode_values)

    _last_refresh_at = _utcnow_iso()
    try:
        import server_core as core
        core.clear_response_cache()
    except Exception:
        pass
    return result


def _keep_task(task: asyncio.Task) -> asyncio.Task:
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def launch_index_worker(app, db) -> None:
    global _refresh_task
    if _refresh_task is not None and not _refresh_task.done():
        return

    async def loop() -> None:
        # Give the rest of startup a moment to settle. Requests already use the
        # persisted/hydrated index during this refresh.
        await asyncio.sleep(1.0)
        while True:
            try:
                await refresh_index(db)
            except Exception as exc:
                print(f"[italian-index-v16] refresh failed: {exc}")
            await asyncio.sleep(REFRESH_SECONDS)

    _refresh_task = _keep_task(asyncio.create_task(loop()))
    app.state.flixit_italian_index_worker = _refresh_task


def install_italian_media_index_v16(app, db) -> bool:
    """Install v16 as the only user-facing Italian availability authority."""
    global _INSTALLED, _db
    if _INSTALLED or getattr(app.state, "flixit_italian_media_index_v16", None):
        return True
    _db = db

    # Critical path: hydrate persisted data synchronously before requests exist.
    hydrate_index(db)

    # Replace every previous public season route with an index-only route. No
    # provider/network function is called from this handler.
    kept = []
    previous_found = False
    for route in app.router.routes:
        if isinstance(route, APIRoute) and route.path == ROUTE_PATH and "GET" in (route.methods or set()):
            previous_found = True
            continue
        kept.append(route)
    app.router.routes[:] = kept

    router = APIRouter()

    @router.get(ROUTE_PATH)
    async def indexed_italian_season(tmdb_id: int, season_number: int):
        return await asyncio.to_thread(_episode_payload, db, int(tmdb_id), int(season_number))

    @router.get(STATUS_PATH)
    async def italian_index_status():
        return {
            "policy": POLICY_VERSION,
            "movie_ready": _movie_ready,
            "episode_ready": _episode_ready,
            "movie_count": len(_movie_ids),
            "episode_count": len(_episode_keys),
            "tv_count": len(_tv_ids),
            "movie_generation": _movie_generation,
            "episode_generation": _episode_generation,
            "last_refresh_at": _last_refresh_at,
            "request_time_provider_checks": False,
        }

    app.include_router(router)

    async def apply_runtime_guards() -> None:
        import player
        import server_core as core
        from services import fast_catalog_availability as fast_catalog
        from services import home_bootstrap_fast as home_fast

        # Home/card membership is now an in-memory index lookup only.
        current_member = fast_catalog._catalog_member
        if not getattr(current_member, "_flixit_preindexed_it_v16", False):
            def indexed_member(core_arg, media_type: str, tmdb_id: int) -> bool:
                try:
                    if not current_member(core_arg, media_type, tmdb_id):
                        return False
                except Exception:
                    return False
                kind = str(media_type or "movie").lower()
                return tv_allowed(tmdb_id) if kind == "tv" else movie_allowed(tmdb_id)

            indexed_member._flixit_preindexed_it_v16 = True
            indexed_member._original = current_member
            fast_catalog._catalog_member = indexed_member

        current_is_on_vixsrc = getattr(core, "is_on_vixsrc", None)
        if callable(current_is_on_vixsrc) and not getattr(current_is_on_vixsrc, "_flixit_preindexed_it_v16", False):
            def indexed_is_on_vixsrc(media_type: str, tmdb_id: int) -> bool:
                try:
                    if not current_is_on_vixsrc(media_type, tmdb_id):
                        return False
                except Exception:
                    return False
                return tv_allowed(tmdb_id) if str(media_type or "").lower() == "tv" else movie_allowed(tmdb_id)

            indexed_is_on_vixsrc._flixit_preindexed_it_v16 = True
            indexed_is_on_vixsrc._original = current_is_on_vixsrc
            core.is_on_vixsrc = indexed_is_on_vixsrc

        current_compact = home_fast._compact
        if not getattr(current_compact, "_flixit_preindexed_it_v16", False):
            def compact_indexed(payload: dict) -> dict:
                return _filter_home_payload(current_compact(payload))

            compact_indexed._flixit_preindexed_it_v16 = True
            compact_indexed._original = current_compact
            home_fast._compact = compact_indexed

        # Direct Watch URLs use only the pre-built index. There is no language
        # resolver/probe in the request path anymore.
        current_resolve = player.resolve_stream
        if not getattr(current_resolve, "_flixit_preindexed_it_v16", False):
            async def indexed_resolve(media_type: str, tmdb_id: int, season=None, episode=None):
                kind = "tv" if str(media_type or "").lower() == "tv" else "movie"
                tmdb_id = int(tmdb_id)
                if kind == "movie":
                    if not movie_allowed(tmdb_id):
                        return {
                            "success": False,
                            "reason": "not_in_italian_index",
                            "message": "Audio italiano non disponibile",
                        }
                    return await current_resolve(kind, tmdb_id, season, episode)

                season_number = max(1, int(season or 1))
                episode_number = max(1, int(episode or 1))
                if not episode_allowed(tmdb_id, season_number, episode_number):
                    return {
                        "success": False,
                        "reason": "not_in_italian_index",
                        "message": "Episodio non disponibile in italiano",
                    }
                return await current_resolve(kind, tmdb_id, season_number, episode_number)

            indexed_resolve._flixit_preindexed_it_v16 = True
            indexed_resolve._original = current_resolve
            player.resolve_stream = indexed_resolve

        try:
            core.clear_response_cache()
        except Exception:
            pass

        launch_index_worker(app, db)

    app.add_event_handler("startup", apply_runtime_guards)
    app.state.flixit_italian_media_index_v16 = {
        "installed": True,
        "policy": POLICY_VERSION,
        "route_replaced": previous_found,
        "movies": "preindexed_catalog_only",
        "episodes": "preindexed_catalog_only",
        "player": "index_lookup_then_stream_resolution",
        "request_time_provider_checks": False,
    }
    _INSTALLED = True
    return True


__all__ = [
    "install_italian_media_index_v16",
    "hydrate_index",
    "refresh_index",
    "movie_allowed",
    "episode_allowed",
    "tv_allowed",
    "POLICY_VERSION",
]
