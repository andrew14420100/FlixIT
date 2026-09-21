"""Annotate TV episodes with Italian-audio availability from the active source.

The detail page keeps the full TMDB episode list, but episodes that the source
explicitly reports as unavailable or original-language-only are marked as
"Disponibile prossimamente in italiano". Pending entries are rechecked often,
so they become playable automatically when the source starts publishing the
Italian version.
"""
from __future__ import annotations

import asyncio
import inspect
import os
import re
import time
from datetime import date
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import APIRouter
from fastapi.routing import APIRoute

VIXSRC_BASE = os.environ.get("VIXSRC_BASE_URL", "https://vixsrc.to").rstrip("/")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
ROUTE_PATH = "/api/public/tv/{tmdb_id}/season/{season_number}"

_client: Optional[httpx.AsyncClient] = None
_cache: dict[tuple[int, int, int], tuple[float, dict]] = {}
_locks: dict[tuple[int, int, int], asyncio.Lock] = {}


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=4.0, read=8.0, write=5.0, pool=3.0),
            limits=httpx.Limits(max_connections=12, max_keepalive_connections=6, keepalive_expiry=30.0),
            headers={
                "User-Agent": USER_AGENT,
                "Referer": f"{VIXSRC_BASE}/",
                "Accept": "application/json,text/plain,*/*",
            },
        )
    return _client


def _normal(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower().replace("_", "-"))


def _is_italian(value: Any) -> bool:
    text = _normal(value)
    if not text:
        return False
    if text in {"it", "ita", "it-it", "italian", "italiano", "italiana"}:
        return True
    return bool(re.search(r"(?:^|[^a-z])(it-it|ita|italian(?:o|a)?)(?:$|[^a-z])", text))


def _is_original_only(value: Any) -> bool:
    text = _normal(value)
    if not text:
        return False
    if text in {"en", "eng", "en-us", "en-gb", "english", "original", "originale", "original audio"}:
        return True
    if re.search(r"\b(?:sub\s*-?\s*ita|subbed|audio\s+originale|lingua\s+originale)\b", text):
        return True
    return bool(re.search(r"(?:^|[^a-z])(en-us|en-gb|eng|english)(?:$|[^a-z])", text))


def _leaf_strings(value: Any, limit: int = 30) -> list[str]:
    out: list[str] = []

    def walk(node: Any) -> None:
        if len(out) >= limit:
            return
        if isinstance(node, (str, int, float, bool)):
            text = str(node).strip()
            if text:
                out.append(text)
            return
        if isinstance(node, dict):
            for child in node.values():
                walk(child)
                if len(out) >= limit:
                    return
        elif isinstance(node, (list, tuple, set)):
            for child in node:
                walk(child)
                if len(out) >= limit:
                    return

    walk(value)
    return out


def _language_hints(payload: dict) -> list[str]:
    hints: list[str] = []

    def add(value: Any) -> None:
        for item in _leaf_strings(value):
            if item not in hints:
                hints.append(item)

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for raw_key, value in node.items():
                key = _normal(raw_key).replace("-", "")
                if any(marker in key for marker in ("lang", "locale", "audio", "dub", "voice")):
                    add(value)
                if str(raw_key).lower() == "src" and isinstance(value, str):
                    try:
                        query = parse_qs(urlparse(value).query)
                    except Exception:
                        query = {}
                    for query_key in ("lang", "language", "locale", "audio", "audio_language", "audio-lang"):
                        for query_value in query.get(query_key, []):
                            add(query_value)
                if isinstance(value, (dict, list, tuple)):
                    walk(value)
        elif isinstance(node, (list, tuple)):
            for child in node:
                walk(child)

    walk(payload)
    return hints[:40]


