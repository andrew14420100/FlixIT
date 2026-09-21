"""Low-noise daily policy plus FLIXIT trailer-language resolution policy.

Interactive requests remain priority 1. Broad maintenance runs once per day at
06:00 Europe/Rome. Trailer selection follows the user-approved order:
Trailer IT > Teaser IT > Trailer EN.

A second provider pass is important because the first pass can discover an
Apple/Prime/Netflix provider page only after Theryston has already been called.
The second pass persists those newly discovered pages and gives Theryston one
chance to extract the official Italian media from them.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from services.trailers.resolver import TrailerResolver, _dt, _now
from services.trailers.base import (
    TrailerCandidate,
    candidate_is_usable,
    candidate_sort_key,
    type_rank,
)

_INSTALLED = False
ROME_TZ = ZoneInfo("Europe/Rome")
DAILY_REFRESH_HOUR = 6
TRAILER_POLICY_VERSION = "it-official-second-pass-v8"


def _seconds_until_rome_refresh(hour: int = DAILY_REFRESH_HOUR) -> float:
    now = datetime.now(ROME_TZ)
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return max(1.0, (target - now).total_seconds())


def _language_rank(value) -> int:
    """Accept both ISO-639-1 and ffprobe/ISO-639-2 language tags."""
    lang = str(value or "").strip().lower().replace("_", "-")
    if lang in {"it", "ita", "italian", "italiano", "italiana"} or lang.startswith("it-"):
        return 3
    if lang in {"en", "eng", "english"} or lang.startswith("en-"):
        return 2
    return 1 if lang else 0


def _normalize_public_language(value):
    rank = _language_rank(value)
    if rank == 3:
        return "it-IT"
    if rank == 2:
        return "en"
    return value


def _user_trailer_tier(candidate) -> int:
    """User-approved order: Trailer IT > Teaser IT > Trailer EN."""
    lang = _language_rank(candidate.audio_language)
    kind = type_rank(candidate.trailer_type)
    if lang == 3 and kind >= 4:
        return 60
    if lang == 3 and kind in {2, 3}:
        return 50
    if lang == 2 and kind >= 4:
        return 40
    if lang == 3:
        return 30
    if lang == 2:
        return 20
    if kind >= 4:
        return 10
    return 0


def _pick_best_user_priority(candidates, *, hdr_supported: bool = False):
    usable = [candidate for candidate in candidates if candidate_is_usable(candidate)]
    if not usable:
        return None
    return max(
        usable,
        key=lambda candidate: (
            _user_trailer_tier(candidate),
            candidate_sort_key(candidate, hdr_supported=hdr_supported),
        ),
    )


def _candidate_rows(doc: dict) -> list[TrailerCandidate]:
    out: list[TrailerCandidate] = []
    for row in doc.get("alternatives") or []:
        try:
            candidate = TrailerCandidate.from_dict(row)
        except Exception:
            continue
        if candidate_is_usable(candidate):
            out.append(candidate)
    return out


def _has_italian_trailer_or_teaser(doc: dict) -> bool:
    return any(_user_trailer_tier(candidate) >= 50 for candidate in _candidate_rows(doc))


def _provider_key(candidate: TrailerCandidate) -> str | None:
    source = str(candidate.source or "").lower()
    page = str(candidate.provider_page or "").strip()
    if not page.startswith("https://"):
        return None
    if "apple" in source:
        return "apple_tv"
    if "prime" in source or "amazon" in source:
        return "prime_video"
    if "netflix" in source:
        return "netflix"
    return None


def _merge_discovered_provider_pages(doc: dict) -> tuple[dict, bool]:
    pages = dict(doc.get("providerPages") or {})
    changed = False
    for candidate in _candidate_rows(doc):
        key = _provider_key(candidate)
        page = str(candidate.provider_page or "").strip()
        if key and page and pages.get(key) != page:
            pages[key] = page
            changed = True
    return pages, changed


def install_trailer_daily_policy() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    # Keep the ranking rule identical everywhere the resolver imports pick_best.
    try:
        import services.trailers.base as trailer_base
        import services.trailers.resolver as trailer_resolver
        trailer_base.pick_best = _pick_best_user_priority
        trailer_resolver.pick_best = _pick_best_user_priority
    except Exception:
        pass

    # The main app routes already exist because server_core is imported before
    # this installer. Wrap the season endpoint without touching server_core.
    try:
        import server_core as _core
        from services.italian_episode_policy import install_italian_episode_policy
        install_italian_episode_policy(_core.app)
    except Exception:
        pass

    original_resolve = TrailerResolver.resolve
    original_public_result = TrailerResolver.public_result

    async def resolve_with_official_second_pass(
        self: TrailerResolver,
        media_type: str,
        tmdb_id: int,
        *,
        force: bool = False,
    ) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        tmdb_id = int(tmdb_id)
        previous = self.results.find_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {"_id": 0, "trailerPolicyVersion": 1},
        ) or {}

        # Old caches must be resolved once with the new policy even when their
        # previous playback URL has not expired yet.
        needs_policy_refresh = previous.get("trailerPolicyVersion") != TRAILER_POLICY_VERSION
        doc = await original_resolve(
            self,
            media_type,
            tmdb_id,
            force=bool(force or needs_policy_refresh),
        )

        manual = (doc.get("manual") or {}).get("enabled")
        if manual:
            self.results.update_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {"$set": {"trailerPolicyVersion": TRAILER_POLICY_VERSION}},
            )
            return self.results.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0}) or doc

        pages, pages_changed = _merge_discovered_provider_pages(doc)
        if pages_changed:
            self.results.update_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {"$set": {"providerPages": pages}},
            )
            doc = {**doc, "providerPages": pages}

        # Direct providers can discover official page URLs during pass one. A
        # second pass lets Theryston consume those pages with lang=it-IT. Do it
        # only when an Italian trailer/teaser is still missing.
        if pages and not _has_italian_trailer_or_teaser(doc):
            try:
                doc = await original_resolve(self, media_type, tmdb_id, force=True)
            except Exception as exc:
                if self.logger:
                    self.logger.warning(
                        "Italian trailer second pass failed for %s:%s: %s",
                        media_type,
                        tmdb_id,
                        exc,
                    )

        self.results.update_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {"$set": {"trailerPolicyVersion": TRAILER_POLICY_VERSION}},
        )
        return self.results.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0}) or doc

    def public_result_with_refresh(
        self: TrailerResolver,
        media_type: str,
        tmdb_id: int,
        *,
        hdr_supported: bool = False,
    ) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        tmdb_id = int(tmdb_id)
        result = original_public_result(self, media_type, tmdb_id, hdr_supported=hdr_supported)

        # ffprobe commonly emits ISO-639-2 tags (`ita`, `eng`). Normalize the
        # selected result before the FastAPI public endpoint applies its language
        # allow-list, otherwise a genuine Italian Theryston trailer is discarded.
        selected = result.get("selected")
        if isinstance(selected, dict) and selected.get("audio_language"):
            selected = {**selected, "audio_language": _normalize_public_language(selected.get("audio_language"))}
            result = {**result, "selected": selected}

        doc = self.results.find_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {"_id": 0, "trailerPolicyVersion": 1},
        ) or {}
        pending = doc.get("trailerPolicyVersion") != TRAILER_POLICY_VERSION
        if pending:
            self.enqueue(media_type, tmdb_id, priority=1, reason="official_it_policy_refresh")
        return {**result, "refresh_pending": pending, "policy_version": TRAILER_POLICY_VERSION}

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
                {"_id": 0, "selected": 1, "metadataExpiresAt": 1, "trailerPolicyVersion": 1},
            ) or {}
            expires = _dt(resolved.get("metadataExpiresAt"))

            if resolved.get("trailerPolicyVersion") != TRAILER_POLICY_VERSION:
                priority, reason = 4, "policy_version_refresh"
            elif not resolved or not resolved.get("selected"):
                priority, reason = 4, "catalog_missing"
            elif not expires or expires <= refresh_cutoff:
                priority, reason = 5, "daily_expiring"
            else:
                skipped_fresh += 1
                continue

            self.enqueue(media_type, tmdb_id, priority=priority, reason=reason)
            queued += 1

        return {
            "scanned": len(targets),
            "queued": queued,
            "skipped_fresh": skipped_fresh,
            "policy": "06:00_rome_missing_expiring_or_old_policy",
            "trailer_policy_version": TRAILER_POLICY_VERSION,
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

    TrailerResolver.resolve = resolve_with_official_second_pass
    TrailerResolver.public_result = public_result_with_refresh
    TrailerResolver.metadata_ttl = metadata_ttl
    TrailerResolver.enqueue_catalog = enqueue_catalog
    TrailerResolver._catalog_loop = catalog_loop


__all__ = ["install_trailer_daily_policy", "TRAILER_POLICY_VERSION"]
