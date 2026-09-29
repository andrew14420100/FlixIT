"""
VixSrcResolver: resolves the direct HLS master playlist from vixsrc.to.

Playback always requests the Italian variant. If the VixSrc payload explicitly
reports another/original audio language and no Italian audio, the stream is
rejected instead of reaching the player.
"""

import logging
import re
import time
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, urljoin, parse_qs, urlparse

import httpx

from .base import BaseResolver

logger = logging.getLogger("player.vixsrc")

VIXSRC_BASE = "https://vixsrc.to"
ENABLED_KEY = "vixsrc_enabled"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

_TOKEN_RE = re.compile(r"""['"]token['"]\s*:\s*['"]([^'"]+)['"]""", re.IGNORECASE)
_EXPIRES_RE = re.compile(r"""['"]expires['"]\s*:\s*['"]([^'"]+)['"]""", re.IGNORECASE)
_URL_RE = re.compile(r"""\burl\s*:\s*['"](https?://[^'"]+)['"]""", re.IGNORECASE)
_FHD_RE = re.compile(r"""canPlayFHD\s*=\s*(true|false)""", re.IGNORECASE)

NOT_FOUND = {"success": False, "reason": "not_found"}
ORIGINAL_ONLY = {
    "success": False,
    "reason": "original_only",
    "message": "Contenuto disponibile solo in lingua originale",
    "italian_audio": False,
}

_client: Optional[httpx.AsyncClient] = None


class VixSrcUnavailable(Exception):
    """Transient upstream failure; must not be cached as a miss."""


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=4.0, read=8.0, write=8.0, pool=4.0),
            follow_redirects=True,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=12, keepalive_expiry=90.0),
            http2=False,
        )
    return _client


async def _get(url: str, headers: dict, label: str) -> httpx.Response:
    last = None
    for attempt in range(2):
        started = time.perf_counter()
        try:
            response = await _http().get(url, headers=headers)
            elapsed = time.perf_counter() - started
            logger.info("[VIXSRC] %s HTTP %s %.3fs attempt=%d", label, response.status_code, elapsed, attempt + 1)
            return response
        except httpx.HTTPError as exc:
            elapsed = time.perf_counter() - started
            last = exc
            logger.warning("[VIXSRC] %s transport error %.3fs attempt=%d: %s", label, elapsed, attempt + 1, exc.__class__.__name__)
            if attempt == 0:
                continue
    raise VixSrcUnavailable(f"{last.__class__.__name__ if last else 'HTTPError'} on {url}")


def _normal(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower().replace("_", "-"))


def _is_italian(value: Any) -> bool:
    text = _normal(value)
    return bool(
        text in {"it", "ita", "it-it", "italian", "italiano", "italiana", "dub ita", "doppiato italiano"}
        or re.search(r"(?:^|[^a-z])(it-it|ita|italian(?:o|a)?)(?:$|[^a-z])", text)
    )


def _is_non_italian_audio(value: Any) -> bool:
    text = _normal(value)
    if not text:
        return False
    if re.search(r"\b(?:sub\s*-?\s*ita|subbed|audio\s+originale|lingua\s+originale|original\s+audio)\b", text):
        return True
    language_codes = {
        "en", "eng", "en-us", "en-gb", "english", "fr", "fra", "french", "de", "deu", "german",
        "es", "spa", "spanish", "pt", "por", "portuguese", "ja", "jpn", "japanese", "ko", "kor",
        "korean", "zh", "zho", "chinese", "ru", "rus", "russian", "tr", "tur", "turkish", "original",
        "originale",
    }
    return text in language_codes


def _language_hints(payload: Any) -> list[str]:
    hints: list[str] = []

    def add(value: Any) -> None:
        if isinstance(value, (str, int, float, bool)):
            text = str(value).strip()
            if text and text not in hints:
                hints.append(text)
        elif isinstance(value, (list, tuple)):
            for child in value[:12]:
                add(child)
        elif isinstance(value, dict):
            for child in list(value.values())[:12]:
                add(child)

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for raw_key, value in node.items():
                key = _normal(raw_key).replace("-", "")
                if any(marker in key for marker in ("lang", "locale", "audio", "dub", "voice")):
                    add(value)
                if str(raw_key).lower() in {"src", "url", "embed", "embed_url", "player"} and isinstance(value, str):
                    try:
                        query = parse_qs(urlparse(value).query)
                    except Exception:
                        query = {}
                    for query_key in ("lang", "language", "locale", "audio", "audio_language", "audio-lang", "dub"):
                        for query_value in query.get(query_key, []):
                            add(query_value)
                if isinstance(value, (dict, list, tuple)):
                    walk(value)
        elif isinstance(node, (list, tuple)):
            for child in node:
                walk(child)

    walk(payload)
    return hints[:40]