def _source_url(payload: dict) -> str:
    for key in ("src", "url", "embed", "embed_url", "player"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    data = payload.get("data")
    if isinstance(data, dict):
        return _source_url(data)
    return ""


def _result(available: bool, status: str, *, source_available: bool, hints: list[str] | None = None) -> dict:
    return {
        "italian_available": bool(available),
        "italian_audio_status": status,
        "source_available": bool(source_available),
        "availability_label": None if available else "Disponibile prossimamente in italiano",
        "detected_languages": (hints or [])[:8],
    }


def _future_episode(episode: dict) -> bool:
    raw = str(episode.get("air_date") or "").strip()
    if not raw:
        return False
    try:
        return date.fromisoformat(raw[:10]) > date.today()
    except Exception:
        return False


async def _inspect_source(tmdb_id: int, season: int, episode: int) -> dict:
    key = (int(tmdb_id), int(season), int(episode))
    cached = _cache.get(key)
    now = time.monotonic()
    if cached and cached[0] > now:
        return dict(cached[1])

    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = _cache.get(key)
        now = time.monotonic()
        if cached and cached[0] > now:
            return dict(cached[1])

        try:
            response = await _http().get(f"{VIXSRC_BASE}/api/tv/{tmdb_id}/{season}/{episode}")
        except Exception:
            result = _result(True, "unknown", source_available=True)
            _cache[key] = (now + 90.0, result)
            return dict(result)

        if response.status_code in {404, 410, 422}:
            result = _result(False, "not_published", source_available=False)
            _cache[key] = (now + 120.0, result)
            return dict(result)
        if response.status_code != 200:
            result = _result(True, "unknown", source_available=True)
            _cache[key] = (now + 90.0, result)
            return dict(result)

        try:
            payload = response.json()
        except Exception:
            result = _result(True, "unknown", source_available=True)
            _cache[key] = (now + 90.0, result)
            return dict(result)

        if not isinstance(payload, dict) or not _source_url(payload):
            result = _result(False, "not_published", source_available=False)
            _cache[key] = (now + 120.0, result)
            return dict(result)

        hints = _language_hints(payload)
        if any(_is_italian(value) for value in hints):
            result = _result(True, "italian", source_available=True, hints=hints)
            ttl = 30 * 60.0
        elif hints and any(_is_original_only(value) for value in hints):
            result = _result(False, "original_only", source_available=True, hints=hints)
            ttl = 120.0
        else:
            # No explicit audio metadata: do not hide a playable episode merely
            # because the provider omitted the language tag.
            result = _result(True, "unknown", source_available=True, hints=hints)
            ttl = 5 * 60.0

        _cache[key] = (now + ttl, result)
        return dict(result)


async def _annotate_episode(tmdb_id: int, season_number: int, episode: dict, index: int, semaphore: asyncio.Semaphore) -> dict:
    row = dict(episode or {})
    number = int(row.get("episode_number") or index + 1)
    if _future_episode(row):
        return {
            **row,
            **_result(False, "not_aired", source_available=False),
        }
    async with semaphore:
        status = await _inspect_source(tmdb_id, season_number, number)
    return {**row, **status}


def install_italian_episode_policy(app) -> bool:
    if getattr(app.state, "flixit_italian_episode_policy_registered", False):
        return True

    legacy_endpoint = None
    kept_routes = []
    for route in app.router.routes:
        if isinstance(route, APIRoute) and route.path == ROUTE_PATH and "GET" in route.methods:
            legacy_endpoint = route.endpoint
            continue
        kept_routes.append(route)

    if legacy_endpoint is None:
        return False

    app.router.routes[:] = kept_routes
    router = APIRouter()

    @router.get(ROUTE_PATH)
    async def italian_aware_season(tmdb_id: int, season_number: int):
        value = legacy_endpoint(tmdb_id=tmdb_id, season_number=season_number)
        if inspect.isawaitable(value):
            value = await value
        if not isinstance(value, dict):
            return value

        episodes = value.get("episodes")
        if not isinstance(episodes, list) or not episodes:
            return value

        semaphore = asyncio.Semaphore(6)
        annotated = await asyncio.gather(
            *(
                _annotate_episode(int(tmdb_id), int(season_number), episode, index, semaphore)
                for index, episode in enumerate(episodes)
            ),
            return_exceptions=False,
        )
        return {
            **value,
            "episodes": annotated,
            "italian_audio_policy": "source_metadata_recheck",
            "pending_recheck_seconds": 120,
        }

    app.include_router(router)
    app.state.flixit_italian_episode_policy_registered = True
    return True


__all__ = ["install_italian_episode_policy"]
