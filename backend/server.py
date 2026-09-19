"""FlixIT FastAPI entrypoint.

The full application remains in ``server_core.py``. This thin entrypoint adds
lifecycle management for an optional localhost Node/Stremio runtime without
changing any existing API routes or player contracts.
"""
import os
from contextlib import asynccontextmanager

import server_core as _core
from server_core import *  # noqa: F401,F403 - preserve existing imports/contracts

# server_core already owns the effective TMDB configuration (including its
# existing fallback). Publish that effective value to the process environment
# so secondary services such as services.stremio use the exact same TMDB
# credentials for TMDB -> IMDb external-id resolution.
if getattr(_core, "TMDB_API_KEY", None):
    os.environ.setdefault("TMDB_API_KEY", str(_core.TMDB_API_KEY))

# Upgrade the existing public media-assets pipeline in place. The wrapper keeps
# the same API contract, but lazily refreshes each cached title once and selects
# the largest native TMDB poster/backdrop/logo available. No artificial upscale.
from services.media_asset_quality import install_max_quality_media_assets

install_max_quality_media_assets(_core)

from services.omni_process import omni_lifespan, omni_status


app = _core.app

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
