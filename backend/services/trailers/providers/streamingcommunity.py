"""StreamingCommunity native trailer metadata provider.

This provider intentionally reads only public title/search metadata used to locate
the trailer associated with a title. It never requests movie/episode playback
sources. A candidate is accepted only after the SC title page TMDB id exactly
matches the FLIX-IT identity and SC exposes a direct non-YouTube trailer media
URL (for example MP4/HLS or an explicitly named trailer/preview URL).
"""
from __future__ import annotations

import html as html_lib
import json
import os
import re
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

from ..base import TrailerCandidate, is_blocked_url
from .common import client


DEFAULT_BASE_URLS = (
    "https://streamingcommunityz.tax",
    "https://streamingcommunityz.ninja",
    "https://streamingunity.vip",
    "https://streamingunity.co",
    "https://streamingunity.biz",
    "https://streamingunity.so",
    "https://streamingunity.to",
)


def _base_urls() -> list[str]:
    configured = [
        os.environ.get("SC_BASE_URL"),
        os.environ.get("STREAMINGCOMMUNITY_BASE_URL"),
    ]
    out: list[str] = []
    for value in [*configured, *DEFAULT_BASE_URLS]:
        text = str(value or "").strip().rstrip("/")
        if text and text not in out:
            out.append(text)
    return out


