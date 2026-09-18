from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from types import MethodType


def _dt(value):
    if not value:
        return None
    try:
        out = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return out if out.tzinfo else out.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def install_queue_policy(resolver):
    """Install a cache-aware, resumable policy for large catalogues.

    Only a small number of workers perform provider work concurrently, but the
    Mongo queue is kept filled in the background. Fresh resolved titles are
    skipped, active jobs are deduplicated and scanning continues past already
    resolved rows so an 18k catalogue cannot get stuck on its first page.
    """

    base_enqueue = resolver.enqueue

    def safe_enqueue(self, media_type: str, tmdb_id: int, *, priority: int = 5, reason: str = "catalog"):
        """Do not let repeated public polling restart a job already in flight.

        Hero/hover/detail can poll the public trailer endpoint while the first
        extraction is running. The old enqueue implementation changed a
        `running` job back to `pending`, allowing another worker to claim the
        same title. Keep active/retrying work intact and only promote the
        priority of a pending job when useful.
        """
        media_type = "tv" if media_type == "tv" else "movie"
        tmdb_id = int(tmdb_id)
        job = self.jobs.find_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {"_id": 0, "status": 1, "priority": 1, "nextRunAt": 1},
        ) or {}
        status = job.get("status")

        if status in {"running", "retry"}:
            return

        if status == "pending":
            current_priority = int(job.get("priority") or 999)
            if int(priority) < current_priority:
                self.jobs.update_one(
                    {"type": media_type, "tmdbId": tmdb_id, "status": "pending"},
                    {"$set": {"priority": int(priority), "reason": reason, "updatedAt": datetime.now(timezone.utc).isoformat()}},
                )
            return

        if status == "failed":
            next_run = _dt(job.get("nextRunAt"))
            if next_run and next_run > datetime.now(timezone.utc):
                return

        base_enqueue(media_type, tmdb_id, priority=priority, reason=reason)

    def enqueue_catalog(self, limit: int = 250):
        wanted = max(1, min(int(limit), 2000))
        queued = 0
        skipped = 0
        scanned = 0
        now = datetime.now(timezone.utc)
        cursor = self.contents.find(
            {"available": {"$ne": False}},
            {"_id": 0, "type": 1, "tmdbId": 1},
        )

        for content in cursor:
            scanned += 1
            if queued >= wanted:
                break

            tmdb_raw = content.get("tmdbId")
            if tmdb_raw is None:
                skipped += 1
                continue
            try:
                tmdb_id = int(tmdb_raw)
            except Exception:
                skipped += 1
                continue

            media_type = "tv" if content.get("type") == "tv" else "movie"
            job = self.jobs.find_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {"_id": 0, "status": 1},
            ) or {}
            if job.get("status") in {"pending", "running", "retry"}:
                skipped += 1
                continue

            resolved = self.results.find_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {"_id": 0},
            ) or {}
            if (resolved.get("manual") or {}).get("enabled"):
                skipped += 1
                continue

            selected = resolved.get("selected") or {}
            if selected:
                playback_exp = _dt(selected.get("expires_at") or selected.get("expiresAt"))
                metadata_exp = _dt(resolved.get("metadataExpiresAt"))
                height = int(selected.get("height") or selected.get("resolution") or 0)

                if height >= 1080 and (not playback_exp or playback_exp > now) and metadata_exp and metadata_exp > now:
                    skipped += 1
                    continue
                if height < 1080:
                    priority, reason = 3, "below_1080"
                elif playback_exp and playback_exp <= now:
                    priority, reason = 4, "playback_expired"
                else:
                    priority, reason = 5, "metadata_expired"
            else:
                legacy = self.assets.find_one(
                    {"type": media_type, "tmdbId": tmdb_id},
                    {"_id": 0, "trailer_key": 1},
                ) or {}
                if legacy.get("trailer_key"):
                    priority, reason = 2, "legacy_youtube"
                else:
                    priority, reason = 1, "missing"

            self.enqueue(media_type, tmdb_id, priority=priority, reason=reason)
            queued += 1

        return {
            "queued": queued,
            "skipped_fresh_or_active": skipped,
            "scanned": scanned,
            "target": wanted,
        }

    async def catalog_loop(self):
        try:
            batch = max(50, min(2000, int(os.environ.get("TRAILER_QUEUE_BATCH", "500"))))
        except Exception:
            batch = 500
        try:
            low_watermark = max(10, min(batch, int(os.environ.get("TRAILER_QUEUE_LOW_WATERMARK", "100"))))
        except Exception:
            low_watermark = 100

        while not self._stop.is_set():
            try:
                self.cleanup_temp_files()
                active = self.jobs.count_documents({"status": {"$in": ["pending", "running", "retry"]}})
                if active < low_watermark:
                    self.enqueue_catalog(limit=batch)
            except Exception as exc:
                if self.logger:
                    self.logger.warning("Trailer catalog queue scan failed: %s", exc)

            # Queue maintenance is cheap and does not contact providers. Workers
            # remain constrained by TRAILER_RESOLVER_CONCURRENCY.
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=45)
            except asyncio.TimeoutError:
                pass

    resolver.enqueue = MethodType(safe_enqueue, resolver)
    resolver.enqueue_catalog = MethodType(enqueue_catalog, resolver)
    resolver._catalog_loop = MethodType(catalog_loop, resolver)
    return resolver
