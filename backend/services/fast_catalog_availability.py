"""Fast catalogue availability overlay.

The live StreamPortal-style verifier is useful for explicit checks, but running
provider HTTP probes for every card in every homepage/archive row makes page
loading depend on dozens of upstream requests. This overlay keeps those live
checks out of the rendering path:

- homepage/archive filtering uses the cached VixSrc ``lang=it`` catalogue only;
- the public batch availability endpoint is an in-memory/Mongo catalogue lookup;
- ordinary catalogue refresh calls return immediately from memory/Mongo and
  refresh upstream in the background instead of blocking a page request;
- the strict Italian episode policy remains installed and continues to hide
  English/original/unconfirmed TV episodes on season pages;
- explicit forced/admin checks can still use the existing live verifier.

No media URL is resolved or inspected here.
"""
from __future__ import annotations

import asyncio
import sys
import time
from typing import Any

from fastapi import Body

POLICY_VERSION = "fast-italian-catalog-v2"
BACKGROUND_REFRESH_SECONDS = 5 * 60
_INSTALLED = False


def _media_type(value: Any) -> str:
    return "tv" if str(value or "").lower() == "tv" else "movie"


def _ensure_local_catalog(core) -> dict[str, bool]:
    """Hydrate in-memory ids from Mongo without waiting for a remote refresh."""
    loaded: dict[str, bool] = {}
    store = getattr(core, "vixsrc_catalog", None)
    ids_map = getattr(core, "_vix_ids", None)
    if not isinstance(ids_map, dict):
        return {"movie": False, "tv": False}

    for kind in ("movie", "tv"):
        ids = ids_map.get(kind) or set()
        if not ids and store is not None:
            try:
                doc = store.find_one({"type": kind}, {"_id": 0, "ids": 1}) or {}
                raw_ids = doc.get("ids") or []
                ids = {int(value) for value in raw_ids if value is not None}
                if ids:
                    ids_map[kind] = ids
            except Exception:
                ids = set()
        loaded[kind] = bool(ids)
    return loaded


def _catalog_counts(core) -> dict[str, int]:
    ids_map = getattr(core, "_vix_ids", {}) or {}
    return {kind: len(ids_map.get(kind) or set()) for kind in ("movie", "tv")}


def _catalog_member(core, media_type: str, tmdb_id: int) -> bool:
    kind = _media_type(media_type)
    try:
        tmdb_id = int(tmdb_id)
    except Exception:
        return False

    try:
        blocklist = getattr(core, "_stream_blocklist", None)
        if blocklist and blocklist.is_blocked(kind, tmdb_id):
            return False
    except Exception:
        return False

    ids = (getattr(core, "_vix_ids", {}) or {}).get(kind) or set()
    return bool(ids) and tmdb_id in ids


def _remove_availability_routes(app) -> None:
    targets = {
        ("/api/public/availability", "POST"),
        ("/api/public/availability/{media_type}/{tmdb_id}", "GET"),
    }
    kept = []
    for route in app.router.routes:
        path = getattr(route, "path", None)
        methods = set(getattr(route, "methods", set()) or set())
        if any(path == target_path and method in methods for target_path, method in targets):
            continue
        kept.append(route)
    app.router.routes[:] = kept