def _int_or_none(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _inertia_page(document: str) -> Optional[dict]:
    """Decode the JSON stored in the Inertia ``data-page`` HTML attribute."""
    match = re.search(r"\bdata-page\s*=\s*([\"'])(.*?)\1", document or "", re.I | re.S)
    if not match:
        return None
    try:
        return json.loads(html_lib.unescape(match.group(2)))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _search_rows(payload: Any) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    rows: Any = payload.get("data")
    if isinstance(rows, dict):
        rows = rows.get("data") or rows.get("titles") or rows.get("results")
    if rows is None:
        rows = payload.get("results") or payload.get("titles")
    return [row for row in (rows or []) if isinstance(row, dict)] if isinstance(rows, list) else []


def _detail_path(row: dict) -> Optional[str]:
    row_id = _int_or_none(row.get("id") or row.get("title_id"))
    slug = str(row.get("slug") or "").strip().strip("/")
    if row_id and slug:
        return f"/it/titles/{row_id}-{slug}"
    url = str(row.get("url") or row.get("href") or "").strip()
    if url:
        try:
            path = urlparse(url).path
        except Exception:
            path = ""
        if "/it/titles/" in path:
            return path
    return None


def _title_payload(page: dict) -> dict:
    props = page.get("props") if isinstance(page, dict) else None
    if not isinstance(props, dict):
        return {}
    title = props.get("title")
    return title if isinstance(title, dict) else {}


def _native_trailer_url(value: Any, base: Optional[str] = None) -> Optional[str]:
    """Return only direct, non-YouTube media that is clearly trailer/preview data.

    This deliberately rejects generic watch/embed/iframe URLs so the trailer
    resolver can never drift into movie/episode playback extraction.
    """
    text = str(value or "").strip()
    if not text:
        return None

    if text.startswith("/"):
        if not base:
            return None
        text = urljoin(f"{base.rstrip('/')}/", text)
    if not re.match(r"^https?://", text, re.I):
        return None
    if is_blocked_url(text):
        return None

    try:
        parsed = urlparse(text)
    except Exception:
        return None
    path = (parsed.path or "").lower()
    query = (parsed.query or "").lower()

    # Never treat title/movie playback pages as trailers.
    if any(marker in path for marker in ("/watch/", "/iframe/", "/embed/")):
        return None

    direct_media = bool(re.search(r"\.(?:m3u8|mp4|webm|mov|m4v)(?:$|[?#])", text, re.I))
    explicit_trailer = any(marker in path for marker in ("/trailer/", "/trailers/", "/preview/", "/previews/"))
    explicit_query = any(marker in query for marker in ("trailer=", "preview="))
    return text if (direct_media or explicit_trailer or explicit_query) else None


def _trailer_row(title: dict, base: Optional[str] = None) -> tuple[Optional[dict], Optional[str]]:
    trailers = title.get("trailers") or []
    if isinstance(trailers, dict):
        trailers = [trailers]

    fields = (
        "url",
        "src",
        "video_url",
        "videoUrl",
        "manifest_url",
        "manifestUrl",
        "mp4_url",
        "mp4Url",
        "hls_url",
        "hlsUrl",
        "file",
        "file_url",
        "fileUrl",
    )
    if isinstance(trailers, list):
        for row in trailers:
            if not isinstance(row, dict):
                continue
            for key in fields:
                native_url = _native_trailer_url(row.get(key), base)
                if native_url:
                    return row, native_url

    # Only trailer-specific title fields are considered. SC's current
    # ``trailerUrl`` is normally YouTube and is therefore rejected here.
    for key in ("trailerUrl", "trailer_url", "trailer", "preview_video_url", "previewVideoUrl"):
        native_url = _native_trailer_url(title.get(key), base)
        if native_url:
            return {}, native_url
    return None, None


class StreamingCommunityTrailerProvider:
    name = "streamingcommunity"

    def __init__(self):
        self._working_base: Optional[str] = None

    def _ordered_bases(self) -> list[str]:
        bases = _base_urls()
        if self._working_base and self._working_base in bases:
            return [self._working_base, *[x for x in bases if x != self._working_base]]
        return bases

    async def _search(self, http, base: str, query: str) -> list[dict]:
        response = await http.get(
            f"{base}/it/search",
            params={"q": query},
            headers={"Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest"},
        )
        if response.status_code != 200:
            return []
        try:
            return _search_rows(response.json())
        except Exception:
            return []

    async def _title(self, http, base: str, path: str) -> tuple[dict, str]:
        url = f"{base}{path if path.startswith('/') else '/' + path}"
        response = await http.get(url, headers={"Accept": "text/html,application/xhtml+xml"})
        if response.status_code != 200:
            return {}, url
        page = _inertia_page(response.text)
        return _title_payload(page or {}), str(response.url)

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        expected_tmdb = _int_or_none(identity.get("tmdbId"))
        if not expected_tmdb:
            return []

        queries: list[str] = []
        for value in (identity.get("title"), identity.get("original_title")):
            text = str(value or "").strip()
            if text and text.casefold() not in {x.casefold() for x in queries}:
                queries.append(text)
        if not queries:
            return []

        async with client() as http:
            for base in self._ordered_bases():
                seen_paths: set[str] = set()
                base_responded = False
                for query in queries:
                    try:
                        rows = await self._search(http, base, query)
                        base_responded = base_responded or bool(rows)
                    except Exception:
                        rows = []

                    for row in rows[:16]:
                        path = _detail_path(row)
                        if not path or path in seen_paths:
                            continue
                        seen_paths.add(path)
                        try:
                            title, provider_page = await self._title(http, base, path)
                        except Exception:
                            continue
                        if not title:
                            continue
                        if _int_or_none(title.get("tmdb_id") or title.get("tmdbId")) != expected_tmdb:
                            continue

                        trailer, native_url = _trailer_row(title, base)
                        if not native_url:
                            self._working_base = base
                            return []

                        self._working_base = base
                        trailer = trailer or {}
                        language = str(trailer.get("language") or trailer.get("locale") or "").strip() or None
                        matched_year = _int_or_none(title.get("year") or title.get("release_year"))
                        is_hls = bool(re.search(r"\.m3u8(?:$|[?#])", native_url, re.I))
                        return [
                            TrailerCandidate(
                                source=self.name,
                                trailer_url=None if is_hls else native_url,
                                manifest_url=native_url if is_hls else None,
                                provider_id=str(trailer.get("id") or native_url),
                                provider_page=provider_page,
                                matched_title=str(title.get("name") or title.get("title") or identity.get("title") or "").strip() or None,
                                matched_year=matched_year,
                                media_type=identity.get("type"),
                                title=str(trailer.get("name") or trailer.get("title") or "Trailer SC").strip(),
                                trailer_type="Trailer",
                                official=False,
                                audio_language=language,
                                confidence=1.0,
                                verified=True,
                                browser_compatible=True,
                                compatibility="native-hls" if is_hls else "native-video",
                                metadata={
                                    "sc_title_id": title.get("id"),
                                    "sc_slug": title.get("slug"),
                                    "sc_base_url": base,
                                    "tmdb_match": "exact",
                                    "native_sc_trailer": True,
                                },
                            )
                        ]

                # If the domain answered search successfully but no exact title
                # matched, try the next configured mirror before giving up.
                if base_responded:
                    continue

        return []
