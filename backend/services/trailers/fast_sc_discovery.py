"""Bounded parallel fast-path for interactive StreamingCommunity trailer lookup.

The public detail endpoint gives a single title a short synchronous resolution
window. The legacy SC provider intentionally walks several mirrors and title
pages sequentially, which is appropriate for background jobs but can exceed that
window when one mirror is slow. This overlay tries the same public title metadata
in parallel with short per-request deadlines, then falls back to the original
provider for background completeness.

Interactive requests can opt into ``fast-only`` mode. In that mode a fast miss
returns immediately instead of entering the slow background scan. The API layer
then keeps/returns the previous cache state and queues the full scan separately.

It only reads title/search metadata. Movie/episode playback URLs are never
resolved here.
"""
from __future__ import annotations

import asyncio
from contextvars import ContextVar, Token

from .providers.common import client
from .providers import streamingcommunity as sc_module


_INSTALLED = False
_INTERACTIVE_FAST_ONLY: ContextVar[bool] = ContextVar(
    "flixit_sc_interactive_fast_only",
    default=False,
)
FAST_BASE_LIMIT = 4
FAST_CATALOG_PATH_LIMIT = 8
FAST_SEARCH_ROW_LIMIT = 24
FAST_REQUEST_TIMEOUT = 2.75


def begin_interactive_fast_only() -> Token:
    """Make SC discovery skip its slow fallback in the current async context."""
    return _INTERACTIVE_FAST_ONLY.set(True)


def end_interactive_fast_only(token: Token) -> None:
    _INTERACTIVE_FAST_ONLY.reset(token)


async def _bounded_title(provider, http, base: str, path: str):
    try:
        return await asyncio.wait_for(
            provider._title(http, base, path),
            timeout=FAST_REQUEST_TIMEOUT,
        )
    except Exception:
        return ({}, f"{base}{path}")


async def _bounded_search(provider, http, base: str, query: str):
    try:
        return await asyncio.wait_for(
            provider._search(http, base, query),
            timeout=FAST_REQUEST_TIMEOUT,
        )
    except Exception:
        return []


async def _catalog_fast(provider, http, identity: dict, expected_tmdb: int, bases: list[str]):
    paths = sc_module._catalog_detail_paths(identity)[:FAST_CATALOG_PATH_LIMIT]
    if not paths:
        return []

    # Interleave mirrors so the HTTP pool does not spend its whole first wave on
    # one dead host. The first connection batch therefore touches every mirror.
    jobs = [(base, path) for path in paths for base in bases]
    results = await asyncio.gather(
        *(_bounded_title(provider, http, base, path) for base, path in jobs),
        return_exceptions=False,
    )

    for (base, _path), (title, provider_page) in zip(jobs, results):
        if not title:
            continue
        candidates = provider._candidates_for_title(
            identity=identity,
            expected_tmdb=expected_tmdb,
            title=title,
            provider_page=provider_page,
            base=base,
            discovery="catalog-fast",
        )
        if candidates:
            provider._working_base = base
            return candidates
    return []


async def _search_fast(provider, http, identity: dict, expected_tmdb: int, bases: list[str]):
    queries = sc_module._query_variants(identity)
    if not queries:
        return []

    # Same mirror interleaving as the catalog pass: one slow domain cannot block
    # all other SC mirrors during the interactive deadline.
    search_jobs = [(base, query) for query in queries for base in bases]
    search_results = await asyncio.gather(
        *(_bounded_search(provider, http, base, query) for base, query in search_jobs),
        return_exceptions=False,
    )

    detail_jobs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for (base, _query), rows in zip(search_jobs, search_results):
        if not rows:
            continue
        ranked = sorted(
            rows,
            key=lambda row: int(
                sc_module._int_or_none(row.get("tmdb_id") or row.get("tmdbId")) == expected_tmdb
            ),
            reverse=True,
        )
        for row in ranked[:FAST_SEARCH_ROW_LIMIT]:
            path = sc_module._detail_path(row)
            marker = (base, path or "")
            if not path or marker in seen:
                continue
            seen.add(marker)
            detail_jobs.append((base, path))

    if not detail_jobs:
        return []

    # Prefer exact-TMDB search rows first, but cap the fan-out for ambiguous
    # franchises. Each request has its own short deadline.
    detail_jobs = detail_jobs[:48]
    details = await asyncio.gather(
        *(_bounded_title(provider, http, base, path) for base, path in detail_jobs),
        return_exceptions=False,
    )
    for (base, _path), (title, provider_page) in zip(detail_jobs, details):
        if not title:
            continue
        candidates = provider._candidates_for_title(
            identity=identity,
            expected_tmdb=expected_tmdb,
            title=title,
            provider_page=provider_page,
            base=base,
            discovery="search-fast",
        )
        if candidates:
            provider._working_base = base
            return candidates
    return []


def install_fast_sc_discovery() -> bool:
    global _INSTALLED
    if _INSTALLED:
        return True

    provider_cls = sc_module.StreamingCommunityTrailerProvider
    current = provider_cls.discover
    if getattr(current, "_flixit_fast_sc_discovery", False):
        _INSTALLED = True
        return True

    async def discover_fast_first(self, identity: dict):
        expected_tmdb = sc_module._int_or_none(identity.get("tmdbId"))
        if not expected_tmdb:
            if _INTERACTIVE_FAST_ONLY.get():
                return []
            return await current(self, identity)

        ordered = self._ordered_bases()
        bases = ordered[:FAST_BASE_LIMIT]
        try:
            async with client() as http:
                candidates = await _catalog_fast(self, http, identity, expected_tmdb, bases)
                if candidates:
                    return candidates
                candidates = await _search_fast(self, http, identity, expected_tmdb, bases)
                if candidates:
                    return candidates
        except Exception:
            pass

        # Interactive detail requests must never fall through to the many-host,
        # serial discovery pass. A worker is queued separately for that complete
        # scan, so a fast miss is not treated as proof that no trailer exists.
        if _INTERACTIVE_FAST_ONLY.get():
            return []
        return await current(self, identity)

    discover_fast_first._flixit_fast_sc_discovery = True
    discover_fast_first._original = current
    provider_cls.discover = discover_fast_first
    _INSTALLED = True
    return True


__all__ = [
    "install_fast_sc_discovery",
    "begin_interactive_fast_only",
    "end_interactive_fast_only",
]
