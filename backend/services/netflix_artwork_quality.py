"""Max-native-quality selection for the existing Netflix artwork resolver.

No new provider is introduced here. The resolver keeps using the already
configured Netflix artwork session/cache, but selection is deterministic and
never discards a valid lower-resolution asset just because 4K is unavailable.

Artwork availability is intentionally separate from playback availability: when
an authenticated Netflix search + metadata lookup yields a strict title/year
match, FLIX-IT may use the returned artwork even if Netflix reports that title as
not currently playable in the configured session/region. The availability flag
is still preserved as metadata and is never used to enable playback.
"""
from __future__ import annotations

from typing import Optional

from services.netflix_artwork import (
    AUTO_MATCH_GAP,
    AUTO_MATCH_THRESHOLD,
    ArtworkResolver,
    _iso_now,
    _year,
)

LOGO_TYPES = {"titleLogoUnbranded", "titleLogoBranded", "brandLogoSmall"}


def _dims(asset: Optional[dict]) -> tuple[int, int]:
    if not asset:
        return 0, 0
    try:
        return max(0, int(asset.get("width") or 0)), max(0, int(asset.get("height") or 0))
    except Exception:
        return 0, 0


def _area(asset: Optional[dict]) -> int:
    w, h = _dims(asset)
    return w * h


def _ratio(asset: Optional[dict]) -> float:
    w, h = _dims(asset)
    return (w / h) if h else 0.0


def _quality_tier(long_edge: int) -> int:
    """4K -> 2K -> 1080-class -> 720-class -> best lower."""
    if long_edge >= 3840:
        return 4
    if long_edge >= 2560:
        return 3
    if long_edge >= 1920:
        return 2
    if long_edge >= 1280:
        return 1
    return 0


def _quality_label(long_edge: int) -> str:
    if long_edge >= 3840:
        return "4K"
    if long_edge >= 2560:
        return "2K"
    if long_edge >= 1920:
        return "1080p-class"
    if long_edge >= 1280:
        return "720p-class"
    return "best-available"


def _annotate(asset: Optional[dict]) -> Optional[dict]:
    if not asset:
        return None
    w, h = _dims(asset)
    long_edge = max(w, h)
    return {
        **asset,
        "native_width": w or None,
        "native_height": h or None,
        "quality_label": _quality_label(long_edge),
        "upscaled": False,
    }


def _best_logo(assets: list[dict], _existing=None) -> Optional[dict]:
    logos = [
        a for a in (assets or [])
        if a.get("available", True) and a.get("url") and a.get("type") in LOGO_TYPES
    ]
    if not logos:
        return None

    kind_weight = {
        "titleLogoUnbranded": 3,
        "titleLogoBranded": 2,
        "brandLogoSmall": 1,
    }

    def key(asset: dict):
        w, h = _dims(asset)
        long_edge = max(w, h)
        return (
            _quality_tier(long_edge),
            long_edge,
            _area(asset),
            kind_weight.get(asset.get("type"), 0),
        )

    return _annotate(max(logos, key=key))


def _choose(self, doc: dict, *, context: str, viewport: str, profile_id: str, existing: dict):
    context = (context or "home").strip().lower()
    override = ((doc.get("overrides") or {}).get(context))
    if override:
        return _annotate(override), None

    assets = [
        a for a in (doc.get("assets") or [])
        if a.get("available", True) and a.get("url")
    ]
    logo = _best_logo(assets)
    visuals = [a for a in assets if a.get("type") not in LOGO_TYPES]

    portrait = context == "top10"
    target_ratio = 0.70 if portrait else (16 / 9)

    exact_shape: list[dict] = []
    same_orientation: list[dict] = []
    unknown: list[dict] = []
    for asset in visuals:
        ratio = _ratio(asset)
        if not ratio:
            unknown.append(asset)
            continue
        if portrait:
            if ratio < 1.0:
                same_orientation.append(asset)
                if 0.55 <= ratio <= 0.82:
                    exact_shape.append(asset)
        else:
            if ratio > 1.0:
                same_orientation.append(asset)
                if 1.50 <= ratio <= 2.00:
                    exact_shape.append(asset)

    candidates = exact_shape or same_orientation or unknown
    if not candidates:
        return None, logo

    if portrait:
        kind_weight = {
            "boxartHighRes": 4,
            "boxart": 3,
            "contextualArtwork": 2,
            "storyArt": 1,
        }
    else:
        kind_weight = {
            "contextualArtwork": 4,
            "storyArt": 3,
            "boxartHighRes": 1,
            "boxart": 0,
        }

    def key(asset: dict):
        w, h = _dims(asset)
        primary = h if portrait else w
        ratio = _ratio(asset)
        ratio_score = -abs(ratio - target_ratio) if ratio else -99.0
        return (
            _quality_tier(primary),
            primary,
            _area(asset),
            kind_weight.get(asset.get("type"), 0),
            ratio_score,
        )

    return _annotate(max(candidates, key=key)), logo


