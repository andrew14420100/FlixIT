"""Final v11 TV-season route driven directly by the VixSrc Italian episode catalogue.

This route is installed *after* the older language-verification/snapshot layers.
It deliberately bypasses stale empty snapshots and per-episode network probing:

1. VixSrc ``/api/list/episode/?lang=it`` is the source of truth for which
   (TMDB series, season, episode) tuples are available in Italian.
2. Episode metadata comes from the local ``tv_episodes`` cache first.
3. Missing metadata is filled with one TMDB season request (Italian locale),
   then persisted locally for subsequent instant responses.
4. Only non-empty verified snapshots are reused long-term. Empty results are
   short-lived/fail-closed so a transient upstream/catalog problem cannot hide a
   whole season for minutes or days.
"""
from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter
from fastapi.routing import APIRoute

ROUTE_PATH = "/api/public/tv/{tmdb_id}/season/{season_number}"
POLICY_VERSION = "strict-it-v11-direct-vixsrc-episode-catalog"
SNAPSHOT_FRESH = timedelta(hours=6)
EMPTY_RETRY_AFTER = timedelta(seconds=20)
_INSTALLED = False
_build_locks: dict[tuple[int, int], asyncio.Lock] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _episode_number(row: dict, fallback: int = 0) -> int:
    try:
        return int(row.get("episode_number") or row.get("episode") or fallback)
    except Exception:
        return int(fallback or 0)


def _verified_fields() -> dict:
    return {
        "vixsrc_available": True,
        "italian_available": True,
        "italian_audio_status": "italian",
        "source_available": True,
        "detected_languages": ["it"],
        "italian_audio_evidence_explicit": True,
        "italian_audio_evidence_source": "vixsrc_episode_catalog_it",
        "italian_audio_policy_version": POLICY_VERSION,
    }


def _snapshot_payload(tmdb_id: int, season_number: int, rows: list[dict], source: str) -> dict:
    return {
        "tmdbId": int(tmdb_id),
        "season_number": int(season_number),
        "episodes": rows,
        "italian_audio_policy": "vixsrc_italian_episode_catalog",
        "italian_audio_policy_version": POLICY_VERSION,
        "pending_recheck_seconds": 0,
        "instant_snapshot": True,
        "snapshot_source": source,
    }


def _read_snapshot(collection, tmdb_id: int, season_number: int):
    try:
        doc = collection.find_one(
            {
                "tmdbId": int(tmdb_id),
                "season": int(season_number),
                "policy": POLICY_VERSION,
            },
            {"_id": 0},
        ) or {}
    except Exception:
        return None
    payload = doc.get("payload") if isinstance(doc.get("payload"), dict) else None
    generated = _parse_dt(doc.get("generated_at"))
    if not payload or not generated:
        return None
    episodes = payload.get("episodes") if isinstance(payload.get("episodes"), list) else []
    age = _now() - generated
    if episodes and age <= SNAPSHOT_FRESH:
        return payload
    if not episodes and age <= EMPTY_RETRY_AFTER:
        return payload
    return None


def _persist_snapshot(collection, tmdb_id: int, season_number: int, payload: dict) -> None:
    try:
        collection.update_one(
            {"tmdbId": int(tmdb_id), "season": int(season_number)},
            {"$set": {
                "tmdbId": int(tmdb_id),
                "season": int(season_number),
                "policy": POLICY_VERSION,
                "generated_at": _now().isoformat(),
                "payload": payload,
            }},
            upsert=True,
        )
    except Exception:
        pass


def _local_metadata(db, tmdb_id: int, season_number: int) -> dict[int, dict]:
    try:
        rows = list(
            db["tv_episodes"].find(
                {"tmdbId": int(tmdb_id), "season_number": int(season_number)},
                {"_id": 0},
            ).sort("episode_number", 1)
        )
    except Exception:
        rows = []
    out: dict[int, dict] = {}
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            continue
        number = _episode_number(row, index)
        if number > 0:
            out[number] = dict(row)
    return out


def _persist_metadata(db, tmdb_id: int, season_number: int, rows: list[dict]) -> None:
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            continue
        number = _episode_number(row, index)
        if number <= 0:
            continue
        value = dict(row)
        value["tmdbId"] = int(tmdb_id)
        value["season_number"] = int(season_number)
        value["episode_number"] = int(number)
        try:
            db["tv_episodes"].update_one(
                {
                    "tmdbId": int(tmdb_id),
                    "season_number": int(season_number),
                    "episode_number": int(number),
                },
                {"$set": value},
                upsert=True,
            )
        except Exception:
            pass


