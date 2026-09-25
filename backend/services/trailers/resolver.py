"""Central StreamingCommunity-only trailer resolver for FLIX-IT."""
from __future__ import annotations

import asyncio
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlparse

from pymongo import ASCENDING, ReturnDocument

from .base import TrailerCandidate, candidate_is_usable, is_blocked_url, now_iso, pick_best
from .providers import StreamingCommunityTrailerProvider

SC_SOURCE = "streamingcommunity"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        out = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return out if out.tzinfo else out.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on", "enabled"}


class TrailerResolver:
    def __init__(self, db, fetch_tmdb_data: Callable, logger=None):
        self.db = db
        self.fetch_tmdb_data = fetch_tmdb_data
        self.logger = logger
        self.results = db["trailer_resolutions"]
        self.jobs = db["trailer_jobs"]
        self.settings = db["app_settings"]
        self.contents = db["contents"]
        self.assets = db["media_assets"]
        self.results.create_index([("type", 1), ("tmdbId", 1)], unique=True)
        self.results.create_index([("metadataExpiresAt", ASCENDING)])
        self.jobs.create_index([("type", 1), ("tmdbId", 1)], unique=True)
        self.jobs.create_index([("status", 1), ("priority", 1), ("nextRunAt", 1)])
        self.providers = [StreamingCommunityTrailerProvider()]
        self._resolve_locks: dict[str, asyncio.Lock] = {}
        self._worker_tasks: list[asyncio.Task] = []
        self._stop = asyncio.Event()
        self.cache_dir = Path(os.environ.get("TRAILER_TEMP_DIR", tempfile.gettempdir())) / "flixit-trailers"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _setting(self, key: str, default=None):
        env_key = key.upper()
        if env_key in os.environ:
            return os.environ.get(env_key)
        doc = self.settings.find_one({"key": key}, {"_id": 0, "value": 1})
        return doc.get("value", default) if doc else default

    def enabled(self) -> bool:
        return _bool(self._setting("MULTI_PROVIDER_TRAILERS_ENABLED", True), True)

    def youtube_enabled(self) -> bool:
        return self.enabled()

    def metadata_ttl(self) -> timedelta:
        try:
            days = max(1, int(self._setting("TRAILER_METADATA_TTL_DAYS", 14)))
        except Exception:
            days = 14
        return timedelta(days=days)

    def playback_ttl(self) -> timedelta:
        try:
            hours = max(1, int(self._setting("TRAILER_PLAYBACK_TTL_HOURS", 3)))
        except Exception:
            hours = 3
        return timedelta(hours=hours)

    def concurrency(self) -> int:
        try:
            return max(1, min(4, int(self._setting("TRAILER_RESOLVER_CONCURRENCY", 2))))
        except Exception:
            return 2

    def config(self) -> dict:
        return {
            "enabled": self.enabled(),
            "source": SC_SOURCE,
            "source_policy": "streamingcommunity-only",
            "youtube_enabled": self.youtube_enabled(),
            "metadata_ttl_days": int(self.metadata_ttl().total_seconds() // 86400),
            "playback_ttl_hours": int(self.playback_ttl().total_seconds() // 3600),
            "concurrency": self.concurrency(),
            "minimum_resolution": None,
        }

    async def identity(self, media_type: str, tmdb_id: int) -> Optional[dict]:
        media_type = "tv" if media_type == "tv" else "movie"
        data = await self.fetch_tmdb_data(
            f"/{media_type}/{int(tmdb_id)}",
            {"append_to_response": "external_ids"},
        )
        if not data:
            return None
        existing = self.results.find_one(
            {"type": media_type, "tmdbId": int(tmdb_id)},
            {"_id": 0, "providerPages": 1},
        ) or {}
        date = data.get("first_air_date") if media_type == "tv" else data.get("release_date")
        year = None
        match = re.search(r"(?:19|20)\d{2}", str(date or ""))
        if match:
            year = int(match.group(0))
        return {
            "type": media_type,
            "tmdbId": int(tmdb_id),
            "title": data.get("name") if media_type == "tv" else data.get("title"),
            "original_title": data.get("original_name") if media_type == "tv" else data.get("original_title"),
            "year": year,
            "release_date": date,
            "runtime": data.get("runtime"),
            "external_ids": data.get("external_ids") or {},
            "provider_pages": existing.get("providerPages") or {},
        }

    def _lock(self, media_type: str, tmdb_id: int) -> asyncio.Lock:
        key = f"{media_type}:{tmdb_id}"
        if key not in self._resolve_locks:
            self._resolve_locks[key] = asyncio.Lock()
        return self._resolve_locks[key]

    def _fresh(self, doc: dict) -> bool:
        expires = _dt(doc.get("metadataExpiresAt"))
        return bool(expires and expires > _now())

    def _playback_fresh(self, candidate: Optional[dict]) -> bool:
        if not candidate:
            return False
        expires = _dt(candidate.get("expires_at") or candidate.get("expiresAt"))
        if not expires:
            return True
        return expires > _now() + timedelta(minutes=5)

    def _is_sc_candidate(self, candidate: Optional[dict]) -> bool:
        return bool(candidate and candidate.get("source") == SC_SOURCE)

    def _manual_candidate(self, doc: dict) -> Optional[dict]:
        manual = doc.get("manual") or {}
        if not manual.get("enabled"):
            return None
        if manual.get("candidate"):
            return manual.get("candidate")
        url = manual.get("url")
        if not url or is_blocked_url(url):
            return None
        return {
            "candidate_id": "manual-url",
            "source": "manual",
            "trailer_url": url,
            "manifest_url": url if ".m3u8" in str(url).lower() else None,
            "title": "Trailer manuale",
            "trailer_type": "Official Trailer",
            "official": True,
            "confidence": 1.0,
            "verified": False,
            "browser_compatible": True,
            "compatibility": "manual",
            "manual": True,
        }

    def public_result(self, media_type: str, tmdb_id: int, *, hdr_supported: bool = False) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        if not self.enabled():
            return {"enabled": False, "available": False, "source": "legacy"}

        doc = self.results.find_one({"type": media_type, "tmdbId": int(tmdb_id)}, {"_id": 0}) or {}
        manual = self._manual_candidate(doc)
        if manual:
            return {
                "enabled": True,
                "available": True,
                "selected": manual,
                "source": "manual",
                "cached": True,
            }

        # Old Apple/IMDb/Prime/Netflix cache entries are intentionally ignored.
        alternatives = [
            TrailerCandidate.from_dict(row)
            for row in (doc.get("alternatives") or [])
            if self._is_sc_candidate(row)
        ]
        selected = pick_best(alternatives, hdr_supported=hdr_supported)
        selected_dict = selected.to_dict() if selected else None
        if selected_dict and self._playback_fresh(selected_dict):
            return {
                "enabled": True,
                "available": True,
                "selected": selected_dict,
                "source": SC_SOURCE,
                "cached": True,
                "resolvedAt": doc.get("resolvedAt"),
            }

        self.enqueue(media_type, tmdb_id, priority=1, reason="sc_trailer_missing_or_stale")
        return {
            "enabled": True,
            "available": False,
            "selected": None,
            "source": SC_SOURCE,
            "cached": bool(doc),
            "stale": bool(doc),
            "refresh_pending": True,
        }

    def _expires(self, candidate: TrailerCandidate) -> str:
        explicit = _dt(candidate.expires_at)
        if explicit:
            return explicit.isoformat()
        if candidate.source == SC_SOURCE:
            return (_now() + self.metadata_ttl()).isoformat()
        return (_now() + self.playback_ttl()).isoformat()

    async def resolve(self, media_type: str, tmdb_id: int, *, force: bool = False) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        tmdb_id = int(tmdb_id)

        async with self._lock(media_type, tmdb_id):
            cached = self.results.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0}) or {}
            if self._manual_candidate(cached):
                return cached

            cached_sc = [
                row for row in (cached.get("alternatives") or [])
                if self._is_sc_candidate(row)
            ]
            if (
                not force
                and cached
                and self._fresh(cached)
                and any(self._playback_fresh(row) for row in cached_sc)
            ):
                return cached

            identity = await self.identity(media_type, tmdb_id)
            if not identity:
                raise RuntimeError("Contenuto TMDB non trovato")

            errors: dict[str, str] = {}
            candidates: list[TrailerCandidate] = []
            provider = self.providers[0]
            try:
                candidates = await provider.discover(identity)
            except Exception as exc:
                errors[provider.name] = str(exc)
                if self.logger:
                    self.logger.warning("SC trailer resolution failed for %s:%s: %s", media_type, tmdb_id, exc)

            ready: list[TrailerCandidate] = []
            for candidate in candidates:
                if candidate.source != SC_SOURCE or not candidate_is_usable(candidate):
                    continue
                candidate.expires_at = self._expires(candidate)
                ready.append(candidate)

            deduped: dict[str, TrailerCandidate] = {}
            for candidate in ready:
                deduped[candidate.candidate_id] = candidate
            ready = list(deduped.values())
            best = pick_best(ready, hdr_supported=False)
            now = _now()

            provider_pages = {}
            if best and best.provider_page:
                provider_pages[SC_SOURCE] = best.provider_page

            doc = {
                "type": media_type,
                "tmdbId": tmdb_id,
                "title": identity.get("title"),
                "originalTitle": identity.get("original_title"),
                "year": identity.get("year"),
                "externalIds": identity.get("external_ids") or {},
                "providerPages": provider_pages,
                "selected": best.to_dict() if best else None,
                "alternatives": [row.to_dict() for row in ready],
                "resolvedAt": now.isoformat(),
                "metadataExpiresAt": (now + self.metadata_ttl()).isoformat(),
                "lastError": errors or None,
                "sourcePolicy": "streamingcommunity-only",
                "minimumResolution": None,
                "youtubeRejected": False,
            }
            if cached.get("manual"):
                doc["manual"] = cached["manual"]

            self.results.update_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {"$set": doc},
                upsert=True,
            )
            return self.results.find_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {"_id": 0},
            ) or doc

    def get_admin(self, media_type: str, tmdb_id: int) -> dict:
        doc = self.results.find_one(
            {"type": "tv" if media_type == "tv" else "movie", "tmdbId": int(tmdb_id)},
            {"_id": 0},
        ) or {}
        return {**doc, "config": self.config()}

    def set_manual_url(self, media_type: str, tmdb_id: int, url: str) -> dict:
        if not url or is_blocked_url(url):
            raise ValueError("URL trailer manuale non valido")
        if urlparse(url).scheme not in ("http", "https"):
            raise ValueError("Il trailer manuale deve usare http/https")
        self.results.update_one(
            {"type": "tv" if media_type == "tv" else "movie", "tmdbId": int(tmdb_id)},
            {"$set": {"manual": {"enabled": True, "url": url, "candidate": None, "updatedAt": now_iso()}}},
            upsert=True,
        )
        return self.get_admin(media_type, tmdb_id)

    async def set_manual_candidate(self, media_type: str, tmdb_id: int, candidate_id: str) -> dict:
        doc = self.get_admin(media_type, tmdb_id)
        candidate_data = next(
            (row for row in (doc.get("alternatives") or []) if row.get("candidate_id") == candidate_id),
            None,
        )
        if not candidate_data:
            raise ValueError("Alternativa trailer non trovata")
        data = TrailerCandidate.from_dict(candidate_data).to_dict()
        data["manual"] = True
        self.results.update_one(
            {"type": "tv" if media_type == "tv" else "movie", "tmdbId": int(tmdb_id)},
            {"$set": {"manual": {"enabled": True, "url": None, "candidate": data, "updatedAt": now_iso()}}},
            upsert=True,
        )
        return self.get_admin(media_type, tmdb_id)

    def reset_manual(self, media_type: str, tmdb_id: int) -> dict:
        self.results.update_one(
            {"type": "tv" if media_type == "tv" else "movie", "tmdbId": int(tmdb_id)},
            {"$unset": {"manual": ""}},
        )
        return self.get_admin(media_type, tmdb_id)

    def set_provider_page(self, media_type: str, tmdb_id: int, provider: str, url: Optional[str]) -> dict:
        if provider not in {SC_SOURCE, "apple_tv", "prime_video"}:
            raise ValueError("Provider page non supportata")
        key = f"providerPages.{provider}"
        update = {"$set": {key: (url or "").strip()}} if url else {"$unset": {key: ""}}
        self.results.update_one(
            {"type": "tv" if media_type == "tv" else "movie", "tmdbId": int(tmdb_id)},
            update,
            upsert=True,
        )
        return self.get_admin(media_type, tmdb_id)

    def enqueue(self, media_type: str, tmdb_id: int, *, priority: int = 5, reason: str = "catalog") -> None:
        now = _now()
        self.jobs.update_one(
            {"type": "tv" if media_type == "tv" else "movie", "tmdbId": int(tmdb_id)},
            {
                "$set": {
                    "status": "pending",
                    "priority": int(priority),
                    "reason": reason,
                    "nextRunAt": now.isoformat(),
                    "updatedAt": now.isoformat(),
                },
                "$setOnInsert": {"createdAt": now.isoformat(), "attempts": 0},
            },
            upsert=True,
        )

    def enqueue_catalog(self, limit: int = 250) -> dict:
        queued = 0
        cursor = self.contents.find(
            {"available": {"$ne": False}},
            {"_id": 0, "type": 1, "tmdbId": 1},
        ).limit(max(1, min(limit, 1000)))

        for content in cursor:
            if not content.get("tmdbId"):
                continue
            media_type = "tv" if content.get("type") == "tv" else "movie"
            tmdb_id = int(content.get("tmdbId"))
            resolved = self.results.find_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {"_id": 0, "selected": 1, "metadataExpiresAt": 1},
            ) or {}
            selected = resolved.get("selected") or {}
            if selected.get("source") != SC_SOURCE:
                priority, reason = 1, "migrate_to_sc"
            elif not self._fresh(resolved):
                priority, reason = 3, "sc_metadata_expired"
            else:
                priority, reason = 5, "sc_catalog_refresh"
            self.enqueue(media_type, tmdb_id, priority=priority, reason=reason)
            queued += 1
        return {"queued": queued}

    def queue_status(self) -> dict:
        counts = {
            row["_id"]: row["count"]
            for row in self.jobs.aggregate([{"$group": {"_id": "$status", "count": {"$sum": 1}}}])
        }
        return {
            "counts": counts,
            "workers": len([task for task in self._worker_tasks if not task.done()]),
            "source": SC_SOURCE,
        }

    async def _worker(self, worker_id: int) -> None:
        while not self._stop.is_set():
            now = _now().isoformat()
            job = self.jobs.find_one_and_update(
                {"status": {"$in": ["pending", "retry"]}, "nextRunAt": {"$lte": now}},
                {"$set": {"status": "running", "worker": worker_id, "startedAt": now, "updatedAt": now}},
                sort=[("priority", ASCENDING), ("updatedAt", ASCENDING)],
                return_document=ReturnDocument.AFTER,
            )
            if not job:
                await asyncio.sleep(2.0)
                continue
            try:
                await self.resolve(job.get("type"), int(job.get("tmdbId")), force=True)
                self.jobs.update_one(
                    {"_id": job["_id"]},
                    {"$set": {"status": "done", "updatedAt": now_iso(), "lastError": None}},
                )
                await asyncio.sleep(0.8)
            except Exception as exc:
                attempts = int(job.get("attempts") or 0) + 1
                if attempts >= 4:
                    status = "failed"
                    next_run = (_now() + timedelta(hours=6)).isoformat()
                else:
                    status = "retry"
                    next_run = (_now() + timedelta(minutes=min(60, 2 ** attempts * 3))).isoformat()
                self.jobs.update_one(
                    {"_id": job["_id"]},
                    {"$set": {"status": status, "attempts": attempts, "nextRunAt": next_run, "lastError": str(exc)[:500], "updatedAt": now_iso()}},
                )
                await asyncio.sleep(min(8.0, 1.5 * attempts))

    async def _catalog_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.cleanup_temp_files()
                self.enqueue_catalog(limit=200)
            except Exception as exc:
                if self.logger:
                    self.logger.warning("SC trailer catalog queue scan failed: %s", exc)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=15 * 60)
            except asyncio.TimeoutError:
                pass

    def cleanup_temp_files(self) -> None:
        cutoff = _now().timestamp() - max(self.playback_ttl().total_seconds() * 2, 6 * 3600)
        for file in self.cache_dir.glob("*.mp4"):
            try:
                if file.stat().st_mtime < cutoff:
                    file.unlink(missing_ok=True)
            except Exception:
                pass

    async def start(self) -> None:
        if self._worker_tasks:
            return
        self._stop.clear()
        self.jobs.update_many(
            {"status": "running"},
            {"$set": {"status": "retry", "nextRunAt": now_iso()}},
        )
        self._worker_tasks = [
            asyncio.create_task(self._worker(index + 1))
            for index in range(self.concurrency())
        ]
        self._worker_tasks.append(asyncio.create_task(self._catalog_loop()))

    async def stop(self) -> None:
        self._stop.set()
        tasks = list(self._worker_tasks)
        self._worker_tasks = []
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
