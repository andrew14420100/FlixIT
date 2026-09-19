"""Netflix-style card artwork policy layered on the unified resolver.

Static catalogue cards are intentionally stricter than Hero/Detail:
- a static 16:9 card is published only when the selected official image already
  contains a title treatment;
- a Top 10 poster is published only when its portrait image already contains the
  title treatment;
- every published card must also have a genuine separate logo available for its
  hover trailer;
- clean artwork + a separate logo remains valid for Hero, Detail and hover;
- Italian merchandising art outranks higher-resolution foreign art;
- no TMDB image URL is introduced here.
"""
from __future__ import annotations

from typing import Any, Optional

import services.official_artwork as artwork_module
from services.official_artwork import OfficialArtworkResolver

POLICY_VERSION = "official-artwork-v4"
_INSTALLED = False


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

    source = str(provider.get("source") or "")
    if source == "apple_itunes_it":
        return "it"

    page = str(provider.get("provider_page") or "").lower()
    if "/it/" in page or "/it-it/" in page or "locale=it" in page:
        return "it"
    if "/en/" in page or "/en-us/" in page or "/en-gb/" in page:
        return "en"
    return "unknown"


def _locale_rank(value: str) -> int:
    # Merchandising language comes before resolution by explicit product policy.
    return {
        "it": 500,
        "neutral": 350,
        "en": 250,
        "unknown": 100,
        "other": 0,
    }.get(str(value or "unknown"), 0)


def _source_rank(source: str) -> int:
    return {
        "netflix": 50,
        "apple_itunes_it": 45,
        "prime_video": 40,
        "imdb": 30,
        "metahub_logo": 20,
    }.get(str(source or ""), 0)


def _safe_url(value: Any) -> Optional[str]:
    return artwork_module._safe_url(value)


def _integer(value: Any) -> int:
    return artwork_module._integer(value)


def _exact_visual(provider: dict, role: str, *, embedded_only: bool) -> Optional[dict]:
    """Build a candidate without rotating poster<->landscape."""
    url = _safe_url(provider.get(f"{role}_url"))
    if not url:
        return None

    width = _integer(provider.get(f"{role}_width"))
    height = _integer(provider.get(f"{role}_height"))
    embedded = bool(provider.get(f"{role}_embedded_title_treatment"))
    if embedded_only and not embedded:
        return None

    if width and height:
        ratio = width / max(1, height)
        if role == "landscape" and ratio < 1.35:
            return None
        if role == "poster" and ratio > 0.90:
            return None
        orientation_score = 3
    else:
        orientation_score = 1

    locale = _provider_locale(provider, role)
    return {
        "url": url,
        "source": provider.get("source"),
        "locale": locale,
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

    # Italian 1080p intentionally beats English/unknown 4K.
    return max(
        candidates,
        key=lambda row: (
            _locale_rank(row.get("locale")),
            int(row.get("orientation_score") or 0),
            int(row.get("native_long_edge") or 0),
            int(row.get("area") or 0),
            _source_rank(row.get("source")),
        ),
    )


def _hero_visual(provider: dict) -> Optional[dict]:
    """Prefer an explicit clean Hero variant when a provider exposes one."""
    url = _safe_url(provider.get("hero_landscape_url"))
    if url:
        width = _integer(provider.get("hero_landscape_width") or provider.get("landscape_width"))
        height = _integer(provider.get("hero_landscape_height") or provider.get("landscape_height"))
        if not width or not height or width / max(1, height) >= 1.35:
            return {
                "url": url,
                "source": provider.get("source"),
                "locale": _provider_locale(provider, "landscape"),
                "width": width,
                "height": height,
                "native_long_edge": max(width, height),
                "area": width * height,
                "embedded_title_treatment": bool(provider.get("hero_embedded_title_treatment")),
                "orientation_score": 3 if width and height else 1,
            }
    return _exact_visual(provider, "landscape", embedded_only=False)


def _choose_hero(providers: list[dict], logo_url: Optional[str]) -> Optional[dict]:
    """Hero/Detail may use clean 16:9 art plus the genuine separate logo."""
    candidates = []
    for provider in providers:
        row = _hero_visual(provider)
        if not row:
            continue
        clean_with_logo = bool(logo_url and not row.get("embedded_title_treatment"))
        row["clean_with_logo"] = clean_with_logo
        candidates.append(row)
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda row: (
            1 if row.get("clean_with_logo") else 0,
            _locale_rank(row.get("locale")),
            int(row.get("native_long_edge") or 0),
            int(row.get("area") or 0),
            _source_rank(row.get("source")),
        ),
    )


def install_artwork_card_policy() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    artwork_module.SOURCE_VERSION = POLICY_VERSION

    async def resolve(self: OfficialArtworkResolver, media_type: str, tmdb_id: int, *, force: bool = False) -> dict:
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

            # A title-bearing image is mandatory for static cards, and a separate
            # genuine logo is also mandatory because the hover trailer always uses
            # that logo during its first five seconds.
            landscape_ready = bool(static_landscape and logo_url)
            poster_ready = bool(static_poster and logo_url)

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
                "policy": "static-embedded-title-treatment_plus-hover-logo_it-first_then-native-quality_no-tmdb-images",
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
