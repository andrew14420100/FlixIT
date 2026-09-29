"""Logo integrity guard for performance artwork bundles.

Backdrop/card matching may tolerate a fuzzy title match, but a wrong transparent
logo is visually much worse.  Keep artwork matching permissive while publishing a
logo only when the StreamingCommunity record name exactly matches either the
Italian or original title after normalization.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

_INSTALLED = False


def _normal(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip().lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _exact_title(raw: dict, provider_name: Any) -> bool:
    expected = {
        _normal(raw.get("title") or raw.get("name")),
        _normal(raw.get("original_title") or raw.get("original_name")),
    }
    expected.discard("")
    return bool(expected and _normal(provider_name) in expected)


def install_logo_integrity(app=None) -> bool:
    global _INSTALLED
    if _INSTALLED:
        return True
    try:
        from services import performance_api
    except Exception:
        return False

    current = performance_api._bundle
    if getattr(current, "_flixit_logo_integrity_v1", False):
        _INSTALLED = True
        return True

    def verified_bundle(raw: dict):
        result = current(raw)
        if not isinstance(result, dict):
            return result
        out = dict(result)
        logo = out.get("logo_url")
        verified = bool(logo and _exact_title(raw or {}, out.get("sc_provider_name")))
        out["logo_verified"] = verified
        if logo and not verified:
            out["logo_url"] = None
            out["logo_source"] = None
            out["logo_locale"] = None
        return out

    verified_bundle._flixit_logo_integrity_v1 = True
    verified_bundle._original = current
    performance_api._bundle = verified_bundle

    try:
        if app is not None:
            app.state.flixit_logo_integrity = {
                "installed": True,
                "mode": "exact_normalized_title_for_logo",
                "ambiguous_logo_behavior": "hide_logo_keep_backdrop",
            }
    except Exception:
        pass

    _INSTALLED = True
    return True


__all__ = ["install_logo_integrity"]
