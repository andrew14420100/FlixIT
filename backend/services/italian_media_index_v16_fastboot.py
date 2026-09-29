"""Non-blocking bootstrap wrapper for the v16 Italian media index.

The index itself remains persistent/precomputed, but Mongo hydration must never run
inside module/service registration because that can delay the whole FastAPI process
and leave the preview frontend on a blank page while its initial API calls wait.
"""
from __future__ import annotations

import asyncio

from services import italian_media_index_v16 as base

_INSTALLED = False
_background_tasks: set[asyncio.Task] = set()


def _keep(task: asyncio.Task) -> asyncio.Task:
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def install_italian_media_index_v16_fastboot(app, db) -> bool:
    global _INSTALLED
    if _INSTALLED or getattr(app.state, "flixit_italian_media_index_v16_fastboot", False):
        return True

    # During the very short cold-start window, Home must remain usable rather than
    # being filtered to zero items simply because the in-memory index has not been
    # hydrated yet. As soon as the persisted generation is loaded these functions
    # automatically become strict again.
    original_movie_allowed = base.movie_allowed
    original_tv_allowed = base.tv_allowed

    def movie_allowed_ready(tmdb_id: int) -> bool:
        if not getattr(base, "_movie_ready", False):
            return True
        return bool(original_movie_allowed(tmdb_id))

    def tv_allowed_ready(tmdb_id: int) -> bool:
        if not getattr(base, "_episode_ready", False):
            return True
        return bool(original_tv_allowed(tmdb_id))

    base.movie_allowed = movie_allowed_ready
    base.tv_allowed = tv_allowed_ready

    # Prevent synchronous Mongo scans during register(). The real hydrate function
    # is captured and executed after startup as a background task.
    original_hydrate = base.hydrate_index
    base.hydrate_index = lambda _db: None
    try:
        installed = bool(base.install_italian_media_index_v16(app, db))
    finally:
        base.hydrate_index = original_hydrate

    if not installed:
        return False

    async def hydrate_after_startup() -> None:
        try:
            await asyncio.to_thread(original_hydrate, db)
            try:
                import server_core as core
                core.clear_response_cache()
            except Exception:
                pass
            app.state.flixit_italian_media_index_v16_hydrated = True
        except Exception as exc:
            print(f"[italian-index-v16] background hydrate failed: {exc}")
            app.state.flixit_italian_media_index_v16_hydrated = False

    async def schedule_hydration() -> None:
        # Scheduling and returning is deliberate: FastAPI must be ready to answer
        # immediately. Hydration/legacy migration can take as long as it needs in
        # the background without blocking the website shell.
        _keep(asyncio.create_task(hydrate_after_startup()))

    app.add_event_handler("startup", schedule_hydration)
    app.state.flixit_italian_media_index_v16_fastboot = True
    _INSTALLED = True
    return True


__all__ = ["install_italian_media_index_v16_fastboot"]
