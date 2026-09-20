"""StreamingCommunity-first card artwork policy for FLIX-IT.

Static catalogue cards keep the strict rule introduced for the Netflix-like UI:
- no separate logo is composited on the static card;
- the visible title treatment must already be inside the selected artwork;
- StreamingCommunity is queried dynamically for every TMDB title and is the
  preferred source for both normal cards and Top 10 cards;
- existing official providers remain available as fallback when SC has no
  reliable match;
- TMDB is used only for identity metadata, never as the final image host.
"""
from __future__ import annotations

import asyncio
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any, Optional

import services.official_artwork as artwork_module
from services.official_artwork import OfficialArtworkResolver

POLICY_VERSION = "official-artwork-v6-sc-covers"
SC_SEARCH_API = "https://streamingcommunityz.ninja/api/search"
SC_CDN_BASE = "https://cdn.streamingcommunityz.ninja/images/"
_INSTALLED = False


def _safe_url(value: Any) -> Optional[str]:
    return artwork_module._safe_url(value)


def _integer(value: Any) -> int:
    return artwork_module._integer(value)


def _normalize_title(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip().lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _extract_year(value: Any) -> Optional[int]:
    match = re.search(r"(?:19|20)\d{2}", str(value or ""))
    return int(match.group(0)) if match else None


def _row_year(row: dict) -> Optional[int]:
    for key in ("year", "release_date", "first_air_date", "date", "last_air_date"):
        value = _extract_year(row.get(key))
        if value:
            return value
    return None


def _row_media_type(row: dict) -> Optional[str]:
    raw = str(
        row.get("media_type")
        or row.get("type")
        or row.get("content_type")
        or ""
    ).strip().lower()
    if not raw:
        return None
    if raw in {"tv", "series", "serie", "show", "serie-tv", "tv-show"} or "serie" in raw:
        return "tv"
    if raw in {"movie", "film", "cinema"} or "film" in raw:
        return "movie"
    return None


def _match_score(row: dict, identity: dict) -> float:
    row_title = _normalize_title(row.get("name") or row.get("title"))
    if not row_title:
        return 0.0

    names = [
        _normalize_title(identity.get("title")),
        _normalize_title(identity.get("original_title")),
    ]
    names = [name for name in names if name]
    if not names:
        return 0.0

    score = 0.0
    for name in names:
        if row_title == name:
            score = max(score, 1.0)
            continue
        ratio = SequenceMatcher(None, row_title, name).ratio()
        if row_title in name or name in row_title:
            ratio = max(ratio, 0.88)
        score = max(score, ratio)

    expected_year = _extract_year(identity.get("year"))
    candidate_year = _row_year(row)
    if expected_year and candidate_year:
        if expected_year == candidate_year:
            score += 0.07
        elif abs(expected_year - candidate_year) > 1:
            score -= 0.05

    expected_type = "tv" if identity.get("type") == "tv" else "movie"
    candidate_type = _row_media_type(row)
    if candidate_type:
        score += 0.04 if candidate_type == expected_type else -0.08

    return score


def _image_url(row: dict, *wanted_types: str) -> Optional[str]:
    images = row.get("images") or []
    if isinstance(images, dict):
        images = list(images.values())
    if not isinstance(images, list):
        return None

    wanted = [str(value).lower() for value in wanted_types]
    for image_type in wanted:
        for image in images:
            if not isinstance(image, dict):
                continue
            kind = str(image.get("type") or image.get("kind") or "").lower()
            if kind != image_type:
                continue
            raw = str(image.get("url") or image.get("filename") or image.get("file") or "").strip()
            if not raw:
                continue
            if re.match(r"^https?://", raw, re.I):
                return _safe_url(raw)
            filename = raw.lstrip("/")
            if not re.search(r"\.[a-z0-9]{2,5}$", filename, re.I):
                filename += ".webp"
            return _safe_url(f"{SC_CDN_BASE}{filename}")
    return None


def _payload_rows(payload: Any) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        for key in ("results", "titles", "items", "data"):
            rows = data.get(key)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
    rows = payload.get("results")
    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]
    return []