def _api_url(tmdb_id, season: Optional[int], episode: Optional[int]) -> str:
    if season is not None and episode is not None:
        return f"{VIXSRC_BASE}/api/tv/{tmdb_id}/{season}/{episode}?lang=it"
    return f"{VIXSRC_BASE}/api/movie/{tmdb_id}?lang=it"


def _build_playlist_url(raw_url: str, token: str, expires: str, can_fhd: bool) -> str:
    parts = urlsplit(raw_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if token:
        query["token"] = token
    if expires:
        query["expires"] = expires
    if can_fhd:
        query["h"] = "1"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


async def resolve_vixsrc(
    tmdb_id,
    season: Optional[int] = None,
    episode: Optional[int] = None,
    media_type: str = "movie",
) -> Optional[dict]:
    total_started = time.perf_counter()
    is_tv = media_type == "tv"
    api_url = _api_url(tmdb_id, season if is_tv else None, episode if is_tv else None)

    base_headers = {
        "User-Agent": USER_AGENT,
        "Referer": f"{VIXSRC_BASE}/",
        "Accept-Language": "it-IT,it;q=1.0",
    }
    api_headers = {**base_headers, "Accept": "application/json"}
    embed_headers = {**base_headers, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"}

    api_started = time.perf_counter()
    api_res = await _get(api_url, api_headers, "API-IT")
    api_elapsed = time.perf_counter() - api_started

    if api_res.status_code in {404, 410, 422}:
        return dict(NOT_FOUND)
    if api_res.status_code != 200:
        raise VixSrcUnavailable(f"HTTP {api_res.status_code}")

    try:
        payload = api_res.json()
        src = (payload or {}).get("src")
    except ValueError:
        raise VixSrcUnavailable("invalid JSON")

    if not src:
        return dict(NOT_FOUND)

    hints = _language_hints(payload)
    has_italian = any(_is_italian(value) for value in hints)
    has_non_italian = any(_is_non_italian_audio(value) for value in hints)
    if has_non_italian and not has_italian:
        logger.info("[VIXSRC] rejected original-only tmdb=%s type=%s hints=%s", tmdb_id, media_type, hints[:4])
        return {**ORIGINAL_ONLY, "detected_languages": hints[:8]}

    embed_url = urljoin(VIXSRC_BASE + "/", str(src))
    if "mediaflow" in embed_url.lower():
        raise VixSrcUnavailable("VixSrc returned a MediaFlow URL instead of a VixSrc embed")

    embed_started = time.perf_counter()
    embed_res = await _get(embed_url, embed_headers, "EMBED-IT")
    embed_elapsed = time.perf_counter() - embed_started

    if embed_res.status_code in {404, 410}:
        return dict(NOT_FOUND)
    if embed_res.status_code != 200:
        raise VixSrcUnavailable(f"embed HTTP {embed_res.status_code}")

    html = embed_res.text
    search_html = html
    url_m = _URL_RE.search(search_html)
    if not url_m:
        search_html = html.replace("\\/", "/")
        url_m = _URL_RE.search(search_html)
    if not url_m:
        raise VixSrcUnavailable("playlist url not found")

    token_m = _TOKEN_RE.search(search_html)
    expires_m = _EXPIRES_RE.search(search_html)
    fhd_m = _FHD_RE.search(search_html)

    playlist_url = _build_playlist_url(
        url_m.group(1).strip(),
        token_m.group(1) if token_m else "",
        expires_m.group(1) if expires_m else "",
        bool(fhd_m and fhd_m.group(1).lower() == "true"),
    )

    total_elapsed = time.perf_counter() - total_started
    logger.info(
        "[VIXSRC] RESOLVED-IT tmdb=%s type=%s api=%.3fs embed=%.3fs total=%.3fs html=%d token=%s expires=%s fhd=%s",
        tmdb_id, media_type, api_elapsed, embed_elapsed, total_elapsed, len(html), bool(token_m), bool(expires_m),
        bool(fhd_m and fhd_m.group(1).lower() == "true"),
    )

    return {
        "success": True,
        "stream": playlist_url,
        "type": "hls",
        "source": "vixsrc",
        "language": "it",
        "italian_audio": True,
        "language_selection": "vixsrc_lang_it",
        "detected_languages": hints[:8],
        "headers": {"Referer": embed_url, "User-Agent": USER_AGENT},
    }


class VixSrcResolver(BaseResolver):
    id = "vixsrc"
    label = "VixSrc (vixsrc.to)"
    always_active = False
    configurable = True

    def is_active(self) -> bool:
        if self._get_setting is None:
            return True
        try:
            raw = self._get_setting(ENABLED_KEY, True)
            if isinstance(raw, str):
                return raw.strip().lower() in {"1", "true", "yes", "on", "enabled"}
            return bool(raw)
        except Exception:
            return True

    async def resolve(
        self,
        tmdb_id: int,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        media_type: str = "movie",
    ) -> Optional[dict]:
        return await resolve_vixsrc(tmdb_id, season, episode, media_type)
