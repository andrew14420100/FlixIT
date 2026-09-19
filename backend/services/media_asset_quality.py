"""Max-quality artwork selection for FlixIT public media assets.

This layer keeps the existing server_core media-asset contract intact while
upgrading cached TMDB artwork once per quality-version. It never invents pixels:
`original` is used by the frontend, and this module only chooses the largest
native poster/backdrop/logo that TMDB actually exposes.
"""
from __future__ import annotations

from typing import Any, Optional

QUALITY_VERSION = "max-quality-v3"


def _area(item: Optional[dict]) -> int:
    if not item:
        return 0
    try:
        return int(item.get("width") or 0) * int(item.get("height") or 0)
    except Exception:
        return 0


def _lang_score(value: Any) -> int:
    lang = str(value or "").lower()
    if lang == "it":
        return 3
    if lang == "en":
        return 2
    if not lang:
        return 1
    return 0


def _largest(items: list[dict], *, prefer_clean: bool = False) -> Optional[dict]:
    rows = [x for x in (items or []) if x.get("file_path")]
    if not rows:
        return None

    # Native pixel area is the primary quality signal. For otherwise equivalent
    # assets, clean artwork and community rating are useful tie breakers.
    def key(row: dict):
        clean = 1 if not row.get("iso_639_1") else 0
        return (
            _area(row),
            clean if prefer_clean else _lang_score(row.get("iso_639_1")),
            float(row.get("vote_average") or 0),
            int(row.get("vote_count") or 0),
        )

    return max(rows, key=key)


def _largest_titled_backdrop(items: list[dict]) -> Optional[dict]:
    rows = [
        x for x in (items or [])
        if x.get("file_path") and x.get("iso_639_1") in ("it", "en")
    ]
    if not rows:
        return None
    return max(
        rows,
        key=lambda row: (
            _area(row),
            _lang_score(row.get("iso_639_1")),
            float(row.get("vote_average") or 0),
            int(row.get("vote_count") or 0),
        ),
    )


def _best_logo(items: list[dict]) -> Optional[dict]:
    rows = [x for x in (items or []) if x.get("file_path")]
    if not rows:
        return None

    # Vector artwork is resolution-independent. Otherwise choose the largest
    # native raster and only then use language/rating as tie breakers.
    def key(row: dict):
        path = str(row.get("file_path") or "").lower()
        vector = 1 if path.endswith(".svg") else 0
        return (
            vector,
            _area(row),
            _lang_score(row.get("iso_639_1")),
            float(row.get("vote_average") or 0),
            int(row.get("vote_count") or 0),
        )

    return max(rows, key=key)


def _meta(row: Optional[dict]) -> dict:
    if not row:
        return {"width": None, "height": None, "native_pixels": 0}
    return {
        "width": row.get("width"),
        "height": row.get("height"),
        "native_pixels": _area(row),
    }


def install_max_quality_media_assets(core) -> None:
    """Install a transparent max-quality wrapper around server_core assets.

    Existing cached media-assets are refreshed lazily the next time each title is
    requested. That avoids a startup spike over the whole catalogue while still
    reimporting every card/Top-10/hover title as it is encountered by the UI.
    """
    if getattr(core, "_max_quality_media_assets_installed", False):
        return

    original_get_media_assets = core.get_media_assets

    async def get_media_assets_max_quality(media_type: str, tmdb_id: int, force: bool = False):
        media_type = "tv" if media_type == "tv" else "movie"
        tmdb_id = int(tmdb_id)

        cached = core.media_assets.find_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {"_id": 0, "asset_quality_version": 1},
        ) or {}
        needs_upgrade = cached.get("asset_quality_version") != QUALITY_VERSION

        # Preserve all existing metadata/certification behavior. The first call
        # after this quality-version forces the old asset document to refresh.
        doc = await original_get_media_assets(
            media_type,
            tmdb_id,
            force=bool(force or needs_upgrade),
        )
        if not doc:
            return doc

        if needs_upgrade or force:
            images = await core.fetch_tmdb_data(
                f"/{media_type}/{tmdb_id}/images",
                {"include_image_language": "it,en,null"},
            ) or {}

            best_poster = _largest(images.get("posters") or [])
            best_backdrop = _largest(images.get("backdrops") or [], prefer_clean=True)
            best_titled = _largest_titled_backdrop(images.get("backdrops") or [])
            best_logo = _best_logo(images.get("logos") or [])

            updates: dict[str, Any] = {
                "asset_quality_version": QUALITY_VERSION,
                "image_quality": "original",
                "upscaled": False,
            }
            if best_poster:
                updates["poster_path"] = best_poster.get("file_path")
                updates["poster_native"] = _meta(best_poster)
            if best_backdrop:
                updates["backdrop_path"] = best_backdrop.get("file_path")
                updates["backdrop_native"] = _meta(best_backdrop)
            if best_titled:
                updates["titled_backdrop_path"] = best_titled.get("file_path")
                updates["titled_backdrop_native"] = _meta(best_titled)
            if best_logo:
                updates["logo_path"] = best_logo.get("file_path")
                updates["logo_native"] = _meta(best_logo)

            core.media_assets.update_one(
                {"type": media_type, "tmdbId": tmdb_id},
                {"$set": updates},
                upsert=True,
            )
            doc = {**doc, **updates}

        return doc

    core.get_media_assets = get_media_assets_max_quality
    core._max_quality_media_assets_installed = True


__all__ = ["QUALITY_VERSION", "install_max_quality_media_assets"]
