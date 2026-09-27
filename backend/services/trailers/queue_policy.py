from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timedelta, timezone
from types import MethodType


ITALIAN_RETRY_SECONDS = 60 * 60
PUBLIC_RETRY_THROTTLE_SECONDS = 5 * 60
TRAILER_POLICY_VERSION = "direct-multiprovider-web-v4-italian-only"
SOURCE_POLICY = "direct-multiprovider-web-no-youtube-italian-only"


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


def _candidate_has_verified_italian_audio(candidate: dict) -> bool:
    if not candidate:
        return False
    language = candidate.get("audio_language") or candidate.get("language")
    if not _is_italian(language):
        return False

    source = str(candidate.get("source") or "").strip().lower()
    metadata = candidate.get("metadata") or {}
    if metadata.get("audio_language_inferred") is True:
        return False

    if source in {"apple_tv", "apple_itunes_it", "theryston_apple_tv"}:
        langs = metadata.get("hls_audio_languages") or []
        return any(_is_italian(value) for value in langs) if langs else _is_italian(language)

    if source in {"netflix", "theryston_netflix"}:
        if "hls_audio_languages" in metadata:
            langs = metadata.get("hls_audio_languages") or []
            return any(_is_italian(value) for value in langs)
        return metadata.get("audio_language_inferred") is False or _is_italian(language)

    # comingsoon_it is accepted only after the source page explicitly labels the
    # item as an Italian trailer. apple_itunes_search_it is accepted only after
    # ffprobe reports Italian audio. Other direct providers already populate the
    # candidate language from their manifest/file inspection.
    return True


def install_queue_policy(resolver):
    """Strict Italian-only policy for direct, non-YouTube trailer discovery.

    The policy version intentionally changes whenever discovery sources change so
    older negative/English-only cache rows are resolved again immediately.
    """

    base_enqueue = resolver.enqueue
    base_public_result = resolver.public_result
    base_resolve = resolver.resolve
    resolver._italian_public_retry_at = {}

    def safe_enqueue(self, media_type: str, tmdb_id: int, *, priority: int = 5, reason: str = "catalog"):
        media_type = "tv" if media_type == "tv" else "movie"
        tmdb_id = int(tmdb_id)
        job = self.jobs.find_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {"_id": 0, "status": 1, "priority": 1},
        ) or {}
        status = job.get("status")
        if status in {"running", "retry"}:
            return
        if status == "pending":
            current_priority = int(job.get("priority") or 999)
            if int(priority) < current_priority:
                self.jobs.update_one(
                    {"type": media_type, "tmdbId": tmdb_id, "status": "pending"},
                    {"$set": {
                        "priority": int(priority),
                        "reason": reason,
                        "updatedAt": datetime.now(timezone.utc).isoformat(),
                    }},
                )
            return
        base_enqueue(media_type, tmdb_id, priority=priority, reason=reason)

    async def policy_resolve(self, media_type: str, tmdb_id: int, *, force: bool = False):
        normalized_type = "tv" if media_type == "tv" else "movie"
        normalized_id = int(tmdb_id)
        cached = self.results.find_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {"_id": 0, "policyVersion": 1},
        ) or {}
        if cached.get("policyVersion") != TRAILER_POLICY_VERSION:
            force = True

        doc = await base_resolve(normalized_type, normalized_id, force=force)
        self.results.update_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {"$set": {"policyVersion": TRAILER_POLICY_VERSION, "sourcePolicy": SOURCE_POLICY}},
            upsert=True,
        )
        if isinstance(doc, dict):
            return {**doc, "policyVersion": TRAILER_POLICY_VERSION, "sourcePolicy": SOURCE_POLICY}
        return doc

    def italian_only_public_result(self, media_type: str, tmdb_id: int, *, hdr_supported: bool = False):
        result = base_public_result(media_type, tmdb_id, hdr_supported=hdr_supported)
        if not result.get("enabled"):
            return result

        selected = result.get("selected") or {}
        if selected and _candidate_has_verified_italian_audio(selected):
            return {
                **result,
                "italian_preferred": True,
                "italian_only": True,
                "language_required": "it",
                "language_verified": True,
                "fallback_original": False,
                "refresh_pending": False,
                "source_policy": SOURCE_POLICY,
                "youtube": False,
            }

        key = f"{'tv' if media_type == 'tv' else 'movie'}:{int(tmdb_id)}"
        now_mono = time.monotonic()
        last_retry = float(self._italian_public_retry_at.get(key) or 0)
        refresh_pending = bool(result.get("refresh_pending"))
        if now_mono - last_retry >= PUBLIC_RETRY_THROTTLE_SECONDS:
            self._italian_public_retry_at[key] = now_mono
            self.enqueue(media_type, tmdb_id, priority=0, reason="seek_verified_italian_web")
            refresh_pending = True

        return {
            **result,
            "available": False,
            "selected": None,
            "source": None,
            "italian_preferred": True,
            "italian_only": True,
            "language_required": "it",
            "language_verified": False,
            "fallback_original": False,
            "refresh_pending": refresh_pending,
            "reason": "verified_italian_web_trailer_search_pending",
            "source_policy": SOURCE_POLICY,
            "youtube": False,
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
            try:
                tmdb_id = int(content.get("tmdbId"))
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

            if resolved.get("policyVersion") != TRAILER_POLICY_VERSION:
                self.enqueue(media_type, tmdb_id, priority=0, reason="italian_web_policy_upgrade")
                queued += 1
                continue

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
                    priority, reason = 0, "seek_verified_italian_web"
                elif not playback_fresh:
                    priority, reason = 1, "playback_expired"
                elif height and height < 1080:
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
                priority, reason = 0, "missing_verified_italian_web_trailer"

            self.enqueue(media_type, tmdb_id, priority=priority, reason=reason)
            queued += 1

        return {
            "queued": queued,
            "skipped_fresh_or_active": skipped,
            "scanned": scanned,
            "target": wanted,
            "italian_preferred": True,
            "italian_only": True,
            "policy_version": TRAILER_POLICY_VERSION,
            "source_policy": SOURCE_POLICY,
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
    resolver.resolve = MethodType(policy_resolve, resolver)
    resolver.enqueue_catalog = MethodType(enqueue_catalog, resolver)
    resolver._catalog_loop = MethodType(catalog_loop, resolver)
    resolver.public_result = MethodType(italian_only_public_result, resolver)
    return resolver
