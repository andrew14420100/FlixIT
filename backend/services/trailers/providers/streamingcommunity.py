"""StreamingCommunity trailer metadata provider.

Reads only StreamingCommunity title/search metadata used to locate trailers for a
catalog title. It never resolves movie/episode playback streams. Candidates are
accepted only after the SC title TMDB id exactly matches FLIX-IT.

Supported trailer playback forms:
- direct trailer media explicitly exposed by SC (MP4/HLS/etc.);
- Vixcloud ``/embed/<id>`` URLs explicitly exposed by SC as trailer metadata.

Signed Vixcloud URLs are never generated or reverse engineered. They are stored
only for their published lifetime and refreshed from SC after expiry. Parameters
whose sole purpose is bypassing ads are not propagated.
"""
from __future__ import annotations

import html as html_lib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

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


def _is_vixcloud_embed(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except Exception:
        return False
    host = (parsed.hostname or "").lower().strip(".")
    if not (host == "vixcloud.co" or host.endswith(".vixcloud.co")):
        return False
    return bool(re.fullmatch(r"/embed/\d+/?", parsed.path or "", re.I))


def _sanitize_vixcloud_embed(value: str) -> Optional[str]:
    """Keep the SC-published signed embed but never propagate ad-bypass flags."""
    if not _is_vixcloud_embed(value):
        return None
    parsed = urlparse(value)
    query = [
        (key, val)
        for key, val in parse_qsl(parsed.query, keep_blank_values=True)
        if key.casefold() != "canbypassads"
    ]
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))


def _expiry_from_url(value: str) -> Optional[str]:
    """Read the published expiry timestamp without deriving or changing tokens."""
    try:
        parsed = urlparse(value)
        for key, val in parse_qsl(parsed.query, keep_blank_values=True):
            if key.casefold() != "expires":
                continue
            timestamp = int(val)
            expiry = datetime.fromtimestamp(timestamp, tz=timezone.utc)
            if expiry > datetime.now(timezone.utc):
                return expiry.isoformat()
    except Exception:
        return None
    return None


def _sc_trailer_playback_url(value: Any, base: Optional[str] = None) -> Optional[str]:
    """Accept explicit SC trailer media or an explicit Vixcloud trailer embed.

    Generic watch/embed pages remain rejected. Vixcloud is the sole iframe host
    accepted here because SC itself uses it for trailer playback metadata.
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

    vixcloud = _sanitize_vixcloud_embed(text)
    if vixcloud:
        return vixcloud

    try:
        parsed = urlparse(text)
    except Exception:
        return None
    path = (parsed.path or "").lower()
    query = (parsed.query or "").lower()

    # Do not accidentally turn movie/episode playback pages into trailers.
    if any(marker in path for marker in ("/watch/", "/iframe/", "/embed/")):
        return None

    direct_media = bool(re.search(r"\.(?:m3u8|mp4|webm|mov|m4v)(?:$|[?#])", text, re.I))
    explicit_trailer = any(marker in path for marker in ("/trailer/", "/trailers/", "/preview/", "/previews/"))
    explicit_query = any(marker in query for marker in ("trailer=", "preview="))
    return text if (direct_media or explicit_trailer or explicit_query) else None


# Backward-compatible alias used by existing tests/imports.
def _native_trailer_url(value: Any, base: Optional[str] = None) -> Optional[str]:
    return _sc_trailer_playback_url(value, base)


_TRAILER_MEDIA_FIELDS = (
    "url",
    "src",
    "embed",
    "embed_url",
    "embedUrl",
    "iframe",
    "iframe_url",
    "iframeUrl",
    "player_url",
    "playerUrl",
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


def _trailer_rows(title: dict, base: Optional[str] = None) -> list[tuple[dict, str]]:
    """Return every unique SC trailer playback URL exposed by title metadata."""
    found: list[tuple[dict, str]] = []
    seen: set[str] = set()

    trailers = title.get("trailers") or []
    if isinstance(trailers, dict):
        trailers = [trailers]
    if isinstance(trailers, list):
        for row in trailers:
            if not isinstance(row, dict):
                continue
            for key in _TRAILER_MEDIA_FIELDS:
                playback_url = _sc_trailer_playback_url(row.get(key), base)
                if playback_url and playback_url not in seen:
                    seen.add(playback_url)
                    found.append((row, playback_url))

    for key in (
        "trailerUrl",
        "trailer_url",
        "trailer",
        "trailerEmbed",
        "trailer_embed",
        "trailerEmbedUrl",
        "trailer_embed_url",
        "preview_video_url",
        "previewVideoUrl",
    ):
        playback_url = _sc_trailer_playback_url(title.get(key), base)
        if playback_url and playback_url not in seen:
            seen.add(playback_url)
            found.append(({}, playback_url))

    return found


def _trailer_row(title: dict, base: Optional[str] = None) -> tuple[Optional[dict], Optional[str]]:
    rows = _trailer_rows(title, base)
    return rows[0] if rows else (None, None)


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

                        self._working_base = base
                        trailer_rows = _trailer_rows(title, base)
                        if not trailer_rows:
                            return []

                        matched_year = _int_or_none(title.get("year") or title.get("release_year"))
                        candidates: list[TrailerCandidate] = []
                        for index, (trailer, playback_url) in enumerate(trailer_rows):
                            language = str(trailer.get("language") or trailer.get("locale") or "").strip() or None
                            is_hls = bool(re.search(r"\.m3u8(?:$|[?#])", playback_url, re.I))
                            is_vixcloud = _is_vixcloud_embed(playback_url)
                            candidates.append(
                                TrailerCandidate(
                                    source=self.name,
                                    trailer_url=None if is_hls else playback_url,
                                    manifest_url=playback_url if is_hls else None,
                                    provider_id=str(trailer.get("id") or f"{title.get('id') or expected_tmdb}:{index}"),
                                    provider_page=provider_page,
                                    matched_title=str(title.get("name") or title.get("title") or identity.get("title") or "").strip() or None,
                                    matched_year=matched_year,
                                    media_type=identity.get("type"),
                                    title=str(trailer.get("name") or trailer.get("title") or f"Trailer SC {index + 1}").strip(),
                                    trailer_type=str(trailer.get("type") or "Trailer").strip() or "Trailer",
                                    official=False,
                                    audio_language=language,
                                    confidence=1.0,
                                    verified=True,
                                    browser_compatible=True,
                                    compatibility=(
                                        "sc-vixcloud-embed"
                                        if is_vixcloud
                                        else "native-hls" if is_hls else "native-video"
                                    ),
                                    expires_at=_expiry_from_url(playback_url),
                                    metadata={
                                        "sc_title_id": title.get("id"),
                                        "sc_slug": title.get("slug"),
                                        "sc_base_url": base,
                                        "sc_trailer_index": index,
                                        "tmdb_match": "exact",
                                        "native_sc_trailer": True,
                                        "sc_vixcloud_embed": is_vixcloud,
                                    },
                                )
                            )
                        return candidates

                if base_responded:
                    continue

        return []
