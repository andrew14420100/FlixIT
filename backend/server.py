"""FlixIT FastAPI entrypoint.

The full application remains in ``server_core.py``. This thin entrypoint adds
lifecycle management for an optional localhost Node/Stremio runtime without
changing any existing API routes or player contracts.
"""
import server_core as _core
from server_core import *  # noqa: F401,F403 - preserve existing imports/contracts

from services.omni_process import omni_lifespan, omni_status


app = _core.app
app.router.lifespan_context = omni_lifespan


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
