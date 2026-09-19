"""FlixIT FastAPI entrypoint.

The full application remains in ``server_core.py``. This thin entrypoint adds
lifecycle management for optional runtimes plus low-priority daily artwork /
trailer/catalog maintenance.
"""
import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import Body, HTTPException

import server_core as _core
from server_core import *  # noqa: F401,F403 - preserve existing imports/contracts

# server_core still owns TMDB metadata/external-id resolution. Artwork selection
# is handled separately and never promotes TMDB images in the public UI.
if getattr(_core, "TMDB_API_KEY", None):
    os.environ.setdefault("TMDB_API_KEY", str(_core.TMDB_API_KEY))

from services.netflix_artwork_quality import install_netflix_artwork_quality
from services.trailer_daily_policy import install_trailer_daily_policy
from services.artwork_card_policy import install_artwork_card_policy, POLICY_VERSION

# Install policies before the application lifespan starts its background workers.
install_netflix_artwork_quality()
install_trailer_daily_policy()
install_artwork_card_policy()

from services.official_artwork import OfficialArtworkResolver
from services.omni_process import omni_lifespan, omni_status


app = _core.app
ROME_TZ = ZoneInfo("Europe/Rome")
DAILY_REFRESH_HOUR = 6

_official_artwork = OfficialArtworkResolver(
    _core.db,
    _core.fetch_tmdb_data,
    lambda: getattr(_core._player, "artwork_resolver", None),
)
app.state.official_artwork_resolver = _official_artwork


@app.get("/api/public/official-artwork/{media_type}/{tmdb_id}", tags=["artwork"])
async def flixit_official_artwork(media_type: str, tmdb_id: int):
    media_type = "tv" if media_type == "tv" else "movie"
    return await _official_artwork.resolve(media_type, int(tmdb_id))


@app.post("/api/public/official-artwork/batch", tags=["artwork"])
async def flixit_official_artwork_batch(payload: dict = Body(...)):
    """Resolve up to 40 card artwork bundles in one HTTP round-trip.

    The resolver itself coalesces/cache-hits individual titles; the batch layer
    removes the browser request waterfall used by Home/Cinema/Serie/Catalogo.
    """
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


_core_lifespan = app.router.lifespan_context


def _seconds_until_rome_refresh(hour: int = DAILY_REFRESH_HOUR) -> float:
    """DST-safe delay until the next 06:00 Europe/Rome refresh window."""
    now = datetime.now(ROME_TZ)
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return max(1.0, (target - now).total_seconds())


async def _warm_daily_catalog() -> None:
    """Warm the public catalogue metadata used by Home/Cinema/Serie after 06:00.

    This does not publish TMDB artwork. It only refreshes title/catalog identity,
    popularity, votes and release data so the frontend can rebuild its daily
    partially-dynamic rows from fresh metadata without making the first user wait.
    """
    calls = [
        ("/trending/movie/day", {"page": 1}),
        ("/trending/tv/day", {"page": 1}),
        ("/movie/now_playing", {"page": 1}),
        ("/movie/now_playing", {"page": 2}),
        ("/movie/upcoming", {"page": 1}),
        ("/movie/popular", {"page": 1}),
        ("/movie/top_rated", {"page": 1}),
        ("/tv/on_the_air", {"page": 1}),
        ("/tv/airing_today", {"page": 1}),
        ("/tv/popular", {"page": 1}),
        ("/tv/top_rated", {"page": 1}),
    ]
    await asyncio.gather(
        *(_core.fetch_tmdb_data(endpoint, dict(params)) for endpoint, params in calls),
        return_exceptions=True,
    )


async def _daily_visual_maintenance(stop: asyncio.Event) -> None:
    """Refresh catalogue/artwork every day at 06:00 Europe/Rome."""
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
            await _official_artwork.refresh_daily(limit=300)
        except Exception:
            # Maintenance is best-effort and must never take down the API.
            pass


@asynccontextmanager
async def flixit_lifespan(app):
    async with _core_lifespan(app):
        async with omni_lifespan(app):
            stop = asyncio.Event()
            maintenance_task = asyncio.create_task(_daily_visual_maintenance(stop))
            try:
                yield
            finally:
                stop.set()
                maintenance_task.cancel()
                await asyncio.gather(maintenance_task, return_exceptions=True)


app.router.lifespan_context = flixit_lifespan


@app.get("/api/system/omni-health", tags=["system"])
async def flixit_omni_health():
    """Small staging diagnostic for the local Node runtime."""
    return await omni_status(app)


def __getattr__(name):
    """Proxy legacy/private attributes to server_core for compatibility."""
    return getattr(_core, name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=False)