async def _streamingcommunity(
    self: OfficialArtworkResolver,
    identity: dict,
) -> dict:
    """Resolve the SC cover for one TMDB identity.

    Search is based on the Italian TMDB title first and the original title only
    as a fallback. Matching is deliberately conservative enough to avoid showing
    an unrelated cover with a similar title.
    """
    queries: list[str] = []
    for value in (identity.get("title"), identity.get("original_title")):
        text = str(value or "").strip()
        if text and text.casefold() not in {query.casefold() for query in queries}:
            queries.append(text)
    if not queries:
        return {}

    semaphore = getattr(self, "_sc_artwork_semaphore", None)
    if semaphore is None:
        semaphore = asyncio.Semaphore(6)
        setattr(self, "_sc_artwork_semaphore", semaphore)

    rows_by_id: dict[str, dict] = {}
    async with semaphore:
        for query in queries:
            try:
                response = await self._http().get(
                    SC_SEARCH_API,
                    params={"q": query},
                    headers={"Accept": "application/json"},
                )
                if response.status_code != 200:
                    continue
                for row in _payload_rows(response.json()):
                    key = str(row.get("id") or row.get("slug") or row.get("name") or len(rows_by_id))
                    rows_by_id[key] = row
            except Exception:
                continue
            # An exact title is normally found on the first Italian-title query;
            # avoid a second request when it is already unambiguous.
            if any(
                _normalize_title(row.get("name") or row.get("title"))
                == _normalize_title(identity.get("title"))
                for row in rows_by_id.values()
            ):
                break

    if not rows_by_id:
        return {}

    ranked = sorted(
        ((_match_score(row, identity), row) for row in rows_by_id.values()),
        key=lambda pair: pair[0],
        reverse=True,
    )
    confidence, match = ranked[0]
    if confidence < 0.72:
        return {}

    # SC's cover/poster artwork is the title-bearing artwork used for static
    # catalogue cards. Keep it as the source for both normal and Top 10 cards.
    cover = _image_url(match, "cover", "poster", "cover_mobile")
    if not cover:
        return {}
    background = _image_url(match, "background", "backdrop") or cover

    return {
        "source": "streamingcommunity",
        "provider_id": match.get("id"),
        "provider_name": match.get("name") or match.get("title"),
        "confidence": round(float(min(confidence, 1.0)), 4),
        "landscape_url": cover,
        "poster_url": cover,
        "hero_landscape_url": background,
        "logo_url": None,
        "landscape_locale": "it",
        "poster_locale": "it",
        "hero_landscape_locale": "it",
        # Width/height are left unknown on purpose: the SC image endpoint owns
        # the native geometry and the frontend crops it to the card viewport.
        "landscape_width": 0,
        "landscape_height": 0,
        "poster_width": 0,
        "poster_height": 0,
        "landscape_embedded_title_treatment": True,
        "poster_embedded_title_treatment": True,
        "hero_embedded_title_treatment": background == cover,
    }


def _provider_locale(provider: dict, role: str) -> str:
    explicit = (
        provider.get(f"{role}_locale")
        or provider.get("artwork_locale")
        or provider.get("locale")
        or ""
    )
    text = str(explicit or "").strip().lower().replace("_", "-")
    if text == "it" or text.startswith("it-"):
        return "it"
    if text == "en" or text.startswith("en-"):
        return "en"
    if text in {"neutral", "none", "und"}:
        return "neutral"
    if str(provider.get("source") or "") == "streamingcommunity":
        return "it"
    if str(provider.get("source") or "") == "apple_itunes_it":
        return "it"
    return "unknown"


def _locale_rank(value: str) -> int:
    return {"it": 500, "neutral": 350, "en": 250, "unknown": 100, "other": 0}.get(
        str(value or "unknown"), 0
    )


def _source_rank(source: str) -> int:
    return {
        "streamingcommunity": 1000,
        "netflix": 50,
        "apple_itunes_it": 45,
        "prime_video": 40,
        "imdb": 30,
        "metahub_logo": 20,
    }.get(str(source or ""), 0)


def _exact_visual(provider: dict, role: str, *, embedded_only: bool) -> Optional[dict]:
    url = _safe_url(provider.get(f"{role}_url"))
    if not url:
        return None
    embedded = bool(provider.get(f"{role}_embedded_title_treatment"))
    if embedded_only and not embedded:
        return None

    width = _integer(provider.get(f"{role}_width"))
    height = _integer(provider.get(f"{role}_height"))
    if width and height:
        ratio = width / max(1, height)
        if role == "landscape" and ratio < 1.35:
            return None
        if role == "poster" and ratio > 0.90:
            return None
        orientation_score = 3
    else:
        orientation_score = 1

    return {
        "url": url,
        "source": provider.get("source"),
        "locale": _provider_locale(provider, role),
        "width": width,
        "height": height,
        "native_long_edge": max(width, height),
        "area": width * height,
        "embedded_title_treatment": embedded,
        "orientation_score": orientation_score,
    }


def _choose_static(providers: list[dict], role: str) -> Optional[dict]:
    candidates = [
        candidate
        for candidate in (_exact_visual(provider, role, embedded_only=True) for provider in providers)
        if candidate
    ]
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda row: (
            1 if row.get("source") == "streamingcommunity" else 0,
            _locale_rank(row.get("locale")),
            int(row.get("orientation_score") or 0),
            int(row.get("native_long_edge") or 0),
            int(row.get("area") or 0),
            _source_rank(row.get("source")),
        ),
    )


def _hero_visual(provider: dict) -> Optional[dict]:
    url = _safe_url(provider.get("hero_landscape_url"))
    if url:
        return {
            "url": url,
            "source": provider.get("source"),
            "locale": _provider_locale(provider, "landscape"),
            "width": _integer(provider.get("hero_landscape_width") or provider.get("landscape_width")),
            "height": _integer(provider.get("hero_landscape_height") or provider.get("landscape_height")),
            "embedded_title_treatment": bool(provider.get("hero_embedded_title_treatment")),
        }
    return _exact_visual(provider, "landscape", embedded_only=False)


