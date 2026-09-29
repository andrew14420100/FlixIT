"""Persistent, instant Italian-season responses.

The strict language verifier is intentionally expensive because it may need to
inspect many episodes.  Users must not pay that cost when they open the Detail
page.  This layer stores the *final filtered season payload* in MongoDB and
returns it immediately; refresh/verification runs in the background.

On startup all seasons already known in ``tv_seasons`` are progressively warmed,
with titles present in the Home snapshot first.  A one-query DB seed built from
``tv_episodes`` + the current strict audio verdicts is used when possible.
"""
from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter
from fastapi.routing import APIRoute

ROUTE_PATH = "/api/public/tv/{tmdb_id}/season/{season_number}"
FRESH_FOR = timedelta(minutes=15)
MAX_STALE_AGE = timedelta(days=7)
PREWARM_CONCURRENCY = 4
PREWARM_BATCH = 20
_INSTALLED = False

_refresh_tasks: dict[tuple[int, int], asyncio.Task] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _policy_version() -> str:
    try:
        from services.strict_audio_evidence import POLICY_VERSION
        return POLICY_VERSION
    except Exception:
        try:
            import services.strict_italian_tv as strict_tv
            return str(strict_tv.STRICT_EPISODE_POLICY_VERSION)
        except Exception:
            return "strict-it-unknown"


def _read_snapshot(collection, tmdb_id: int, season_number: int) -> tuple[dict | None, datetime | None]:
    try:
        doc = collection.find_one(
            {
                "tmdbId": int(tmdb_id),
                "season": int(season_number),
                "policy": _policy_version(),
            },
            {"_id": 0},
        ) or {}
    except Exception:
        return None, None
    payload = doc.get("payload")
    generated = _parse_dt(doc.get("generated_at"))
    if not isinstance(payload, dict):
        return None, generated
    return payload, generated


def _persist_snapshot(collection, tmdb_id: int, season_number: int, payload: dict) -> None:
    now = _now()
    try:
        collection.update_one(
            {"tmdbId": int(tmdb_id), "season": int(season_number)},
            {"$set": {
                "tmdbId": int(tmdb_id),
                "season": int(season_number),
                "policy": _policy_version(),
                "generated_at": now.isoformat(),
                "payload": payload,
            }},
            upsert=True,
        )
    except Exception:
        pass


def _db_seed(db, tmdb_id: int, season_number: int) -> dict | None:
    """Build an instant season payload with one episode query + one verdict query."""
    now = _now()
    try:
        episodes = list(
            db["tv_episodes"].find(
                {"tmdbId": int(tmdb_id), "season_number": int(season_number)},
                {"_id": 0},
            ).sort("episode_number", 1)
        )
    except Exception:
        episodes = []
    if not episodes:
        return None

    try:
        verdict_rows = list(
            db["italian_episode_audio_cache"].find(
                {
                    "tmdbId": int(tmdb_id),
                    "season": int(season_number),
                    "policy": _policy_version(),
                },
                {"_id": 0, "episode": 1, "result": 1, "expires_at": 1},
            )
        )
    except Exception:
        verdict_rows = []

    verdicts: dict[int, dict] = {}
    for row in verdict_rows:
        expires_at = _parse_dt(row.get("expires_at"))
        if not expires_at or expires_at <= now:
            continue
        result = row.get("result") if isinstance(row.get("result"), dict) else {}
        if result.get("italian_available") is not True:
            continue
        if str(result.get("italian_audio_status") or "") != "italian":
            continue
        try:
            verdicts[int(row.get("episode"))] = result
        except Exception:
            continue

    visible = []
    for index, episode in enumerate(episodes):
        try:
            number = int(episode.get("episode_number") or index + 1)
        except Exception:
            continue
        verdict = verdicts.get(number)
        if not verdict:
            continue
        visible.append({**episode, **verdict})

    if not visible:
        return None

    return {
        "tmdbId": int(tmdb_id),
        "season_number": int(season_number),
        "episodes": visible,
        "italian_audio_policy": "strict_confirmed_italian_only",
        "italian_audio_policy_version": _policy_version(),
        "pending_recheck_seconds": 0,
        "instant_snapshot": True,
        "snapshot_source": "mongo_verified_seed",
    }


async def _invoke(endpoint, tmdb_id: int, season_number: int) -> dict | None:
    try:
        value = endpoint(tmdb_id=int(tmdb_id), season_number=int(season_number))
        if inspect.isawaitable(value):
            value = await value
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def _home_tv_ids(db) -> list[int]:
    try:
        doc = db["home_snapshots"].find_one(
            {"key": "public-home-v1"}, {"_id": 0, "payload": 1}
        ) or {}
        payload = doc.get("payload") if isinstance(doc.get("payload"), dict) else {}
    except Exception:
        payload = {}

    out: list[int] = []
    seen: set[int] = set()

    def add(item: Any) -> None:
        if not isinstance(item, dict):
            return
        kind = "tv" if str(item.get("type") or item.get("media_type") or item.get("mediaType") or "").lower() == "tv" else "movie"
        if kind != "tv":
            return
        try:
            tmdb_id = int(item.get("tmdbId") or item.get("tmdb_id") or item.get("contentId") or item.get("id") or 0)
        except Exception:
            return
        if tmdb_id > 0 and tmdb_id not in seen:
            seen.add(tmdb_id)
            out.append(tmdb_id)

    add(payload.get("hero"))
    for row in payload.get("rows") or []:
        if isinstance(row, dict):
            for item in row.get("items") or []:
                add(item)
    return out


