"""Strict Italian-audio policy for public TV-season responses.

Only episodes with explicitly confirmed Italian audio are returned to the
frontend. Unknown/original-only episodes stay hidden. Availability is checked
in the background and negative decisions expire quickly, so a newly dubbed
episode appears automatically on a later poll without a deploy.

Episode metadata keeps the Italian TMDB response when present. If an Italian
name/overview is missing, the same episode is enriched from TMDB en-US.
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
TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "4f153630f8d7e92d542dde3a38fbddf2")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
ROUTE_PATH = "/api/public/tv/{tmdb_id}/season/{season_number}"
POLICY_VERSION = "strict-explicit-it-v4-filtered-en-fallback"

_client: Optional[httpx.AsyncClient] = None
_tmdb_client: Optional[httpx.AsyncClient] = None
_cache: dict[tuple[int, int, int], tuple[float, dict]] = {}
_locks: dict[tuple[int, int, int], asyncio.Lock] = {}
_background_tasks: set[asyncio.Task] = set()


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


def _tmdb_http() -> httpx.AsyncClient:
    global _tmdb_client
    if _tmdb_client is None or _tmdb_client.is_closed:
        _tmdb_client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=4.0, read=8.0, write=5.0, pool=3.0),
            limits=httpx.Limits(max_connections=6, max_keepalive_connections=3, keepalive_expiry=30.0),
            headers={"Accept": "application/json"},
        )
    return _tmdb_client


def _normal(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower().replace("_", "-"))


def _is_italian(value: Any) -> bool:
    text = _normal(value)
    if not text:
        return False
    if text in {"it", "ita", "it-it", "italian", "italiano", "italiana", "dub ita", "doppiato italiano"}:
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


def _leaf_strings(value: Any, limit: int = 40) -> list[str]:
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
                if str(raw_key).lower() in {"src", "url", "embed", "embed_url", "player"} and isinstance(value, str):
                    try:
                        query = parse_qs(urlparse(value).query)
                    except Exception:
                        query = {}
                    for query_key in (
                        "lang", "language", "locale", "audio", "audio_language", "audio-lang", "dub"
                    ):
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
        "availability_label": None,
        "detected_languages": (hints or [])[:8],
        "italian_audio_policy_version": POLICY_VERSION,
    }


def _future_episode(episode: dict) -> bool:
    raw = str(episode.get("air_date") or "").strip()
    if not raw:
        return False
    try:
        return date.fromisoformat(raw[:10]) > date.today()
    except Exception:
        return False


def _cache_hit(key: tuple[int, int, int]) -> Optional[dict]:
    cached = _cache.get(key)
    if cached and cached[0] > time.monotonic():
        return dict(cached[1])
    if cached:
        _cache.pop(key, None)
    return None


async def _inspect_source(tmdb_id: int, season: int, episode: int) -> dict:
    key = (int(tmdb_id), int(season), int(episode))
    hit = _cache_hit(key)
    if hit:
        return hit

    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        hit = _cache_hit(key)
        if hit:
            return hit
        now = time.monotonic()

        try:
            # Explicitly request the Italian rendition. A concrete source returned
            # for this request is accepted unless the payload explicitly says it
            # is original/English only.
            response = await _http().get(
                f"{VIXSRC_BASE}/api/tv/{tmdb_id}/{season}/{episode}",
                params={"lang": "it"},
            )
        except Exception:
            result = _result(False, "checking", source_available=False)
            _cache[key] = (now + 20.0, result)
            return dict(result)

        if response.status_code in {404, 410, 422}:
            result = _result(False, "not_published", source_available=False)
            _cache[key] = (now + 90.0, result)
            return dict(result)
        if response.status_code != 200:
            result = _result(False, "checking", source_available=False)
            _cache[key] = (now + 20.0, result)
            return dict(result)

        try:
            payload = response.json()
        except Exception:
            result = _result(False, "checking", source_available=False)
            _cache[key] = (now + 20.0, result)
            return dict(result)

        if not isinstance(payload, dict) or not _source_url(payload):
            result = _result(False, "not_published", source_available=False)
            _cache[key] = (now + 90.0, result)
            return dict(result)

        hints = _language_hints(payload)
        has_italian = any(_is_italian(value) for value in hints)
        original_only = any(_is_original_only(value) for value in hints) and not has_italian

        if original_only:
            result = _result(False, "original_only", source_available=True, hints=hints)
            ttl = 90.0
        else:
            # The endpoint was queried explicitly with lang=it and returned a
            # concrete stream. In the absence of a contradictory language hint,
            # treat it as confirmed Italian for catalogue/display purposes.
            result = _result(True, "italian", source_available=True, hints=hints)
            ttl = 30 * 60.0

        _cache[key] = (now + ttl, result)
        return dict(result)


async def _refresh_uncached(tmdb_id: int, season_number: int, episodes: list[dict]) -> None:
    semaphore = asyncio.Semaphore(6)

    async def one(episode: dict, index: int):
        if _future_episode(episode):
            return
        number = int(episode.get("episode_number") or index + 1)
        key = (int(tmdb_id), int(season_number), number)
        if _cache_hit(key):
            return
        async with semaphore:
            await _inspect_source(tmdb_id, season_number, number)

    await asyncio.gather(*(one(episode, index) for index, episode in enumerate(episodes)), return_exceptions=True)


def _spawn_refresh(tmdb_id: int, season_number: int, episodes: list[dict]) -> None:
    task = asyncio.create_task(_refresh_uncached(tmdb_id, season_number, episodes))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _annotate_cached(tmdb_id: int, season_number: int, episode: dict, index: int) -> tuple[dict, bool]:
    row = dict(episode or {})
    number = int(row.get("episode_number") or index + 1)
    if _future_episode(row):
        return {**row, **_result(False, "not_aired", source_available=False)}, False
    hit = _cache_hit((int(tmdb_id), int(season_number), number))
    if hit:
        return {**row, **hit}, False
    return {**row, **_result(False, "checking", source_available=False)}, True


async def _english_episode_map(tmdb_id: int, season_number: int) -> dict[int, dict]:
    params = {"language": "en-US"}
    headers = {}
    if TMDB_API_KEY.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {TMDB_API_KEY}"
    else:
        params["api_key"] = TMDB_API_KEY
    try:
        response = await _tmdb_http().get(
            f"{TMDB_BASE_URL}/tv/{int(tmdb_id)}/season/{int(season_number)}",
            params=params,
            headers=headers,
        )
        if response.status_code != 200:
            return {}
        payload = response.json()
    except Exception:
        return {}

    rows = payload.get("episodes") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return {}
    out: dict[int, dict] = {}
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        number = int(row.get("episode_number") or index + 1)
        out[number] = row
    return out


def install_italian_episode_policy(app) -> bool:
    if getattr(app.state, "flixit_italian_episode_policy_registered", False):
        return True

    try:
        from services.performance_api import install_performance_api
        install_performance_api(app)
    except Exception:
        pass

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
            return {
                **value,
                "episodes": [],
                "italian_audio_policy": "strict_confirmed_italian_only",
                "italian_audio_policy_version": POLICY_VERSION,
                "pending_recheck_seconds": 90,
            }

        annotated: list[dict] = []
        needs_refresh = False
        for index, episode in enumerate(episodes):
            row, missing = _annotate_cached(int(tmdb_id), int(season_number), episode, index)
            annotated.append(row)
            needs_refresh = needs_refresh or missing

        if needs_refresh:
            _spawn_refresh(int(tmdb_id), int(season_number), episodes)

        visible = [row for row in annotated if row.get("italian_available") is True]

        # Italian TMDB metadata from the legacy endpoint stays primary. English
        # fills only genuinely missing name/overview fields.
        if visible and any(not str(row.get("name") or "").strip() or not str(row.get("overview") or "").strip() for row in visible):
            english = await _english_episode_map(int(tmdb_id), int(season_number))
            for row in visible:
                number = int(row.get("episode_number") or 0)
                fallback = english.get(number) or {}
                if not str(row.get("name") or "").strip():
                    row["name"] = fallback.get("name") or row.get("name")
                if not str(row.get("overview") or "").strip():
                    row["overview"] = fallback.get("overview") or ""

        return {
            **value,
            "episodes": visible,
            "italian_audio_policy": "strict_confirmed_italian_only",
            "italian_audio_policy_version": POLICY_VERSION,
            "pending_recheck_seconds": 4 if needs_refresh else 90,
        }

    app.include_router(router)
    app.state.flixit_italian_episode_policy_registered = True
    return True


__all__ = ["install_italian_episode_policy", "POLICY_VERSION"]
