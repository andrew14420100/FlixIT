"""FlixIT FastAPI entrypoint.

The full application remains in ``server_core.py``. This thin entrypoint adds
lifecycle management for optional runtimes plus the low-priority daily artwork /
trailer maintenance policy.
"""
import asyncio
import os
from contextlib import asynccontextmanager

import server_core as _core
from server_core import *  # noqa: F401,F403 - preserve existing imports/contracts

# server_core still owns TMDB metadata/external-id resolution. Artwork selection
# is handled separately and never promotes TMDB images in the public UI.
if getattr(_core, "TMDB_API_KEY", None):
    os.environ.setdefault("TMDB_API_KEY", str(_core.TMDB_API_KEY))

from services.netflix_artwork_quality import install_netflix_artwork_quality
from services.trailer_daily_policy import install_trailer_daily_policy

# Install policies before the application lifespan starts its background workers.
install_netflix_artwork_quality()
install_trailer_daily_policy()

from services.official_artwork import OfficialArtworkResolver
from services.omni_process import omni_lifespan, omni_status


app = _core.app

# One visual resolver is shared by Home, Top 10, Hero and Detail. TMDB is used
# only to identify title/year/external ids; returned artwork never uses
# image.tmdb.org.
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


# Keep FastAPI/Starlette's original lifespan so every startup/shutdown handler
# registered by server_core still runs (trailer resolver, catalog warmers, etc.).
_core_lifespan = app.router.lifespan_context


async def _daily_visual_maintenance(stop: asyncio.Event) -> None:
    """Quietly refresh recently used assets once per day.

    The first pass is delayed so normal Home/API traffic always gets CPU/network
    priority after a backend restart. The client-side Home feed has its own 24h
    refetch; clearing the small public response cache makes its next pass observe
    newly released/upcoming metadata immediately.
    """
    try:
        await asyncio.wait_for(stop.wait(), timeout=60)
        return
    except asyncio.TimeoutError:
        pass

    while not stop.is_set():
        try:
            await _official_artwork.refresh_daily(limit=180)
            clear = getattr(_core, "clear_response_cache", None)
            if callable(clear):
                clear()
        except Exception:
            # Maintenance is best-effort and must never take down the API.
            pass
        try:
            await asyncio.wait_for(stop.wait(), timeout=24 * 60 * 60)
        except asyncio.TimeoutError:
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