def _identity_from_doc(doc: Optional[dict]) -> Optional[dict]:
    if not isinstance(doc, dict):
        return None
    title = (
        doc.get("title")
        or doc.get("name")
        or doc.get("original_title")
        or doc.get("original_name")
        or ""
    )
    if not str(title).strip():
        return None
    return {
        "title": str(title).strip(),
        "original_title": str(
            doc.get("original_title")
            or doc.get("original_name")
            or title
        ).strip(),
        "year": _year(
            doc.get("year")
            or doc.get("release_date")
            or doc.get("first_air_date")
            or doc.get("releaseDate")
            or doc.get("firstAirDate")
        ),
    }


def _local_identity(self, media_type: str, tmdb_id: int) -> Optional[dict]:
    current = self.matches.find_one(
        {"type": media_type, "tmdbId": tmdb_id},
        {"_id": 0, "identity": 1, "netflix_title": 1, "netflix_year": 1},
    ) or {}
    identity = _identity_from_doc(current.get("identity"))
    if identity:
        return identity

    if current.get("netflix_title"):
        return {
            "title": str(current.get("netflix_title") or "").strip(),
            "original_title": str(current.get("netflix_title") or "").strip(),
            "year": _year(current.get("netflix_year")),
        }

    queries = [
        {"type": media_type, "tmdbId": tmdb_id},
        {"media_type": media_type, "tmdbId": tmdb_id},
        {"tmdbId": tmdb_id},
        {"tmdb_id": tmdb_id},
        {"id": tmdb_id},
    ]
    for collection_name in ("media_assets", "contents", "catalog", "movies", "tv"):
        try:
            collection = self.db[collection_name]
            for query in queries:
                doc = collection.find_one(query, {"_id": 0})
                identity = _identity_from_doc(doc)
                if identity:
                    return identity
        except Exception:
            continue
    return None


