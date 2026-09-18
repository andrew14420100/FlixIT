from __future__ import annotations

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
    """Replace catalog seeding with a cache-aware, resumable queue policy.

    Fresh resolved titles are not re-enqueued on every 15 minute scan. Jobs that
    are pending/running/retrying are also left untouched so provider work is
    deduplicated across Home/Top10/categories and across process restarts.
    """

    def enqueue_catalog(self, limit: int = 250):
        queued = 0
        skipped = 0
        now = datetime.now(timezone.utc)
        cursor = self.contents.find(
            {"available": {"$ne": False}},
            {"_id": 0, "type": 1, "tmdbId": 1},
        ).limit(max(1, min(int(limit), 1000)))

        for content in cursor:
            media_type = "tv" if content.get("type") == "tv" else "movie"
            tmdb_id = int(content.get("tmdbId"))
            job = self.jobs.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0, "status": 1}) or {}
            if job.get("status") in {"pending", "running", "retry"}:
                skipped += 1
                continue

            resolved = self.results.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0}) or {}
            if (resolved.get("manual") or {}).get("enabled"):
                skipped += 1
                continue
            legacy = self.assets.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0, "trailer_key": 1}) or {}
            selected = resolved.get("selected") or {}

            if not selected and not legacy.get("trailer_key"):
                priority, reason = 1, "missing"
            elif legacy.get("trailer_key") and not selected:
                priority, reason = 2, "legacy_youtube"
            elif int(selected.get("height") or selected.get("resolution") or 0) < 1080:
                priority, reason = 3, "below_1080"
            else:
                playback_exp = _dt(selected.get("expires_at") or selected.get("expiresAt"))
                metadata_exp = _dt(resolved.get("metadataExpiresAt"))
                if playback_exp and playback_exp <= now:
                    priority, reason = 4, "playback_expired"
                elif not metadata_exp or metadata_exp <= now:
                    priority, reason = 5, "metadata_expired"
                else:
                    skipped += 1
                    continue

            self.enqueue(media_type, tmdb_id, priority=priority, reason=reason)
            queued += 1
        return {"queued": queued, "skipped_fresh_or_active": skipped}

    resolver.enqueue_catalog = MethodType(enqueue_catalog, resolver)
    return resolver
