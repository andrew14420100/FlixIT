"""Persistent, instant Italian-season responses.

Language verification happens before the user opens the episode list. The final
filtered season payload is stored in MongoDB and served first; stale snapshots
remain usable while a single background refresh recomputes them.
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
_INSTALLED = False
_refresh_tasks: dict[tuple[int, int], asyncio.Task] = {}
_background_tasks: set[asyncio.Task] = set()


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
    return (payload if isinstance(payload, dict) else None), generated


def _persist_snapshot(collection, tmdb_id: int, season_number: int, payload: dict) -> None:
    try:
        collection.update_one(
            {"tmdbId": int(tmdb_id), "season": int(season_number)},
            {"$set": {
                "tmdbId": int(tmdb_id),
                "season": int(season_number),
                "policy": _policy_version(),
                "generated_at": _now().isoformat(),
                "payload": payload,
            }},
            upsert=True,
        )
    except Exception:
        pass


def _db_seed(db, tmdb_id: int, season_number: int) -> dict | None:
    """Build a season instantly from locally cached metadata + current verdicts."""
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
        result = row.get("result") if isinstance(row.get("result"), dict) else {}
        if not expires_at or expires_at <= now:
            continue
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
        if verdict:
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
        raw_type = str(item.get("type") or item.get("media_type") or item.get("mediaType") or "").lower()
        if raw_type != "tv":
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
            pending = Number(payload.get("pending_recheck_seconds") or 0) if isinstance(payload, dict) else 0
            if payload and 0 < pending <= 10:
                # The underlying strict route is still filling episode verdicts.
                # This wait happens only in background prewarm/refresh, not while
                # a valid snapshot is being served to a user.
                await asyncio.sleep(max(1.0, min(3.0, pending + 0.15)))
                newer = await _invoke(current_endpoint, key[0], key[1])
                if isinstance(newer, dict):
                    payload = newer

            if isinstance(payload, dict):
                pending = Number(payload.get("pending_recheck_seconds") or 0)
                if not (0 < pending <= 10):
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

        # Do not insert this outer task into _refresh_tasks: refresh_snapshot owns
        # that map. Otherwise it would discover itself and await itself.
        task = asyncio.create_task(refresh_snapshot(*key))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

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

        # Cold-first requests are rare after startup prewarm. Fail closed if the
        # verifier cannot build a complete response.
        fresh = await refresh_snapshot(tmdb_id, season_number)
        pending = Number(fresh.get("pending_recheck_seconds") or 0) if isinstance(fresh, dict) else 0
        if fresh and not (0 < pending <= 10):
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
    app.state.flixit_instant_episode_snapshots_registered = True
    app.state.flixit_instant_episode_snapshots = {
        "installed": True,
        "policy": _policy_version(),
        "serve": "mongo_snapshot_first",
        "refresh": "single_flight_background",
        "prewarm": "launcher_home_first",
    }
    _INSTALLED = True
    return True


__all__ = [
    "install_instant_episode_snapshots",
    "ROUTE_PATH",
    "_season_targets",
]
