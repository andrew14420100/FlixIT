from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from types import MethodType


SC_SOURCE = "streamingcommunity"
TRAILER_POLICY_VERSION = "streamingcommunity-only-v3"


def install_queue_policy(resolver):
    """Install a strict StreamingCommunity-only trailer policy.

    No manual URL, old provider result, media_assets trailer_key or temporary
    original-language fallback is allowed to become public playback. Existing
    manual overrides are removed because older releases preserved them and they
    could permanently block SC discovery.
    """

    base_enqueue = resolver.enqueue
    base_public_result = resolver.public_result
    base_resolve = resolver.resolve

    # One-time migration for records produced by the previous trailer systems.
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

        # A manual override must never short-circuit TrailerResolver.resolve().
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
            or (selected and selected.get("source") != SC_SOURCE)
        ):
            force = True

        doc = await base_resolve(normalized_type, normalized_id, force=force)
        self.results.update_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {
                "$set": {
                    "policyVersion": TRAILER_POLICY_VERSION,
                    "sourcePolicy": "streamingcommunity-only",
                },
                "$unset": {"manual": ""},
            },
            upsert=True,
        )
        if isinstance(doc, dict):
            doc.pop("manual", None)
            return {
                **doc,
                "policyVersion": TRAILER_POLICY_VERSION,
                "sourcePolicy": "streamingcommunity-only",
            }
        return doc

    def strict_public_result(self, media_type: str, tmdb_id: int, *, hdr_supported: bool = False):
        normalized_type = "tv" if media_type == "tv" else "movie"
        normalized_id = int(tmdb_id)

        # Clear an override even if it was written after service startup.
        self.results.update_one(
            {"type": normalized_type, "tmdbId": normalized_id},
            {"$unset": {"manual": ""}},
        )

        result = base_public_result(normalized_type, normalized_id, hdr_supported=hdr_supported)
        selected = result.get("selected") or {}
        source = str(selected.get("source") or result.get("source") or "").strip().lower()
        policy_ok = source == SC_SOURCE and result.get("available") is not False

        if policy_ok:
            return {
                **result,
                "enabled": True,
                "available": True,
                "source": SC_SOURCE,
                "selected": selected,
                "source_policy": "streamingcommunity-only",
                "policy_version": TRAILER_POLICY_VERSION,
                "refresh_pending": False,
                "fallback_original": False,
            }

        # Never let the FastAPI integration fall back to the legacy endpoint.
        # The only valid interim state is 'no trailer' while SC is resolving.
        self.enqueue(normalized_type, normalized_id, priority=1, reason="strict_sc_only")
        return {
            "enabled": True,
            "available": False,
            "selected": None,
            "source": SC_SOURCE,
            "source_policy": "streamingcommunity-only",
            "policy_version": TRAILER_POLICY_VERSION,
            "cached": bool(result.get("cached")),
            "stale": bool(result.get("stale") or selected),
            "refresh_pending": True,
            "fallback_original": False,
            "reason": "streamingcommunity_trailer_required",
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
            expiry = resolved.get("metadataExpiresAt")
            metadata_fresh = False
            if expiry:
                try:
                    parsed = datetime.fromisoformat(str(expiry).replace("Z", "+00:00"))
                    if not parsed.tzinfo:
                        parsed = parsed.replace(tzinfo=timezone.utc)
                    metadata_fresh = parsed > now
                except Exception:
                    metadata_fresh = False

            if (
                selected.get("source") == SC_SOURCE
                and resolved.get("policyVersion") == TRAILER_POLICY_VERSION
                and metadata_fresh
            ):
                skipped += 1
                continue

            self.enqueue(media_type, tmdb_id, priority=1, reason="migrate_to_strict_sc")
            queued += 1

        return {
            "queued": queued,
            "skipped_fresh_or_active": skipped,
            "scanned": scanned,
            "target": wanted,
            "source": SC_SOURCE,
            "source_policy": "streamingcommunity-only",
            "policy_version": TRAILER_POLICY_VERSION,
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
                    self.logger.warning("SC trailer catalog queue scan failed: %s", exc)

            try:
                await asyncio.wait_for(self._stop.wait(), timeout=45)
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
