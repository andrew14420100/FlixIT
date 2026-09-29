"""Per-episode Italian availability for FlixIT v12.

The global VixSrc episode list is not a historical archive, so it must not be
used as the sole source of truth for an entire season. v12 checks the actual
episode endpoint with ``lang=it``, resolves that exact playback source, inspects
HLS audio metadata when present, and persists the verdict. Detail then reads the
persisted result instantly.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi.routing import APIRoute

ROUTE_PATH = "/api/public/tv/{tmdb_id}/season/{season_number}"
POLICY_VERSION = "strict-it-v12-direct-episode-lang-it"
POSITIVE_TTL = timedelta(hours=24)
NEGATIVE_TTL = timedelta(minutes=20)
CHECK_TIMEOUT_SECONDS = 2.4
_INSTALLED = False

_manifest_client: httpx.AsyncClient | None = None
_locks: dict[tuple[int, int, int], asyncio.Lock] = {}

# User-confirmed bad-source exceptions are stored through the same override
# mechanism used for future manual corrections. They are not the main detector.
_BOOTSTRAP_NEGATIVE_OVERRIDES = {
    (65334, 6, 19): "user_confirmed_original_audio",
    (65334, 6, 20): "user_confirmed_original_audio",
    (65334, 6, 21): "user_confirmed_original_audio",
}


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
    global _manifest_client
    if _manifest_client is None or _manifest_client.is_closed:
        _manifest_client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=4.0, read=7.0, write=4.0, pool=3.0),
            limits=httpx.Limits(max_connections=24, max_keepalive_connections=16),
        )
    return _manifest_client


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


def _override(db, key: tuple[int, int, int]):
    try:
        row = db["italian_audio_overrides"].find_one(
            {"tmdbId": key[0], "season": key[1], "episode": key[2]},
            {"_id": 0},
        ) or {}
        if "italian_available" in row:
            return bool(row.get("italian_available")), str(row.get("reason") or "manual_override")
    except Exception:
        pass
    if key in _BOOTSTRAP_NEGATIVE_OVERRIDES:
        return False, _BOOTSTRAP_NEGATIVE_OVERRIDES[key]
    return None


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


def _result(available: bool, reason: str, evidence: str = "vixsrc_episode_api_lang_it") -> dict:
    return {
        "italian_available": bool(available),
        "italian_audio_status": "italian" if available else reason,
        "source_available": bool(available),
        "detected_languages": ["it"] if available else (["en"] if "original" in reason or "english" in reason else []),
        "italian_audio_evidence_explicit": bool(available),
        "italian_audio_evidence_source": evidence,
        "italian_audio_policy_version": POLICY_VERSION,
    }


def _audio_tag_verdict(text: str):
    """Return True/False only when an HLS master explicitly declares audio language."""
    audio_lines = [
        line.strip()
        for line in str(text or "").splitlines()
        if line.upper().startswith("#EXT-X-MEDIA:") and "TYPE=AUDIO" in line.upper()
    ]
    if not audio_lines:
        return None

    def italian(line: str) -> bool:
        return bool(
            re.search(r'LANGUAGE\s*=\s*["\']?(?:it|ita|it-IT)["\']?', line, re.I)
            or re.search(r'NAME\s*=\s*["\'][^"\']*(?:italiano|italian|ita)[^"\']*["\']', line, re.I)
        )

    if any(italian(line) for line in audio_lines):
        return True
    return False


async def _resolved_audio_verdict(tmdb_id: int, season: int, episode: int):
    try:
        from services.vixsrc import resolve_vixsrc_stream
        resolved = await resolve_vixsrc_stream(str(tmdb_id), season=season, episode=episode)
    except Exception:
        return False, "provider_unavailable", "resolver"

    stream_url = str((resolved or {}).get("stream_url") or "").strip()
    headers = (resolved or {}).get("headers") if isinstance((resolved or {}).get("headers"), dict) else {}
    if not stream_url:
        return False, "source_missing", "resolver"

    try:
        response = await _http().get(stream_url, headers=headers)
        if response.status_code == 200:
            verdict = _audio_tag_verdict(response.text)
            if verdict is True:
                return True, "italian", "hls_audio_language"
            if verdict is False:
                return False, "english_or_original_audio", "hls_audio_language"
    except Exception:
        pass

    # Some VixSrc masters contain muxed audio and therefore no EXT-X-MEDIA audio
    # tags. In that case the provider's explicitly selected lang=it source is the
    # best available evidence; playback itself is also forced to lang=it.
    return True, "italian", "vixsrc_lang_it_resolver"


async def _persist_verdict(db, key: tuple[int, int, int], available: bool, reason: str, evidence: str) -> None:
    ttl = POSITIVE_TTL if available else NEGATIVE_TTL
    result = _result(available, reason, evidence)
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


async def _probe_episode(db, tmdb_id: int, season: int, episode: int) -> bool:
    key = (int(tmdb_id), int(season), int(episode))
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = await asyncio.to_thread(_cached_verdicts, db, key[0], key[1])
        if key[2] in cached:
            return bool(cached[key[2]])

        manual = await asyncio.to_thread(_override, db, key)
        if manual is not None:
            available, reason = manual
            await _persist_verdict(db, key, available, reason, "manual_override")
            return available

        available, reason, evidence = await _resolved_audio_verdict(*key)
        await _persist_verdict(db, key, available, reason, evidence)
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
        numbers = [_episode_number(row, index) for index, row in enumerate(rows, 1) if isinstance(row, dict)]
        missing = [number for number in numbers if number > 0 and number not in cached]

        if missing:
            semaphore = asyncio.Semaphore(10)

            async def one(number: int):
                async with semaphore:
                    return number, await _probe_episode(db, tmdb_id, season_number, number)

            tasks = [asyncio.create_task(one(number)) for number in missing]
            try:
                done, _pending = await asyncio.wait(tasks, timeout=CHECK_TIMEOUT_SECONDS)
                for task in done:
                    try:
                        number, available = task.result()
                        cached[int(number)] = bool(available)
                    except Exception:
                        pass
            finally:
                # Let unfinished checks complete in the background so the next
                # request is instant instead of cancelling all warm-up work.
                for task in tasks:
                    if not task.done():
                        task.add_done_callback(lambda _task: None)

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
            "italian_audio_policy": "direct_episode_lang_it_and_hls_audio",
            "italian_audio_policy_version": POLICY_VERSION,
            "pending_recheck_seconds": 0 if len(cached) >= len(numbers) else 1,
            "instant_snapshot": True,
            "snapshot_source": "v12_persisted_episode_verdicts",
        }

    app.include_router(router)
    app.state.flixit_episode_availability_v12 = {
        "installed": True,
        "policy": POLICY_VERSION,
        "source": "per_episode_resolver_lang_it_plus_hls_audio",
        "global_episode_feed_is_authoritative": False,
    }
    _INSTALLED = True
    return True


__all__ = ["install_episode_availability_v12", "POLICY_VERSION", "_audio_tag_verdict"]
