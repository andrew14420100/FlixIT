"""Per-episode Italian availability for FlixIT v12.

The global VixSrc episode list is not a historical archive, so it must not be
used as the sole source of truth for an entire season. v12 instead checks the
actual episode endpoint with ``lang=it`` and persists the verdict. Season
responses are built from local episode metadata plus those persisted verdicts.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi.routing import APIRoute

ROUTE_PATH = "/api/public/tv/{tmdb_id}/season/{season_number}"
POLICY_VERSION = "strict-it-v12-direct-episode-lang-it"
VIXSRC_BASE = "https://vixsrc.to"
POSITIVE_TTL = timedelta(hours=24)
NEGATIVE_TTL = timedelta(minutes=20)
CHECK_TIMEOUT_SECONDS = 1.8
_INSTALLED = False

_client: httpx.AsyncClient | None = None
_locks: dict[tuple[int, int, int], asyncio.Lock] = {}


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


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=4.0, read=7.0, write=4.0, pool=3.0),
            limits=httpx.Limits(max_connections=24, max_keepalive_connections=16),
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
                "Accept": "application/json,text/plain,*/*",
                "Referer": f"{VIXSRC_BASE}/",
                "Accept-Language": "it-IT,it;q=0.9",
            },
        )
    return _client


def _episode_number(row: dict, fallback: int = 0) -> int:
    try:
        return int(row.get("episode_number") or row.get("episode") or fallback)
    except Exception:
        return int(fallback or 0)


def _metadata(db, tmdb_id: int, season_number: int) -> list[dict]:
    try:
        return list(
            db["tv_episodes"].find(
                {"tmdbId": int(tmdb_id), "season_number": int(season_number)},
                {"_id": 0},
            ).sort("episode_number", 1)
        )
    except Exception:
        return []


def _cached_verdicts(db, tmdb_id: int, season_number: int) -> dict[int, bool]:
    now = _now()
    try:
        rows = list(db["italian_episode_audio_cache"].find(
            {
                "tmdbId": int(tmdb_id),
                "season": int(season_number),
                "policy": POLICY_VERSION,
            },
            {"_id": 0, "episode": 1, "result": 1, "expires_at": 1},
        ))
    except Exception:
        return {}
    out: dict[int, bool] = {}
    for row in rows:
        expires = _parse_dt(row.get("expires_at"))
        if not expires or expires <= now:
            continue
        result = row.get("result") if isinstance(row.get("result"), dict) else {}
        try:
            out[int(row.get("episode"))] = result.get("italian_available") is True
        except Exception:
            continue
    return out


def _result(available: bool, reason: str) -> dict:
    return {
        "italian_available": bool(available),
        "italian_audio_status": "italian" if available else reason,
        "source_available": bool(available),
        "detected_languages": ["it"] if available else [],
        "italian_audio_evidence_explicit": bool(available),
        "italian_audio_evidence_source": "vixsrc_episode_api_lang_it",
        "italian_audio_policy_version": POLICY_VERSION,
    }


async def _probe_episode(db, tmdb_id: int, season: int, episode: int) -> bool:
    key = (int(tmdb_id), int(season), int(episode))
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = await asyncio.to_thread(_cached_verdicts, db, key[0], key[1])
        if key[2] in cached:
            return bool(cached[key[2]])

        available = False
        reason = "not_in_italian_episode_api"
        try:
            response = await _http().get(
                f"{VIXSRC_BASE}/api/tv/{key[0]}/{key[1]}/{key[2]}",
                params={"lang": "it"},
            )
            if response.status_code == 200:
                payload = response.json()
                src = str(payload.get("src") or "").strip() if isinstance(payload, dict) else ""
                available = bool(src)
                reason = "italian" if available else "source_missing"
            elif response.status_code in {404, 410, 422}:
                reason = "not_published_or_not_italian"
            else:
                reason = "provider_unavailable"
        except Exception:
            reason = "provider_unavailable"

        ttl = POSITIVE_TTL if available else NEGATIVE_TTL
        result = _result(available, reason)
        now = _now()
        try:
            await asyncio.to_thread(
                db["italian_episode_audio_cache"].update_one,
                {"tmdbId": key[0], "season": key[1], "episode": key[2]},
                {"$set": {
                    "tmdbId": key[0], "season": key[1], "episode": key[2],
                    "result": result,
                    "policy": POLICY_VERSION,
                    "checked_at": now.isoformat(),
                    "expires_at": (now + ttl).isoformat(),
                }},
                upsert=True,
            )
        except Exception:
            pass
        return available


async def _ensure_metadata(core, db, tmdb_id: int, season_number: int) -> list[dict]:
    rows = await asyncio.to_thread(_metadata, db, tmdb_id, season_number)
    if rows:
        return rows
    try:
        payload = await core.fetch_tmdb_data(f"/tv/{int(tmdb_id)}/season/{int(season_number)}")
    except Exception:
        payload = None
    rows = payload.get("episodes") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            continue
        value = dict(row)
        value["tmdbId"] = int(tmdb_id)
        value["season_number"] = int(season_number)
        value["episode_number"] = _episode_number(value, index)
        try:
            await asyncio.to_thread(
                db["tv_episodes"].update_one,
                {
                    "tmdbId": int(tmdb_id),
                    "season_number": int(season_number),
                    "episode_number": int(value["episode_number"]),
                },
                {"$set": value},
                upsert=True,
            )
        except Exception:
            pass
    return rows


def _decorate(row: dict, tmdb_id: int, season_number: int, number: int) -> dict:
    return {
        **dict(row or {}),
        "tmdbId": int(tmdb_id),
        "season_number": int(season_number),
        "episode_number": int(number),
        **_result(True, "italian"),
    }


def install_episode_availability_v12(app, db) -> bool:
    global _INSTALLED
    if _INSTALLED or getattr(app.state, "flixit_episode_availability_v12", False):
        return True

    try:
        import server_core as core
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

    app.router.routes[:] = kept
    router = APIRouter()

    @router.get(ROUTE_PATH)
    async def italian_season_v12(tmdb_id: int, season_number: int):
        tmdb_id = int(tmdb_id)
        season_number = int(season_number)
        rows = await _ensure_metadata(core, db, tmdb_id, season_number)
        if not rows:
            return {
                "tmdbId": tmdb_id,
                "season_number": season_number,
                "episodes": [],
                "italian_audio_policy_version": POLICY_VERSION,
                "pending_recheck_seconds": 2,
            }

        cached = await asyncio.to_thread(_cached_verdicts, db, tmdb_id, season_number)
        numbers = [
            _episode_number(row, index)
            for index, row in enumerate(rows, 1)
            if isinstance(row, dict)
        ]
        missing = [number for number in numbers if number > 0 and number not in cached]

        if missing:
            semaphore = asyncio.Semaphore(12)
            async def one(number: int):
                async with semaphore:
                    return number, await _probe_episode(db, tmdb_id, season_number, number)
            try:
                results = await asyncio.wait_for(
                    asyncio.gather(*(one(number) for number in missing), return_exceptions=True),
                    timeout=CHECK_TIMEOUT_SECONDS,
                )
                for item in results:
                    if isinstance(item, tuple) and len(item) == 2:
                        cached[int(item[0])] = bool(item[1])
            except asyncio.TimeoutError:
                pass
            cached.update(await asyncio.to_thread(_cached_verdicts, db, tmdb_id, season_number))

        visible = []
        for index, row in enumerate(rows, 1):
            if not isinstance(row, dict):
                continue
            number = _episode_number(row, index)
            if cached.get(number) is True:
                visible.append(_decorate(row, tmdb_id, season_number, number))

        return {
            "tmdbId": tmdb_id,
            "season_number": season_number,
            "episodes": visible,
            "italian_audio_policy": "direct_episode_lang_it",
            "italian_audio_policy_version": POLICY_VERSION,
            "pending_recheck_seconds": 0 if len(cached) >= len(numbers) else 1,
            "instant_snapshot": True,
            "snapshot_source": "v12_persisted_episode_verdicts",
        }

    app.include_router(router)
    app.state.flixit_episode_availability_v12 = {
        "installed": True,
        "policy": POLICY_VERSION,
        "source": "per_episode_api_lang_it",
        "global_episode_feed_is_authoritative": False,
    }
    _INSTALLED = True
    return True


__all__ = ["install_episode_availability_v12", "POLICY_VERSION"]
