"""Compact first-paint Home endpoint.

This endpoint never rebuilds the full catalogue in the user's request. It reads
the persistent snapshot directly, trims it before FastAPI serializes the payload,
and schedules any expensive refresh in the background. The canonical full Home
endpoint remains responsible for rebuilding stale data.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

FAST_ROWS = 8
FAST_ITEMS_PER_ROW = 18


def _compact(payload: dict) -> dict:
    source_rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    rows = []
    for row in source_rows[:FAST_ROWS]:
        if not isinstance(row, dict):
            continue
        items = row.get("items") if isinstance(row.get("items"), list) else []
        rows.append({**row, "items": items[:FAST_ITEMS_PER_ROW]})

    return {
        **payload,
        "compact": True,
        "rows": rows,
        "row_count": len(rows),
        "total_row_count": int(payload.get("row_count") or len(source_rows)),
    }


def _empty(hero=None) -> dict:
    return {
        "compact": True,
        "hero": hero,
        "rows": [],
        "row_count": 0,
        "total_row_count": 0,
    }


def install_home_bootstrap_fast(app) -> bool:
    if getattr(app.state, "flixit_home_bootstrap_fast_registered", False):
        return True

    import server_core as core
    from services import home_bootstrap as home

    router = APIRouter()

    @router.get("/api/public/home-bootstrap-fast", tags=["catalog"])
    async def public_home_bootstrap_fast():
        # PyMongo is synchronous. Even a tiny find_one can momentarily stall all
        # async requests if Mongo has a network hiccup, so keep the most critical
        # Home lookup in a worker thread.
        payload, generated = await asyncio.to_thread(home._read_snapshot, core)

        if payload:
            try:
                current_settings = await asyncio.to_thread(home._current_hero_settings, core)
                cached_hero = payload.get("hero") if isinstance(payload.get("hero"), dict) else {}
                if home._hero_fingerprint(current_settings) != home._hero_fingerprint(cached_hero):
                    fresh_hero = await home._load_current_hero(app)
                    if fresh_hero:
                        updated = dict(payload)
                        updated["version"] = home.SNAPSHOT_VERSION
                        updated["hero"] = fresh_hero
                        await asyncio.to_thread(home._persist_snapshot_payload, core, updated, generated)
                        payload = updated
            except Exception:
                pass

            try:
                age = home._now() - generated if generated else None
                if (
                    payload.get("version") != home.SNAPSHOT_VERSION
                    or age is None
                    or age >= home.FRESH_FOR
                ):
                    home._schedule_refresh(app, core)
            except Exception:
                pass

            return _compact(payload)

        try:
            home._schedule_refresh(app, core)
        except Exception:
            pass

        hero = None
        try:
            hero = await home._load_current_hero(app)
        except Exception:
            pass
        return _empty(hero)

    app.include_router(router)
    app.state.flixit_home_bootstrap_fast_registered = True
    return True


__all__ = ["install_home_bootstrap_fast", "FAST_ROWS", "FAST_ITEMS_PER_ROW"]
