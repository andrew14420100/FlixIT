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


class AppleTVTrailerProvider:
    """Official Apple Italy trailer provider.

    The primary path follows the current Apple TV web backend documented by the
    e2iplayer Apple Trailers host: Italian storefront 143450 / locale it-IT,
    token-less UTS metadata, and only plain DRM-free iTunes Store preview HLS.
    Apple TV+ subscription/DRM preview playlists are deliberately ignored.
    """

    name = "apple_tv"

    def __init__(self):
        self._catalog: list[dict] | None = None
        self._catalog_at = 0.0
        self._catalog_lock = asyncio.Lock()

    async def _json(self, http, path: str, **extra: Any) -> dict | None:
        try:
            response = await http.get(_uts_url(path, **extra), timeout=18.0)
            if response.status_code != 200:
                return None
            return response.json()
        except Exception:
            return None

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

            top = await self._json(http, "uts/v2/browse/collection/uts.col.ItunesCharts.chart.allMovies33")
            add((top or {}).get("data") or {})

            genres = await self._json(http, "uts/v3/mcp/genres")
            identifiers = [
                str(row.get("identifier"))
                for row in ((genres or {}).get("data") or {}).get("genres") or []
                if row.get("identifier")
            ]

            semaphore = asyncio.Semaphore(4)

            async def one(identifier: str):
                async with semaphore:
                    return await self._json(http, f"uts/v2/browse/genre/umc.gnr.mov.{identifier}")

            if identifiers:
                rows = await asyncio.gather(*(one(identifier) for identifier in identifiers), return_exceptions=True)
                for payload in rows:
                    if isinstance(payload, dict):
                        add((payload.get("data") or {}))

            self._catalog = list(catalog.values())
            self._catalog_at = time.monotonic()
            return self._catalog

    async def _match_store_movie(self, http, identity: dict) -> tuple[dict, float] | None:
        if identity.get("type") != "movie":
            return None
        wanted = {
            normalize_title(identity.get("title")),
            normalize_title(identity.get("original_title")),
        }
        wanted.discard("")
        if not wanted:
            return None

        ranked: list[tuple[float, int, dict]] = []
        expected_year = int(identity.get("year") or 0)
        for item in await self._italian_catalog(http):
            title = str(item.get("title") or "")
            if normalize_title(title) not in wanted:
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

    async def _itunes_store_candidates(self, http, identity: dict) -> list[TrailerCandidate]:
        matched = await self._match_store_movie(http, identity)
        if not matched:
            return []
        item, initial_confidence = matched
        movie_id = str(item.get("id") or "")
        if not movie_id:
            return []

        detail_url = _uts_url(f"uts/v3/movies/{movie_id}", includePreviewAssets="true")
        try:
            response = await http.get(detail_url, timeout=18.0)
            if response.status_code != 200:
                return []
            payload = response.json()
        except Exception:
            return []

        data = (payload or {}).get("data") or {}
        content = data.get("content") or {}
        matched_title = str(content.get("title") or item.get("title") or "")
        matched_year = _release_year(content.get("releaseDate") or item.get("releaseDate"))
        confidence = confidence_for_identity(identity, matched_title, matched_year, "movie")
        if confidence < 0.90:
            confidence = initial_confidence
        if confidence < 0.90:
            return []

        hls_rows: list[tuple[str, str]] = []
        for shelf in ((data.get("canvas") or {}).get("shelves") or []):
            if str(shelf.get("id") or "") != "uts.col.Trailers":
                continue
            for trailer in shelf.get("items") or []:
                label = str(trailer.get("title") or "Trailer")
                for playable in trailer.get("playables") or []:
                    hls_url = str(((playable.get("assets") or {}).get("hlsUrl") or "")).strip()
                    if not hls_url:
                        continue
                    # Only the plain DRM-free iTunes Store preview HLS. Apple TV+
                    # subscription previews are intentionally excluded.
                    if "/hls/playlist.m3u8" not in hls_url or "/hls/subscription/" in hls_url:
                        continue
                    hls_rows.append((label, hls_url))

        candidates: list[TrailerCandidate] = []
        seen: set[str] = set()
        for label, hls_url in hls_rows:
            if hls_url in seen:
                continue
            seen.add(hls_url)
            try:
                rows = await inspect_hls(
                    http,
                    hls_url,
                    source="apple_itunes_it",
                    confidence=confidence,
                    provider_id=movie_id,
                    provider_page=detail_url,
                    matched_title=matched_title,
                    matched_year=matched_year,
                    trailer_type=label,
                    official=True,
                    default_language=APPLE_IT_LOCALE,
                )
            except Exception:
                continue
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
                        default_language=APPLE_IT_LOCALE if "/it/" in page_url.lower() else None,
                    )
                    candidates.extend(row for row in rows if _is_italian(row.audio_language))
            except Exception:
                continue
        return candidates

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        async with client() as http:
            candidates = await self._itunes_store_candidates(http, identity)
            if candidates:
                return candidates
            return await self._page_candidates(http, identity)
