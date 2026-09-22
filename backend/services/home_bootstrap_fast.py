"""Compact first-paint view over the persistent Home snapshot.

The canonical Home builder still owns ordering, deduplication and artwork. This
module only trims the already-built payload before JSON serialization so the
browser can paint the Hero and first rows without downloading the entire Home.
"""
from __future__ import annotations

import inspect
import json
from typing import Any

from fastapi import APIRouter

FAST_ROWS = 8
FAST_ITEMS_PER_ROW = 18


def _route_endpoint(app, path: str):
    for route in reversed(getattr(app, "routes", [])):
        if getattr(route, "path", None) != path:
            continue
        methods = set(getattr(route, "methods", set()) or set())
        if not methods or "GET" in methods:
            return getattr(route, "endpoint", None)
    return None


def _unwrap(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    body = getattr(value, "body", None)
    try:
        if isinstance(body, bytes):
            parsed = json.loads(body.decode("utf-8"))
            return parsed if isinstance(parsed, dict) else {}
        if isinstance(body, str):
            parsed = json.loads(body)
            return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass
    return {}


def _compact(payload: dict) -> dict:
    rows = []
    source_rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    for row in source_rows[:FAST_ROWS]:
        if not isinstance(row, dict):
            continue
        rows.append({
            **row,
            "items": (row.get("items") if isinstance(row.get("items"), list) else [])[:FAST_ITEMS_PER_ROW],
        })

    return {
        **payload,
        "compact": True,
        "rows": rows,
        "row_count": len(rows),
        "total_row_count": int(payload.get("row_count") or len(source_rows)),
    }


def install_home_bootstrap_fast(app) -> bool:
    if getattr(app.state, "flixit_home_bootstrap_fast_registered", False):
        return True

    router = APIRouter()

    @router.get("/api/public/home-bootstrap-fast", tags=["catalog"])
    async def public_home_bootstrap_fast():
        endpoint = _route_endpoint(app, "/api/public/home-bootstrap")
        if not callable(endpoint):
            return {"compact": True, "hero": None, "rows": [], "row_count": 0, "total_row_count": 0}
        try:
            value = endpoint()
            if inspect.isawaitable(value):
                value = await value
            payload = _unwrap(value)
            return _compact(payload) if payload else {
                "compact": True,
                "hero": None,
                "rows": [],
                "row_count": 0,
                "total_row_count": 0,
            }
        except Exception:
            return {"compact": True, "hero": None, "rows": [], "row_count": 0, "total_row_count": 0}

    app.include_router(router)
    app.state.flixit_home_bootstrap_fast_registered = True
    return True


__all__ = ["install_home_bootstrap_fast", "FAST_ROWS", "FAST_ITEMS_PER_ROW"]
