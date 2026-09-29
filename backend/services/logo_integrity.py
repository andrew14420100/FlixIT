"""Logo integrity guard for performance artwork bundles.

Backdrop/card matching may tolerate a fuzzy title match, but a wrong transparent
logo is visually much worse. Artwork remains available, while transparent logos
are published only for an exact normalized title identity.
"""
from __future__ import annotations

import asyncio
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
        _normal(raw.get("title")),
        _normal(raw.get("name")),
        _normal(raw.get("original_title")),
        _normal(raw.get("original_name")),
    }
    expected.discard("")
    provider = _normal(provider_name)
    return bool(provider and provider in expected)


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

    # The persistent Home snapshot may have been built before this guard was
    # installed. Rebuild it in the background and then hot-reload the fast path;
    # users continue receiving the old snapshot until the verified one is ready.
    if app is not None:
        async def rebuild_home_visuals() -> None:
            try:
                import server_core as core
                from services import home_bootstrap as home
                from services import home_bootstrap_fast as home_fast

                await home._build_snapshot(app, core)
                await asyncio.to_thread(home_fast._read_hot, core, home, force=True)
            except Exception:
                pass

        try:
            asyncio.get_running_loop().create_task(rebuild_home_visuals())
        except RuntimeError:
            pass

    try:
        if app is not None:
            app.state.flixit_logo_integrity = {
                "installed": True,
                "mode": "exact_normalized_title_for_logo",
                "ambiguous_logo_behavior": "hide_logo_keep_backdrop_use_title_fallback",
                "home_snapshot_refresh": "background",
            }
    except Exception:
        pass

    _INSTALLED = True
    return True


__all__ = ["install_logo_integrity"]
