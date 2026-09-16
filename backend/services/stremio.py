"""
Stremio addon client: query a Stremio-protocol addon for the streams of a title.

Protocol (https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md):
  GET {addon}/manifest.json
  GET {addon}/stream/{movie|series}/{imdb_id}.json            -> movies
  GET {addon}/stream/series/{imdb_id}:{season}:{episode}.json -> episodes
Response: {"streams": [{"url": "...", "name": "...", "title": "...", "behaviorHints": {...}}, ...]}

Settings (Mongo `app_settings`):
  stremio_addon_url  base URL of the addon (a trailing /manifest.json is accepted and stripped)
  stremio_enabled    on/off switch (default True when a URL is set)
"""
import logging
import os
from typing import Callable, Optional
from urllib.parse import quote, urlparse

import httpx

from .resolvers.base import stream_type_for

logger = logging.getLogger("player.stremio")

URL_KEY = "stremio_addon_url"
ENABLED_KEY = "stremio_enabled"

TMDB_BASE_URL = "https://api.themoviedb.org/3"
REQUEST_TIMEOUT = 12.0


class StremioError(Exception):
    """Addon unreachable / invalid response."""


def normalize_addon_url(url: Optional[str]) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if url.endswith("/manifest.json"):
        url = url[: -len("/manifest.json")]
    url = url.rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL addon Stremio non valido: deve iniziare con http:// o https://")
    return url


def get_config(get_setting: Optional[Callable]) -> dict:
    if get_setting is None:
        return {"url": "", "enabled": False}
    url = normalize_addon_url_safe(get_setting(URL_KEY, ""))
    return {"url": url, "enabled": bool(get_setting(ENABLED_KEY, True)) and bool(url)}


def normalize_addon_url_safe(url: Optional[str]) -> str:
    try:
        return normalize_addon_url(url)
    except ValueError:
        return ""


# --------------------------------------------------------------------------- TMDB -> IMDb
def _tmdb_auth() -> tuple[dict, dict]:
    api_key = os.environ.get("TMDB_API_KEY", "")
    if api_key.startswith("eyJ"):
        return {}, {"Authorization": f"Bearer {api_key}"}
    return {"api_key": api_key}, {}


async def fetch_imdb_id(media_type: str, tmdb_id: int, db=None) -> Optional[str]:
    """Resolve the IMDb id of a TMDB title (cached in Mongo `external_ids` when a db is given)."""
    if db is not None:
        doc = db["external_ids"].find_one({"media_type": media_type, "tmdbId": tmdb_id}, {"_id": 0})
        if doc and doc.get("imdb_id"):
            return doc["imdb_id"]
    params, headers = _tmdb_auth()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{TMDB_BASE_URL}/{media_type}/{tmdb_id}/external_ids", params=params, headers=headers)
        if r.status_code != 200:
            return None
        imdb_id = (r.json().get("imdb_id") or "").strip() or None
    except Exception as e:
        logger.warning(f"TMDB external_ids failed for {media_type}/{tmdb_id}: {e}")
        return None
    if imdb_id and db is not None:
        db["external_ids"].update_one(
            {"media_type": media_type, "tmdbId": tmdb_id}, {"$set": {"imdb_id": imdb_id}}, upsert=True
        )
    return imdb_id


# --------------------------------------------------------------------------- addon calls
def stremio_id(imdb_id: str, media_type: str, season: Optional[int], episode: Optional[int]) -> tuple[str, str]:
    """Return (stremio_type, stremio_id) for the request path."""
    if media_type == "tv":
        return "series", f"{imdb_id}:{season}:{episode}"
    return "movie", imdb_id


async def fetch_manifest(addon_url: str) -> dict:
    addon_url = normalize_addon_url(addon_url)
    if not addon_url:
        raise StremioError("URL addon non configurato")
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            r = await client.get(f"{addon_url}/manifest.json")
    except httpx.TimeoutException:
        raise StremioError("Addon non raggiungibile: timeout")
    except httpx.HTTPError as e:
        raise StremioError(f"Addon non raggiungibile: {e.__class__.__name__}")
    if r.status_code != 200:
        raise StremioError(f"Manifest non valido: HTTP {r.status_code}")
    try:
        data = r.json()
    except ValueError:
        raise StremioError("Manifest non valido: risposta non JSON")
    if not isinstance(data, dict) or not data.get("id"):
        raise StremioError("Manifest non valido: campo 'id' mancante")
    return data


async def fetch_streams(addon_url: str, media_type: str, imdb_id: str, season: Optional[int] = None, episode: Optional[int] = None) -> list[dict]:
    """Call the addon stream resource and return the parsed, playable streams."""
    addon_url = normalize_addon_url(addon_url)
    if not addon_url:
        raise StremioError("URL addon non configurato")
    s_type, s_id = stremio_id(imdb_id, media_type, season, episode)
    url = f"{addon_url}/stream/{s_type}/{quote(s_id, safe=':')}.json"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            r = await client.get(url)
    except httpx.TimeoutException:
        raise StremioError("Addon non raggiungibile: timeout")
    except httpx.HTTPError as e:
        raise StremioError(f"Addon non raggiungibile: {e.__class__.__name__}")
    if r.status_code == 404:
        return []
    if r.status_code != 200:
        raise StremioError(f"Risposta addon non valida: HTTP {r.status_code}")
    try:
        data = r.json()
    except ValueError:
        raise StremioError("Risposta addon non valida: non JSON")
    return parse_streams(data)


# --------------------------------------------------------------------------- parsing
def parse_streams(data: dict) -> list[dict]:
    """Keep only http(s) `url` streams (torrent infoHash / ytId / externalUrl are not playable by the native player)."""
    items = data.get("streams") if isinstance(data, dict) else None
    out = []
    for s in items or []:
        if not isinstance(s, dict):
            continue
        url = (s.get("url") or "").strip()
        if url and not urlparse(url).scheme:
            url = "https://" + url
        if urlparse(url).scheme not in ("http", "https"):
            continue
        hints = s.get("behaviorHints") or {}
        headers = ((hints.get("proxyHeaders") or {}).get("request") or {}) if isinstance(hints, dict) else {}
        filename = (hints.get("filename") or "") if isinstance(hints, dict) else ""
        out.append({
            "url": url,
            "type": stream_type_for(url) if not filename else stream_type_for(filename),
            "name": (s.get("name") or "").strip(),
            "title": (s.get("title") or s.get("description") or "").strip(),
            "headers": {k: str(v) for k, v in headers.items() if v} if isinstance(headers, dict) else {},
            "not_web_ready": bool(hints.get("notWebReady")) if isinstance(hints, dict) else False,
        })
    return out


def pick_best(streams: list[dict]) -> Optional[dict]:
    """Prefer web-ready HLS, then web-ready MP4, then anything else, preserving addon order."""
    if not streams:
        return None
    ranked = sorted(
        streams,
        key=lambda s: (s["not_web_ready"], 0 if s["type"] == "hls" else 1),
    )
    return ranked[0]
