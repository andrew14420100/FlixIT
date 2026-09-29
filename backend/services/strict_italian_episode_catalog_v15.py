"""Strict season-level Italian episode filter for FlixIT v15.

VixSrc documents ``lang=it`` on the player as a *preferred audio track*. That
parameter alone is therefore not proof that a returned source is actually
dubbed in Italian. v14 intentionally kept unknown episodes visible to avoid
empty seasons, but that also allowed original/English episodes to remain visible.

v15 combines the two reliable signals already present in FlixIT:

1. the complete, persisted VixSrc ``/api/list/episode?lang=it`` catalogue;
2. explicit per-episode HLS/manual audio evidence.

A season-level catalogue is considered authoritative only when that exact
(TMDb series, season) appears in the persisted Italian catalogue. When it does,
only catalogue members (plus explicit manual-positive overrides) are rendered.
When it does not, v15 falls back to explicit HLS/manual evidence and keeps
unknown metadata visible instead of collapsing the whole season to zero rows.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter
from fastapi.routing import APIRoute

from services import episode_availability_v12 as base
from services import strict_audio_evidence as catalog_policy
from services.vixsrc_episode_catalog_paged import install_paged_episode_catalog

ROUTE_PATH = base.ROUTE_PATH
POLICY_VERSION = "strict-it-v15-season-catalog-plus-explicit-audio"
CATALOG_FALLBACK_MAX_AGE = timedelta(days=7)
CATALOG_REFRESH_AFTER = timedelta(minutes=15)
_INSTALLED = False
_catalog_task: asyncio.Task | None = None
_background_tasks: set[asyncio.Task] = set()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _catalog_snapshot(db, tmdb_id: int, season_number: int):
    """Return (allowed_episode_numbers, age) or (None, None).

    A catalogue that contains no row for the requested season is *not* used as a
    negative source of truth. This is the key difference from the old v10 logic
    that could hide entire historical seasons when the provider catalogue did not
    include them.
    """
    try:
        meta = db["vixsrc_episode_catalog_meta"].find_one(
            {"key": "it"}, {"_id": 0, "updated_at": 1, "count": 1}
        ) or {}
        updated = _parse_dt(meta.get("updated_at"))
        if not updated:
            return None, None
        age = _now() - updated
        if age > CATALOG_FALLBACK_MAX_AGE:
            return None, age

        rows = list(
            db["vixsrc_episode_catalog_it"].find(
                {"tmdbId": int(tmdb_id), "season": int(season_number)},
                {"_id": 0, "episode": 1},
            )
        )
        allowed = {
            int(row.get("episode"))
            for row in rows
            if row.get("episode") is not None and int(row.get("episode")) > 0
        }
        if not allowed:
            return None, age
        return allowed, age
    except Exception:
        return None, None


def _positive_result(evidence: str) -> dict:
    return {
        "italian_available": True,
        "italian_audio_status": "italian",
        "source_available": True,
        "detected_languages": ["it"],
        "italian_audio_evidence_explicit": True,
        "italian_audio_evidence_source": evidence,
        "italian_audio_policy_version": POLICY_VERSION,
        "language_validation_pending": False,
    }


def _pending_result() -> dict:
    return {
        "italian_available": None,
        "italian_audio_status": "validation_pending",
        "source_available": None,
        "detected_languages": [],
        "italian_audio_evidence_explicit": False,
        "italian_audio_evidence_source": "catalog_or_hls_validation_pending",
        "italian_audio_policy_version": POLICY_VERSION,
        "language_validation_pending": True,
    }


def _trusted_cached_result(result: dict | None):
    """Accept only evidence that proves audio, never a plain ``lang=it`` request.

    v14 cache rows with evidence ``vixsrc_episode_api_lang_it`` are deliberately
    ignored as positives because VixSrc documents that parameter as a preference,
    not a guarantee that an Italian dub exists.
    """
    if not isinstance(result, dict):
        return None

    if base._is_definitive_negative(result):
        return dict(result)

    if result.get("italian_available") is not True:
        return None

    evidence = str(result.get("italian_audio_evidence_source") or "").strip().lower()
    if evidence in {
        "hls_audio_language",
        "manual_override",
        "vixsrc_episode_catalog_it",
    }:
        out = dict(result)
        out["italian_audio_policy_version"] = POLICY_VERSION
        return out
    return None


def _keep_task(task: asyncio.Task) -> asyncio.Task:
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


async def ensure_catalog_warm(force: bool = False) -> bool:
    """Refresh the complete paged Italian catalogue without blocking a request."""
    try:
        return bool(await catalog_policy.warm_italian_episode_catalog(force=force))
    except Exception:
        return False


def schedule_catalog_warm(force: bool = False) -> asyncio.Task | None:
    global _catalog_task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None

    if _catalog_task is not None and not _catalog_task.done():
        return _catalog_task

    _catalog_task = loop.create_task(ensure_catalog_warm(force=force))
    _keep_task(_catalog_task)

    def cleanup(done: asyncio.Task) -> None:
        global _catalog_task
        if _catalog_task is done:
            _catalog_task = None

    _catalog_task.add_done_callback(cleanup)
    return _catalog_task


def install_strict_italian_episode_catalog_v15(app, db) -> bool:
    global _INSTALLED
    if _INSTALLED or getattr(app.state, "flixit_episode_availability_v15", False):
        return True

    try:
        import server_core as core
    except Exception:
        return False

    # Reuse the existing resilient paged loader, but do not install its old v10
    # route/policy wrappers. We only need its complete persisted catalogue here.
    try:
        catalog_policy._catalog_db = db
        install_paged_episode_catalog(catalog_policy)
    except Exception:
        pass

    previous = None
    kept = []
    for route in app.router.routes:
        if isinstance(route, APIRoute) and route.path == ROUTE_PATH and "GET" in (route.methods or set()):
            previous = route.endpoint
            continue
        kept.append(route)
    if not callable(previous):
        return False

    app.router.routes[:] = kept
    router = APIRouter()

    @router.get(ROUTE_PATH)
    async def italian_season_v15(tmdb_id: int, season_number: int):
        tmdb_id = int(tmdb_id)
        season_number = int(season_number)
        rows = await base._ensure_metadata(core, db, tmdb_id, season_number)
        if not rows:
            schedule_catalog_warm(force=False)
            return {
                "tmdbId": tmdb_id,
                "season_number": season_number,
                "episodes": [],
                "italian_audio_policy": "metadata_missing",
                "italian_audio_policy_version": POLICY_VERSION,
                "pending_recheck_seconds": 1,
                "validation_pending_count": 0,
                "catalog_pending": True,
                "hidden_negative_count": 0,
                "hidden_catalog_count": 0,
                "instant_snapshot": True,
            }

        allowed, catalog_age = await asyncio.to_thread(
            _catalog_snapshot, db, tmdb_id, season_number
        )
        catalog_authoritative = isinstance(allowed, set) and bool(allowed)

        # Keep the persisted catalogue fresh, but never hold this HTTP request on
        # a global catalogue download.
        if not catalog_authoritative:
            schedule_catalog_warm(force=False)
        elif catalog_age is not None and catalog_age > CATALOG_REFRESH_AFTER:
            schedule_catalog_warm(force=True)

        cached = await asyncio.to_thread(base._cached_results, db, tmdb_id, season_number)
        visible: list[dict] = []
        missing: list[int] = []
        hidden_negative_count = 0
        hidden_catalog_count = 0

        for index, row in enumerate(rows, 1):
            if not isinstance(row, dict):
                continue
            number = base._episode_number(row, index)
            if number <= 0:
                continue

            key = (tmdb_id, season_number, number)
            manual = await asyncio.to_thread(base._override, db, key)
            if manual is not None:
                available, reason = manual
                if available is False:
                    hidden_negative_count += 1
                    continue
                visible.append(
                    base._decorate(
                        row,
                        tmdb_id,
                        season_number,
                        number,
                        _positive_result("manual_override"),
                    )
                )
                continue

            if catalog_authoritative:
                if number not in allowed:
                    hidden_catalog_count += 1
                    continue
                visible.append(
                    base._decorate(
                        row,
                        tmdb_id,
                        season_number,
                        number,
                        _positive_result("vixsrc_episode_catalog_it"),
                    )
                )
                continue

            trusted = _trusted_cached_result(cached.get(number))
            if trusted is not None:
                if base._is_definitive_negative(trusted):
                    hidden_negative_count += 1
                    continue
                visible.append(
                    base._decorate(row, tmdb_id, season_number, number, trusted)
                )
                continue

            missing.append(number)
            visible.append(
                base._decorate(
                    row,
                    tmdb_id,
                    season_number,
                    number,
                    _pending_result(),
                )
            )

        # Per-episode checks still matter for seasons that are not represented in
        # the global Italian catalogue. Their old lang=it-only positives are not
        # trusted by v15; only explicit HLS/manual evidence survives on read.
        if not catalog_authoritative:
            base._start_season_warm(db, tmdb_id, season_number, missing)

        pending_count = 0 if catalog_authoritative else len(missing)
        return {
            "tmdbId": tmdb_id,
            "season_number": season_number,
            "episodes": visible,
            "italian_audio_policy": "season_catalog_when_present_else_explicit_audio_only",
            "italian_audio_policy_version": POLICY_VERSION,
            "pending_recheck_seconds": 0 if catalog_authoritative else 1,
            "validation_pending_count": pending_count,
            "catalog_pending": not catalog_authoritative,
            "catalog_authoritative_for_season": catalog_authoritative,
            "catalog_episode_count": len(allowed or []),
            "hidden_negative_count": hidden_negative_count,
            "hidden_catalog_count": hidden_catalog_count,
            "instant_snapshot": True,
            "snapshot_source": (
                "v15_persisted_italian_episode_catalog"
                if catalog_authoritative
                else "v15_metadata_plus_explicit_audio_fallback"
            ),
        }

    app.include_router(router)
    app.state.flixit_episode_availability_v15 = {
        "installed": True,
        "policy": POLICY_VERSION,
        "source": "season_catalog_plus_explicit_audio",
        "lang_it_request_alone_is_positive_evidence": False,
        "catalog_absence_hides_whole_unrepresented_season": False,
        "catalog_membership_filters_represented_season": True,
    }
    _INSTALLED = True
    return True


__all__ = [
    "install_strict_italian_episode_catalog_v15",
    "ensure_catalog_warm",
    "schedule_catalog_warm",
    "POLICY_VERSION",
    "_catalog_snapshot",
    "_trusted_cached_result",
]
