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

    Important for large catalogues: the scan is not limited *before* fresh rows
    are skipped.  We keep walking Mongo until `limit` new jobs are actually
    queued, so an 18k catalogue progresses instead of getting stuck on the same
    first 200 already-resolved titles forever.
    """

    def enqueue_catalog(self, limit: int = 250):
        wanted = max(1, min(int(limit), 1000))
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

    resolver.enqueue_catalog = MethodType(enqueue_catalog, resolver)
    return resolver
