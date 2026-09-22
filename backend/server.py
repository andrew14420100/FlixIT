"""FlixIT FastAPI entrypoint.

The full application remains in ``server_core.py``. This thin entrypoint adds
lifecycle management for optional runtimes plus low-priority daily artwork /
trailer/catalog maintenance.
"""
import asyncio
import math
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import Body, HTTPException, Query

import server_core as _core
from server_core import *  # noqa: F401,F403 - preserve existing imports/contracts

if getattr(_core, "TMDB_API_KEY", None):
    os.environ.setdefault("TMDB_API_KEY", str(_core.TMDB_API_KEY))

from services.netflix_artwork_quality import install_netflix_artwork_quality
from services.trailer_daily_policy import install_trailer_daily_policy
from services.artwork_card_policy import install_artwork_card_policy, POLICY_VERSION

install_netflix_artwork_quality()
install_trailer_daily_policy()
install_artwork_card_policy()

from services.official_artwork import OfficialArtworkResolver
from services.omni_process import omni_lifespan, omni_status


app = _core.app
ROME_TZ = ZoneInfo("Europe/Rome")
DAILY_REFRESH_HOUR = 6
SC_IMPORT_PAGES = 10
SC_IMPORT_LIMIT = 1600
SC_IMPORT_CHUNK = 24

_official_artwork = OfficialArtworkResolver(
    _core.db,
    _core.fetch_tmdb_data,
    lambda: getattr(_core._player, "artwork_resolver", None),
)
app.state.official_artwork_resolver = _official_artwork

_sc_import_state = {
    "running": False,
    "catalog_candidates": 0,
    "processed": 0,
    "sc_imported": 0,
    "card_ready": 0,
    "last_started_at": None,
    "last_finished_at": None,
    "version": POLICY_VERSION,
}

# Top 10 sorts globally by recent activity. The existing compound
# (user_id, updated_at) index cannot serve that sort, so keep a dedicated
# timestamp index as well. create_index is idempotent on startup.
try:
    _core.db["watch_progress"].create_index([("updated_at", -1)])
except Exception:
    pass


@app.get("/api/public/official-artwork/{media_type}/{tmdb_id}", tags=["artwork"])
async def flixit_official_artwork(media_type: str, tmdb_id: int):
    media_type = "tv" if media_type == "tv" else "movie"
    return await _official_artwork.resolve(media_type, int(tmdb_id))


@app.post("/api/public/official-artwork/batch", tags=["artwork"])
async def flixit_official_artwork_batch(payload: dict = Body(...)):
    """Resolve up to 40 card artwork bundles in one HTTP round-trip."""
    raw_items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(raw_items, list):
        raise HTTPException(status_code=400, detail="items deve essere una lista")
    if len(raw_items) > 40:
        raise HTTPException(status_code=400, detail="Massimo 40 titoli per batch")

    normalized = []
    seen = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        try:
            tmdb_id = int(raw.get("tmdbId") or raw.get("tmdb_id") or raw.get("id"))
        except Exception:
            continue
        if tmdb_id <= 0:
            continue
        media_type = "tv" if raw.get("type") == "tv" or raw.get("media_type") == "tv" else "movie"
        key = (media_type, tmdb_id)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(key)

    semaphore = asyncio.Semaphore(8)

    async def one(media_type: str, tmdb_id: int):
        async with semaphore:
            try:
                return await _official_artwork.resolve(media_type, tmdb_id)
            except Exception:
                return {
                    "active": False,
                    "type": media_type,
                    "tmdbId": tmdb_id,
                    "card_ready": False,
                    "top10_ready": False,
                    "reason": "resolver_error",
                    "version": POLICY_VERSION,
                }

    results = await asyncio.gather(*(one(media_type, tmdb_id) for media_type, tmdb_id in normalized))
    return {
        "items": results,
        "count": len(results),
        "version": POLICY_VERSION,
        "max_batch_size": 40,
    }


def _safe_number(value, default=0.0) -> float:
    try:
        return float(value if value is not None else default)
    except Exception:
        return float(default)


