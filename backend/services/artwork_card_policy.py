"""StreamingCommunity-first card artwork policy for FLIX-IT.

Static catalogue cards never composite a separate logo.  The title treatment has
already to be part of the selected artwork.  StreamingCommunity is queried for
all useful title variants and every matching SC row with a real cover is
considered before falling back to another provider.
"""
from __future__ import annotations

import asyncio
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any, Optional

import services.official_artwork as artwork_module
from services.official_artwork import OfficialArtworkResolver

POLICY_VERSION = "official-artwork-v7-sc-exhaustive"
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
    for key in (
        "year",
        "release_date",
        "first_air_date",
        "date",
        "last_air_date",
        "publication_date",
    ):
        value = _extract_year(row.get(key))
        if value:
            return value
    return None


def _row_media_type(row: dict) -> Optional[str]:
    raw = str(
        row.get("media_type")
        or row.get("type")
        or row.get("content_type")
        or row.get("category")
        or ""
    ).strip().lower()
    if not raw:
        return None
    if raw in {"tv", "series", "serie", "show", "serie-tv", "tv-show"} or "serie" in raw:
        return "tv"
    if raw in {"movie", "film", "cinema"} or "film" in raw or "movie" in raw:
        return "movie"
    return None


def _row_titles(row: dict) -> list[str]:
    values: list[Any] = [
        row.get("name"),
        row.get("title"),
        row.get("original_name"),
        row.get("original_title"),
    ]
    aliases = row.get("aliases") or row.get("alternative_titles") or row.get("alternativeTitles")
    if isinstance(aliases, list):
        values.extend(aliases)
    elif isinstance(aliases, dict):
        values.extend(aliases.values())

    out: list[str] = []
    seen = set()
    for value in values:
        if isinstance(value, dict):
            value = value.get("title") or value.get("name") or value.get("value")
        normalized = _normalize_title(value)
        if normalized and normalized not in seen:
            seen.add(normalized)
            out.append(normalized)
    return out


def _query_variants(identity: dict) -> list[str]:
    out: list[str] = []
    seen = set()

    def add(value: Any) -> None:
        text = re.sub(r"\s+", " ", str(value or "").strip())
        key = text.casefold()
        if text and key not in seen:
            seen.add(key)
            out.append(text)

    for raw in (identity.get("title"), identity.get("original_title")):
        text = str(raw or "").strip()
        if not text:
            continue
        add(text)
        # SC titles often omit a subtitle or a parenthetical qualifier.
        add(re.split(r"\s*[:|–—-]\s*", text, maxsplit=1)[0])
        add(re.sub(r"\s*\([^)]*\)\s*", " ", text).strip())
        add(re.sub(r"\s+(?:stagione|season)\s+\d+\s*$", "", text, flags=re.I).strip())

    return out[:8]


def _match_score(row: dict, identity: dict) -> float:
    row_titles = _row_titles(row)
    if not row_titles:
        return 0.0

    identity_titles = [
        _normalize_title(identity.get("title")),
        _normalize_title(identity.get("original_title")),
    ]
    identity_titles = [value for value in identity_titles if value]
    if not identity_titles:
        return 0.0

    score = 0.0
    for row_title in row_titles:
        for expected in identity_titles:
            if row_title == expected:
                score = max(score, 1.0)
                continue
            ratio = SequenceMatcher(None, row_title, expected).ratio()
            if row_title in expected or expected in row_title:
                ratio = max(ratio, 0.90)
            # Strong token overlap helps translated/subtitled variants without
            # accepting a completely different title that shares one word.
            a = set(row_title.split())
            b = set(expected.split())
            if a and b:
                overlap = len(a & b) / max(1, len(a | b))
                if overlap >= 0.75:
                    ratio = max(ratio, 0.87)
                elif overlap >= 0.50:
                    ratio = max(ratio, 0.74)
            score = max(score, ratio)

    expected_year = _extract_year(identity.get("year"))
    candidate_year = _row_year(row)
    if expected_year and candidate_year:
        if expected_year == candidate_year:
            score += 0.08
        elif abs(expected_year - candidate_year) == 1:
            score += 0.02
        else:
            score -= 0.10

    expected_type = "tv" if identity.get("type") == "tv" else "movie"
    candidate_type = _row_media_type(row)
    if candidate_type:
        score += 0.05 if candidate_type == expected_type else -0.14

    return score


