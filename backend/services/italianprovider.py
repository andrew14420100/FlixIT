"""HTTP bridge client for Gian-Fr/ItalianProvider.

ItalianProvider is a CloudStream/Kotlin provider collection, so it cannot be
loaded directly inside the Python/FastAPI process.  FlixIT talks to it through a
small external bridge exposing a stable JSON contract:

    GET {bridge}/resolve?tmdb_id=...&media_type=movie|tv&season=...&episode=...

Accepted response shapes:
    {"url": "https://.../video.m3u8", "headers": {...}}
    {"stream": "https://.../video.mp4", "type": "mp4"}
    {"streams": [{...}, {...}]}

Only http(s) stream URLs are accepted by this client.  The bridge URL is never
hard-coded so deployments can point at their own compatible service.
"""

import logging
import os
from typing import Callable, Optional
from urllib.parse import urlparse

import httpx

from .resolvers.base import stream_type_for

logger = logging.getLogger("player.italianprovider")

REPO_URL = "https://github.com/Gian-Fr/ItalianProvider"
BRIDGE_URL_KEY = "italianprovider_bridge_url"
ENABLED_KEY = "italianprovider_enabled"
LEGACY_ENABLED_KEY = "vixsrc_enabled"
REQUEST_TIMEOUT = 15.0


class ItalianProviderError(Exception):
    """Bridge unreachable or response not usable."""


def _as_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on", "enabled"}
    return bool(value)


def normalize_bridge_url(url: Optional[str]) -> str:
    url = (url or "").strip().rstrip("/")
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL bridge ItalianProvider non valido: usa http:// o https://")
    return url


def get_config(get_setting: Optional[Callable]) -> dict:
    """Read bridge configuration from app settings with env fallbacks.

    `vixsrc_enabled` is kept as a backwards-compatible toggle because the player
    previously used that slot for its primary resolver.  Once
    `italianprovider_enabled` is saved explicitly it takes precedence.
    """
    setting_url = ""
    explicit_enabled = None
    legacy_enabled = True

    if get_setting is not None:
        try:
            setting_url = get_setting(BRIDGE_URL_KEY, "") or ""
            explicit_enabled = get_setting(ENABLED_KEY, None)
            legacy_enabled = _as_bool(get_setting(LEGACY_ENABLED_KEY, True), True)
        except Exception:
            setting_url = ""
            explicit_enabled = None
            legacy_enabled = True

    env_url = os.environ.get("ITALIANPROVIDER_BRIDGE_URL", "")
    url = normalize_bridge_url(setting_url or env_url)

    if explicit_enabled is not None:
        enabled = _as_bool(explicit_enabled)
    elif os.environ.get("ITALIANPROVIDER_ENABLED") is not None:
        enabled = _as_bool(os.environ.get("ITALIANPROVIDER_ENABLED"))
    else:
        enabled = legacy_enabled

    return {"url": url, "enabled": bool(url) and enabled, "repo": REPO_URL}


def _parse_stream(item: dict) -> Optional[dict]:
    if not isinstance(item, dict):
        return None

    url = str(item.get("url") or item.get("stream") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None

    headers = item.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}

    media_type = str(item.get("type") or "").strip().lower()
    if media_type not in ("hls", "mp4"):
        media_type = stream_type_for(url)

    return {
        "url": url,
        "type": media_type,
        "name": str(item.get("name") or "ItalianProvider").strip(),
        "title": str(item.get("title") or item.get("description") or "").strip(),
        "headers": {str(k): str(v) for k, v in headers.items() if v},
    }


async def fetch_streams(
    bridge_url: str,
    media_type: str,
    tmdb_id: int,
    season: Optional[int] = None,
    episode: Optional[int] = None,
) -> list[dict]:
    bridge_url = normalize_bridge_url(bridge_url)
    if not bridge_url:
        return []

    params = {"tmdb_id": int(tmdb_id), "media_type": "tv" if media_type == "tv" else "movie"}
    if media_type == "tv":
        if season is not None:
            params["season"] = int(season)
        if episode is not None:
            params["episode"] = int(episode)

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(
                f"{bridge_url}/resolve",
                params=params,
                headers={"Accept": "application/json", "User-Agent": "FlixIT/ItalianProviderBridge"},
            )
    except httpx.TimeoutException as exc:
        raise ItalianProviderError("Bridge ItalianProvider non raggiungibile: timeout") from exc
    except httpx.HTTPError as exc:
        raise ItalianProviderError(
            f"Bridge ItalianProvider non raggiungibile: {exc.__class__.__name__}"
        ) from exc

    if response.status_code == 404:
        return []
    if response.status_code != 200:
        raise ItalianProviderError(f"Bridge ItalianProvider: HTTP {response.status_code}")

    try:
        data = response.json()
    except ValueError as exc:
        raise ItalianProviderError("Bridge ItalianProvider: risposta non JSON") from exc

    if isinstance(data, dict) and isinstance(data.get("streams"), list):
        raw_items = data["streams"]
    elif isinstance(data, list):
        raw_items = data
    elif isinstance(data, dict):
        raw_items = [data]
    else:
        raw_items = []

    parsed = [_parse_stream(item) for item in raw_items]
    return [item for item in parsed if item]


def pick_best(streams: list[dict]) -> Optional[dict]:
    """Prefer HLS, then MP4, preserving bridge order inside each class."""
    if not streams:
        return None
    return sorted(streams, key=lambda s: 0 if s.get("type") == "hls" else 1)[0]