def _safe_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _media_identity(row: dict):
    raw_id = (
        row.get("tmdbId")
        or row.get("tmdb_id")
        or row.get("media_id")
        or row.get("content_id")
    )
    try:
        tmdb_id = int(raw_id)
    except Exception:
        return None
    raw_type = str(row.get("media_type") or row.get("type") or "").lower()
    media_type = "tv" if "tv" in raw_type or "series" in raw_type else "movie"
    if not raw_type:
        try:
            content = _core.db["contents"].find_one(
                {"tmdbId": tmdb_id}, {"_id": 0, "type": 1}
            ) or {}
            media_type = "tv" if content.get("type") == "tv" else "movie"
        except Exception:
            pass
    return media_type, tmdb_id


@app.get("/api/public/flixit-top10", tags=["catalog"])
@_core.cached_response(ttl=timedelta(minutes=5))
async def flixit_recent_top10(hours: int = Query(48, ge=24, le=168)):
    """Top 10 driven primarily by recent real FlixIT activity."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=int(hours))
    candidates: dict[tuple[str, int], dict] = {}

    def row_for(key):
        if key not in candidates:
            candidates[key] = {
                "type": key[0],
                "tmdbId": key[1],
                "recent_watchers": 0,
                "recent_completions": 0.0,
                "recent_score": 0.0,
                "views": 0.0,
                "rating_sum": 0.0,
                "rating_count": 0,
                "latest_activity": None,
            }
        return candidates[key]

    try:
        progress_rows = list(
            _core.db["watch_progress"].find(
                {},
                {
                    "_id": 0,
                    "tmdb_id": 1,
                    "tmdbId": 1,
                    "media_id": 1,
                    "media_type": 1,
                    "type": 1,
                    "updated_at": 1,
                    "updatedAt": 1,
                    "progress": 1,
                    "duration": 1,
                },
            ).sort("updated_at", -1).limit(2000)
        )
    except Exception:
        progress_rows = []

    for row in progress_rows:
        key = _media_identity(row)
        if not key:
            continue
        updated = _safe_datetime(row.get("updated_at") or row.get("updatedAt"))
        if not updated or updated.astimezone(timezone.utc) < cutoff:
            continue
        entry = row_for(key)
        age_hours = max(0.0, (now - updated.astimezone(timezone.utc)).total_seconds() / 3600.0)
        recency = max(0.18, 1.0 - age_hours / max(24.0, float(hours)))
        duration = max(0.0, _safe_number(row.get("duration")))
        progress = max(0.0, _safe_number(row.get("progress")))
        completion = min(1.0, progress / duration) if duration > 0 else 0.0
        entry["recent_watchers"] += 1
        entry["recent_completions"] += completion
        entry["recent_score"] += 8.0 * recency + 4.0 * completion
        if not entry["latest_activity"] or updated > entry["latest_activity"]:
            entry["latest_activity"] = updated

    try:
        view_rows = list(
            _core.db["content_views"].find({}, {"_id": 0}).sort("views", -1).limit(300)
        )
    except Exception:
        view_rows = []
    for row in view_rows:
        key = _media_identity(row)
        if not key:
            continue
        entry = row_for(key)
        entry["views"] = max(
            entry["views"],
            _safe_number(row.get("views") or row.get("view_count") or row.get("count")),
        )

    try:
        rating_rows = list(_core.db["user_ratings"].find({}, {"_id": 0}).limit(5000))
    except Exception:
        rating_rows = []
    for row in rating_rows:
        key = _media_identity(row)
        if not key:
            continue
        rating = _safe_number(row.get("rating"))
        if rating <= 0:
            continue
        entry = row_for(key)
        entry["rating_sum"] += min(10.0, rating)
        entry["rating_count"] += 1

    def pre_score(entry):
        views_signal = min(100.0, math.log1p(max(0.0, entry["views"])) * 14.0)
        rating = (
            entry["rating_sum"] / entry["rating_count"]
            if entry["rating_count"]
            else 0.0
        )
        return entry["recent_score"] * 7.0 + views_signal * 0.18 + rating * 2.0

    pool = sorted(candidates.values(), key=pre_score, reverse=True)[:30]
    semaphore = asyncio.Semaphore(8)

    async def enrich(entry):
        media_type = entry["type"]
        tmdb_id = entry["tmdbId"]
        endpoint = f"/{'tv' if media_type == 'tv' else 'movie'}/{tmdb_id}"
        async with semaphore:
            data = await _core.fetch_tmdb_data(endpoint) or {}
        title = data.get("name") if media_type == "tv" else data.get("title")
        popularity = max(0.0, _safe_number(data.get("popularity")))
        vote_count = max(0.0, _safe_number(data.get("vote_count")))
        vote_average = max(0.0, min(10.0, _safe_number(data.get("vote_average"))))
        external_fame = min(100.0, math.log1p(popularity) * 16.0) * 0.55 + min(
            100.0, math.log1p(vote_count) * 11.0
        ) * 0.30 + vote_average * 10.0 * 0.15
        local_rating = (
            entry["rating_sum"] / entry["rating_count"]
            if entry["rating_count"]
            else 0.0
        )
        views_signal = min(100.0, math.log1p(max(0.0, entry["views"])) * 14.0)
        watcher_signal = min(100.0, entry["recent_watchers"] * 18.0)
        completion_signal = min(100.0, entry["recent_completions"] * 20.0)
        activity_signal = min(100.0, entry["recent_score"] * 5.5)

        score = (
            activity_signal * 0.42
            + watcher_signal * 0.25
            + completion_signal * 0.10
            + views_signal * 0.08
            + local_rating * 10.0 * 0.08
            + external_fame * 0.07
        )
        return {
            "id": tmdb_id,
            "tmdbId": tmdb_id,
            "tmdb_id": tmdb_id,
            "type": media_type,
            "media_type": media_type,
            "title": title or data.get("title") or data.get("name") or str(tmdb_id),
            "name": title or data.get("name") or data.get("title") or str(tmdb_id),
            "release_date": data.get("release_date"),
            "first_air_date": data.get("first_air_date"),
            "genre_ids": [g.get("id") for g in (data.get("genres") or []) if g.get("id")],
            "popularity": popularity,
            "vote_count": vote_count,
            "vote_average": vote_average,
            "recent_watchers": entry["recent_watchers"],
            "recent_completion_score": round(entry["recent_completions"], 3),
            "views": int(entry["views"]),
            "local_rating": round(local_rating, 2),
            "flixit_score": round(score, 4),
            "latest_activity": entry["latest_activity"].isoformat() if entry["latest_activity"] else None,
            "ranking_window_hours": int(hours),
        }

    enriched = await asyncio.gather(*(enrich(entry) for entry in pool), return_exceptions=True)
    clean = [row for row in enriched if isinstance(row, dict)]
    clean.sort(key=lambda row: row.get("flixit_score", 0), reverse=True)
    top = clean[:10]
    for index, row in enumerate(top, start=1):
        row["rank"] = index

    return {
        "items": top,
        "total": len(top),
        "window_hours": int(hours),
        "generated_at": now.isoformat(),
        "policy": "recent_flixit_activity_first_then_local_ratings_views_then_external_fame",
    }


_core_lifespan = app.router.lifespan_context


def _seconds_until_rome_refresh(hour: int = DAILY_REFRESH_HOUR) -> float:
    now = datetime.now(ROME_TZ)
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return max(1.0, (target - now).total_seconds())


async def _warm_daily_catalog() -> None:
    calls = []
    for page in range(1, 5):
        calls.extend(
            [
                ("/trending/movie/day", {"page": page}),
                ("/trending/tv/day", {"page": page}),
                ("/movie/now_playing", {"page": page}),
                ("/movie/upcoming", {"page": page}),
                ("/movie/popular", {"page": page}),
                ("/movie/top_rated", {"page": page}),
                ("/tv/on_the_air", {"page": page}),
                ("/tv/airing_today", {"page": page}),
                ("/tv/popular", {"page": page}),
                ("/tv/top_rated", {"page": page}),
            ]
        )
    await asyncio.gather(
        *(_core.fetch_tmdb_data(endpoint, dict(params)) for endpoint, params in calls),
        return_exceptions=True,
    )


async def _catalog_cover_candidates() -> list[tuple[str, int]]:
    """Collect a broad current movie/TV catalogue whose SC covers can be cached."""
    calls: list[tuple[str, str, int]] = []
    movie_endpoints = (
        "/trending/movie/day",
        "/movie/now_playing",
        "/movie/upcoming",
        "/movie/popular",
        "/movie/top_rated",
    )
    tv_endpoints = (
        "/trending/tv/day",
        "/tv/on_the_air",
        "/tv/airing_today",
        "/tv/popular",
        "/tv/top_rated",
    )
    for page in range(1, SC_IMPORT_PAGES + 1):
        calls.extend(("movie", endpoint, page) for endpoint in movie_endpoints)
        calls.extend(("tv", endpoint, page) for endpoint in tv_endpoints)

    semaphore = asyncio.Semaphore(12)

    async def fetch_one(media_type: str, endpoint: str, page: int):
        async with semaphore:
            try:
                payload = await _core.fetch_tmdb_data(endpoint, {"page": page}) or {}
            except Exception:
                return []
            rows = payload.get("results") if isinstance(payload, dict) else None
            if not isinstance(rows, list):
                rows = payload.get("items") if isinstance(payload, dict) else None
            if not isinstance(rows, list):
                return []
            out = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                try:
                    tmdb_id = int(row.get("id") or row.get("tmdbId") or row.get("tmdb_id"))
                except Exception:
                    continue
                if tmdb_id > 0:
                    out.append((media_type, tmdb_id))
            return out

    groups = await asyncio.gather(
        *(fetch_one(media_type, endpoint, page) for media_type, endpoint, page in calls),
        return_exceptions=True,
    )
    seen = set()
    out = []
    for group in groups:
        if not isinstance(group, list):
            continue
        for key in group:
            if key in seen:
                continue
            seen.add(key)
            out.append(key)
            if len(out) >= SC_IMPORT_LIMIT:
                return out
    return out


async def _warm_sc_cover_catalog(stop: asyncio.Event | None = None) -> None:
    """Progressively import/cache SC covers for the current FLIX-IT catalogue."""
    if _sc_import_state.get("running"):
        return

    _sc_import_state.update(
        {
            "running": True,
            "catalog_candidates": 0,
            "processed": 0,
            "sc_imported": 0,
            "card_ready": 0,
            "last_started_at": datetime.now(timezone.utc).isoformat(),
            "version": POLICY_VERSION,
        }
    )
    try:
        candidates = await _catalog_cover_candidates()
        _sc_import_state["catalog_candidates"] = len(candidates)

        for offset in range(0, len(candidates), SC_IMPORT_CHUNK):
            if stop is not None and stop.is_set():
                break
            chunk = candidates[offset : offset + SC_IMPORT_CHUNK]
            results = await asyncio.gather(
                *(_official_artwork.resolve(media_type, tmdb_id) for media_type, tmdb_id in chunk),
                return_exceptions=True,
            )
            for result in results:
                _sc_import_state["processed"] += 1
                if not isinstance(result, dict):
                    continue
                if result.get("sc_cover_imported"):
                    _sc_import_state["sc_imported"] += 1
                if result.get("card_ready"):
                    _sc_import_state["card_ready"] += 1
            # Stay background-friendly while still filling the cache quickly.
            await asyncio.sleep(0.08)
    finally:
        _sc_import_state["running"] = False
        _sc_import_state["last_finished_at"] = datetime.now(timezone.utc).isoformat()


async def _startup_sc_cover_import(stop: asyncio.Event) -> None:
    try:
        await asyncio.wait_for(stop.wait(), timeout=2.5)
        return
    except asyncio.TimeoutError:
        pass
    try:
        await _warm_sc_cover_catalog(stop)
    except Exception:
        pass


async def _daily_visual_maintenance(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=_seconds_until_rome_refresh())
            return
        except asyncio.TimeoutError:
            pass

        try:
            clear = getattr(_core, "clear_response_cache", None)
            if callable(clear):
                clear()
            await _warm_daily_catalog()
            await _official_artwork.refresh_daily(limit=600)
            await _warm_sc_cover_catalog(stop)
        except Exception:
            pass


@app.get("/api/system/sc-cover-import-status", tags=["system"])
async def flixit_sc_cover_import_status():
    return dict(_sc_import_state)


@asynccontextmanager
async def flixit_lifespan(app):
    async with _core_lifespan(app):
        async with omni_lifespan(app):
            stop = asyncio.Event()
            maintenance_task = asyncio.create_task(_daily_visual_maintenance(stop))
            cover_import_task = asyncio.create_task(_startup_sc_cover_import(stop))
            try:
                yield
            finally:
                stop.set()
                maintenance_task.cancel()
                cover_import_task.cancel()
                await asyncio.gather(
                    maintenance_task,
                    cover_import_task,
                    return_exceptions=True,
                )


app.router.lifespan_context = flixit_lifespan


@app.get("/api/system/omni-health", tags=["system"])
async def flixit_omni_health():
    return await omni_status(app)


def __getattr__(name):
    return getattr(_core, name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=False)