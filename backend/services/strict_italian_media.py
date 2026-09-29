"""Strict Italian-only movie policy + player hot-cache warmer.

The UI must never expose a movie only because it exists in a provider's Italian
catalogue. Movies are accepted only when the public provider payload contains an
explicit Italian language/audio marker. Verdicts are persisted in MongoDB and
kept out of request-time catalogue rendering.

Player resolution is also warmed from the persistent Home snapshot. On a cold
player request, language verification and stream resolution run concurrently so
strict language filtering does not add a serial wait before playback.
"""
from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional


POLICY_VERSION = "strict-explicit-it-movie-v1"
VIXSRC_BASE = os.environ.get("VIXSRC_BASE_URL", "https://vixsrc.to").rstrip("/")
POSITIVE_TTL = timedelta(hours=24)
ORIGINAL_TTL = timedelta(hours=6)
UNCONFIRMED_TTL = timedelta(minutes=30)
TRANSIENT_TTL = timedelta(seconds=45)
PRIORITY_MOVIES = 72
PLAYER_WARM_MOVIES = 18
VERIFY_CONCURRENCY = 10
PLAYER_WARM_CONCURRENCY = 3
_INSTALLED = False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _item_id(item: Any) -> int:
    if not isinstance(item, dict):
        return 0
    try:
        return int(item.get("tmdbId") or item.get("tmdb_id") or item.get("id") or 0)
    except Exception:
        return 0


def _item_type(item: Any) -> str:
    if not isinstance(item, dict):
        return "movie"
    return "tv" if str(item.get("type") or item.get("media_type") or "").lower() == "tv" else "movie"


