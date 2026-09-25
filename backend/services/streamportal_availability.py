"""Strict VixSrc availability policy inspired by StreamPortal.

This module only verifies whether the public VixSrc title/episode endpoints report
that a title is currently playable. It never resolves, extracts or proxies the
underlying media stream.

Policy:
- VixSrc's Italian catalogue remains the cheap first filter;
- unknown catalogue state fails closed instead of showing unverified titles;
- public VixSrc movie/episode endpoints are then checked on demand;
- results are cached in MongoDB to avoid probing the provider on every request;
- homepage/archive filters and the public availability API use the same result.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from fastapi import Body


POLICY_VERSION = "streamportal-live-v1"
VIXSRC_BASE = "https://vixsrc.to"
POSITIVE_TTL = timedelta(hours=6)
NEGATIVE_TTL = timedelta(minutes=20)
MAX_BATCH = 200
PROBE_CONCURRENCY = 10
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)

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


def _media_type(value: Any) -> str:
    return "tv" if str(value or "").lower() == "tv" else "movie"


def _public_url(media_type: str, tmdb_id: int, season: int = 1, episode: int = 1) -> str:
    media_type = _media_type(media_type)
    if media_type == "tv":
        return f"{VIXSRC_BASE}/tv/{int(tmdb_id)}/{int(season)}/{int(episode)}"
    return f"{VIXSRC_BASE}/movie/{int(tmdb_id)}"


def _api_url(media_type: str, tmdb_id: int, season: int = 1, episode: int = 1) -> str:
    media_type = _media_type(media_type)
    if media_type == "tv":
        return f"{VIXSRC_BASE}/api/tv/{int(tmdb_id)}/{int(season)}/{int(episode)}"
    return f"{VIXSRC_BASE}/api/movie/{int(tmdb_id)}"


def _fresh(doc: dict) -> bool:
    checked = _parse_dt(doc.get("checked_at"))
    if not checked:
        return False
    ttl = POSITIVE_TTL if doc.get("available") is True else NEGATIVE_TTL
    return _utcnow() - checked < ttl


class VixSrcAvailabilityVerifier:
    """Cached, bounded verifier for public VixSrc availability."""

    def __init__(self, core, db):
        self.core = core
        self.db = db
        self.title_cache = db["vixsrc_playability"]
        self.episode_cache = db["vixsrc_episode_playability"]
        self._client: Optional[httpx.AsyncClient] = None
        self._semaphore = asyncio.Semaphore(PROBE_CONCURRENCY)
        self._title_inflight: dict[tuple[str, int], asyncio.Task] = {}
        self._episode_inflight: dict[tuple[int, int, int], asyncio.Task] = {}

        try:
            self.title_cache.create_index([("type", 1), ("tmdbId", 1)], unique=True)
            self.title_cache.create_index("checked_at")
            self.episode_cache.create_index(
                [("tmdbId", 1), ("season", 1), ("episode", 1)], unique=True
            )
            self.episode_cache.create_index("checked_at")
        except Exception:
            pass

    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                follow_redirects=True,
                timeout=httpx.Timeout(5.0, connect=3.0),
                limits=httpx.Limits(
                    max_connections=PROBE_CONCURRENCY + 4,
                    max_keepalive_connections=PROBE_CONCURRENCY,
                    keepalive_expiry=30.0,
                ),
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
                    "Referer": f"{VIXSRC_BASE}/",
                },
            )
        return self._client

    def catalog_loaded(self, media_type: str) -> bool:
        ids = getattr(self.core, "_vix_ids", {}).get(_media_type(media_type), set())
        return bool(ids)

    def catalog_member(self, media_type: str, tmdb_id: int) -> bool:
        media_type = _media_type(media_type)
        try:
            tmdb_id = int(tmdb_id)
        except Exception:
            return False

        try:
            blocklist = getattr(self.core, "_stream_blocklist", None)
            if blocklist and blocklist.is_blocked(media_type, tmdb_id):
                return False
        except Exception:
            return False

        ids = getattr(self.core, "_vix_ids", {}).get(media_type, set())
        # Strict policy: a provider outage must not turn every TMDB title into an
        # apparently playable title.
        if not ids:
            return False
        return tmdb_id in ids

    def _cached_title(self, media_type: str, tmdb_id: int) -> Optional[bool]:
        doc = self.title_cache.find_one(
            {"type": _media_type(media_type), "tmdbId": int(tmdb_id)},
            {"_id": 0, "available": 1, "checked_at": 1, "policy": 1},
        ) or {}
        if doc.get("policy") != POLICY_VERSION or not _fresh(doc):
            return None
        return doc.get("available") is True

    def _cached_episode(self, tmdb_id: int, season: int, episode: int) -> Optional[bool]:
        doc = self.episode_cache.find_one(
            {
                "tmdbId": int(tmdb_id),
                "season": int(season),
                "episode": int(episode),
            },
            {"_id": 0, "available": 1, "checked_at": 1, "policy": 1},
        ) or {}
        if doc.get("policy") != POLICY_VERSION or not _fresh(doc):
            return None
        return doc.get("available") is True

    async def _probe_endpoint(
        self,
        media_type: str,
        tmdb_id: int,
        *,
        season: int = 1,
        episode: int = 1,
    ) -> tuple[Optional[bool], str]:
        """Check provider-advertised playability without opening its media embed."""
        api_url = _api_url(media_type, tmdb_id, season, episode)
        public_url = _public_url(media_type, tmdb_id, season, episode)

        async with self._semaphore:
            try:
                response = await self.client().get(api_url)
            except (httpx.TimeoutException, httpx.HTTPError):
                return None, "api_unreachable"
            except Exception:
                return None, "api_error"

            if response.status_code in {404, 410}:
                return False, f"api_http_{response.status_code}"

            if response.status_code == 200:
                try:
                    payload = response.json()
                except Exception:
                    payload = None
                # Presence of a provider player source is enough for availability
                # verification. The source value itself is deliberately discarded.
                if isinstance(payload, dict) and bool(payload.get("src")):
                    return True, "api_player_source"
                if isinstance(payload, dict):
                    return False, "api_no_player_source"

            # StreamPortal's original availability test is a public-page HTTP 200
            # check. Keep it only as compatibility fallback if the JSON API changes.
            try:
                page = await self.client().get(public_url)
            except (httpx.TimeoutException, httpx.HTTPError):
                return None, "page_unreachable"
            except Exception:
                return None, "page_error"

            if page.status_code in {404, 410}:
                return False, f"page_http_{page.status_code}"
            if page.status_code == 200:
                text = (page.text or "")[:12000].lower()
                if any(marker in text for marker in ("not found", "non trovato", "404")):
                    return False, "page_not_found_marker"
                return True, "streamportal_page_200"
            if page.status_code >= 500:
                return None, f"page_http_{page.status_code}"
            return False, f"page_http_{page.status_code}"

    def _tv_candidates(self, tmdb_id: int) -> list[tuple[int, int]]:
        candidates: list[tuple[int, int]] = [(1, 1)]
        try:
            rows = list(
                self.db["tv_episodes"].find(
                    {"tmdbId": int(tmdb_id)},
                    {"_id": 0, "season_number": 1, "episode_number": 1},
                ).sort([("season_number", 1), ("episode_number", 1)]).limit(6)
            )
        except Exception:
            rows = []
        for row in rows:
            try:
                pair = (int(row.get("season_number")), int(row.get("episode_number")))
            except Exception:
                continue
            if pair[0] > 0 and pair[1] > 0 and pair not in candidates:
                candidates.append(pair)
        for fallback in ((1, 2), (1, 3)):
            if fallback not in candidates:
                candidates.append(fallback)
        return candidates[:6]

    async def _run_title_probe(self, media_type: str, tmdb_id: int) -> Optional[bool]:
        media_type = _media_type(media_type)
        tmdb_id = int(tmdb_id)
        if not self.catalog_member(media_type, tmdb_id):
            result: Optional[bool] = False
            reason = "not_in_italian_catalog"
            used_season = used_episode = None
        elif media_type == "movie":
            result, reason = await self._probe_endpoint("movie", tmdb_id)
            used_season = used_episode = None
        else:
            result = False
            reason = "no_playable_episode"
            used_season = used_episode = None
            had_unknown = False
            for season, episode in self._tv_candidates(tmdb_id):
                probe, probe_reason = await self._probe_endpoint(
                    "tv", tmdb_id, season=season, episode=episode
                )
                if probe is True:
                    result = True
                    reason = probe_reason
                    used_season, used_episode = season, episode
                    break
                if probe is None:
                    had_unknown = True
                    reason = probe_reason
            else:
                if had_unknown:
                    result = None

        now = _utcnow().isoformat()
        if result is not None:
            update = {
                "type": media_type,
                "tmdbId": tmdb_id,
                "available": bool(result),
                "checked_at": now,
                "policy": POLICY_VERSION,
                "reason": reason,
                "public_url": (
                    _public_url(media_type, tmdb_id, used_season or 1, used_episode or 1)
                    if result
                    else None
                ),
            }
            if used_season is not None:
                update["season"] = used_season
                update["episode"] = used_episode
            self.title_cache.update_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {"$set": update},
                upsert=True,
            )
            try:
                self.db["contents"].update_one(
                    {"tmdbId": tmdb_id, "type": media_type},
                    {"$set": {
                        "vixsrc_available": bool(result),
                        "vixsrc_checked_at": now,
                        "vixsrc_availability_policy": POLICY_VERSION,
                    }},
                )
            except Exception:
                pass
        return result

    async def verify_title(
        self,
        media_type: str,
        tmdb_id: int,
        *,
        force: bool = False,
    ) -> Optional[bool]:
        media_type = _media_type(media_type)
        tmdb_id = int(tmdb_id)
        if not force:
            cached = self._cached_title(media_type, tmdb_id)
            if cached is not None:
                return cached

        key = (media_type, tmdb_id)
        existing = self._title_inflight.get(key)
        if existing:
            return await existing

        task = asyncio.create_task(self._run_title_probe(media_type, tmdb_id))
        self._title_inflight[key] = task
        try:
            return await task
        finally:
            self._title_inflight.pop(key, None)

    async def _run_episode_probe(self, tmdb_id: int, season: int, episode: int) -> Optional[bool]:
        tmdb_id, season, episode = int(tmdb_id), int(season), int(episode)
        if not self.catalog_member("tv", tmdb_id):
            result: Optional[bool] = False
            reason = "not_in_italian_catalog"
        else:
            result, reason = await self._probe_endpoint(
                "tv", tmdb_id, season=season, episode=episode
            )
        if result is not None:
            self.episode_cache.update_one(
                {"tmdbId": tmdb_id, "season": season, "episode": episode},
                {"$set": {
                    "tmdbId": tmdb_id,
                    "season": season,
                    "episode": episode,
                    "available": bool(result),
                    "checked_at": _utcnow().isoformat(),
                    "policy": POLICY_VERSION,
                    "reason": reason,
                }},
                upsert=True,
            )
        return result

    async def verify_episode(
        self,
        tmdb_id: int,
        season: int,
        episode: int,
        *,
        force: bool = False,
    ) -> Optional[bool]:
        tmdb_id, season, episode = int(tmdb_id), int(season), int(episode)
        if not force:
            cached = self._cached_episode(tmdb_id, season, episode)
            if cached is not None:
                return cached
        key = (tmdb_id, season, episode)
        existing = self._episode_inflight.get(key)
        if existing:
            return await existing
        task = asyncio.create_task(self._run_episode_probe(tmdb_id, season, episode))
        self._episode_inflight[key] = task
        try:
            return await task
        finally:
            self._episode_inflight.pop(key, None)


async def _verified_filter(verifier: VixSrcAvailabilityVerifier, items: list, limit: int = 24) -> list:
    """Fill a row only with provider-catalogue titles confirmed reachable now."""
    await verifier.core.refresh_vixsrc_catalog()
    wanted = max(1, int(limit or 24))
    candidates = []
    for item in items or []:
        try:
            tmdb_id = int(item.get("tmdbId") or item.get("tmdb_id") or item.get("id"))
        except Exception:
            continue
        media_type = _media_type(item.get("type") or item.get("media_type"))
        if verifier.catalog_member(media_type, tmdb_id):
            candidates.append((item, media_type, tmdb_id))

    out = []
    # Work in small chunks so a row can stop as soon as it is full.
    chunk_size = max(8, min(24, wanted))
    for start in range(0, len(candidates), chunk_size):
        chunk = candidates[start:start + chunk_size]
        results = await asyncio.gather(
            *(verifier.verify_title(media_type, tmdb_id) for _, media_type, tmdb_id in chunk),
            return_exceptions=True,
        )
        for (item, _, _), result in zip(chunk, results):
            if result is True:
                out.append(item)
                if len(out) >= wanted:
                    return out
    return out


def _remove_availability_routes(app) -> None:
    targets = {
        ("/api/public/availability", "POST"),
        ("/api/public/availability/{media_type}/{tmdb_id}", "GET"),
    }
    kept = []
    for route in app.router.routes:
        path = getattr(route, "path", None)
        methods = set(getattr(route, "methods", set()) or set())
        if any(path == target_path and method in methods for target_path, method in targets):
            continue
        kept.append(route)
    app.router.routes[:] = kept


def install_streamportal_availability(app, db) -> None:
    """Install strict catalogue/playability checks after server_core is loaded."""
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    async def apply_policy() -> None:
        core = sys.modules.get("server_core")
        if core is None:
            return
        if getattr(app.state, "streamportal_availability_applied", False):
            return

        verifier = VixSrcAvailabilityVerifier(core, db)
        app.state.vixsrc_availability_verifier = verifier

        def strict_is_on_vixsrc(media_type: str, tmdb_id: int) -> bool:
            return verifier.catalog_member(media_type, tmdb_id)

        async def strict_check_vixsrc_availability(tmdb_id: int, content_type: str) -> dict:
            media_type = _media_type(content_type)
            await core.refresh_vixsrc_catalog()
            result = await verifier.verify_title(media_type, int(tmdb_id))
            return {
                "available": result is True,
                "source_url": _public_url(media_type, int(tmdb_id)) if result is True else None,
                "checked_at": _utcnow().isoformat(),
                "verified": result is not None,
                "policy": POLICY_VERSION,
            }

        async def strict_check_episode(tmdb_id: int, season: int, episode: int) -> bool:
            await core.refresh_vixsrc_catalog()
            return (await verifier.verify_episode(tmdb_id, season, episode)) is True

        async def strict_filter_available(items: list, limit: int = 24) -> list:
            return await _verified_filter(verifier, items, limit=limit)

        # Existing endpoints/functions resolve these module globals at request
        # time, so admin imports, archive rows and episode checks all inherit the
        # stricter policy without invasive changes to server_core.py.
        core.is_on_vixsrc = strict_is_on_vixsrc
        core.check_vixsrc_availability = strict_check_vixsrc_availability
        core.check_vixsrc_episode_availability = strict_check_episode
        core.filter_available = strict_filter_available

        _remove_availability_routes(app)

        async def public_availability(payload: dict = Body(...)):
            raw_items = payload.get("items") if isinstance(payload, dict) else None
            if not isinstance(raw_items, list):
                raw_items = []
            raw_items = raw_items[:MAX_BATCH]
            await core.refresh_vixsrc_catalog()

            normalized: list[tuple[str, int]] = []
            seen = set()
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                try:
                    tmdb_id = int(item.get("id") or item.get("tmdbId") or item.get("tmdb_id"))
                except Exception:
                    continue
                media_type = _media_type(item.get("type") or item.get("media_type"))
                key = (media_type, tmdb_id)
                if tmdb_id > 0 and key not in seen:
                    seen.add(key)
                    normalized.append(key)

            relevant_types = {media_type for media_type, _ in normalized}
            loaded = {kind: verifier.catalog_loaded(kind) for kind in ("movie", "tv")}
            candidates = [
                (media_type, tmdb_id)
                for media_type, tmdb_id in normalized
                if verifier.catalog_member(media_type, tmdb_id)
            ]
            not_in_catalog = [
                {"type": media_type, "id": tmdb_id}
                for media_type, tmdb_id in normalized
                if verifier.catalog_loaded(media_type)
                and not verifier.catalog_member(media_type, tmdb_id)
            ]

            results = await asyncio.gather(
                *(verifier.verify_title(media_type, tmdb_id) for media_type, tmdb_id in candidates),
                return_exceptions=True,
            )
            available = []
            unavailable = list(not_in_catalog)
            pending = []
            for (media_type, tmdb_id), result in zip(candidates, results):
                row = {"type": media_type, "id": tmdb_id}
                if result is True:
                    available.append(row)
                elif result is False:
                    unavailable.append(row)
                else:
                    pending.append(row)

            catalog_loaded = all(loaded[kind] for kind in relevant_types) if relevant_types else all(loaded.values())
            return {
                "available": available,
                "unavailable": unavailable,
                "pending": pending,
                "catalog_loaded": catalog_loaded,
                "catalog_loaded_by_type": loaded,
                "verified_count": len(available) + len(unavailable),
                "policy": POLICY_VERSION,
            }

        async def public_single_availability(media_type: str, tmdb_id: int):
            media_type = _media_type(media_type)
            await core.refresh_vixsrc_catalog()
            if not verifier.catalog_loaded(media_type):
                return {
                    "available": False,
                    "verified": False,
                    "catalog_loaded": False,
                    "policy": POLICY_VERSION,
                }
            result = await verifier.verify_title(media_type, int(tmdb_id))
            return {
                "available": result is True,
                "verified": result is not None,
                "catalog_loaded": True,
                "policy": POLICY_VERSION,
            }

        app.add_api_route(
            "/api/public/availability",
            public_availability,
            methods=["POST"],
            tags=["catalog"],
            name="strict_vixsrc_availability_batch",
        )
        app.add_api_route(
            "/api/public/availability/{media_type}/{tmdb_id}",
            public_single_availability,
            methods=["GET"],
            tags=["catalog"],
            name="strict_vixsrc_availability_single",
        )

        try:
            core.clear_response_cache()
        except Exception:
            pass
        app.state.streamportal_availability_applied = True

    # server_core can still be importing when services.__init__ installs this
    # hook. Startup is the first point where every route and helper is guaranteed
    # to exist, so apply the patch there.
    app.add_event_handler("startup", apply_policy)


__all__ = [
    "install_streamportal_availability",
    "VixSrcAvailabilityVerifier",
    "POLICY_VERSION",
    "_public_url",
    "_api_url",
]