def install_fast_catalog_availability(app, db) -> None:
    """Install after StreamPortal/strict-TV overlays so this is the render path."""
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    async def apply_fast_policy() -> None:
        core = sys.modules.get("server_core")
        if core is None or getattr(app.state, "fast_catalog_availability_applied", False):
            return

        _ensure_local_catalog(core)

        # Many public endpoints call refresh_vixsrc_catalog() before rendering.
        # Previously that could wait for a remote catalogue request on a cold or
        # stale cache. Keep normal calls local and schedule refresh in background;
        # force=True remains synchronous for explicit admin/background refreshes.
        original_refresh = getattr(core, "refresh_vixsrc_catalog", None)
        if callable(original_refresh) and not getattr(original_refresh, "_flixit_fast_cached_v2", False):
            refresh_state = {"last_scheduled": 0.0, "task": None}

            async def fast_refresh_vixsrc_catalog(force: bool = False):
                if force:
                    return await original_refresh(force=True)

                _ensure_local_catalog(core)
                now = time.monotonic()
                task = refresh_state.get("task")
                if (
                    now - float(refresh_state.get("last_scheduled") or 0.0) >= BACKGROUND_REFRESH_SECONDS
                    and (task is None or task.done())
                ):
                    refresh_state["last_scheduled"] = now
                    try:
                        task = asyncio.create_task(original_refresh(force=False))
                        refresh_state["task"] = task
                    except Exception:
                        pass
                return _catalog_counts(core)

            fast_refresh_vixsrc_catalog._flixit_fast_cached_v2 = True
            fast_refresh_vixsrc_catalog._original = original_refresh
            core.refresh_vixsrc_catalog = fast_refresh_vixsrc_catalog

        async def fast_filter_available(items: list, limit: int = 24) -> list:
            _ensure_local_catalog(core)
            wanted = max(1, int(limit or 24))
            out = []
            for item in items or []:
                try:
                    tmdb_id = int(item.get("tmdbId") or item.get("tmdb_id") or item.get("id"))
                except Exception:
                    continue
                kind = _media_type(item.get("type") or item.get("media_type"))
                if _catalog_member(core, kind, tmdb_id):
                    out.append(item)
                    if len(out) >= wanted:
                        break
            return out

        # Homepage, archive and other card rows call this helper. Keep them
        # independent from live provider latency.
        core.filter_available = fast_filter_available

        _remove_availability_routes(app)

        async def public_availability(payload: dict = Body(...)):
            raw_items = payload.get("items") if isinstance(payload, dict) else []
            if not isinstance(raw_items, list):
                raw_items = []
            loaded = _ensure_local_catalog(core)

            available = []
            unavailable = []
            seen = set()
            relevant_types = set()
            for item in raw_items[:200]:
                if not isinstance(item, dict):
                    continue
                try:
                    tmdb_id = int(item.get("id") or item.get("tmdbId") or item.get("tmdb_id"))
                except Exception:
                    continue
                kind = _media_type(item.get("type") or item.get("media_type"))
                key = (kind, tmdb_id)
                if tmdb_id <= 0 or key in seen:
                    continue
                seen.add(key)
                relevant_types.add(kind)
                row = {"type": kind, "id": tmdb_id}
                if _catalog_member(core, kind, tmdb_id):
                    available.append(row)
                elif loaded.get(kind):
                    unavailable.append(row)

            catalog_loaded = (
                all(loaded.get(kind, False) for kind in relevant_types)
                if relevant_types
                else all(loaded.values())
            )
            return {
                "available": available,
                "unavailable": unavailable,
                "pending": [],
                "catalog_loaded": catalog_loaded,
                "catalog_loaded_by_type": loaded,
                "verified_count": len(available) + len(unavailable),
                "policy": POLICY_VERSION,
                "render_path": "cached_italian_catalog",
            }

        async def public_single_availability(media_type: str, tmdb_id: int):
            kind = _media_type(media_type)
            loaded = _ensure_local_catalog(core)
            is_loaded = bool(loaded.get(kind))
            return {
                "available": is_loaded and _catalog_member(core, kind, int(tmdb_id)),
                "verified": is_loaded,
                "catalog_loaded": is_loaded,
                "policy": POLICY_VERSION,
                "render_path": "cached_italian_catalog",
            }

        app.add_api_route(
            "/api/public/availability",
            public_availability,
            methods=["POST"],
            tags=["catalog"],
            name="fast_catalog_availability_batch",
        )
        app.add_api_route(
            "/api/public/availability/{media_type}/{tmdb_id}",
            public_single_availability,
            methods=["GET"],
            tags=["catalog"],
            name="fast_catalog_availability_single",
        )

        try:
            core.clear_response_cache()
        except Exception:
            pass

        app.state.fast_catalog_availability_applied = True
        app.state.fast_catalog_availability_policy = POLICY_VERSION

    # Registered after the live/strict overlays, so this startup hook runs last
    # and only changes the card-rendering/availability path.
    app.add_event_handler("startup", apply_fast_policy)


__all__ = [
    "install_fast_catalog_availability",
    "POLICY_VERSION",
    "_ensure_local_catalog",
    "_catalog_member",
]
