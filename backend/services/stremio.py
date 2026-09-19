"""
Omni/Stremio stream client used by the native FLIX-IT player.

FLIX-IT supports two Omni modes:
1. embedded (default): the Omni-compatible core runs inside the same FastAPI
   process and resolves authorized streams stored in FLIX-IT's database;
2. remote: when OMNI_ADDON_URL or the legacy Admin Stremio URL is configured,
   FLIX-IT consumes the remote Stremio /stream resource.

Remote protocol:
  GET {addon}/manifest.json
  GET {addon}/stream/{movie|series}/{imdb_id}.json
  GET {addon}/stream/series/{imdb_id}:{season}:{episode}.json

Runtime configuration:
  OMNI_ADDON_URL   optional remote Omni base URL. A trailing /manifest.json is accepted.
  OMNI_ENABLED     global boolean override (1/true/yes/on or 0/false/no/off).

Backward-compatible Admin settings:
  stremio_addon_url
  stremio_enabled

When no URL is configured, source="embedded" is selected automatically.
"""
import logging
import os
from typing import Callable, Optional
from urllib.parse import quote, urlparse

import httpx

from .resolvers.base import stream_type_for

logger = logging.getLogger("player.omni")

URL_KEY = "stremio_addon_url"
ENABLED_KEY = "stremio_enabled"
OMNI_URL_ENV = "OMNI_ADDON_URL"
OMNI_ENABLED_ENV = "OMNI_ENABLED"

TMDB_BASE_URL = "https://api.themoviedb.org/3"
REQUEST_TIMEOUT = 15.0


class StremioError(Exception):
    """Omni/Stremio addon unreachable or returned an invalid response."""


def normalize_addon_url(url: Optional[str]) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if url.endswith("/manifest.json"):
        url = url[: -len("/manifest.json")]
    url = url.rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL Omni non valido: deve iniziare con http:// o https://")
    return url


def normalize_addon_url_safe(url: Optional[str]) -> str:
    try:
        return normalize_addon_url(url)
    except ValueError:
        return ""


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    value = str(raw).strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


def get_config(get_setting: Optional[Callable]) -> dict:
    """Return effective Omni config; embedded mode is the zero-config default."""
    global_enabled = _env_bool(OMNI_ENABLED_ENV, True)
    if not global_enabled:
        return {"url": "", "enabled": False, "source": "disabled"}

    env_url = normalize_addon_url_safe(os.environ.get(OMNI_URL_ENV, ""))
    if env_url:
        return {
            "url": env_url,
            "enabled": True,
            "source": "env",
        }

    if get_setting is not None:
        url = normalize_addon_url_safe(get_setting(URL_KEY, ""))
        if url and bool(get_setting(ENABLED_KEY, True)):
            return {"url": url, "enabled": True, "source": "admin"}

    # No separate Omni deployment is required. The resolver switches to
    # services.omni_embedded inside the same FastAPI process.
    return {"url": "", "enabled": True, "source": "embedded"}


# --------------------------------------------------------------------------- TMDB -> IMDb
def _tmdb_auth() -> tuple[dict, dict]:
    api_key = os.environ.get("TMDB_API_KEY", "")
    if api_key.startswith("eyJ"):
        return {}, {"Authorization": f"Bearer {api_key}"}
    return {"api_key": api_key}, {}


async def fetch_imdb_id(media_type: str, tmdb_id: int, db=None) -> Optional[str]:
    """Resolve the IMDb id of a TMDB title (cached in Mongo `external_ids`)."""
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
            {"media_type": media_type, "tmdbId": tmdb_id},
            {"$set": {"imdb_id": imdb_id}},
            upsert=True,
        )
    return imdb_id


# --------------------------------------------------------------------------- addon calls
def stremio_id(imdb_id: str, media_type: str, season: Optional[int], episode: Optional[int]) -> tuple[str, str]:
    """Return (stremio_type, stremio_id) for a remote request path."""
    if media_type == "tv":
        return "series", f"{imdb_id}:{season}:{episode}"
    return "movie", imdb_id


async def fetch_manifest(addon_url: str) -> dict:
    addon_url = normalize_addon_url(addon_url)
    if not addon_url:
        raise StremioError("URL Omni non configurato")
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            r = await client.get(f"{addon_url}/manifest.json")
    except httpx.TimeoutException:
        raise StremioError("Omni non raggiungibile: timeout")
    except httpx.HTTPError as e:
        raise StremioError(f"Omni non raggiungibile: {e.__class__.__name__}")
    if r.status_code != 200:
        raise StremioError(f"Manifest Omni non valido: HTTP {r.status_code}")
    try:
        data = r.json()
    except ValueError:
        raise StremioError("Manifest Omni non valido: risposta non JSON")
    if not isinstance(data, dict) or not data.get("id"):
        raise StremioError("Manifest Omni non valido: campo 'id' mancante")
    return data


async def fetch_streams(
    addon_url: str,
    media_type: str,
    imdb_id: str,
    season: Optional[int] = None,
    episode: Optional[int] = None,
) -> list[dict]:
    """Call a remote Omni stream resource and return HTTP(S) streams playable by FLIX-IT."""
    addon_url = normalize_addon_url(addon_url)
    if not addon_url:
        raise StremioError("URL Omni non configurato")
    s_type, s_id = stremio_id(imdb_id, media_type, season, episode)
    url = f"{addon_url}/stream/{s_type}/{quote(s_id, safe=':')}.json"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            r = await client.get(url)
    except httpx.TimeoutException:
        raise StremioError("Omni non raggiungibile: timeout")
    except httpx.HTTPError as e:
        raise StremioError(f"Omni non raggiungibile: {e.__class__.__name__}")
    if r.status_code == 404:
        return []
    if r.status_code != 200:
        raise StremioError(f"Risposta Omni non valida: HTTP {r.status_code}")
    try:
        data = r.json()
    except ValueError:
        raise StremioError("Risposta Omni non valida: non JSON")
    return parse_streams(data)


# --------------------------------------------------------------------------- parsing
def _stream_type(url: str, filename: str = "") -> str:
    """Recognise Omni lazy/proxy HLS URLs even when they do not end in .m3u8."""
    candidate = filename or url
    path = urlparse(candidate).path.lower()
    if path.endswith(".m3u8") or "/hls/" in path or "/resolve/" in path:
        return "hls"
    return stream_type_for(candidate)


def parse_streams(data: dict) -> list[dict]:
    """
    Keep HTTP(S) `url` streams. Torrent-only infoHash entries remain inside a
    remote Omni/debrid service unless it converts them to an HTTP(S) URL first.
    """
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
            "type": _stream_type(url, filename),
            "name": (s.get("name") or "").strip(),
            "title": (s.get("title") or s.get("description") or "").strip(),
            "headers": {k: str(v) for k, v in headers.items() if v} if isinstance(headers, dict) else {},
            "not_web_ready": bool(hints.get("notWebReady")) if isinstance(hints, dict) else False,
        })
    return out


def pick_best(streams: list[dict]) -> Optional[dict]:
    """Prefer web-ready HLS, then web-ready MP4, preserving source order."""
    if not streams:
        return None
    ranked = sorted(
        streams,
        key=lambda s: (s["not_web_ready"], 0 if s["type"] == "hls" else 1),
    )
    return ranked[0]