class MovieItalianAudioVerifier:
    def __init__(self, db):
        self.db = db
        self.collection = db["italian_movie_audio_cache"]
        self._memory: dict[int, tuple[float, bool, str]] = {}
        self._inflight: dict[int, asyncio.Task] = {}
        try:
            self.collection.create_index("tmdbId", unique=True)
            self.collection.create_index("expires_at")
            self.collection.create_index([("available", 1), ("expires_at", 1)])
        except Exception:
            pass

    def _remember(self, tmdb_id: int, available: bool, status: str, expires_at: datetime) -> None:
        seconds = max(1.0, (expires_at - _utcnow()).total_seconds())
        self._memory[int(tmdb_id)] = (time.monotonic() + seconds, bool(available), str(status))

    def hydrate(self) -> None:
        now = _utcnow()
        try:
            rows = self.collection.find(
                {"policy": POLICY_VERSION, "expires_at": {"$gt": now.isoformat()}},
                {"_id": 0, "tmdbId": 1, "available": 1, "status": 1, "expires_at": 1},
            )
            for row in rows:
                expires_at = _parse_dt(row.get("expires_at"))
                if not expires_at or expires_at <= now:
                    continue
                try:
                    tmdb_id = int(row.get("tmdbId"))
                except Exception:
                    continue
                self._remember(tmdb_id, row.get("available") is True, row.get("status") or "unknown", expires_at)
        except Exception:
            pass

    def cached(self, tmdb_id: int) -> Optional[bool]:
        try:
            tmdb_id = int(tmdb_id)
        except Exception:
            return False
        hit = self._memory.get(tmdb_id)
        if hit:
            if hit[0] > time.monotonic():
                return bool(hit[1])
            self._memory.pop(tmdb_id, None)

        try:
            row = self.collection.find_one(
                {"tmdbId": tmdb_id, "policy": POLICY_VERSION},
                {"_id": 0, "available": 1, "status": 1, "expires_at": 1},
            ) or {}
            expires_at = _parse_dt(row.get("expires_at"))
            if not expires_at or expires_at <= _utcnow():
                return None
            available = row.get("available") is True
            self._remember(tmdb_id, available, row.get("status") or "unknown", expires_at)
            return available
        except Exception:
            return None

    def _persist(self, tmdb_id: int, available: bool, status: str, hints: list[str], ttl: timedelta) -> bool:
        now = _utcnow()
        expires_at = now + ttl
        self._remember(tmdb_id, available, status, expires_at)
        try:
            self.collection.update_one(
                {"tmdbId": int(tmdb_id)},
                {"$set": {
                    "tmdbId": int(tmdb_id),
                    "available": bool(available),
                    "status": str(status),
                    "detected_languages": list(hints or [])[:8],
                    "policy": POLICY_VERSION,
                    "checked_at": now.isoformat(),
                    "expires_at": expires_at.isoformat(),
                }},
                upsert=True,
            )
        except Exception:
            pass
        return bool(available)

    async def _verify_uncached(self, tmdb_id: int) -> bool:
        from services import italian_episode_policy as episode_policy

        try:
            response = await episode_policy._http().get(
                f"{VIXSRC_BASE}/api/movie/{int(tmdb_id)}",
                params={"lang": "it"},
            )
        except Exception:
            return self._persist(tmdb_id, False, "checking", [], TRANSIENT_TTL)

        if response.status_code in {404, 410, 422}:
            return self._persist(tmdb_id, False, "not_published", [], ORIGINAL_TTL)
        if response.status_code != 200:
            return self._persist(tmdb_id, False, "checking", [], TRANSIENT_TTL)

        try:
            payload = response.json()
        except Exception:
            return self._persist(tmdb_id, False, "checking", [], TRANSIENT_TTL)

        if not isinstance(payload, dict) or not episode_policy._source_url(payload):
            return self._persist(tmdb_id, False, "not_published", [], ORIGINAL_TTL)

        hints = episode_policy._language_hints(payload)
        has_italian = any(episode_policy._is_italian(value) for value in hints)
        has_original = any(episode_policy._is_original_only(value) for value in hints)

        if has_italian:
            return self._persist(tmdb_id, True, "italian", hints, POSITIVE_TTL)
        if has_original:
            return self._persist(tmdb_id, False, "original_only", hints, ORIGINAL_TTL)
        return self._persist(tmdb_id, False, "language_unconfirmed", hints, UNCONFIRMED_TTL)

    async def verify(self, tmdb_id: int, *, force: bool = False) -> bool:
        tmdb_id = int(tmdb_id)
        if not force:
            hit = await asyncio.to_thread(self.cached, tmdb_id)
            if hit is not None:
                return bool(hit)

        existing = self._inflight.get(tmdb_id)
        if existing is not None and not existing.done():
            return bool(await asyncio.shield(existing))

        task = asyncio.create_task(self._verify_uncached(tmdb_id))
        self._inflight[tmdb_id] = task
        try:
            return bool(await asyncio.shield(task))
        finally:
            if self._inflight.get(tmdb_id) is task:
                self._inflight.pop(tmdb_id, None)


def _snapshot_movie_ids(core, *, limit: Optional[int] = None) -> tuple[list[int], Optional[dict]]:
    try:
        from services import home_bootstrap as home
        payload, _generated = home._read_snapshot(core)
    except Exception:
        payload = None

    if not isinstance(payload, dict):
        return [], None

    out: list[int] = []
    seen: set[int] = set()

    def add(item: Any) -> None:
        if _item_type(item) != "movie":
            return
        tmdb_id = _item_id(item)
        if tmdb_id <= 0 or tmdb_id in seen:
            return
        seen.add(tmdb_id)
        out.append(tmdb_id)

    hero = payload.get("hero")
    if isinstance(hero, dict):
        add(hero)

    for row in payload.get("rows") or []:
        if not isinstance(row, dict):
            continue
        for item in row.get("items") or []:
            add(item)
            if limit and len(out) >= limit:
                return out, payload
    return out, payload


