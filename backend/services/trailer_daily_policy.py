"""Low-noise daily policy for the existing multi-provider trailer resolver.

On-demand hover/detail requests keep priority 1 and are untouched. Broad catalog
maintenance runs once per day at 06:00 Europe/Rome and only queues missing or
expiring entries, so background work never competes with interactive hover.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from services.trailers.resolver import TrailerResolver, _dt, _now

_INSTALLED = False
ROME_TZ = ZoneInfo("Europe/Rome")
DAILY_REFRESH_HOUR = 6


def _seconds_until_rome_refresh(hour: int = DAILY_REFRESH_HOUR) -> float:
    now = datetime.now(ROME_TZ)
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return max(1.0, (target - now).total_seconds())


def install_trailer_daily_policy() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    def metadata_ttl(self: TrailerResolver) -> timedelta:
        try:
            days = max(1, int(self._setting("TRAILER_METADATA_TTL_DAYS", 1)))
        except Exception:
            days = 1
        return timedelta(days=days)

    def enqueue_catalog(self: TrailerResolver, limit: int = 300) -> dict:
        limit = max(1, min(int(limit), 1000))
        targets: list[tuple[str, int]] = []
        seen: set[tuple[str, int]] = set()

        def add(media_type, tmdb_id):
            try:
                key = ("tv" if media_type == "tv" else "movie", int(tmdb_id))
            except Exception:
                return
            if not key[1] or key in seen or len(targets) >= limit:
                return
            seen.add(key)
            targets.append(key)

        for content in self.contents.find(
            {"available": {"$ne": False}}, {"_id": 0, "type": 1, "tmdbId": 1}
        ).limit(limit):
            add(content.get("type"), content.get("tmdbId"))

        if len(targets) < limit:
            for row in self.results.find(
                {}, {"_id": 0, "type": 1, "tmdbId": 1, "resolvedAt": 1}
            ).sort("resolvedAt", -1).limit(limit - len(targets)):
                add(row.get("type"), row.get("tmdbId"))

        queued = 0
        skipped_fresh = 0
        refresh_cutoff = _now() + timedelta(minutes=30)
        for media_type, tmdb_id in targets:
            resolved = self.results.find_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {"_id": 0, "selected": 1, "metadataExpiresAt": 1},
            ) or {}
            expires = _dt(resolved.get("metadataExpiresAt"))

            if not resolved or not resolved.get("selected"):
                priority, reason = 4, "catalog_missing"
            elif not expires or expires <= refresh_cutoff:
                priority, reason = 5, "daily_expiring"
            else:
                skipped_fresh += 1
                continue

            # User hover/detail requests use priority 1. Background work is never
            # allowed to jump ahead of them.
            self.enqueue(media_type, tmdb_id, priority=priority, reason=reason)
            queued += 1

        return {
            "scanned": len(targets),
            "queued": queued,
            "skipped_fresh": skipped_fresh,
            "policy": "06:00_rome_missing_or_expiring_only",
        }

    async def catalog_loop(self: TrailerResolver) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=_seconds_until_rome_refresh(),
                )
                return
            except asyncio.TimeoutError:
                pass

            try:
                self.cleanup_temp_files()
                self.enqueue_catalog(limit=300)
            except Exception as exc:
                if self.logger:
                    self.logger.warning("Daily trailer catalog scan failed: %s", exc)

    TrailerResolver.metadata_ttl = metadata_ttl
    TrailerResolver.enqueue_catalog = enqueue_catalog
    TrailerResolver._catalog_loop = catalog_loop


__all__ = ["install_trailer_daily_policy"]