def _season_targets(db) -> list[tuple[int, int]]:
    priority = _home_tv_ids(db)
    priority_index = {value: index for index, value in enumerate(priority)}
    try:
        rows = list(
            db["tv_seasons"].find(
                {"season_number": {"$gt": 0}},
                {"_id": 0, "tmdbId": 1, "season_number": 1},
            )
        )
    except Exception:
        rows = []

    targets: list[tuple[int, int]] = []
    seen = set()
    for row in rows:
        try:
            key = (int(row.get("tmdbId")), int(row.get("season_number")))
        except Exception:
            continue
        if key[0] <= 0 or key[1] <= 0 or key in seen:
            continue
        seen.add(key)
        targets.append(key)

    targets.sort(key=lambda pair: (priority_index.get(pair[0], 10**9), pair[0], pair[1]))
    return targets


def install_instant_episode_snapshots(app, db) -> bool:
    global _INSTALLED
    if _INSTALLED or getattr(app.state, "flixit_instant_episode_snapshots_registered", False):
        return True

    current_endpoint = None
    kept = []
    for route in app.router.routes:
        if isinstance(route, APIRoute) and route.path == ROUTE_PATH and "GET" in (route.methods or set()):
            current_endpoint = route.endpoint
            continue
        kept.append(route)
    if not callable(current_endpoint):
        return False

    collection = db["italian_season_snapshots"]
    try:
        collection.create_index([("tmdbId", 1), ("season", 1)], unique=True)
        collection.create_index("generated_at")
        collection.create_index("policy")
    except Exception:
        pass

    app.router.routes[:] = kept
    router = APIRouter()

    async def refresh_snapshot(tmdb_id: int, season_number: int) -> dict | None:
        key = (int(tmdb_id), int(season_number))
        existing = _refresh_tasks.get(key)
        if existing is not None and not existing.done():
            try:
                return await asyncio.shield(existing)
            except Exception:
                return None

        async def run():
            payload = await _invoke(current_endpoint, key[0], key[1])
            if isinstance(payload, dict):
                payload = {
                    **payload,
                    "pending_recheck_seconds": 0,
                    "instant_snapshot": True,
                    "snapshot_source": "verified_route",
                }
                await asyncio.to_thread(_persist_snapshot, collection, key[0], key[1], payload)
            return payload

        task = asyncio.create_task(run())
        _refresh_tasks[key] = task
        try:
            return await asyncio.shield(task)
        finally:
            if _refresh_tasks.get(key) is task:
                _refresh_tasks.pop(key, None)

    def schedule_refresh(tmdb_id: int, season_number: int) -> None:
        key = (int(tmdb_id), int(season_number))
        existing = _refresh_tasks.get(key)
        if existing is not None and not existing.done():
            return
        task = asyncio.create_task(refresh_snapshot(*key))
        _refresh_tasks[key] = task

        def cleanup(done):
            if _refresh_tasks.get(key) is done:
                _refresh_tasks.pop(key, None)

        task.add_done_callback(cleanup)

    @router.get(ROUTE_PATH)
    async def instant_italian_season(tmdb_id: int, season_number: int):
        tmdb_id = int(tmdb_id)
        season_number = int(season_number)
        payload, generated = await asyncio.to_thread(
            _read_snapshot, collection, tmdb_id, season_number
        )
        if payload and generated:
            age = _now() - generated
            if age <= MAX_STALE_AGE:
                if age >= FRESH_FOR:
                    schedule_refresh(tmdb_id, season_number)
                return payload

        seed = await asyncio.to_thread(_db_seed, db, tmdb_id, season_number)
        if seed:
            await asyncio.to_thread(_persist_snapshot, collection, tmdb_id, season_number, seed)
            schedule_refresh(tmdb_id, season_number)
            return seed

        # Cold-first request: start verification immediately.  This path should be
        # rare because startup prewarming covers all seasons already in Mongo.
        fresh = await refresh_snapshot(tmdb_id, season_number)
        if fresh:
            return fresh
        return {
            "tmdbId": tmdb_id,
            "season_number": season_number,
            "episodes": [],
            "italian_audio_policy": "strict_confirmed_italian_only",
            "italian_audio_policy_version": _policy_version(),
            "pending_recheck_seconds": 0,
            "instant_snapshot": True,
            "snapshot_source": "empty_fail_closed",
        }

    app.include_router(router)

    async def prewarm_all_known_seasons() -> None:
        targets = await asyncio.to_thread(_season_targets, db)
        semaphore = asyncio.Semaphore(PREWARM_CONCURRENCY)

        async def one(target: tuple[int, int]) -> None:
            tmdb_id, season_number = target
            payload, generated = await asyncio.to_thread(
                _read_snapshot, collection, tmdb_id, season_number
            )
            if payload and generated and _now() - generated < FRESH_FOR:
                return
            seed = await asyncio.to_thread(_db_seed, db, tmdb_id, season_number)
            if seed:
                await asyncio.to_thread(_persist_snapshot, collection, tmdb_id, season_number, seed)
            async with semaphore:
                await refresh_snapshot(tmdb_id, season_number)

        for start in range(0, len(targets), PREWARM_BATCH):
            batch = targets[start : start + PREWARM_BATCH]
            await asyncio.gather(*(one(target) for target in batch), return_exceptions=True)
            await asyncio.sleep(0.15)

    @app.on_event("startup")
    async def _prewarm_episode_snapshots_on_startup():
        asyncio.create_task(prewarm_all_known_seasons())

    app.state.flixit_instant_episode_snapshots_registered = True
    app.state.flixit_instant_episode_snapshots = {
        "installed": True,
        "policy": _policy_version(),
        "serve": "mongo_snapshot_first",
        "refresh": "background",
        "prewarm": "all_known_seasons_home_first",
    }
    _INSTALLED = True
    return True


__all__ = ["install_instant_episode_snapshots"]
