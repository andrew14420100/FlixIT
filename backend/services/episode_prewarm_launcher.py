"""Launch instant-season warming from an already-running startup loop."""
from __future__ import annotations

import asyncio
import inspect

from fastapi.routing import APIRoute

from services.instant_episode_snapshots import ROUTE_PATH, _season_targets

_STARTED = False


def launch_episode_prewarm(app, db) -> bool:
    global _STARTED
    if _STARTED:
        return True

    endpoint = None
    for route in reversed(app.router.routes):
        if isinstance(route, APIRoute) and route.path == ROUTE_PATH and "GET" in (route.methods or set()):
            endpoint = route.endpoint
            break
    if not callable(endpoint):
        return False

    async def run() -> None:
        targets = await asyncio.to_thread(_season_targets, db)
        semaphore = asyncio.Semaphore(4)

        async def one(tmdb_id: int, season_number: int) -> None:
            async with semaphore:
                try:
                    value = endpoint(tmdb_id=tmdb_id, season_number=season_number)
                    if inspect.isawaitable(value):
                        await value
                except Exception:
                    pass

        # Home-priority ordering is already produced by _season_targets.
        for start in range(0, len(targets), 20):
            await asyncio.gather(
                *(one(tmdb_id, season) for tmdb_id, season in targets[start:start + 20]),
                return_exceptions=True,
            )
            await asyncio.sleep(0.15)

    try:
        asyncio.get_running_loop().create_task(run())
    except RuntimeError:
        return False

    app.state.flixit_episode_prewarm_launcher = {
        "started": True,
        "mode": "all_known_seasons_home_first",
    }
    _STARTED = True
    return True


__all__ = ["launch_episode_prewarm"]
