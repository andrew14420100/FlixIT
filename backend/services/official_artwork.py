"""Unified non-TMDB artwork resolver for the public FLIX-IT UI.

Visual source policy:
1. Netflix artwork from the already-configured authenticated artwork resolver.
2. Apple/iTunes public storefront artwork (Italy) when Netflix has no suitable asset.
3. IMDb primary artwork as a final official-source fallback.

TMDB is used only for title/year/external-id identity. TMDB image URLs and relative
TMDB image paths are never returned by this module.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

import httpx

from services.trailers.providers.apple_tv import AppleTVTrailerProvider
from services.trailers.providers.common import client as provider_client

CACHE_TTL = timedelta(days=7)
SOURCE_VERSION = "official-artwork-v1"
IMDB_GRAPHQL_URL = "https://api.graphql.imdb.com/"
IMDB_QUERY = r'''
query Artwork($id: ID!) {
  title(id: $id) {
    titleText { text }
    releaseYear { year }
    primaryImage { url width height }
  }
}
'''


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _now().isoformat()


def _year(value: Any) -> Optional[int]:
    match = re.search(r"(?:19|20)\d{2}", str(value or ""))
    return int(match.group(0)) if match else None


def _is_tmdb_url(value: Any) -> bool:
    return bool(re.search(r"(?:^|//)image\.tmdb\.org/", str(value or ""), re.I))


def _safe_url(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text or _is_tmdb_url(text):
        return None
    if not re.match(r"^https?://", text, re.I):
        return None
    return text


def _apple_template(node: Any, *, width: int, height: int) -> Optional[str]:
    if not isinstance(node, dict):
        return None
    raw = _safe_url(node.get("url"))
    if not raw:
        return None
    replacements = {
        "{w}": str(width),
        "{h}": str(height),
        "{f}": "jpg",
        "{c}": "bb",
    }
    out = raw
    for key, value in replacements.items():
        out = out.replace(key, value)
    # Apple occasionally adds extra numeric placeholders. Use the long edge
    # rather than leaving an invalid template in the browser.
    out = re.sub(r"\{[^}]+\}", str(max(width, height)), out)
    return _safe_url(out)


def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _logo_from_apple_images(images: Any) -> Optional[str]:
    if not isinstance(images, dict):
        return None
    preferred = []
    for key, node in images.items():
        lower = str(key or "").lower()
        if "logo" not in lower and "title" not in lower:
            continue
        if isinstance(node, dict) and node.get("url"):
            preferred.append(node)
    for node in preferred:
        url = _apple_template(node, width=1200, height=500)
        if url:
            return url
    return None


class OfficialArtworkResolver:
    def __init__(
        self,
        db,
        fetch_tmdb_data: Callable[..., Any],
        netflix_resolver_getter: Callable[[], Any],
    ):
        self.db = db
        self.fetch_tmdb_data = fetch_tmdb_data
        self.netflix_resolver_getter = netflix_resolver_getter
        self.cache = db["official_artwork_cache"]
        self.cache.create_index([("type", 1), ("tmdbId", 1)], unique=True)
        self.apple = AppleTVTrailerProvider()
        self._imdb_client: Optional[httpx.AsyncClient] = None
        self._locks: dict[tuple[str, int], asyncio.Lock] = {}

    def _lock(self, media_type: str, tmdb_id: int) -> asyncio.Lock:
        key = (media_type, tmdb_id)
        lock = self._locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[key] = lock
        return lock

    def _imdb_http(self) -> httpx.AsyncClient:
        if self._imdb_client is None or self._imdb_client.is_closed:
            self._imdb_client = httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=6.0),
                limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
                follow_redirects=True,
            )
        return self._imdb_client

    async def identity(self, media_type: str, tmdb_id: int) -> Optional[dict]:
        media_type = "tv" if media_type == "tv" else "movie"
        data = await self.fetch_tmdb_data(
            f"/{media_type}/{int(tmdb_id)}",
            {"append_to_response": "external_ids"},
        )
        if not data:
            return None
        external = data.get("external_ids") or {}
        return {
            "type": media_type,
            "tmdbId": int(tmdb_id),
            "title": data.get("title") or data.get("name") or "",
            "original_title": data.get("original_title") or data.get("original_name") or "",
            "year": _year(data.get("release_date") or data.get("first_air_date")),
            "external_ids": external,
        }

    async def _netflix(self, media_type: str, tmdb_id: int) -> dict:
        try:
            resolver = self.netflix_resolver_getter()
        except Exception:
            resolver = None
        if resolver is None:
            return {}
        try:
            home, top10 = await asyncio.gather(
                resolver.resolve(
                    media_type,
                    tmdb_id,
                    context="home",
                    viewport="desktop",
                    profile_id="official-artwork",
                    preview=False,
                ),
                resolver.resolve(
                    media_type,
                    tmdb_id,
                    context="top10",
                    viewport="desktop",
                    profile_id="official-artwork",
                    preview=False,
                ),
            )
        except Exception:
            return {}

        def asset_url(payload: dict, key: str) -> Optional[str]:
            return _safe_url(((payload or {}).get(key) or {}).get("url"))

        home_art = asset_url(home, "artwork")
        top_art = asset_url(top10, "artwork")
        logo = asset_url(home, "logo") or asset_url(top10, "logo")
        return {
            "source": "netflix",
            "landscape_url": home_art,
            "poster_url": top_art,
            "logo_url": logo,
            "netflix_id": (home or {}).get("netflix_id") or (top10 or {}).get("netflix_id"),
            "confidence": (home or {}).get("confidence") or (top10 or {}).get("confidence"),
        }

    async def _apple(self, identity: dict) -> dict:
        if identity.get("type") != "movie":
            return {}
        try:
            async with provider_client() as http:
                matched = await self.apple._match_store_movie(http, identity)
                if not matched:
                    return {}
                item, confidence = matched
                movie_id = str(item.get("id") or "")
                if not movie_id:
                    return {}

                detail = await self.apple._json(
                    http,
                    f"uts/v3/movies/{movie_id}",
                    includePreviewAssets="true",
                )
                content = ((detail or {}).get("data") or {}).get("content") or {}
                images = {}
                images.update(item.get("images") or {})
                images.update(content.get("images") or {})

                poster = None
                for key in ("coverArt", "shelfImage", "previewFrame"):
                    poster = _apple_template(images.get(key), width=1200, height=1800)
                    if poster:
                        break

                landscape = None
                for key in ("coverArt16X9", "shelfImage", "previewFrame", "coverArt"):
                    landscape = _apple_template(images.get(key), width=1920, height=1080)
                    if landscape:
                        break

                logo = _logo_from_apple_images(images)
                if not poster and not landscape and not logo:
                    return {}
                return {
                    "source": "apple_itunes_it",
                    "provider_id": movie_id,
                    "confidence": round(float(confidence or 0), 4),
                    "landscape_url": landscape,
                    "poster_url": poster,
                    "logo_url": logo,
                    # Apple coverArt commonly carries the title treatment inside
                    # the actual artwork. The UI must not synthesize text over it.
                    "embedded_title_treatment": True,
                }
        except Exception:
            return {}

    async def _imdb(self, identity: dict) -> dict:
        imdb_id = str((identity.get("external_ids") or {}).get("imdb_id") or "").strip()
        if not re.fullmatch(r"tt\d+", imdb_id):
            return {}
        try:
            response = await self._imdb_http().post(
                IMDB_GRAPHQL_URL,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Origin": "https://www.imdb.com",
                    "Referer": "https://www.imdb.com/",
                    "x-imdb-client-name": "imdb-web-next",
                },
                json={"query": IMDB_QUERY, "variables": {"id": imdb_id}},
            )
            if response.status_code != 200:
                return {}
            title = ((response.json().get("data") or {}).get("title") or {})
            image = title.get("primaryImage") or {}
            url = _safe_url(image.get("url"))
            if not url:
                return {}
            return {
                "source": "imdb",
                "provider_id": imdb_id,
                "poster_url": url,
                "landscape_url": None,
                "logo_url": None,
                "native_width": image.get("width"),
                "native_height": image.get("height"),
                "embedded_title_treatment": True,
            }
        except Exception:
            return {}

    def _cached_fallback(self, media_type: str, tmdb_id: int) -> Optional[dict]:
        row = self.cache.find_one(
            {"type": media_type, "tmdbId": tmdb_id, "version": SOURCE_VERSION},
            {"_id": 0},
        ) or {}
        fetched_at = row.get("fetched_at")
        if not fetched_at:
            return None
        try:
            dt = datetime.fromisoformat(str(fetched_at).replace("Z", "+00:00"))
            if not dt.tzinfo:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
        if dt < _now() - CACHE_TTL:
            return None
        return row.get("fallback") or {}

    async def _fallback(self, identity: dict, force: bool = False) -> dict:
        media_type = identity["type"]
        tmdb_id = int(identity["tmdbId"])
        if not force:
            cached = self._cached_fallback(media_type, tmdb_id)
            if cached is not None:
                return cached

        apple = await self._apple(identity)
        fallback = apple
        if not fallback or (not fallback.get("poster_url") and not fallback.get("landscape_url")):
            imdb = await self._imdb(identity)
            fallback = fallback or imdb
            if fallback and imdb:
                fallback = {
                    **imdb,
                    **{k: v for k, v in fallback.items() if v is not None},
                    "poster_url": fallback.get("poster_url") or imdb.get("poster_url"),
                    "landscape_url": fallback.get("landscape_url") or imdb.get("landscape_url"),
                    "logo_url": fallback.get("logo_url") or imdb.get("logo_url"),
                }

        self.cache.update_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {"$set": {
                "type": media_type,
                "tmdbId": tmdb_id,
                "version": SOURCE_VERSION,
                "fallback": fallback or {},
                "fetched_at": _iso_now(),
            }},
            upsert=True,
        )
        return fallback or {}

    async def resolve(self, media_type: str, tmdb_id: int, *, force: bool = False) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        tmdb_id = int(tmdb_id)
        async with self._lock(media_type, tmdb_id):
            identity = await self.identity(media_type, tmdb_id)
            if not identity:
                return {
                    "active": False,
                    "type": media_type,
                    "tmdbId": tmdb_id,
                    "reason": "identity_unavailable",
                }

            netflix = await self._netflix(media_type, tmdb_id)
            needs_fallback = not netflix.get("landscape_url") or not netflix.get("poster_url") or not netflix.get("logo_url")
            fallback = await self._fallback(identity, force=force) if needs_fallback else {}

            landscape = netflix.get("landscape_url") or fallback.get("landscape_url") or fallback.get("poster_url")
            poster = netflix.get("poster_url") or fallback.get("poster_url") or fallback.get("landscape_url")
            logo = netflix.get("logo_url") or fallback.get("logo_url")

            return {
                "active": bool(landscape or poster or logo),
                "type": media_type,
                "tmdbId": tmdb_id,
                "title": identity.get("title"),
                "year": identity.get("year"),
                "backdrop_url": landscape,
                "poster_url": poster,
                "logo_url": logo,
                "netflix": netflix,
                "fallback": fallback,
                "source": "netflix" if (netflix.get("landscape_url") or netflix.get("poster_url")) else fallback.get("source"),
                "embedded_title_treatment": bool(
                    not logo and fallback.get("embedded_title_treatment")
                ),
                "policy": "netflix_then_apple_then_imdb_no_tmdb_images",
                "version": SOURCE_VERSION,
            }


__all__ = ["OfficialArtworkResolver", "SOURCE_VERSION"]
