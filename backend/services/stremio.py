"""
Omni/Stremio stream client used by the native FLIX-IT player.

FLIX-IT supports two Omni modes:
1. embedded (default): the Omni-compatible core runs inside the same FastAPI
   process and resolves authorized streams stored in FLIX-IT's database;
2. remote: when OMNI_ADDON_URL or the legacy Admin Stremio URL is configured,
   FLIX-IT consumes the remote Stremio /stream resource.
"""
import logging
import os
import re
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
_HTTP_MAX_CONNECTIONS = 24
_HTTP_MAX_KEEPALIVE = 12

_client: Optional[httpx.AsyncClient] = None
_imdb_memory: dict[tuple[str, int], str] = {}
_IMDB_MEMORY_MAX = 6000
_external_ids_index_ready = False


class StremioError(Exception):
    """Omni/Stremio addon unreachable or returned an invalid response."""


def _http() -> httpx.AsyncClient:
    """One keep-alive client for TMDB external ids and remote Omni calls."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(REQUEST_TIMEOUT, connect=5.0),
            follow_redirects=True,
            limits=httpx.Limits(
                max_connections=_HTTP_MAX_CONNECTIONS,
                max_keepalive_connections=_HTTP_MAX_KEEPALIVE,
                keepalive_expiry=60.0,
            ),
        )
    return _client


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

    return {"url": "", "enabled": True, "source": "embedded"}


# --------------------------------------------------------------------------- TMDB -> IMDb
def _tmdb_auth() -> tuple[dict, dict]:
    api_key = os.environ.get("TMDB_API_KEY", "")
    if api_key.startswith("eyJ"):
        return {}, {"Authorization": f"Bearer {api_key}"}
    return {"api_key": api_key}, {}


def _ensure_external_ids_index(db) -> None:
    global _external_ids_index_ready
    if _external_ids_index_ready or db is None:
        return
    try:
        db["external_ids"].create_index(
            [("media_type", 1), ("tmdbId", 1)],
            unique=True,
            background=True,
        )
    except Exception:
        pass
    _external_ids_index_ready = True


async def fetch_imdb_id(media_type: str, tmdb_id: int, db=None) -> Optional[str]:
    """Resolve the IMDb id of a TMDB title with memory + Mongo + TMDB caching."""
    media_type = "tv" if media_type == "tv" else "movie"
    tmdb_id = int(tmdb_id)
    memory_key = (media_type, tmdb_id)
    memory_hit = _imdb_memory.get(memory_key)
    if memory_hit:
        return memory_hit

    if db is not None:
        _ensure_external_ids_index(db)
        try:
            doc = db["external_ids"].find_one(
                {"media_type": media_type, "tmdbId": tmdb_id},
                {"_id": 0, "imdb_id": 1},
            )
        except Exception:
            doc = None
        if doc and doc.get("imdb_id"):
            imdb_id = str(doc["imdb_id"])
            if len(_imdb_memory) >= _IMDB_MEMORY_MAX:
                _imdb_memory.clear()
            _imdb_memory[memory_key] = imdb_id
            return imdb_id

    params, headers = _tmdb_auth()
    try:
        r = await _http().get(
            f"{TMDB_BASE_URL}/{media_type}/{tmdb_id}/external_ids",
            params=params,
            headers=headers,
            timeout=10.0,
        )
        if r.status_code != 200:
            return None
        imdb_id = (r.json().get("imdb_id") or "").strip() or None
    except Exception as e:
        logger.warning("TMDB external_ids failed for %s/%s: %s", media_type, tmdb_id, e.__class__.__name__)
        return None

    if imdb_id:
        if len(_imdb_memory) >= _IMDB_MEMORY_MAX:
            _imdb_memory.clear()
        _imdb_memory[memory_key] = imdb_id
        if db is not None:
            try:
                db["external_ids"].update_one(
                    {"media_type": media_type, "tmdbId": tmdb_id},
                    {"$set": {"imdb_id": imdb_id}},
                    upsert=True,
                )
            except Exception:
                pass
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
        r = await _http().get(f"{addon_url}/manifest.json")
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
        r = await _http().get(url)
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


def _quality_score(stream: dict) -> int:
    text = " ".join(
        str(stream.get(k) or "")
        for k in ("name", "title", "filename", "url")
    ).lower()
    if re.search(r"\b(2160p|4k|uhd)\b", text):
        return 400
    if re.search(r"\b1440p\b", text):
        return 300
    if re.search(r"\b(1080p|fhd|full[ ._-]?hd)\b", text):
        return 200
    if re.search(r"\b720p\b", text):
        return 100
    if re.search(r"\b(576p|480p|sd)\b", text):
        return 50
    return 0


def _stream_text(stream: dict) -> str:
    return " ".join(
        str(stream.get(k) or "")
        for k in ("name", "title", "filename", "url")
    ).lower()


def _language_rank(stream: dict) -> int:
    """Lower is better. Explicit ENG-only streams are rejected by pick_best."""
    text = _stream_text(stream)
    has_italian = bool(re.search(r"(^|[^a-z])(ita|italian|italiano|it-it)([^a-z]|$)", text))
    has_multi = bool(re.search(r"(^|[^a-z])(multi|multiaudio|multi-audio|dual[ ._-]?audio)([^a-z]|$)", text))
    has_english = bool(re.search(r"(^|[^a-z])(eng|english|inglese|en-us|en-gb)([^a-z]|$)", text))

    if has_italian:
        return 0
    if has_multi and not has_english:
        return 1
    if has_english:
        return 99
    return 2


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
            "filename": filename,
            "headers": {k: str(v) for k, v in headers.items() if v} if isinstance(headers, dict) else {},
            "not_web_ready": bool(hints.get("notWebReady")) if isinstance(hints, dict) else False,
        })
    return out


def pick_best(streams: list[dict]) -> Optional[dict]:
    """Prefer Italian/MULTI web-ready streams, then quality; never select explicit ENG-only streams."""
    if not streams:
        return None

    eligible = [stream for stream in streams if _language_rank(stream) < 99]
    if not eligible:
        logger.info("Omni returned only explicit ENG streams; refusing non-Italian playback")
        return None

    ranked = sorted(
        eligible,
        key=lambda s: (
            _language_rank(s),
            s["not_web_ready"],
            -_quality_score(s),
            0 if s["type"] == "hls" else 1,
        ),
    )
    return ranked[0]
