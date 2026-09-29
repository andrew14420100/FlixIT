"""Keep the most likely playback targets hot without slowing catalogue requests."""
from __future__ import annotations

import asyncio
from typing import Any


WARM_LIMIT = 24
WARM_CONCURRENCY = 3
REFRESH_SECONDS = 45 * 60
_INSTALLED = False


def _media_type(item: Any) -> str:
    if not isinstance(item, dict):
        return "movie"
    return "tv" if str(item.get("type") or item.get("media_type") or "").lower() == "tv" else "movie"


def _id(item: Any) -> int:
    if not isinstance(item, dict):
        return 0
    try:
        return int(item.get("tmdbId") or item.get("tmdb_id") or item.get("id") or 0)
    except Exception:
        return 0


def _target(item: dict) -> tuple[str, int, int | None, int | None] | None:
    tmdb_id = _id(item)
    if tmdb_id <= 0:
        return None
    kind = _media_type(item)
    if kind == "movie":
        return ("movie", tmdb_id, None, None)

    watch = item.get("watch") if isinstance(item.get("watch"), dict) else {}
    try:
        season = max(1, int(watch.get("season") or item.get("season") or 1))
    except Exception:
        season = 1
    try:
        episode = max(1, int(watch.get("episode") or item.get("episode") or 1))
    except Exception:
        episode = 1
    return ("tv", tmdb_id, season, episode)


def _home_targets(core) -> list[tuple[str, int, int | None, int | None]]:
    try:
        from services import home_bootstrap as home
        payload, _generated = home._read_snapshot(core)
    except Exception:
        payload = None
    if not isinstance(payload, dict):
        return []

    values: list[dict] = []
    if isinstance(payload.get("hero"), dict):
        values.append(payload["hero"])
    for row in (payload.get("rows") or [])[:5]:
        if isinstance(row, dict):
            values.extend((row.get("items") or [])[:8])

    seen = set()
    targets = []
    for item in values:
        target = _target(item)
        if not target or target in seen:
            continue
        seen.add(target)
        targets.append(target)
        if len(targets) >= WARM_LIMIT:
            break
    return targets


async def _map_limit(values, limit, worker):
    cursor = 0

    async def run():
        nonlocal cursor
        while True:
            index = cursor
            cursor += 1
            if index >= len(values):
                return
            try:
                await worker(values[index])
            except Exception:
                pass

    if values:
        await asyncio.gather(*[run() for _ in range(min(limit, len(values)))])


def install_player_hot_warm(app, _db=None) -> bool:
    global _INSTALLED
    if _INSTALLED or getattr(app.state, "flixit_player_hot_warm_registered", False):
        return True
    _INSTALLED = True

    async def startup() -> None:
        import player
        import server_core as core

        async def one(target):
            media_type, tmdb_id, season, episode = target
            # By startup time strict_italian_media has patched player.resolve_stream,
            # so original-language movies/episodes are rejected here as well.
            await player.resolve_stream(media_type, tmdb_id, season, episode)

        async def warm_once():
            targets = await asyncio.to_thread(_home_targets, core)
            await _map_limit(targets, WARM_CONCURRENCY, one)

        async def loop():
            # Do not hold API startup for stream providers. Language policy warms
            # first; stream resolution follows entirely in background.
            await warm_once()
            while True:
                await asyncio.sleep(REFRESH_SECONDS)
                await warm_once()

        asyncio.create_task(loop())
        app.state.flixit_player_hot_warm = {
            "installed": True,
            "targets": "hero_plus_first_five_rows",
            "concurrency": WARM_CONCURRENCY,
            "refresh_seconds": REFRESH_SECONDS,
        }

    app.add_event_handler("startup", startup)
    app.state.flixit_player_hot_warm_registered = True
    return True


__all__ = ["install_player_hot_warm"]
