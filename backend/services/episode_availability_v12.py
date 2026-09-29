"""Fast per-episode Italian availability for FlixIT v13.

The public season route must never depend on the global VixSrc episode feed: it
is not a complete historical archive. v13 checks the real episode endpoint with
``lang=it`` first (fast), persists that verdict, and validates HLS audio metadata
in the background when available. Background work is strongly referenced so it
cannot disappear before completing.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import APIRouter
from fastapi.routing import APIRoute

ROUTE_PATH = "/api/public/tv/{tmdb_id}/season/{season_number}"
POLICY_VERSION = "strict-it-v13-fast-episode-lang-it"
POSITIVE_TTL = timedelta(hours=12)
NEGATIVE_TTL = timedelta(minutes=10)
API_CHECK_TIMEOUT_SECONDS = 2.2
_INSTALLED = False

_client: httpx.AsyncClient | None = None
_locks: dict[tuple[int, int, int], asyncio.Lock] = {}
_season_tasks: dict[tuple[int, int], asyncio.Task] = {}
_background_tasks: set[asyncio.Task] = set()
_validation_tasks: dict[tuple[int, int, int], asyncio.Task] = {}

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
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=3.0, read=6.0, write=4.0, pool=3.0),
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=20, keepalive_expiry=30.0),
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
                "Accept": "application/json,text/plain,*/*",
                "Accept-Language": "it-IT,it;q=0.9",
                "Referer": "https://vixsrc.to/",
            },
        )
    return _client


def _keep_task(task: asyncio.Task) -> asyncio.Task:
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


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


def _cached_results(db, tmdb_id: int, season_number: int) -> dict[int, dict]:
    now = _now()
    try:
        rows = list(db["italian_episode_audio_cache"].find(
            {"tmdbId": int(tmdb_id), "season": int(season_number), "policy": POLICY_VERSION},
            {"_id": 0, "episode": 1, "result": 1, "expires_at": 1},
        ))
    except Exception:
        return {}
    out: dict[int, dict] = {}
    for row in rows:
        expires = _parse_dt(row.get("expires_at"))
        result = row.get("result") if isinstance(row.get("result"), dict) else {}
        if not expires or expires <= now or not result:
            continue
        try:
            out[int(row.get("episode"))] = dict(result)
        except Exception:
            continue
    return out


def _result(available: bool, reason: str, evidence: str) -> dict:
    return {
        "italian_available": bool(available),
        "italian_audio_status": "italian" if available else reason,
        "source_available": bool(available),
        "detected_languages": ["it"] if available else (["en"] if "english" in reason or "original" in reason else []),
        "italian_audio_evidence_explicit": bool(available),
        "italian_audio_evidence_source": evidence,
        "italian_audio_policy_version": POLICY_VERSION,
    }


async def _persist_result(db, key: tuple[int, int, int], result: dict) -> None:
    ttl = POSITIVE_TTL if result.get("italian_available") is True else NEGATIVE_TTL
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


def _audio_tag_verdict(text: str):
    audio_lines = [
        line.strip() for line in str(text or "").splitlines()
        if line.upper().startswith("#EXT-X-MEDIA:") and "TYPE=AUDIO" in line.upper()
    ]
    if not audio_lines:
        return None
    for line in audio_lines:
        if (
            re.search(r'LANGUAGE\s*=\s*["\']?(?:it|ita|it-IT)["\']?', line, re.I)
            or re.search(r'NAME\s*=\s*["\'][^"\']*(?:italiano|italian|ita)[^"\']*["\']', line, re.I)
        ):
            return True
    return False


def _payload_language_verdict(payload: dict):
    """Reject only explicit original/English hints in the API response."""
    values: list[str] = []
    for key, value in payload.items():
        lower = str(key).lower()
        if any(marker in lower for marker in ("lang", "audio", "dub", "voice", "locale")):
            values.append(str(value).lower())
    src = str(payload.get("src") or "")
    try:
        query = parse_qs(urlparse(src).query)
        for key in ("lang", "language", "audio", "locale"):
            values.extend(str(v).lower() for v in query.get(key, []))
    except Exception:
        pass
    joined = " ".join(values)
    has_it = bool(re.search(r"(?:^|\W)(?:it|ita|it-it|italian(?:o|a)?)(?:$|\W)", joined, re.I))
    has_en = bool(re.search(r"(?:^|\W)(?:en|eng|en-us|en-gb|english|originale?|original)(?:$|\W)", joined, re.I))
    if has_en and not has_it:
        return False
    return None


async def _validate_hls_background(db, key: tuple[int, int, int]) -> None:
    try:
        from services.vixsrc import resolve_vixsrc_stream
        resolved = await resolve_vixsrc_stream(str(key[0]), season=key[1], episode=key[2])
        stream_url = str((resolved or {}).get("stream_url") or "").strip()
        headers = (resolved or {}).get("headers") if isinstance((resolved or {}).get("headers"), dict) else {}
        if not stream_url:
            return
        response = await _http().get(stream_url, headers=headers)
        if response.status_code != 200:
            return
        verdict = _audio_tag_verdict(response.text)
        if verdict is True:
            await _persist_result(db, key, _result(True, "italian", "hls_audio_language"))
        elif verdict is False:
            await _persist_result(db, key, _result(False, "english_or_original_audio", "hls_audio_language"))
    except Exception:
        # A validator failure must not erase a fast positive lang=it verdict.
        return
    finally:
        _validation_tasks.pop(key, None)


def _schedule_validation(db, key: tuple[int, int, int]) -> None:
    current = _validation_tasks.get(key)
    if current is not None and not current.done():
        return
    task = asyncio.create_task(_validate_hls_background(db, key))
    _validation_tasks[key] = task
    _keep_task(task)


async def _probe_episode(db, tmdb_id: int, season: int, episode: int) -> dict:
    key = (int(tmdb_id), int(season), int(episode))
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = await asyncio.to_thread(_cached_results, db, key[0], key[1])
        if key[2] in cached:
            return cached[key[2]]

        manual = await asyncio.to_thread(_override, db, key)
        if manual is not None:
            available, reason = manual
            result = _result(available, reason, "manual_override")
            await _persist_result(db, key, result)
            return result

        try:
            response = await _http().get(
                f"https://vixsrc.to/api/tv/{key[0]}/{key[1]}/{key[2]}",
                params={"lang": "it"},
            )
        except Exception:
            result = _result(False, "provider_unavailable", "vixsrc_episode_api_lang_it")
            await _persist_result(db, key, result)
            return result

        if response.status_code in {404, 410, 422}:
            result = _result(False, "not_published_or_not_italian", "vixsrc_episode_api_lang_it")
            await _persist_result(db, key, result)
            return result
        if response.status_code != 200:
            result = _result(False, "provider_unavailable", "vixsrc_episode_api_lang_it")
            await _persist_result(db, key, result)
            return result

        try:
            payload = response.json()
        except Exception:
            payload = {}
        src = str(payload.get("src") or "").strip() if isinstance(payload, dict) else ""
        if not src:
            result = _result(False, "source_missing", "vixsrc_episode_api_lang_it")
            await _persist_result(db, key, result)
            return result

        if _payload_language_verdict(payload) is False:
            result = _result(False, "english_or_original_audio", "vixsrc_episode_api_language_hint")
            await _persist_result(db, key, result)
            return result

        result = _result(True, "italian", "vixsrc_episode_api_lang_it")
        await _persist_result(db, key, result)
        _schedule_validation(db, key)
        return result


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
                {"tmdbId": int(tmdb_id), "season_number": int(season_number), "episode_number": int(value["episode_number"])},
                {"$set": value},
                upsert=True,
            )
        except Exception:
            pass
    return rows


def _decorate(row: dict, tmdb_id: int, season_number: int, number: int, result: dict) -> dict:
    return {
        **dict(row or {}),
        "tmdbId": int(tmdb_id),
        "season_number": int(season_number),
        "episode_number": int(number),
        **result,
    }


def _start_season_warm(db, tmdb_id: int, season_number: int, missing: list[int]) -> asyncio.Task:
    key = (int(tmdb_id), int(season_number))
    current = _season_tasks.get(key)
    if current is not None and not current.done():
        return current

    async def run():
        semaphore = asyncio.Semaphore(18)
        async def one(number: int):
            async with semaphore:
                await _probe_episode(db, key[0], key[1], number)
        await asyncio.gather(*(one(number) for number in missing), return_exceptions=True)

    task = asyncio.create_task(run())
    _season_tasks[key] = task
    _keep_task(task)
    def cleanup(done: asyncio.Task) -> None:
        if _season_tasks.get(key) is done:
            _season_tasks.pop(key, None)
    task.add_done_callback(cleanup)
    return task


def install_episode_availability_v12(app, db) -> bool:
    global _INSTALLED
    if _INSTALLED or getattr(app.state, "flixit_episode_availability_v13", False):
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
    async def italian_season_v13(tmdb_id: int, season_number: int):
        tmdb_id = int(tmdb_id)
        season_number = int(season_number)
        rows = await _ensure_metadata(core, db, tmdb_id, season_number)
        if not rows:
            return {
                "tmdbId": tmdb_id,
                "season_number": season_number,
                "episodes": [],
                "italian_audio_policy_version": POLICY_VERSION,
                "pending_recheck_seconds": 1,
            }

        numbers = [_episode_number(row, index) for index, row in enumerate(rows, 1) if isinstance(row, dict)]
        cached = await asyncio.to_thread(_cached_results, db, tmdb_id, season_number)
        missing = [number for number in numbers if number > 0 and number not in cached]
        if missing:
            warm_task = _start_season_warm(db, tmdb_id, season_number, missing)
            # Wait briefly for the cheap API checks, but never cancel the warm-up.
            try:
                await asyncio.wait({warm_task}, timeout=API_CHECK_TIMEOUT_SECONDS)
            except Exception:
                pass
            cached = await asyncio.to_thread(_cached_results, db, tmdb_id, season_number)

        visible: list[dict] = []
        for index, row in enumerate(rows, 1):
            if not isinstance(row, dict):
                continue
            number = _episode_number(row, index)
            result = cached.get(number) or {}
            if result.get("italian_available") is True:
                visible.append(_decorate(row, tmdb_id, season_number, number, result))

        return {
            "tmdbId": tmdb_id,
            "season_number": season_number,
            "episodes": visible,
            "italian_audio_policy": "fast_episode_lang_it_then_hls_background",
            "italian_audio_policy_version": POLICY_VERSION,
            "pending_recheck_seconds": 0 if len(cached) >= len([n for n in numbers if n > 0]) else 1,
            "instant_snapshot": True,
            "snapshot_source": "v13_persisted_episode_verdicts",
        }

    app.include_router(router)
    app.state.flixit_episode_availability_v13 = {
        "installed": True,
        "policy": POLICY_VERSION,
        "source": "fast_per_episode_lang_it_plus_background_hls_validation",
        "global_episode_feed_is_authoritative": False,
    }
    _INSTALLED = True
    return True


__all__ = [
    "install_episode_availability_v12",
    "POLICY_VERSION",
    "_audio_tag_verdict",
    "_payload_language_verdict",
    "_BOOTSTRAP_NEGATIVE_OVERRIDES",
]
