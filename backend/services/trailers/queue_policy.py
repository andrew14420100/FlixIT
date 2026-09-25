from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import MethodType


SC_SOURCE = "streamingcommunity"
TRAILER_POLICY_VERSION = "streamingcommunity-vixcloud-all-v6-recovery"
EMPTY_RESULT_TTL = timedelta(minutes=20)


def _fresh_expiry(value) -> bool:
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if not parsed.tzinfo:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed > datetime.now(timezone.utc)
    except Exception:
        return False


def _native_selected(selected: dict) -> bool:
    metadata = selected.get("metadata") or {}
    return bool(
        selected
        and selected.get("source") == SC_SOURCE
        and isinstance(metadata, dict)
        and metadata.get("native_sc_trailer") is True
    )


def install_queue_policy(resolver):
    """Install strict SC trailer policy and full-catalog background import.

    Every available FLIX-IT catalog item is checked against StreamingCommunity.
    Accepted playback is either an explicit SC trailer media URL or an explicit
    Vixcloud trailer embed published in SC trailer metadata. Empty/transient
    results expire quickly so a temporary provider failure cannot hide trailers
    for days.
    """

    base_enqueue = resolver.enqueue
    base_public_result = resolver.public_result
    base_resolve = resolver.resolve

    resolver.results.update_many(
        {},
        {
            "$unset": {
                "manual": "",
                "providerPages.apple_tv": "",
                "providerPages.prime_video": "",
                "providerPages.netflix": "",
            }
        },
    )

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
                    {
                        "$set": {
                            "priority": int(priority),
                            "reason": reason,
                            "updatedAt": datetime.now(timezone.utc).isoformat(),
                        }
                    },
                )
            return
        base_enqueue(media_type, tmdb_id, priority=priority, reason=reason)

    async def strict_resolve(self, media_type: str, tmdb_id: int, *, force: bool = False):
        normalized_type = "tv" if media_type == "tv" else "movie"
        normalized_id = int(tmdb_id)

        self.results.update_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {"$unset": {"manual": ""}},
        )

        cached = self.results.find_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {"_id": 0, "policyVersion": 1, "selected": 1},
        ) or {}
        selected = cached.get("selected") or {}
        if (
            cached.get("policyVersion") != TRAILER_POLICY_VERSION
            or (selected and not _native_selected(selected))
        ):
            force = True

        doc = await base_resolve(normalized_type, normalized_id, force=force)
        alternatives = (doc or {}).get("alternatives") or [] if isinstance(doc, dict) else []
        native_count = sum(
            1
            for row in alternatives
            if isinstance(row, dict)
            and row.get("source") == SC_SOURCE
            and (row.get("metadata") or {}).get("native_sc_trailer") is True
        )
        now_dt = datetime.now(timezone.utc)
        checked_at = now_dt.isoformat()
        metadata_expiry = (
            (now_dt + EMPTY_RESULT_TTL).isoformat()
            if native_count == 0
            else (doc or {}).get("metadataExpiresAt")
        )
        update_fields = {
            "policyVersion": TRAILER_POLICY_VERSION,
            "sourcePolicy": "streamingcommunity-vixcloud-or-direct",
            "scNativeCheckedAt": checked_at,
            "scNativeTrailerCount": native_count,
        }
        if metadata_expiry:
            update_fields["metadataExpiresAt"] = metadata_expiry

        self.results.update_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {
                "$set": update_fields,
                "$unset": {"manual": ""},
            },
            upsert=True,
        )
        if isinstance(doc, dict):
            doc.pop("manual", None)
            return {
                **doc,
                **update_fields,
            }
        return doc

    def strict_public_result(self, media_type: str, tmdb_id: int, *, hdr_supported: bool = False):
        normalized_type = "tv" if media_type == "tv" else "movie"
        normalized_id = int(tmdb_id)

        self.results.update_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {"$unset": {"manual": ""}},
        )

        cached = self.results.find_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {"_id": 0, "policyVersion": 1, "selected": 1, "metadataExpiresAt": 1, "scNativeTrailerCount": 1},
        ) or {}
        cached_selected = cached.get("selected") or {}
        current_check = cached.get("policyVersion") == TRAILER_POLICY_VERSION and _fresh_expiry(cached.get("metadataExpiresAt"))

        if current_check and not cached_selected:
            return {
                "enabled": True,
                "available": False,
                "selected": None,
                "source": SC_SOURCE,
                "source_policy": "streamingcommunity-vixcloud-or-direct",
                "policy_version": TRAILER_POLICY_VERSION,
                "cached": True,
                "stale": False,
                "refresh_pending": False,
                "fallback_original": False,
                "sc_native_trailer_count": int(cached.get("scNativeTrailerCount") or 0),
                "reason": "streamingcommunity_trailer_not_available",
            }

        result = base_public_result(normalized_type, normalized_id, hdr_supported=hdr_supported)
        selected = result.get("selected") or {}
        native_ok = _native_selected(selected) and result.get("available") is not False

        if native_ok:
            return {
                **result,
                "enabled": True,
                "available": True,
                "source": SC_SOURCE,
                "selected": selected,
                "source_policy": "streamingcommunity-vixcloud-or-direct",
                "policy_version": TRAILER_POLICY_VERSION,
                "refresh_pending": False,
                "fallback_original": False,
            }

        self.enqueue(normalized_type, normalized_id, priority=1, reason="strict_sc_vixcloud_or_direct")
        return {
            "enabled": True,
            "available": False,
            "selected": None,
            "source": SC_SOURCE,
            "source_policy": "streamingcommunity-vixcloud-or-direct",
            "policy_version": TRAILER_POLICY_VERSION,
            "cached": bool(result.get("cached")),
            "stale": bool(result.get("stale") or selected),
            "refresh_pending": True,
            "fallback_original": False,
            "reason": "streamingcommunity_trailer_required",
        }

    def enqueue_catalog(self, limit: int = 0):
        """Queue every stale/unmigrated catalog title; limit<=0 means ALL."""
        wanted = max(0, int(limit or 0))
        queued = 0
        skipped = 0
        scanned = 0

        cursor = self.contents.find(
            {"available": {"$ne": False}},
            {"_id": 0, "type": 1, "tmdbId": 1},
        )

        for content in cursor:
            scanned += 1
            if wanted and queued >= wanted:
                break
            if content.get("tmdbId") is None:
                skipped += 1
                continue
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
                {"_id": 0, "selected": 1, "metadataExpiresAt": 1, "policyVersion": 1},
            ) or {}
            selected = resolved.get("selected") or {}
            checked_current_policy = resolved.get("policyVersion") == TRAILER_POLICY_VERSION
            metadata_fresh = _fresh_expiry(resolved.get("metadataExpiresAt"))
            valid_selected = not selected or _native_selected(selected)

            if checked_current_policy and metadata_fresh and valid_selected:
                skipped += 1
                continue

            self.enqueue(media_type, tmdb_id, priority=1, reason="bulk_import_sc_vixcloud_or_direct")
            queued += 1

        return {
            "queued": queued,
            "skipped_fresh_or_active": skipped,
            "scanned": scanned,
            "target": "all" if wanted == 0 else wanted,
            "source": SC_SOURCE,
            "source_policy": "streamingcommunity-vixcloud-or-direct",
            "policy_version": TRAILER_POLICY_VERSION,
        }

    async def catalog_loop(self):
        first_pass = True
        while not self._stop.is_set():
            try:
                self.cleanup_temp_files()
                active = self.jobs.count_documents({"status": {"$in": ["pending", "running", "retry"]}})
                if first_pass or active < 100:
                    self.enqueue_catalog(limit=0)
                    first_pass = False
            except Exception as exc:
                if self.logger:
                    self.logger.warning("SC trailer catalog import scan failed: %s", exc)

            try:
                await asyncio.wait_for(self._stop.wait(), timeout=15 * 60)
            except asyncio.TimeoutError:
                pass

    def reject_manual_url(self, media_type: str, tmdb_id: int, url: str):
        raise ValueError("Override manuali disabilitati: i trailer usano solo StreamingCommunity")

    async def reject_manual_candidate(self, media_type: str, tmdb_id: int, candidate_id: str):
        raise ValueError("Override manuali disabilitati: i trailer usano solo StreamingCommunity")

    resolver.enqueue = MethodType(safe_enqueue, resolver)
    resolver.resolve = MethodType(strict_resolve, resolver)
    resolver.enqueue_catalog = MethodType(enqueue_catalog, resolver)
    resolver._catalog_loop = MethodType(catalog_loop, resolver)
    resolver.public_result = MethodType(strict_public_result, resolver)
    resolver.set_manual_url = MethodType(reject_manual_url, resolver)
    resolver.set_manual_candidate = MethodType(reject_manual_candidate, resolver)
    return resolver
