"""FlixIT FastAPI entrypoint.

The full application remains in ``server_core.py``. This thin entrypoint adds
lifecycle management for an optional localhost Node/Stremio runtime without
changing any existing API routes or player contracts.
"""
import os
from contextlib import asynccontextmanager

import server_core as _core
from server_core import *  # noqa: F401,F403 - preserve existing imports/contracts

# server_core still owns TMDB metadata/external-id resolution. Artwork selection
# is handled separately and never promotes TMDB images in the public UI.
if getattr(_core, "TMDB_API_KEY", None):
    os.environ.setdefault("TMDB_API_KEY", str(_core.TMDB_API_KEY))

# Keep the existing Netflix artwork provider, but rank its already exposed
# assets by native quality: 4K -> 2K -> 1080-class -> 720-class -> best lower.
# No upscaling and no additional image provider is introduced here.
from services.netflix_artwork_quality import install_netflix_artwork_quality

install_netflix_artwork_quality()

from services.official_artwork import OfficialArtworkResolver
from services.omni_process import omni_lifespan, omni_status


app = _core.app

# One visual resolver is shared by Home, Top 10, Hero and Detail. TMDB is used
# only to identify a title/year/external id; returned artwork is Netflix, Apple
# or IMDb and never image.tmdb.org.
_official_artwork = OfficialArtworkResolver(
    _core.db,
    _core.fetch_tmdb_data,
    lambda: getattr(_core._player, "artwork_resolver", None),
)


@app.get("/api/public/official-artwork/{media_type}/{tmdb_id}", tags=["artwork"])
async def flixit_official_artwork(media_type: str, tmdb_id: int):
    media_type = "tv" if media_type == "tv" else "movie"
    return await _official_artwork.resolve(media_type, int(tmdb_id))


# Keep FastAPI/Starlette's original lifespan so every startup/shutdown handler
# registered by server_core still runs (trailer resolver, catalog warmers, etc.).
# Omni is composed inside that lifecycle instead of replacing it.
_core_lifespan = app.router.lifespan_context


@asynccontextmanager
async def flixit_lifespan(app):
    async with _core_lifespan(app):
        async with omni_lifespan(app):
            yield


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
