"""Unified non-TMDB artwork resolver for the public FLIX-IT UI.

The public UI never receives TMDB image URLs from this module. TMDB is used only
for title/year/external-id identity.

Visual goals:
- use real provider artwork, never synthesized title text;
- prefer artwork that already contains a title treatment;
- otherwise pair the best native artwork with a genuine transparent title logo;
- prefer the correct orientation, then the best native resolution;
- refresh the resolved bundle every 24 hours so new artwork can appear without a
  code deployment.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

import httpx

from services.trailers.base import confidence_for_identity
from services.trailers.providers.apple_tv import AppleTVTrailerProvider
from services.trailers.providers.common import client as provider_client, google_site_search, meta
from services.trailers.providers.prime_video import (
    _hydration as prime_hydration,
    _page_identity as prime_page_identity,
)

CACHE_TTL = timedelta(hours=24)
SOURCE_VERSION = "official-artwork-v3"
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


def _integer(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except Exception:
        return 0


def _apple_template(
    node: Any,
    *,
    width: int,
    height: int,
    image_format: str = "jpg",
) -> Optional[str]:
    if not isinstance(node, dict):
        return None
    raw = _safe_url(node.get("url"))
    if not raw:
        return None
    replacements = {
        "{w}": str(width),
        "{h}": str(height),
        "{f}": image_format,
        "{c}": "bb",
    }
    out = raw
    for key, value in replacements.items():
        out = out.replace(key, value)
    out = re.sub(r"\{[^}]+\}", str(max(width, height)), out)
    return _safe_url(out)


def _logo_from_apple_images(images: Any) -> Optional[str]:
    """Return only explicit transparent title-logo/treatment assets.

    Older code accepted every Apple image key containing the word ``title`` and
    then forced it to JPEG. That could turn opaque title cards into the white
    rectangles visible over FLIX-IT cards. Logos now keep transparency (PNG) and
    generic title images are never treated as logos.
    """
    if not isinstance(images, dict):
        return None
    candidates: list[dict] = []
    for key, node in images.items():
        lower = str(key or "").replace("_", "").replace("-", "").lower()
        is_logo = "logo" in lower or "titletreatment" in lower
        if not is_logo:
            continue
        if isinstance(node, dict) and node.get("url"):
            candidates.append(node)
    for node in candidates:
        url = _apple_template(node, width=1600, height=650, image_format="png")
        if url:
            return url
    return None


def _logo_locale_from_key(key: Any) -> str:
    text = str(key or "").strip().lower()
    match = re.search(r"\|([a-z]{2}(?:-[a-z]{2})?)$", text)
    if not match:
        return "neutral"
    lang = match.group(1)
    if lang == "it" or lang.startswith("it-"):
        return "it"
    if lang == "en" or lang.startswith("en-"):
        return "en"
    return "other"


def _source_rank(source: str) -> int:
    return {
        "netflix": 50,
        "apple_itunes_it": 45,
        "prime_video": 40,
        "imdb": 30,
        "metahub_logo": 20,
    }.get(str(source or ""), 0)


def _locale_rank(value: str) -> int:
    return {"it": 40, "en": 30, "neutral": 20, "unknown": 10, "other": 0}.get(
        str(value or "unknown"), 0
    )


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
        self.cache.create_index([("last_accessed_at", -1)])
        self.apple = AppleTVTrailerProvider()
        self._asset_client: Optional[httpx.AsyncClient] = None
        self._locks: dict[tuple[str, int], asyncio.Lock] = {}
        # Prevent a first uncached Home load from opening dozens of upstream
        # provider requests at once. Visible cards still win because their own
        # request is issued first by the frontend.
        self._provider_semaphore = asyncio.Semaphore(4)

    def _lock(self, media_type: str, tmdb_id: int) -> asyncio.Lock:
        key = (media_type, tmdb_id)
        lock = self._locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[key] = lock
        return lock

    def _http(self) -> httpx.AsyncClient:
        if self._asset_client is None or self._asset_client.is_closed:
            self._asset_client = httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=6.0),
                limits=httpx.Limits(max_connections=12, max_keepalive_connections=8),
                follow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
                    "Accept-Language": "it-IT,it;q=0.9,en;q=0.7",
                },
            )
        return self._asset_client

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

    async def _netflix(self, media_type: str, tmdb_id: int, *, force: bool = False) -> dict:
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
                    force_match=force,
                ),
                resolver.resolve(
                    media_type,
                    tmdb_id,
                    context="top10",
                    viewport="desktop",
                    profile_id="official-artwork",
                    preview=False,
                    force_match=force,
                ),
            )
        except Exception:
            return {}

        def asset(payload: dict, key: str) -> dict:
            raw = ((payload or {}).get(key) or {})
            url = _safe_url(raw.get("url"))
            if not url:
                return {}
            return {
                "url": url,
                "width": _integer(raw.get("native_width") or raw.get("width")),
                "height": _integer(raw.get("native_height") or raw.get("height")),
                "type": raw.get("type"),
                "key": raw.get("key"),
            }

        landscape = asset(home, "artwork")
        poster = asset(top10, "artwork")
        logo_asset = asset(home, "logo") or asset(top10, "logo")
        if not landscape and not poster and not logo_asset:
            return {}
        return {
            "source": "netflix",
            "landscape_url": landscape.get("url"),
            "poster_url": poster.get("url"),
            "logo_url": logo_asset.get("url"),
            "landscape_width": landscape.get("width"),
            "landscape_height": landscape.get("height"),
            "poster_width": poster.get("width"),
            "poster_height": poster.get("height"),
            "logo_locale": _logo_locale_from_key(logo_asset.get("key")) if logo_asset else None,
            "landscape_embedded_title_treatment": False,
            "poster_embedded_title_treatment": False,
            "netflix_id": (home or {}).get("netflix_id") or (top10 or {}).get("netflix_id"),
            "confidence": (home or {}).get("confidence") or (top10 or {}).get("confidence"),
        }

    async def _apple(self, identity: dict) -> dict:
        # The current token-less UTS catalog matcher is deterministic for movies.
        # TV titles keep flowing through Netflix/Prime/IMDb/MetaHub rather than
        # accepting an ambiguous Apple match.
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

                poster = next(
                    (
                        _apple_template(images.get(key), width=1200, height=1800)
                        for key in ("coverArt", "shelfImage", "previewFrame")
                        if _apple_template(images.get(key), width=1200, height=1800)
                    ),
                    None,
                )
                landscape = next(
                    (
                        _apple_template(images.get(key), width=1920, height=1080)
                        for key in ("coverArt16X9", "shelfImage", "previewFrame", "coverArt")
                        if _apple_template(images.get(key), width=1920, height=1080)
                    ),
                    None,
                )
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
                    "logo_locale": "it" if logo else None,
                    "landscape_width": 1920 if landscape else None,
                    "landscape_height": 1080 if landscape else None,
                    "poster_width": 1200 if poster else None,
                    "poster_height": 1800 if poster else None,
                    # Apple storefront art is a merchandising treatment rather
                    # than a plain production still; do not place a second logo
                    # on top of it on the static card.
                    "landscape_embedded_title_treatment": bool(landscape),
                    "poster_embedded_title_treatment": bool(poster),
                }
        except Exception:
            return {}

    async def _prime(self, identity: dict) -> dict:
        """Use only public Prime Video page artwork after strict title/year match."""
        query = f"{identity.get('title') or identity.get('original_title')} {identity.get('year') or ''}".strip()
        if not query:
            return {}
        try:
            results = await google_site_search(query, "primevideo.com", 5)
        except Exception:
            return {}
        if not results:
            return {}
        try:
            async with provider_client() as http:
                for result in results:
                    page_url = str(result.get("link") or "").strip()
                    if not page_url:
                        continue
                    try:
                        page = await http.get(page_url)
                    except Exception:
                        continue
                    if page.status_code != 200:
                        continue
                    hydration = prime_hydration(page.text)
                    matched_title, matched_year = prime_page_identity(page.text, hydration)
                    confidence = confidence_for_identity(
                        identity, matched_title, matched_year, identity.get("type")
                    )
                    if confidence < 0.90:
                        continue
                    artwork = _safe_url(
                        meta(page.text, "og:image")
                        or meta(page.text, "twitter:image")
                        or meta(page.text, "image")
                    )
                    if not artwork:
                        continue
                    return {
                        "source": "prime_video",
                        "provider_page": page_url,
                        "confidence": round(float(confidence), 4),
                        "poster_url": artwork,
                        "landscape_url": artwork,
                        "logo_url": None,
                        "logo_locale": None,
                        "landscape_width": 1600,
                        "landscape_height": 900,
                        "poster_width": 1600,
                        "poster_height": 900,
                        "landscape_embedded_title_treatment": True,
                        "poster_embedded_title_treatment": True,
                    }
        except Exception:
            return {}
        return {}

    async def _imdb(self, identity: dict) -> dict:
        imdb_id = str((identity.get("external_ids") or {}).get("imdb_id") or "").strip()
        if not re.fullmatch(r"tt\d+", imdb_id):
            return {}
        try:
            response = await self._http().post(
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
            width = _integer(image.get("width"))
            height = _integer(image.get("height"))
            return {
                "source": "imdb",
                "provider_id": imdb_id,
                "poster_url": url,
                "landscape_url": None,
                "logo_url": None,
                "logo_locale": None,
                "poster_width": width,
                "poster_height": height,
                "poster_embedded_title_treatment": True,
                "landscape_embedded_title_treatment": False,
            }
        except Exception:
            return {}

    async def _metahub_logo(self, identity: dict) -> dict:
        """Supplemental no-TMDB transparent logo source keyed by IMDb id.

        MetaHub's public image endpoints are widely used by Stremio clients. It
        is deliberately used only to complete a card with a title treatment; the
        underlying poster/backdrop continues to come from the primary providers.
        """
        imdb_id = str((identity.get("external_ids") or {}).get("imdb_id") or "").strip()
        if not re.fullmatch(r"tt\d+", imdb_id):
            return {}
        url = f"https://images.metahub.space/logo/medium/{imdb_id}/img"
        try:
            response = await self._http().head(url)
            if response.status_code >= 400:
                response = await self._http().get(url, headers={"Range": "bytes=0-0"})
            content_type = str(response.headers.get("content-type") or "").lower()
            if response.status_code not in (200, 206) or "image" not in content_type:
                return {}
            return {
                "source": "metahub_logo",
                "provider_id": imdb_id,
                "logo_url": url,
                "logo_locale": "unknown",
            }
        except Exception:
            return {}

    def _cached(self, media_type: str, tmdb_id: int) -> Optional[dict]:
        row = self.cache.find_one(
            {"type": media_type, "tmdbId": tmdb_id, "version": SOURCE_VERSION},
            {"_id": 0},
        ) or {}
        fetched_at = row.get("fetched_at")
        resolved = row.get("resolved")
        if not fetched_at or not isinstance(resolved, dict):
            return None
        try:
            dt = datetime.fromisoformat(str(fetched_at).replace("Z", "+00:00"))
            if not dt.tzinfo:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
        if dt < _now() - CACHE_TTL:
            return None
        self.cache.update_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {"$set": {"last_accessed_at": _iso_now()}},
        )
        return resolved

    async def _providers(self, identity: dict, media_type: str, tmdb_id: int, *, force: bool) -> list[dict]:
        async with self._provider_semaphore:
            netflix_task = self._netflix(media_type, tmdb_id, force=force)
            apple_task = self._apple(identity)
            prime_task = self._prime(identity)
            imdb_task = self._imdb(identity)
            metahub_task = self._metahub_logo(identity)
            rows = await asyncio.gather(
                netflix_task,
                apple_task,
                prime_task,
                imdb_task,
                metahub_task,
                return_exceptions=True,
            )
        return [row for row in rows if isinstance(row, dict) and row]

    @staticmethod
    def _choose_logo(providers: list[dict]) -> tuple[Optional[str], Optional[str], Optional[str]]:
        candidates = []
        for provider in providers:
            url = _safe_url(provider.get("logo_url"))
            if not url:
                continue
            candidates.append(
                (
                    _locale_rank(provider.get("logo_locale") or "unknown"),
                    _source_rank(provider.get("source")),
                    url,
                    provider.get("source"),
                    provider.get("logo_locale") or "unknown",
                )
            )
        if not candidates:
            return None, None, None
        candidates.sort(reverse=True)
        _lang, _src, url, source, locale = candidates[0]
        return url, source, locale

    @staticmethod
    def _visual_candidate(provider: dict, role: str, logo_url: Optional[str]) -> Optional[dict]:
        opposite = "poster" if role == "landscape" else "landscape"
        url = _safe_url(provider.get(f"{role}_url"))
        actual_role = role
        if not url:
            url = _safe_url(provider.get(f"{opposite}_url"))
            actual_role = opposite
        if not url:
            return None
        width = _integer(provider.get(f"{actual_role}_width"))
        height = _integer(provider.get(f"{actual_role}_height"))
        embedded = bool(provider.get(f"{actual_role}_embedded_title_treatment"))
        if width and height:
            ratio = width / max(1, height)
            correct_orientation = ratio >= 1.15 if role == "landscape" else ratio <= 0.90
            orientation_score = 2 if correct_orientation else 0
        else:
            orientation_score = 1
        complete = bool(embedded or logo_url)
        return {
            "url": url,
            "source": provider.get("source"),
            "width": width,
            "height": height,
            "embedded_title_treatment": embedded,
            "complete": complete,
            "orientation_score": orientation_score,
            "native_long_edge": max(width, height),
            "area": width * height,
        }

    def _choose_visual(self, providers: list[dict], role: str, logo_url: Optional[str]) -> Optional[dict]:
        candidates = [
            candidate
            for candidate in (self._visual_candidate(provider, role, logo_url) for provider in providers)
            if candidate
        ]
        if not candidates:
            return None
        # Completeness comes first: a card without a real title treatment must not
        # beat an equally valid titled asset. Within complete assets we then honor
        # the requested orientation and highest native resolution.
        return max(
            candidates,
            key=lambda row: (
                1 if row.get("complete") else 0,
                int(row.get("orientation_score") or 0),
                1 if row.get("embedded_title_treatment") else 0,
                int(row.get("native_long_edge") or 0),
                int(row.get("area") or 0),
                _source_rank(row.get("source")),
            ),
        )

    async def resolve(self, media_type: str, tmdb_id: int, *, force: bool = False) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        tmdb_id = int(tmdb_id)
        async with self._lock(media_type, tmdb_id):
            if not force:
                cached = self._cached(media_type, tmdb_id)
                if cached is not None:
                    return cached

            identity = await self.identity(media_type, tmdb_id)
            if not identity:
                return {
                    "active": False,
                    "type": media_type,
                    "tmdbId": tmdb_id,
                    "reason": "identity_unavailable",
                    "version": SOURCE_VERSION,
                }

            providers = await self._providers(identity, media_type, tmdb_id, force=force)
            logo_url, logo_source, logo_locale = self._choose_logo(providers)
            landscape = self._choose_visual(providers, "landscape", logo_url)
            poster = self._choose_visual(providers, "poster", logo_url)

            # Do not intentionally publish a logo-less clean card. When a
            # transparent logo exists it is composed by the frontend; otherwise
            # the chosen visual itself must carry the title treatment.
            def valid_visual(row: Optional[dict]) -> Optional[dict]:
                if not row:
                    return None
                if row.get("embedded_title_treatment") or logo_url:
                    return row
                return None

            landscape = valid_visual(landscape)
            poster = valid_visual(poster)
            if not landscape and poster:
                landscape = dict(poster)
            if not poster and landscape:
                poster = dict(landscape)

            resolved = {
                "active": bool(landscape or poster or logo_url),
                "type": media_type,
                "tmdbId": tmdb_id,
                "title": identity.get("title"),
                "year": identity.get("year"),
                "backdrop_url": (landscape or {}).get("url"),
                "poster_url": (poster or {}).get("url"),
                "logo_url": logo_url,
                "backdrop_source": (landscape or {}).get("source"),
                "poster_source": (poster or {}).get("source"),
                "logo_source": logo_source,
                "logo_locale": logo_locale,
                "backdrop_native_width": (landscape or {}).get("width"),
                "backdrop_native_height": (landscape or {}).get("height"),
                "poster_native_width": (poster or {}).get("width"),
                "poster_native_height": (poster or {}).get("height"),
                "backdrop_embedded_title_treatment": bool((landscape or {}).get("embedded_title_treatment")),
                "poster_embedded_title_treatment": bool((poster or {}).get("embedded_title_treatment")),
                "embedded_title_treatment": bool((landscape or {}).get("embedded_title_treatment")),
                "complete": bool(
                    (landscape and ((landscape or {}).get("embedded_title_treatment") or logo_url))
                    and (poster and ((poster or {}).get("embedded_title_treatment") or logo_url))
                ),
                "providers": [
                    {
                        "source": provider.get("source"),
                        "has_landscape": bool(provider.get("landscape_url")),
                        "has_poster": bool(provider.get("poster_url")),
                        "has_logo": bool(provider.get("logo_url")),
                    }
                    for provider in providers
                ],
                "policy": "complete-title-treatment_then-orientation_then-max-native_no-tmdb-images",
                "version": SOURCE_VERSION,
            }
            self.cache.update_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {
                    "$set": {
                        "type": media_type,
                        "tmdbId": tmdb_id,
                        "version": SOURCE_VERSION,
                        "resolved": resolved,
                        "fetched_at": _iso_now(),
                        "last_accessed_at": _iso_now(),
                    }
                },
                upsert=True,
            )
            return resolved

    async def refresh_daily(self, limit: int = 180) -> dict:
        """Refresh recently used artwork quietly in the background every day."""
        targets: list[tuple[str, int]] = []
        seen: set[tuple[str, int]] = set()
        rows = self.cache.find(
            {}, {"_id": 0, "type": 1, "tmdbId": 1, "last_accessed_at": 1}
        ).sort("last_accessed_at", -1).limit(max(1, min(int(limit), 500)))
        for row in rows:
            key = ("tv" if row.get("type") == "tv" else "movie", int(row.get("tmdbId") or 0))
            if key[1] and key not in seen:
                seen.add(key)
                targets.append(key)

        if len(targets) < limit:
            remaining = max(0, limit - len(targets))
            for row in self.db["contents"].find(
                {"available": {"$ne": False}}, {"_id": 0, "type": 1, "tmdbId": 1}
            ).limit(remaining):
                key = ("tv" if row.get("type") == "tv" else "movie", int(row.get("tmdbId") or 0))
                if key[1] and key not in seen:
                    seen.add(key)
                    targets.append(key)

        semaphore = asyncio.Semaphore(2)
        refreshed = 0
        failed = 0

        async def one(media_type: str, tmdb_id: int):
            nonlocal refreshed, failed
            async with semaphore:
                try:
                    await self.resolve(media_type, tmdb_id, force=True)
                    refreshed += 1
                except Exception:
                    failed += 1
                await asyncio.sleep(0.15)

        await asyncio.gather(*(one(media_type, tmdb_id) for media_type, tmdb_id in targets))
        return {"targets": len(targets), "refreshed": refreshed, "failed": failed}


__all__ = ["OfficialArtworkResolver", "SOURCE_VERSION"]