def _choose_hero(providers: list[dict], logo_url: Optional[str]) -> Optional[dict]:
    candidates = [row for row in (_hero_visual(provider) for provider in providers) if row]
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda row: (
            1 if logo_url and not row.get("embedded_title_treatment") else 0,
            _locale_rank(row.get("locale")),
            _source_rank(row.get("source")),
        ),
    )


def install_artwork_card_policy() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    artwork_module.SOURCE_VERSION = POLICY_VERSION
    base_providers = OfficialArtworkResolver._providers

    async def providers_with_streamingcommunity(
        self: OfficialArtworkResolver,
        identity: dict,
        media_type: str,
        tmdb_id: int,
        *,
        force: bool,
    ) -> list[dict]:
        base_rows, sc_row = await asyncio.gather(
            base_providers(self, identity, media_type, tmdb_id, force=force),
            _streamingcommunity(self, identity),
            return_exceptions=True,
        )
        rows = base_rows if isinstance(base_rows, list) else []
        if isinstance(sc_row, dict) and sc_row:
            return [sc_row, *rows]
        return rows

    OfficialArtworkResolver._providers = providers_with_streamingcommunity

    async def resolve(
        self: OfficialArtworkResolver,
        media_type: str,
        tmdb_id: int,
        *,
        force: bool = False,
    ) -> dict:
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
                    "version": POLICY_VERSION,
                }

            providers = await self._providers(identity, media_type, tmdb_id, force=force)
            logo_url, logo_source, logo_locale = self._choose_logo(providers)
            static_landscape = _choose_static(providers, "landscape")
            static_poster = _choose_static(providers, "poster")
            hero_landscape = _choose_hero(providers, logo_url) or static_landscape

            landscape_ready = bool(static_landscape)
            poster_ready = bool(static_poster)

            resolved = {
                "active": bool(static_landscape or static_poster or hero_landscape or logo_url),
                "type": media_type,
                "tmdbId": tmdb_id,
                "title": identity.get("title"),
                "year": identity.get("year"),
                "backdrop_url": (static_landscape or {}).get("url"),
                "poster_url": (static_poster or {}).get("url"),
                "backdrop_source": (static_landscape or {}).get("source"),
                "poster_source": (static_poster or {}).get("source"),
                "backdrop_locale": (static_landscape or {}).get("locale"),
                "poster_locale": (static_poster or {}).get("locale"),
                "backdrop_native_width": (static_landscape or {}).get("width"),
                "backdrop_native_height": (static_landscape or {}).get("height"),
                "poster_native_width": (static_poster or {}).get("width"),
                "poster_native_height": (static_poster or {}).get("height"),
                "backdrop_embedded_title_treatment": bool(static_landscape),
                "poster_embedded_title_treatment": bool(static_poster),
                "embedded_title_treatment": bool(static_landscape),
                "landscape_card_ready": landscape_ready,
                "poster_card_ready": poster_ready,
                "card_ready": landscape_ready,
                "top10_ready": poster_ready,
                "hero_backdrop_url": (hero_landscape or {}).get("url"),
                "detail_backdrop_url": (hero_landscape or {}).get("url"),
                "hero_backdrop_source": (hero_landscape or {}).get("source"),
                "hero_backdrop_locale": (hero_landscape or {}).get("locale"),
                "hero_embedded_title_treatment": bool(
                    (hero_landscape or {}).get("embedded_title_treatment")
                ),
                "logo_url": logo_url,
                "logo_source": logo_source,
                "logo_locale": logo_locale,
                "complete": bool(landscape_ready and poster_ready),
                "providers": [
                    {
                        "source": provider.get("source"),
                        "has_landscape": bool(provider.get("landscape_url")),
                        "has_poster": bool(provider.get("poster_url")),
                        "has_logo": bool(provider.get("logo_url")),
                        "landscape_embedded": bool(provider.get("landscape_embedded_title_treatment")),
                        "poster_embedded": bool(provider.get("poster_embedded_title_treatment")),
                        "landscape_locale": _provider_locale(provider, "landscape"),
                        "poster_locale": _provider_locale(provider, "poster"),
                    }
                    for provider in providers
                ],
                "policy": "streamingcommunity-covers-first_static-embedded-title-treatment-only_no-tmdb-images",
                "version": POLICY_VERSION,
            }

            self.cache.update_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {
                    "$set": {
                        "type": media_type,
                        "tmdbId": tmdb_id,
                        "version": POLICY_VERSION,
                        "resolved": resolved,
                        "fetched_at": artwork_module._iso_now(),
                        "last_accessed_at": artwork_module._iso_now(),
                    }
                },
                upsert=True,
            )
            return resolved

    OfficialArtworkResolver.resolve = resolve


__all__ = ["install_artwork_card_policy", "POLICY_VERSION"]