def _asset_url(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        value = (
            value.get("url")
            or value.get("src")
            or value.get("filename")
            or value.get("file")
            or value.get("path")
            or value.get("uuid")
            or value.get("id")
        )
    raw = str(value or "").strip()
    if not raw:
        return None
    if re.match(r"^https?://", raw, re.I):
        return _safe_url(raw)
    filename = raw.lstrip("/")
    if not re.search(r"\.[a-z0-9]{2,5}$", filename, re.I):
        filename += ".webp"
    return _safe_url(f"{SC_CDN_BASE}{filename}")


def _images(row: dict) -> list[dict]:
    raw = row.get("images") or row.get("artworks") or row.get("artwork") or []
    if isinstance(raw, dict):
        expanded: list[dict] = []
        for key, value in raw.items():
            if isinstance(value, dict):
                expanded.append({"type": value.get("type") or key, **value})
            else:
                expanded.append({"type": key, "value": value})
        return expanded
    if isinstance(raw, list):
        return [value for value in raw if isinstance(value, dict)]
    return []


def _image_url(row: dict, *wanted_types: str) -> Optional[str]:
    wanted = [str(value).strip().lower() for value in wanted_types if value]
    images = _images(row)

    for wanted_type in wanted:
        for image in images:
            kind = str(
                image.get("type")
                or image.get("kind")
                or image.get("role")
                or image.get("name")
                or ""
            ).strip().lower()
            if kind != wanted_type:
                continue
            resolved = _asset_url(
                image.get("url")
                or image.get("src")
                or image.get("filename")
                or image.get("file")
                or image.get("path")
                or image.get("uuid")
                or image.get("value")
            )
            if resolved:
                return resolved

    # Accept any other SC field whose type clearly says cover/poster, but never
    # silently turn a plain background/backdrop into a static card.
    if any(value in {"cover", "poster", "cover_mobile", "cover_desktop"} for value in wanted):
        for image in images:
            kind = str(image.get("type") or image.get("kind") or image.get("role") or "").lower()
            if "cover" not in kind and "poster" not in kind:
                continue
            resolved = _asset_url(
                image.get("url")
                or image.get("src")
                or image.get("filename")
                or image.get("file")
                or image.get("path")
                or image.get("uuid")
                or image.get("value")
            )
            if resolved:
                return resolved

        for key in (
            "cover_url",
            "cover",
            "poster_url",
            "poster",
            "cover_image",
            "coverImage",
            "image_url",
            "image",
        ):
            resolved = _asset_url(row.get(key))
            if resolved:
                return resolved

    return None


def _cover_url(row: dict) -> Optional[str]:
    return _image_url(
        row,
        "cover",
        "cover_desktop",
        "poster",
        "cover_mobile",
        "poster_mobile",
        "thumbnail",
        "thumb",
    )


def _background_url(row: dict) -> Optional[str]:
    return _image_url(row, "background", "backdrop", "hero", "wallpaper")


def _payload_rows(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []

    candidates = [
        payload.get("data"),
        payload.get("results"),
        payload.get("titles"),
        payload.get("items"),
    ]
    data = payload.get("data")
    if isinstance(data, dict):
        candidates.extend(
            [data.get("results"), data.get("titles"), data.get("items"), data.get("data")]
        )

    for rows in candidates:
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


async def _streamingcommunity(self: OfficialArtworkResolver, identity: dict) -> dict:
    """Resolve every usable SC cover candidate for one TMDB identity.

    We intentionally do not stop at the first title hit: SC can expose several
    rows for the same title and only one of them may carry the merchandising
    cover.  All title variants are searched, then the highest-confidence row
    that actually contains a cover is selected.
    """
    queries = _query_variants(identity)
    if not queries:
        return {}

    semaphore = getattr(self, "_sc_artwork_semaphore", None)
    if semaphore is None:
        semaphore = asyncio.Semaphore(8)
        setattr(self, "_sc_artwork_semaphore", semaphore)

    rows_by_id: dict[str, dict] = {}
    async with semaphore:
        for query in queries:
            try:
                response = await self._http().get(
                    SC_SEARCH_API,
                    params={"q": query},
                    headers={
                        "Accept": "application/json",
                        "Referer": "https://streamingcommunityz.ninja/",
                    },
                )
                if response.status_code != 200:
                    continue
                for row in _payload_rows(response.json()):
                    key = str(
                        row.get("id")
                        or row.get("uuid")
                        or row.get("slug")
                        or row.get("name")
                        or row.get("title")
                        or len(rows_by_id)
                    )
                    rows_by_id[key] = row
            except Exception:
                continue

    if not rows_by_id:
        return {}

    ranked: list[tuple[float, dict, str]] = []
    for row in rows_by_id.values():
        cover = _cover_url(row)
        if not cover:
            continue
        ranked.append((_match_score(row, identity), row, cover))
    ranked.sort(key=lambda value: value[0], reverse=True)

    if not ranked:
        return {}

    confidence, match, cover = ranked[0]
    if confidence < 0.62:
        return {}

    background = _background_url(match) or cover
    return {
        "source": "streamingcommunity",
        "provider_id": match.get("id") or match.get("uuid") or match.get("slug"),
        "provider_name": match.get("name") or match.get("title"),
        "confidence": round(float(min(confidence, 1.0)), 4),
        "landscape_url": cover,
        "poster_url": cover,
        "hero_landscape_url": background,
        "logo_url": None,
        "landscape_locale": "it",
        "poster_locale": "it",
        "hero_landscape_locale": "it",
        "landscape_width": 0,
        "landscape_height": 0,
        "poster_width": 0,
        "poster_height": 0,
        "landscape_embedded_title_treatment": True,
        "poster_embedded_title_treatment": True,
        "hero_embedded_title_treatment": background == cover,
        "sc_cover_imported": True,
        "sc_candidates_seen": len(rows_by_id),
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
    if str(provider.get("source") or "") in {"streamingcommunity", "apple_itunes_it"}:
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
            sc_provider = next(
                (provider for provider in providers if provider.get("source") == "streamingcommunity"),
                {},
            )

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
                "sc_cover_imported": bool(sc_provider),
                "sc_provider_id": sc_provider.get("provider_id"),
                "sc_provider_name": sc_provider.get("provider_name"),
                "sc_confidence": sc_provider.get("confidence"),
                "sc_candidates_seen": sc_provider.get("sc_candidates_seen", 0),
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
                "policy": "streamingcommunity-exhaustive-cover-import_first_then_embedded-provider-fallback",
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