def _filter_home_payload(payload: dict, verifier: MovieItalianAudioVerifier) -> dict:
    if not isinstance(payload, dict):
        return payload
    rows = []
    for row in payload.get("rows") or []:
        if not isinstance(row, dict):
            continue
        items = []
        for item in row.get("items") or []:
            if _item_type(item) == "movie" and verifier.cached(_item_id(item)) is not True:
                continue
            items.append(item)
        rows.append({**row, "items": items})

    hero = payload.get("hero")
    if isinstance(hero, dict) and _item_type(hero) == "movie":
        if verifier.cached(_item_id(hero)) is not True:
            hero = None

    return {**payload, "hero": hero, "rows": rows}


async def _map_limit(values: list[int], limit: int, worker) -> list:
    results = [None] * len(values)
    cursor = 0

    async def run() -> None:
        nonlocal cursor
        while True:
            index = cursor
            cursor += 1
            if index >= len(values):
                return
            try:
                results[index] = await worker(values[index])
            except Exception:
                results[index] = None

    await asyncio.gather(*[run() for _ in range(min(max(1, limit), max(1, len(values))))])
    return results


def install_strict_italian_media(app, db) -> bool:
    global _INSTALLED
    if _INSTALLED or getattr(app.state, "flixit_strict_italian_media_registered", False):
        return True
    _INSTALLED = True

    verifier = MovieItalianAudioVerifier(db)
    app.state.flixit_movie_italian_verifier = verifier

    async def apply_policy() -> None:
        import player
        import server_core as core
        from services import fast_catalog_availability as fast_catalog
        from services import home_bootstrap_fast as home_fast
        from services import italian_episode_policy as episode_policy

        await asyncio.to_thread(verifier.hydrate)

        # Make every card-rendering path fail closed for movies. TV keeps its
        # dedicated per-episode strict policy.
        current_member = fast_catalog._catalog_member
        if not getattr(current_member, "_flixit_strict_movie_it_v1", False):
            def strict_member(core_arg, media_type: str, tmdb_id: int) -> bool:
                if not current_member(core_arg, media_type, tmdb_id):
                    return False
                if str(media_type or "").lower() == "tv":
                    return True
                return verifier.cached(int(tmdb_id)) is True

            strict_member._flixit_strict_movie_it_v1 = True
            strict_member._original = current_member
            fast_catalog._catalog_member = strict_member

        current_is_on_vixsrc = getattr(core, "is_on_vixsrc", None)
        if callable(current_is_on_vixsrc) and not getattr(current_is_on_vixsrc, "_flixit_strict_movie_it_v1", False):
            def strict_is_on_vixsrc(media_type: str, tmdb_id: int) -> bool:
                if not current_is_on_vixsrc(media_type, tmdb_id):
                    return False
                if str(media_type or "").lower() == "tv":
                    return True
                return verifier.cached(int(tmdb_id)) is True

            strict_is_on_vixsrc._flixit_strict_movie_it_v1 = True
            strict_is_on_vixsrc._original = current_is_on_vixsrc
            core.is_on_vixsrc = strict_is_on_vixsrc

        current_compact = home_fast._compact
        if not getattr(current_compact, "_flixit_strict_movie_it_v1", False):
            def compact_italian_movies(payload: dict) -> dict:
                return _filter_home_payload(current_compact(payload), verifier)

            compact_italian_movies._flixit_strict_movie_it_v1 = True
            compact_italian_movies._original = current_compact
            home_fast._compact = compact_italian_movies

        # Enforce the same language rule on direct Watch URLs. On a cold entry
        # language verification and stream resolution run concurrently, rather
        # than one after the other.
        current_resolve = player.resolve_stream
        if not getattr(current_resolve, "_flixit_strict_media_it_v1", False):
            async def strict_resolve(media_type: str, tmdb_id: int, season=None, episode=None):
                kind = "tv" if str(media_type or "").lower() == "tv" else "movie"
                tmdb_id = int(tmdb_id)

                if kind == "movie":
                    cached = await asyncio.to_thread(verifier.cached, tmdb_id)
                    if cached is False:
                        return {"success": False, "reason": "not_italian", "message": "Audio italiano non disponibile"}
                    if cached is True:
                        return await current_resolve(kind, tmdb_id, season, episode)
                    language_task = asyncio.create_task(verifier.verify(tmdb_id))
                    stream_task = asyncio.create_task(current_resolve(kind, tmdb_id, season, episode))
                    language_ok, stream = await asyncio.gather(language_task, stream_task)
                    if language_ok:
                        return stream
                    return {"success": False, "reason": "not_italian", "message": "Audio italiano non disponibile"}

                season_number = max(1, int(season or 1))
                episode_number = max(1, int(episode or 1))
                key = (tmdb_id, season_number, episode_number)
                cached_audio = episode_policy._cache_hit(key)
                if isinstance(cached_audio, dict):
                    if cached_audio.get("italian_available") is not True:
                        return {"success": False, "reason": "not_italian", "message": "Episodio non disponibile in italiano"}
                    return await current_resolve(kind, tmdb_id, season_number, episode_number)

                language_task = asyncio.create_task(
                    episode_policy._inspect_source(tmdb_id, season_number, episode_number)
                )
                stream_task = asyncio.create_task(
                    current_resolve(kind, tmdb_id, season_number, episode_number)
                )
                audio, stream = await asyncio.gather(language_task, stream_task)
                if isinstance(audio, dict) and audio.get("italian_available") is True:
                    return stream
                return {"success": False, "reason": "not_italian", "message": "Episodio non disponibile in italiano"}

            strict_resolve._flixit_strict_media_it_v1 = True
            strict_resolve._original = current_resolve
            player.resolve_stream = strict_resolve

        priority_ids, _payload = _snapshot_movie_ids(core, limit=PRIORITY_MOVIES)
        if priority_ids:
            try:
                await asyncio.wait_for(
                    _map_limit(priority_ids, VERIFY_CONCURRENCY, verifier.verify),
                    timeout=6.0,
                )
            except asyncio.TimeoutError:
                pass
            except Exception:
                pass

        async def warm_player(ids: list[int]) -> None:
            confirmed = [tmdb_id for tmdb_id in ids if verifier.cached(tmdb_id) is True][:PLAYER_WARM_MOVIES]
            async def one(tmdb_id: int):
                try:
                    return await current_resolve("movie", tmdb_id)
                except Exception:
                    return None
            if confirmed:
                await _map_limit(confirmed, PLAYER_WARM_CONCURRENCY, one)

        async def background_loop() -> None:
            # First fill the remaining Italian-movie verdicts without putting any
            # provider probes on user requests.
            try:
                catalog_ids = list((getattr(core, "_vix_ids", {}) or {}).get("movie") or set())
            except Exception:
                catalog_ids = []

            priority_set = set(priority_ids)
            remaining = [int(value) for value in catalog_ids if int(value) not in priority_set]
            for start in range(0, len(remaining), 30):
                await _map_limit(remaining[start:start + 30], VERIFY_CONCURRENCY, verifier.verify)
                await asyncio.sleep(2.0)

            while True:
                try:
                    hot_ids, _ = _snapshot_movie_ids(core, limit=PRIORITY_MOVIES)
                    await _map_limit(hot_ids, VERIFY_CONCURRENCY, verifier.verify)
                    await warm_player(hot_ids)
                except Exception:
                    pass
                await asyncio.sleep(45 * 60)

        await warm_player(priority_ids)
        asyncio.create_task(background_loop())

        try:
            core.clear_response_cache()
        except Exception:
            pass

        app.state.flixit_strict_italian_media = {
            "installed": True,
            "policy": POLICY_VERSION,
            "movies": "explicit_italian_only_fail_closed",
            "episodes": "explicit_italian_only_fail_closed",
            "player": "parallel_language_check_and_resolution_with_hot_cache",
        }

    app.add_event_handler("startup", apply_policy)
    app.state.flixit_strict_italian_media_registered = True
    return True


__all__ = ["install_strict_italian_media", "MovieItalianAudioVerifier", "POLICY_VERSION"]
