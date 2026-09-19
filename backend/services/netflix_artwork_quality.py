"""Max-native-quality selection for the existing Netflix artwork resolver.

No new provider is introduced here. The resolver keeps using the already
configured Netflix artwork session/cache, but selection is deterministic and
never discards a valid lower-resolution asset just because 4K is unavailable.
"""
from __future__ import annotations

from typing import Optional

from services.netflix_artwork import ArtworkResolver

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

    # Standard cards, Hero and hover are horizontal Netflix-style. Top 10 alone
    # uses the portrait treatment. Unknown dimensions stay as the final fallback
    # instead of disappearing.
    shaped = []
    unknown = []
    for asset in visuals:
        ratio = _ratio(asset)
        if not ratio:
            unknown.append(asset)
            continue
        if portrait:
            if 0.50 <= ratio <= 0.88:
                shaped.append(asset)
        elif 1.35 <= ratio <= 2.20:
            shaped.append(asset)

    candidates = shaped or unknown
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


def install_netflix_artwork_quality() -> None:
    """Install the max-quality policy once on the existing resolver class."""
    if getattr(ArtworkResolver, "_flixit_max_native_installed", False):
        return

    original_enabled = ArtworkResolver.enabled

    def enabled(self) -> bool:
        # If the existing Netflix artwork session is configured, make the
        # resolver usable by the public UI without requiring a second toggle.
        return bool(original_enabled(self) or self._cookies())

    ArtworkResolver.enabled = enabled
    ArtworkResolver._logo = _best_logo
    ArtworkResolver._choose = _choose
    ArtworkResolver._flixit_max_native_installed = True


__all__ = ["install_netflix_artwork_quality"]