async def _search_exact_without_region_gate(self, media_type: str, tmdb_id: int) -> dict:
    """Strict Netflix artwork match independent from playback availability."""
    base = {
        "type": media_type,
        "tmdbId": tmdb_id,
        "region": self.region(),
        "checked_at": _iso_now(),
    }

    identity = _local_identity(self, media_type, tmdb_id)
    if not identity:
        try:
            identity = await self._tmdb_identity(media_type, tmdb_id)
        except Exception:
            identity = None

    if not identity or not identity.get("title"):
        return {
            **base,
            "status": "uncertain",
            "netflix_available": None,
            "confidence": 0.0,
            "reason": "identity_unavailable",
        }

    queries = []
    for value in (identity.get("title"), identity.get("original_title")):
        text = str(value or "").strip()
        if text and text not in queries:
            queries.append(text)

    candidates: dict[str, dict] = {}
    for query in queries:
        try:
            rows = await self.provider.search(query)
        except Exception as exc:
            return {
                **base,
                "status": "uncertain",
                "netflix_available": None,
                "confidence": 0.0,
                "reason": "netflix_search_failed",
                "identity": identity,
                "error": str(exc),
            }

        for row in rows:
            enriched = dict(row or {})
            nid = str(enriched.get("netflix_id") or "")
            if not nid:
                continue

            # Search suggestions can omit releaseYear even for an exact title.
            # Resolve metadata first so the automatic match remains title+year
            # strict whenever Netflix exposes a year.
            if not _year(enriched.get("year")):
                try:
                    entity = await self.provider.metadata(nid)
                except Exception:
                    entity = None
                if entity:
                    enriched["year"] = (
                        entity.get("latestYear")
                        or entity.get("releaseYear")
                        or entity.get("year")
                    )
                    enriched["metadata_available"] = entity.get("isAvailable")
                    if not enriched.get("title"):
                        enriched["title"] = entity.get("title")

            scored = {**enriched, "score": self._score_match(identity, enriched)}
            current = candidates.get(nid)
            if current is None or scored["score"] > current["score"]:
                candidates[nid] = scored

    ranked = sorted(candidates.values(), key=lambda row: row.get("score", 0), reverse=True)
    top = ranked[0] if ranked else None
    second = ranked[1] if len(ranked) > 1 else None
    confidence = float((top or {}).get("score") or 0)
    gap = confidence - float((second or {}).get("score") or 0)
    safe = bool(
        top
        and confidence >= AUTO_MATCH_THRESHOLD
        and (second is None or gap >= AUTO_MATCH_GAP)
    )

    if not safe:
        return {
            **base,
            "status": "uncertain",
            "netflix_available": None,
            "confidence": round(confidence, 4),
            "reason": "ambiguous_or_low_confidence",
            "identity": identity,
            "candidates": ranked[:8],
        }

    try:
        entity = await self.provider.metadata(str(top["netflix_id"]))
    except Exception as exc:
        return {
            **base,
            "status": "uncertain",
            "netflix_available": None,
            "confidence": round(confidence, 4),
            "reason": "netflix_metadata_failed",
            "identity": identity,
            "candidates": ranked[:8],
            "error": str(exc),
        }

    playable = entity.get("isAvailable")
    artwork_only = playable is False

    # A successful authenticated metadata response plus a strict title/year
    # match is sufficient for artwork. isAvailable controls playback/catalog
    # availability only; it must not blank an otherwise valid cover/logo.
    return {
        **base,
        "status": "matched",
        "netflix_available": False if artwork_only else (True if playable is True else None),
        "netflix_id": top["netflix_id"],
        "confidence": round(confidence, 4),
        "reason": (
            "strict_title_year_match_artwork_only"
            if artwork_only
            else "strict_title_year_match_netflix_session"
        ),
        "artwork_only": artwork_only,
        "identity": identity,
        "contextualArtwork": top.get("contextualArtwork"),
        "candidates": ranked[:8],
    }


def install_netflix_artwork_quality() -> None:
    """Install the max-quality and resilient matching policy once."""
    if getattr(ArtworkResolver, "_flixit_max_native_installed", False):
        return

    original_enabled = ArtworkResolver.enabled
    original_auto_match = ArtworkResolver.auto_match

    def enabled(self) -> bool:
        if original_enabled(self) or self._cookies():
            return True
        try:
            cached = self.matches.find_one(
                {
                    "status": {"$in": ["matched", "manual"]},
                    "assets.0": {"$exists": True},
                },
                {"_id": 1},
            )
            return bool(cached)
        except Exception:
            return False

    async def auto_match(self, media_type: str, tmdb_id: int, force: bool = False):
        if not force:
            try:
                current = self.matches.find_one(
                    {"type": "tv" if media_type == "tv" else "movie", "tmdbId": tmdb_id},
                    {"_id": 0, "reason": 1},
                ) or {}
                if current.get("reason") in {
                    "region_verification_unavailable",
                    "tmdb_identity_unavailable",
                    "identity_unavailable",
                    "netflix_search_failed",
                    "netflix_metadata_failed",
                    "ambiguous_or_low_confidence",
                    "not_available_in_configured_netflix_session",
                }:
                    force = True
            except Exception:
                pass
        return await original_auto_match(self, media_type, tmdb_id, force=force)

    ArtworkResolver.enabled = enabled
    ArtworkResolver._search_exact = _search_exact_without_region_gate
    ArtworkResolver.auto_match = auto_match
    ArtworkResolver._logo = _best_logo
    ArtworkResolver._choose = _choose
    ArtworkResolver._flixit_max_native_installed = True


__all__ = ["install_netflix_artwork_quality"]
