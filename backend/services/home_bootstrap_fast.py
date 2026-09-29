"""Ultra-fast first-paint Home endpoint.

The request path is intentionally boring: return the last persistent snapshot
from process memory and move every refresh/rebuild outside the user's request.
MongoDB is touched only when the worker hot cache is cold or periodically
reloaded. This keeps F5 latency stable even when Atlas/providers are slow.
"""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter

# Include every canonical Home row in the fast response. Items per horizontal
# row are capped so the first JSON stays bounded and does not become slower than
# the old multi-request hydration it replaces.
FAST_ROWS = 24
FAST_ITEMS_PER_ROW = 24
HOT_RELOAD_SECONDS = 5 * 60
HOT_REFRESH_SETTLE_SECONDS = 2.0

_hot_payload: dict | None = None
_hot_generated = None
_hot_loaded_at = 0.0
_hot_reload_tasks: set[asyncio.Task] = set()


def _compact(payload: dict) -> dict:
    source_rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    rows = []
    for row in source_rows[:FAST_ROWS]:
        if not isinstance(row, dict):
            continue
        items = row.get("items") if isinstance(row.get("items"), list) else []
        rows.append({**row, "items": items[:FAST_ITEMS_PER_ROW]})

    # `compact` now means rows are still missing, not simply that each carousel
    # was payload-capped. With all rows present React must not call the expensive
    # full bootstrap endpoint four seconds later and accidentally create a rebuild
    # stampede after deploys.
    rows_missing = len(rows) < len(source_rows)
    return {
        **payload,
        "compact": rows_missing,
        "row_items_capped": True,
        "rows": rows,
        "row_count": len(rows),
        "total_row_count": int(payload.get("row_count") or len(source_rows)),
    }


def _empty() -> dict:
    return {
        "compact": True,
        "hero": None,
        "rows": [],
        "row_count": 0,
        "total_row_count": 0,
    }


def _read_hot(core, home, *, force: bool = False):
    global _hot_payload, _hot_generated, _hot_loaded_at
    now = time.monotonic()
    if (
        not force
        and _hot_payload is not None
        and now - _hot_loaded_at < HOT_RELOAD_SECONDS
    ):
        return _hot_payload, _hot_generated

    payload, generated = home._read_snapshot(core)
    if payload:
        _hot_payload = payload
        _hot_generated = generated
        _hot_loaded_at = now
    return payload, generated


def _schedule_hot_reload(core, home) -> None:
    if any(not task.done() for task in _hot_reload_tasks):
        return

    async def runner():
        try:
            await asyncio.sleep(HOT_REFRESH_SETTLE_SECONDS)
            await asyncio.to_thread(_read_hot, core, home, force=True)
        except Exception:
            pass

    task = asyncio.create_task(runner())
    _hot_reload_tasks.add(task)
    task.add_done_callback(_hot_reload_tasks.discard)


def install_home_bootstrap_fast(app) -> bool:
    if getattr(app.state, "flixit_home_bootstrap_fast_registered", False):
        return True

    import server_core as core
    from services import home_bootstrap as home

    router = APIRouter()

    @router.get("/api/public/home-bootstrap-fast", tags=["catalog"])
    async def public_home_bootstrap_fast():
        payload, generated = await asyncio.to_thread(_read_hot, core, home)

        if payload:
            try:
                age = home._now() - generated if generated else None
                stale = (
                    payload.get("version") != home.SNAPSHOT_VERSION
                    or age is None
                    or age >= home.FRESH_FOR
                )
                if stale:
                    home._schedule_refresh(app, core)
                    _schedule_hot_reload(core, home)
            except Exception:
                pass
            return _compact(payload)

        try:
            home._schedule_refresh(app, core)
            _schedule_hot_reload(core, home)
        except Exception:
            pass
        return _empty()

    async def prime_hot_snapshot() -> None:
        try:
            payload, generated = await asyncio.to_thread(_read_hot, core, home, force=True)
            if (
                not payload
                or payload.get("version") != home.SNAPSHOT_VERSION
                or not generated
                or home._now() - generated >= home.FRESH_FOR
            ):
                home._schedule_refresh(app, core)
                _schedule_hot_reload(core, home)
        except Exception:
            pass

    @app.on_event("startup")
    async def _prime_fast_home_snapshot_on_startup():
        asyncio.create_task(prime_hot_snapshot())

    app.include_router(router)
    app.state.flixit_home_bootstrap_fast_registered = True
    return True


__all__ = ["install_home_bootstrap_fast", "FAST_ROWS", "FAST_ITEMS_PER_ROW"]
