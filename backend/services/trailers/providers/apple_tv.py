from __future__ import annotations

import asyncio
import html as html_lib
import json
import re
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

from ..base import TrailerCandidate, confidence_for_identity, extract_year, normalize_title
from ..manifest import inspect_hls
from .common import client, google_site_search, meta

APPLE_UTS_BASE = "https://uts-api.itunes.apple.com/"
APPLE_IT_STOREFRONT = "143450"
APPLE_IT_LOCALE = "it-IT"
APPLE_CATALOG_TTL_SECONDS = 6 * 60 * 60
APPLE_REQUIRED_PARAMS_TTL_SECONDS = 6 * 60 * 60


def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _serialized(html: str) -> list[Any]:
    out = []
    for sid in ("serialized-server-data", "shoebox-uts-api-cache"):
        m = re.search(rf'<script[^>]+id=["\']{sid}["\'][^>]*>(.*?)</script>', html, re.I | re.S)
        if not m:
            continue
        try:
            out.append(json.loads(html_lib.unescape(m.group(1))))
        except Exception:
            pass
    return out


def _page_identity(html: str) -> tuple[str, int | None]:
    title = meta(html, "og:title") or ""
    title = re.split(r"[|–—]", title)[0].strip()
    year = None
    for root in _serialized(html):
        for row in _walk(root):
            if not title:
                title = str(row.get("title") or row.get("name") or "")
            year = year or extract_year(row.get("releaseDate") or row.get("release_date") or row.get("year"))
            if title and year:
                return title, year
    return title, year


def _trailers(html: str) -> list[dict]:
    found: list[dict] = []
    for root in _serialized(html):
        for row in _walk(root):
            hls = row.get("hlsUrl") or row.get("hlsURL")
            if hls:
                title = str(row.get("title") or row.get("name") or "Trailer")
                if any(word in normalize_title(title) for word in ("trailer", "teaser", "clip")):
                    found.append({"title": title, "hls": hls})
    og = meta(html, "og:video")
    if og and not found:
        found.append({"title": "Official Trailer", "hls": og})
    dedupe = {}
    for item in found:
        dedupe[item["hls"]] = item
    return list(dedupe.values())


def _release_year(value: Any) -> int | None:
    if isinstance(value, (int, float)):
        try:
            seconds = float(value) / 1000.0 if float(value) > 10_000_000_000 else float(value)
            return datetime.fromtimestamp(seconds, tz=timezone.utc).year
        except Exception:
            return None
    return extract_year(value)


def _is_italian(value: Any) -> bool:
    lang = str(value or "").strip().lower().replace("_", "-")
    return lang == "it" or lang.startswith("it-") or lang.startswith("ital")


def _uts_url(path: str, **extra: Any) -> str:
    params = {
        "caller": "web",
        "v": "58",
        "pfm": "web",
        "mfr": "Apple",
        "utsk": "0",
        "sf": APPLE_IT_STOREFRONT,
        "locale": APPLE_IT_LOCALE,
    }
    for key, value in extra.items():
        if value is not None:
            params[key] = str(value)
    return f"{APPLE_UTS_BASE}{path.lstrip('/')}?{urlencode(params)}"


def _collect_movies(payload: Any) -> list[dict]:
    out: dict[str, dict] = {}
    for row in _walk(payload):
        movie_id = str(row.get("id") or "")
        title = str(row.get("title") or "").strip()
        if row.get("type") != "Movie" or not movie_id.startswith("umc.cmc.") or not title:
            continue
        out[movie_id] = row
    return list(out.values())


def _collect_search_items(payload: Any, media_type: str) -> list[dict]:
    expected = "Show" if media_type == "tv" else "Movie"
    out: dict[str, dict] = {}
    for row in _walk(payload):
        item_id = str(row.get("id") or "").strip()
        title = str(row.get("title") or "").strip()
        if row.get("type") != expected or not item_id or not title:
            continue
        out[item_id] = row
    return list(out.values())


def _preview_hls_rows(data: dict) -> list[tuple[str, str]]:
    """Collect only public trailer/teaser preview HLS assets from Apple detail data."""
    rows: list[tuple[str, str]] = []
    canvas = (data or {}).get("canvas") or {}
    for shelf in canvas.get("shelves") or []:
        shelf_id = normalize_title(shelf.get("id") or "")
        shelf_title = normalize_title(shelf.get("title") or shelf.get("name") or "")
        trailer_shelf = any(word in f"{shelf_id} {shelf_title}" for word in ("trailer", "teaser", "preview"))
        if not trailer_shelf and str(shelf.get("id") or "") != "uts.col.Trailers":
            continue
        for item in shelf.get("items") or []:
            label = str(item.get("title") or item.get("name") or "Trailer")
            for playable in item.get("playables") or []:
                assets = playable.get("assets") or {}
                hls_url = str(assets.get("hlsUrl") or assets.get("hlsURL") or "").strip()
                if not hls_url:
                    continue
                if "/hls/subscription/" in hls_url:
                    continue
                rows.append((label, hls_url))

    # Some UTS payload revisions expose preview assets outside the trailer shelf.
    # Accept them only when the surrounding object is itself clearly trailer-like.
    for row in _walk(data):
        label = str(row.get("title") or row.get("name") or "")
        kind = normalize_title(f"{label} {row.get('type') or ''} {row.get('kind') or ''}")
        if not any(word in kind for word in ("trailer", "teaser", "preview")):
            continue
        hls_url = str(row.get("hlsUrl") or row.get("hlsURL") or "").strip()
        if not hls_url:
            assets = row.get("assets") or {}
            hls_url = str(assets.get("hlsUrl") or assets.get("hlsURL") or "").strip()
        if hls_url and "/hls/subscription/" not in hls_url:
            rows.append((label or "Trailer", hls_url))

    deduped: dict[str, tuple[str, str]] = {}
    for label, url in rows:
        deduped[url] = (label, url)
    return list(deduped.values())


