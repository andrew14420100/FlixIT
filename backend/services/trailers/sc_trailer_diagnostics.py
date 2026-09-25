"""Safe diagnostics for StreamingCommunity trailer metadata discovery.

This module never resolves movie/episode playback streams and never exposes
signed media URLs. It only reports whether public SC title metadata was reached,
whether the TMDB id matched, and whether trailer rows / youtube_id fields exist.
"""
from __future__ import annotations

import asyncio
from typing import Any

from .providers.common import client
from .providers import streamingcommunity as sc_module

DIAG_BASE_LIMIT = 4
DIAG_CATALOG_PATH_LIMIT = 8
DIAG_SEARCH_QUERY_LIMIT = 3
DIAG_SEARCH_ROW_LIMIT = 24
DIAG_REQUEST_TIMEOUT = 2.5


def _trailer_rows_raw(title: dict) -> list[dict]:
    rows = title.get("trailers") if isinstance(title, dict) else None
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _youtube_count(title: dict) -> int:
    count = 0
    for row in _trailer_rows_raw(title):
        value = str(row.get("youtube_id") or row.get("youtubeId") or "").strip()
        if value:
            count += 1
    return count


async def _title(provider, http, base: str, path: str):
    try:
        return await asyncio.wait_for(
            provider._title(http, base, path),
            timeout=DIAG_REQUEST_TIMEOUT,
        )
    except Exception:
        return ({}, f"{base}{path}")


async def _search(provider, http, base: str, query: str):
    try:
        return await asyncio.wait_for(
            provider._search(http, base, query),
            timeout=DIAG_REQUEST_TIMEOUT,
        )
    except Exception:
        return []


async def diagnose_sc_title(provider, identity: dict) -> dict[str, Any]:
    expected_tmdb = sc_module._int_or_none(identity.get("tmdbId"))
    bases = provider._ordered_bases()[:DIAG_BASE_LIMIT]
    paths = sc_module._catalog_detail_paths(identity)[:DIAG_CATALOG_PATH_LIMIT]
    queries = sc_module._query_variants(identity)[:DIAG_SEARCH_QUERY_LIMIT]

    diag: dict[str, Any] = {
        "expected_tmdb": expected_tmdb,
        "bases": bases,
        "catalog_paths": len(paths),
        "catalog_pages_parsed": 0,
        "catalog_exact_tmdb": 0,
        "search_queries": queries,
        "search_responses": 0,
        "search_rows": 0,
        "detail_pages_parsed": 0,
        "detail_exact_tmdb": 0,
        "exact_title_id": None,
        "exact_title_slug": None,
        "trailer_rows": 0,
        "youtube_id_rows": 0,
        "playable_candidate_rows": 0,
        "result": "no_exact_title",
    }
    if not expected_tmdb:
        diag["result"] = "missing_tmdb"
        return diag

    async with client() as http:
        # First inspect local-catalog title paths against the currently ordered mirrors.
        jobs = [(base, path) for path in paths for base in bases]
        if jobs:
            details = await asyncio.gather(
                *(_title(provider, http, base, path) for base, path in jobs),
                return_exceptions=False,
            )
            for (base, _path), (title, provider_page) in zip(jobs, details):
                if not title:
                    continue
                diag["catalog_pages_parsed"] += 1
                tmdb = sc_module._int_or_none(title.get("tmdb_id") or title.get("tmdbId"))
                if tmdb != expected_tmdb:
                    continue
                diag["catalog_exact_tmdb"] += 1
                diag["exact_title_id"] = title.get("id")
                diag["exact_title_slug"] = title.get("slug")
                raw_rows = _trailer_rows_raw(title)
                diag["trailer_rows"] = max(diag["trailer_rows"], len(raw_rows))
                diag["youtube_id_rows"] = max(diag["youtube_id_rows"], _youtube_count(title))
                try:
                    playable = provider._candidates_for_title(
                        identity=identity,
                        expected_tmdb=expected_tmdb,
                        title=title,
                        provider_page=provider_page,
                        base=base,
                        discovery="diagnostic-catalog",
                    )
                except Exception:
                    playable = []
                diag["playable_candidate_rows"] = max(diag["playable_candidate_rows"], len(playable or []))
                diag["result"] = (
                    "candidate_available" if playable else
                    "youtube_id_present_but_not_candidate" if diag["youtube_id_rows"] else
                    "trailers_present_no_youtube_id" if diag["trailer_rows"] else
                    "exact_title_has_no_trailers"
                )
                return diag

        # If the local catalogue missed, inspect public search results.
        search_jobs = [(base, query) for query in queries for base in bases]
        search_results = await asyncio.gather(
            *(_search(provider, http, base, query) for base, query in search_jobs),
            return_exceptions=False,
        ) if search_jobs else []

        detail_jobs: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for (base, _query), rows in zip(search_jobs, search_results):
            if rows:
                diag["search_responses"] += 1
                diag["search_rows"] += len(rows)
            ranked = sorted(
                rows or [],
                key=lambda row: int(
                    sc_module._int_or_none(row.get("tmdb_id") or row.get("tmdbId")) == expected_tmdb
                ),
                reverse=True,
            )
            for row in ranked[:DIAG_SEARCH_ROW_LIMIT]:
                path = sc_module._detail_path(row)
                marker = (base, path or "")
                if not path or marker in seen:
                    continue
                seen.add(marker)
                detail_jobs.append((base, path))

        detail_jobs = detail_jobs[:48]
        details = await asyncio.gather(
            *(_title(provider, http, base, path) for base, path in detail_jobs),
            return_exceptions=False,
        ) if detail_jobs else []

        for (base, _path), (title, provider_page) in zip(detail_jobs, details):
            if not title:
                continue
            diag["detail_pages_parsed"] += 1
            tmdb = sc_module._int_or_none(title.get("tmdb_id") or title.get("tmdbId"))
            if tmdb != expected_tmdb:
                continue
            diag["detail_exact_tmdb"] += 1
            diag["exact_title_id"] = title.get("id")
            diag["exact_title_slug"] = title.get("slug")
            raw_rows = _trailer_rows_raw(title)
            diag["trailer_rows"] = len(raw_rows)
            diag["youtube_id_rows"] = _youtube_count(title)
            try:
                playable = provider._candidates_for_title(
                    identity=identity,
                    expected_tmdb=expected_tmdb,
                    title=title,
                    provider_page=provider_page,
                    base=base,
                    discovery="diagnostic-search",
                )
            except Exception:
                playable = []
            diag["playable_candidate_rows"] = len(playable or [])
            diag["result"] = (
                "candidate_available" if playable else
                "youtube_id_present_but_not_candidate" if diag["youtube_id_rows"] else
                "trailers_present_no_youtube_id" if diag["trailer_rows"] else
                "exact_title_has_no_trailers"
            )
            return diag

    if diag["catalog_pages_parsed"] == 0 and diag["detail_pages_parsed"] == 0:
        diag["result"] = "no_sc_title_page_parsed"
    elif diag["search_responses"] == 0 and not paths:
        diag["result"] = "no_sc_search_response"
    else:
        diag["result"] = "no_exact_tmdb_match"
    return diag


__all__ = ["diagnose_sc_title"]