async def _tmdb_metadata(core, db, tmdb_id: int, season_number: int) -> dict[int, dict]:
    try:
        payload = await core.fetch_tmdb_data(f"/tv/{int(tmdb_id)}/season/{int(season_number)}")
    except Exception:
        payload = None
    rows = payload.get("episodes") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return {}
    await asyncio.to_thread(_persist_metadata, db, tmdb_id, season_number, rows)
    out: dict[int, dict] = {}
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            continue
        number = _episode_number(row, index)
        if number > 0:
            out[number] = dict(row)
    return out


async def _fallback_payload(endpoint, tmdb_id: int, season_number: int):
    try:
        value = endpoint(tmdb_id=int(tmdb_id), season_number=int(season_number))
        if inspect.isawaitable(value):
            value = await value
    except Exception:
        return None
    if not isinstance(value, dict):
        return value
    episodes = []
    for row in value.get("episodes") or []:
        if not isinstance(row, dict):
            continue
        if row.get("italian_available") is not True:
            continue
        episodes.append({**row, **_verified_fields()})
    return {
        **value,
        "episodes": episodes,
        "italian_audio_policy": "vixsrc_italian_episode_catalog",
        "italian_audio_policy_version": POLICY_VERSION,
        "pending_recheck_seconds": 0,
    }


def install_direct_italian_episode_route(app, db) -> bool:
    global _INSTALLED
    if _INSTALLED or getattr(app.state, "flixit_direct_italian_episode_v11", False):
        return True

    try:
        import server_core as core
        import services.strict_audio_evidence as strict_audio
    except Exception:
        return False

    previous = None
    kept = []
    for route in app.router.routes:
        if isinstance(route, APIRoute) and route.path == ROUTE_PATH and "GET" in (route.methods or set()):
            previous = route.endpoint
            continue
        kept.append(route)
    if not callable(previous):
        return False

    snapshots = db["italian_season_snapshots"]
    try:
        snapshots.create_index([("tmdbId", 1), ("season", 1)], unique=True)
        snapshots.create_index("policy")
        snapshots.create_index("generated_at")
    except Exception:
        pass

    app.router.routes[:] = kept
    router = APIRouter()

    async def build(tmdb_id: int, season_number: int) -> dict:
        key = (int(tmdb_id), int(season_number))
        lock = _build_locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = await asyncio.to_thread(_read_snapshot, snapshots, *key)
            if cached:
                return cached

            ready = False
            try:
                ready = bool(await strict_audio.warm_italian_episode_catalog())
            except Exception:
                ready = False

            if not ready:
                fallback = await _fallback_payload(previous, *key)
                if isinstance(fallback, dict):
                    return fallback
                return _snapshot_payload(*key, [], "catalog_unavailable_fail_closed")

            try:
                allowed = sorted(
                    int(ep)
                    for series_id, season, ep in strict_audio._catalog_keys
                    if int(series_id) == key[0] and int(season) == key[1]
                )
            except Exception:
                allowed = []

            if not allowed:
                empty = _snapshot_payload(*key, [], "vixsrc_catalog_confirmed_empty")
                await asyncio.to_thread(_persist_snapshot, snapshots, *key, empty)
                return empty

            metadata = await asyncio.to_thread(_local_metadata, db, *key)
            if any(number not in metadata for number in allowed):
                remote = await _tmdb_metadata(core, db, *key)
                if remote:
                    metadata.update(remote)

            visible: list[dict] = []
            verified = _verified_fields()
            for number in allowed:
                row = dict(metadata.get(number) or {})
                row.setdefault("tmdbId", key[0])
                row.setdefault("season_number", key[1])
                row["episode_number"] = int(number)
                row.setdefault("name", f"Episodio {number}")
                row.setdefault("overview", "")
                row.setdefault("still_path", None)
                visible.append({**row, **verified})

            payload = _snapshot_payload(*key, visible, "v11_direct_vixsrc_catalog")
            await asyncio.to_thread(_persist_snapshot, snapshots, *key, payload)
            return payload

    @router.get(ROUTE_PATH)
    async def direct_italian_season(tmdb_id: int, season_number: int):
        return await build(int(tmdb_id), int(season_number))

    app.include_router(router)
    app.state.flixit_direct_italian_episode_v11 = {
        "installed": True,
        "policy": POLICY_VERSION,
        "source": "vixsrc_episode_catalog_it",
        "metadata": "mongo_then_tmdb_once",
        "stale_empty_snapshot_max_seconds": int(EMPTY_RETRY_AFTER.total_seconds()),
    }
    _INSTALLED = True
    return True


__all__ = ["install_direct_italian_episode_route", "POLICY_VERSION", "ROUTE_PATH"]