class AppleTVTrailerProvider:
    """Official Apple Italy trailer provider.

    The primary path uses Apple's own UTS search with Italian storefront 143450
    and locale it-IT for both movies and TV shows. This avoids depending on an
    external Google Custom Search key just to discover the Apple title page.
    Only public, DRM-free preview/trailer HLS assets are accepted.
    """

    name = "apple_tv"

    def __init__(self):
        self._catalog: list[dict] | None = None
        self._catalog_at = 0.0
        self._catalog_lock = asyncio.Lock()
        self._required_params: dict[str, str] | None = None
        self._required_params_at = 0.0
        self._required_params_lock = asyncio.Lock()

    async def _json(self, http, path: str, **extra: Any) -> dict | None:
        try:
            response = await http.get(_uts_url(path, **extra), timeout=18.0)
            if response.status_code != 200:
                return None
            return response.json()
        except Exception:
            return None

    async def _get_required_params(self, http) -> dict[str, str]:
        now = time.monotonic()
        if self._required_params is not None and now - self._required_params_at < APPLE_REQUIRED_PARAMS_TTL_SECONDS:
            return self._required_params

        async with self._required_params_lock:
            now = time.monotonic()
            if self._required_params is not None and now - self._required_params_at < APPLE_REQUIRED_PARAMS_TTL_SECONDS:
                return self._required_params
            payload = await self._json(http, "uts/v3/configurations") or {}
            params = (
                (((payload.get("data") or {}).get("applicationProps") or {}).get("requiredParamsMap") or {}).get("Default")
                or {}
            )
            clean = {str(k): str(v) for k, v in params.items() if v is not None and str(v)}
            self._required_params = clean
            self._required_params_at = time.monotonic()
            return clean

    async def _json_native(self, http, path: str, **extra: Any) -> dict | None:
        params = await self._get_required_params(http)
        return await self._json(http, path, **params, **extra)

    async def _italian_catalog(self, http) -> list[dict]:
        now = time.monotonic()
        if self._catalog is not None and now - self._catalog_at < APPLE_CATALOG_TTL_SECONDS:
            return self._catalog

        async with self._catalog_lock:
            now = time.monotonic()
            if self._catalog is not None and now - self._catalog_at < APPLE_CATALOG_TTL_SECONDS:
                return self._catalog

            catalog: dict[str, dict] = {}

            def add(payload: Any) -> None:
                for item in _collect_movies(payload):
                    catalog.setdefault(str(item.get("id")), item)

            top = await self._json_native(http, "uts/v2/browse/collection/uts.col.ItunesCharts.chart.allMovies33")
            add((top or {}).get("data") or {})

            genres = await self._json_native(http, "uts/v3/mcp/genres")
            identifiers = [
                str(row.get("identifier"))
                for row in ((genres or {}).get("data") or {}).get("genres") or []
                if row.get("identifier")
            ]

            semaphore = asyncio.Semaphore(4)

            async def one(identifier: str):
                async with semaphore:
                    return await self._json_native(http, f"uts/v2/browse/genre/umc.gnr.mov.{identifier}")

            if identifiers:
                responses = await asyncio.gather(*(one(identifier) for identifier in identifiers), return_exceptions=True)
                for payload in responses:
                    if isinstance(payload, dict):
                        add((payload.get("data") or {}))

            self._catalog = list(catalog.values())
            self._catalog_at = time.monotonic()
            return self._catalog

    async def _native_search_match(self, http, identity: dict) -> tuple[dict, float] | None:
        media_type = "tv" if identity.get("type") == "tv" else "movie"
        titles = []
        for value in (identity.get("title"), identity.get("original_title")):
            text = str(value or "").strip()
            if text and text not in titles:
                titles.append(text)
        if not titles:
            return None

        expected_year = int(identity.get("year") or 0)
        ranked: list[tuple[float, int, dict]] = []
        seen: set[str] = set()
        for query in titles[:2]:
            payload = await self._json_native(http, "uts/v3/search", searchTerm=query)
            if not payload:
                continue
            for item in _collect_search_items((payload.get("data") or {}), media_type):
                item_id = str(item.get("id") or "")
                if item_id in seen:
                    continue
                seen.add(item_id)
                title = str(item.get("title") or "")
                if normalize_title(title) not in {normalize_title(x) for x in titles}:
                    continue
                year = _release_year(item.get("releaseDate") or item.get("release_date") or item.get("year"))
                confidence = confidence_for_identity(identity, title, year, media_type)
                if confidence < 0.90:
                    continue
                year_gap = abs((year or expected_year or 0) - (expected_year or year or 0))
                ranked.append((confidence, -year_gap, item))

        if not ranked and media_type == "movie":
            # Keep the old Italian catalogue scan as a movie-only safety net.
            for item in await self._italian_catalog(http):
                title = str(item.get("title") or "")
                if normalize_title(title) not in {normalize_title(x) for x in titles}:
                    continue
                year = _release_year(item.get("releaseDate"))
                confidence = confidence_for_identity(identity, title, year, "movie")
                if confidence < 0.90:
                    continue
                year_gap = abs((year or expected_year or 0) - (expected_year or year or 0))
                ranked.append((confidence, -year_gap, item))

        if not ranked:
            return None
        ranked.sort(key=lambda row: (row[0], row[1]), reverse=True)
        confidence, _gap, item = ranked[0]
        return item, confidence

    async def _native_store_candidates(self, http, identity: dict) -> list[TrailerCandidate]:
        matched = await self._native_search_match(http, identity)
        if not matched:
            return []
        item, initial_confidence = matched
        item_id = str(item.get("id") or "")
        if not item_id:
            return []

        media_type = "tv" if identity.get("type") == "tv" else "movie"
        path = "shows" if media_type == "tv" else "movies"
        detail_url = _uts_url(f"uts/v3/{path}/{item_id}", includePreviewAssets="true")
        params = await self._get_required_params(http)
        try:
            response = await http.get(_uts_url(f"uts/v3/{path}/{item_id}", **params, includePreviewAssets="true"), timeout=18.0)
            if response.status_code != 200:
                return []
            payload = response.json()
        except Exception:
            return []

        data = (payload or {}).get("data") or {}
        content = data.get("content") or {}
        matched_title = str(content.get("title") or item.get("title") or "")
        matched_year = _release_year(content.get("releaseDate") or item.get("releaseDate"))
        confidence = confidence_for_identity(identity, matched_title, matched_year, media_type)
        if confidence < 0.90:
            confidence = initial_confidence
        if confidence < 0.90:
            return []

        candidates: list[TrailerCandidate] = []
        for label, hls_url in _preview_hls_rows(data):
            if "/hls/subscription/" in hls_url:
                continue
            try:
                rows = await inspect_hls(
                    http,
                    hls_url,
                    source="apple_itunes_it",
                    confidence=confidence,
                    provider_id=item_id,
                    provider_page=detail_url,
                    matched_title=matched_title,
                    matched_year=matched_year,
                    trailer_type=label,
                    official=True,
                    default_language=None,
                )
            except Exception:
                continue
            # Do not infer Italian merely from the storefront. Only explicitly
            # tagged Italian audio is promoted as an Italian candidate.
            candidates.extend(row for row in rows if _is_italian(row.audio_language))
        return candidates

    async def _page_candidates(self, http, identity: dict) -> list[TrailerCandidate]:
        query = f"{identity.get('title') or identity.get('original_title')} {identity.get('year') or ''}".strip()
        pages: list[str] = []
        manual = ((identity.get("provider_pages") or {}).get("apple_tv") or "").strip()
        if manual:
            pages.append(manual)
        for result in await google_site_search(query, "tv.apple.com", 5):
            url = result.get("link")
            if url and url not in pages:
                pages.append(url)

        candidates: list[TrailerCandidate] = []
        for page_url in pages[:5]:
            try:
                response = await http.get(page_url)
                if response.status_code != 200:
                    continue
                page_title, page_year = _page_identity(response.text)
                confidence = confidence_for_identity(identity, page_title, page_year, identity.get("type"))
                if confidence < 0.90:
                    continue
                for trailer in _trailers(response.text):
                    rows = await inspect_hls(
                        http,
                        trailer["hls"],
                        source=self.name,
                        confidence=confidence,
                        provider_page=page_url,
                        matched_title=page_title,
                        matched_year=page_year,
                        trailer_type=trailer["title"],
                        official=True,
                        default_language=None,
                    )
                    candidates.extend(row for row in rows if _is_italian(row.audio_language))
            except Exception:
                continue
        return candidates

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        async with client() as http:
            candidates = await self._native_store_candidates(http, identity)
            if candidates:
                return candidates
            # Google page discovery remains only a last-resort compatibility path;
            # normal Apple Italia discovery no longer depends on Google API keys.
            return await self._page_candidates(http, identity)
