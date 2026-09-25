"""Bounded parallel fast-path for interactive StreamingCommunity trailer lookup.

The public detail endpoint gives a single title a short synchronous resolution
window. The legacy SC provider intentionally walks several mirrors and title
pages sequentially, which is appropriate for background jobs but can exceed that
window when one mirror is slow. This overlay tries the same public title metadata
in parallel with short per-request deadlines, then falls back to the original
provider for background completeness.

It only reads title/search metadata. Movie/episode playback URLs are never
resolved here.
"""
from __future__ import annotations

import asyncio
from typing import Any

from .providers.common import client
from .providers import streamingcommunity as sc_module


_INSTALLED = False
FAST_BASE_LIMIT = 4
FAST_CATALOG_PATH_LIMIT = 8
FAST_SEARCH_ROW_LIMIT = 24
FAST_REQUEST_TIMEOUT = 2.75


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

    jobs = [(base, path) for base in bases for path in paths]
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

    search_jobs = [(base, query) for base in bases for query in queries]
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

    # Keep the interactive fan-out bounded even for very ambiguous franchises.
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

        return await current(self, identity)

    discover_fast_first._flixit_fast_sc_discovery = True
    discover_fast_first._original = current
    provider_cls.discover = discover_fast_first
    _INSTALLED = True
    return True


__all__ = ["install_fast_sc_discovery"]
