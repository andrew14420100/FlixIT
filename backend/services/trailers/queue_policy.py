from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timedelta, timezone
from types import MethodType


ITALIAN_RETRY_SECONDS = 6 * 60 * 60
PUBLIC_RETRY_THROTTLE_SECONDS = 30 * 60


def _dt(value):
    if not value:
        return None
    try:
        out = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return out if out.tzinfo else out.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _language(value) -> str:
    return str(value or "").strip().lower().replace("_", "-")


def _is_italian(value) -> bool:
    lang = _language(value)
    return bool(
        lang == "it"
        or lang.startswith("it-")
        or lang in {"ita", "italian", "italiano", "italiana"}
        or lang.startswith("italian-")
    )


def _is_english(value) -> bool:
    lang = _language(value)
    return bool(
        lang == "en"
        or lang.startswith("en-")
        or lang in {"eng", "english", "inglese"}
        or lang.startswith("english-")
    )


def _candidate_has_verified_italian_audio(candidate: dict) -> bool:
    """Require evidence that the media audio itself is Italian.

    A localized provider page alone is not sufficient evidence. When an HLS
    manifest or a direct-file probe exposes the audio language, that evidence is
    preferred. Provider-specific metadata may also prove that the selected audio
    track itself is Italian.
    """
    if not candidate:
        return False
    language = candidate.get("audio_language") or candidate.get("language")
    if not _is_italian(language):
        return False

    source = str(candidate.get("source") or "").strip().lower()
    metadata = candidate.get("metadata") or {}

    if metadata.get("audio_language_inferred") is True:
        return False

    if source in {"apple_tv", "apple_itunes_it"}:
        langs = metadata.get("hls_audio_languages") or []
        return any(_is_italian(value) for value in langs)

    if source == "netflix":
        if "hls_audio_languages" in metadata:
            langs = metadata.get("hls_audio_languages") or []
            return any(_is_italian(value) for value in langs)
        return metadata.get("audio_language_inferred") is False

    return True


def install_queue_policy(resolver):
    """Install a cache-aware Italian-first trailer policy.

    Verified Italian audio is always preferred. If providers have not exposed a
    verifiable Italian rendition yet, the best already-resolved trailer remains
    playable instead of making Hero/Detail/hover lose the trailer completely.
    That fallback is temporary: it is re-queued periodically until an Italian
    candidate replaces it automatically. Italian 1080p is also revisited later
    in search of native 2160p/4K.
    """

    base_enqueue = resolver.enqueue
    base_public_result = resolver.public_result
    resolver._italian_public_retry_at = {}

    def safe_enqueue(self, media_type: str, tmdb_id: int, *, priority: int = 5, reason: str = "catalog"):
        """Do not let repeated public polling restart a job already in flight."""
        media_type = "tv" if media_type == "tv" else "movie"
        tmdb_id = int(tmdb_id)
        job = self.jobs.find_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {"_id": 0, "status": 1, "priority": 1, "nextRunAt": 1, "updatedAt": 1},
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

        base_enqueue(media_type, tmdb_id, priority=priority, reason=reason)

    def italian_first_public_result(self, media_type: str, tmdb_id: int, *, hdr_supported: bool = False):
        """Prefer verified Italian, but keep a temporary original-language fallback visible."""
        result = base_public_result(media_type, tmdb_id, hdr_supported=hdr_supported)
        if not result.get("enabled"):
            return result

        selected = result.get("selected") or {}
        language = selected.get("audio_language") or selected.get("language")
        if selected and _candidate_has_verified_italian_audio(selected):
            return {
                **result,
                "italian_preferred": True,
                "italian_only": False,
                "language_required": "it",
                "language_verified": True,
                "fallback_original": False,
            }

        # Keep the already-resolved trailer visible while scheduling a throttled
        # search for Italian audio. This avoids the regression where every title
        # lost its trailer merely because providers omitted/failed language tags.
        key = f"{'tv' if media_type == 'tv' else 'movie'}:{int(tmdb_id)}"
        now_mono = time.monotonic()
        last_retry = float(self._italian_public_retry_at.get(key) or 0)
        refresh_pending = False
        if now_mono - last_retry >= PUBLIC_RETRY_THROTTLE_SECONDS:
            self._italian_public_retry_at[key] = now_mono
            self.enqueue(media_type, tmdb_id, priority=1, reason="seek_verified_italian")
            refresh_pending = True

        if selected and result.get("available") is not False:
            return {
                **result,
                "italian_preferred": True,
                "italian_only": False,
                "language_required": "it",
                "language_verified": False,
                "fallback_original": True,
                "fallback_language": language or "unknown",
                "refresh_pending": refresh_pending,
                "reason": "temporary_original_until_italian_available",
            }

        return {
            **result,
            "available": False,
            "selected": None,
            "source": None,
            "italian_preferred": True,
            "italian_only": False,
            "language_required": "it",
            "language_verified": False,
            "fallback_original": False,
            "refresh_pending": refresh_pending,
            "reason": "italian_audio_search_pending",
        }

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

            selected = resolved.get("selected") or {}
            resolved_at = _dt(resolved.get("resolvedAt"))
            age = (now - resolved_at) if resolved_at else timedelta(days=999)
            metadata_exp = _dt(resolved.get("metadataExpiresAt"))
            metadata_fresh = bool(metadata_exp and metadata_exp > now)

            if selected:
                playback_exp = _dt(selected.get("expires_at") or selected.get("expiresAt"))
                height = int(selected.get("height") or selected.get("resolution") or 0)
                italian_verified = _candidate_has_verified_italian_audio(selected)
                playback_fresh = not playback_exp or playback_exp > now

                if not italian_verified:
                    if metadata_fresh and age.total_seconds() < ITALIAN_RETRY_SECONDS:
                        skipped += 1
                        continue
                    priority, reason = 1, "seek_verified_italian"
                elif not playback_fresh:
                    priority, reason = 1, "playback_expired"
                elif height < 1080:
                    priority, reason = 2, "below_1080_it"
                elif height >= 2160 and metadata_fresh:
                    skipped += 1
                    continue
                elif height >= 1080 and metadata_fresh and age < timedelta(hours=72):
                    skipped += 1
                    continue
                else:
                    priority, reason = 3, "seek_4k_it"
            else:
                if resolved_at and metadata_fresh and age.total_seconds() < ITALIAN_RETRY_SECONDS:
                    skipped += 1
                    continue
                legacy = self.assets.find_one(
                    {"type": media_type, "tmdbId": tmdb_id},
                    {"_id": 0, "trailer_key": 1},
                ) or {}
                if legacy.get("trailer_key"):
                    priority, reason = 2, "legacy_youtube_rejected"
                else:
                    priority, reason = 1, "missing_italian"

            self.enqueue(media_type, tmdb_id, priority=priority, reason=reason)
            queued += 1

        return {
            "queued": queued,
            "skipped_fresh_or_active": skipped,
            "scanned": scanned,
            "target": wanted,
            "italian_preferred": True,
            "italian_only": False,
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

            try:
                await asyncio.wait_for(self._stop.wait(), timeout=45)
            except asyncio.TimeoutError:
                pass

    resolver.enqueue = MethodType(safe_enqueue, resolver)
    resolver.enqueue_catalog = MethodType(enqueue_catalog, resolver)
    resolver._catalog_loop = MethodType(catalog_loop, resolver)
    resolver.public_result = MethodType(italian_first_public_result, resolver)
    return resolver
