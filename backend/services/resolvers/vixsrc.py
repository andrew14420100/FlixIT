"""
VixSrcResolver: resolves the direct HLS master playlist from vixsrc.to.

Optimized version:
- reuses a global httpx.AsyncClient with connection pooling
- uses separate, tighter timeouts for API and embed requests
- retries only transient transport errors, with no artificial sleep
- uses focused Accept headers
- logs only request timings and safe metadata (never the HTML body/token)
- preserves the same resolver response shape and VixSrc -> internal proxy flow
"""

import logging
import re
import time
from typing import Optional
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, urljoin

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

_TOKEN_RE = re.compile(
    r"""['"]token['"]\s*:\s*['"]([^'"]+)['"]""",
    re.IGNORECASE,
)
_EXPIRES_RE = re.compile(
    r"""['"]expires['"]\s*:\s*['"]([^'"]+)['"]""",
    re.IGNORECASE,
)
_URL_RE = re.compile(
    r"""\burl\s*:\s*['"](https?://[^'"]+)['"]""",
    re.IGNORECASE,
)
_FHD_RE = re.compile(
    r"""canPlayFHD\s*=\s*(true|false)""",
    re.IGNORECASE,
)

NOT_FOUND = {"success": False, "reason": "not_found"}

_client: Optional[httpx.AsyncClient] = None


class VixSrcUnavailable(Exception):
    """Transient upstream failure; must not be cached as a miss."""


def _http() -> httpx.AsyncClient:
    """Return one reusable AsyncClient so TCP/TLS connections can be pooled."""
    global _client

    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=4.0,
                read=8.0,
                write=8.0,
                pool=4.0,
            ),
            follow_redirects=True,
            limits=httpx.Limits(
                max_connections=16,
                max_keepalive_connections=8,
                keepalive_expiry=60.0,
            ),
            http2=False,
        )

    return _client


async def _get(url: str, headers: dict, label: str) -> httpx.Response:
    """
    GET with one retry for transport errors only.

    No sleep is inserted between attempts: if a connection fails transiently,
    retry immediately. HTTP 4xx/5xx responses are returned to the caller so
    resolver policy can handle them explicitly.
    """
    last = None

    for attempt in range(2):
        started = time.perf_counter()
        try:
            response = await _http().get(url, headers=headers)
            elapsed = time.perf_counter() - started

            logger.info(
                "[VIXSRC] %s HTTP %s %.3fs attempt=%d",
                label,
                response.status_code,
                elapsed,
                attempt + 1,
            )
            return response

        except httpx.HTTPError as exc:
            elapsed = time.perf_counter() - started
            last = exc

            logger.warning(
                "[VIXSRC] %s transport error %.3fs attempt=%d: %s",
                label,
                elapsed,
                attempt + 1,
                exc.__class__.__name__,
            )

            if attempt == 0:
                continue

    raise VixSrcUnavailable(
        f"{last.__class__.__name__ if last else 'HTTPError'} on {url}"
    )


def _api_url(
    tmdb_id,
    season: Optional[int],
    episode: Optional[int],
) -> str:
    if season is not None and episode is not None:
        return f"{VIXSRC_BASE}/api/tv/{tmdb_id}/{season}/{episode}"
    return f"{VIXSRC_BASE}/api/movie/{tmdb_id}"


def _build_playlist_url(
    raw_url: str,
    token: str,
    expires: str,
    can_fhd: bool,
) -> str:
    parts = urlsplit(raw_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))

    if token:
        query["token"] = token
    if expires:
        query["expires"] = expires
    if can_fhd:
        query["h"] = "1"

    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urlencode(query),
            parts.fragment,
        )
    )


async def resolve_vixsrc(
    tmdb_id,
    season: Optional[int] = None,
    episode: Optional[int] = None,
    media_type: str = "movie",
) -> Optional[dict]:
    total_started = time.perf_counter()

    is_tv = media_type == "tv"
    api_url = _api_url(
        tmdb_id,
        season if is_tv else None,
        episode if is_tv else None,
    )

    base_headers = {
        "User-Agent": USER_AGENT,
        "Referer": f"{VIXSRC_BASE}/",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    }

    api_headers = {
        **base_headers,
        "Accept": "application/json",
    }

    embed_headers = {
        **base_headers,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    }

    # ---------------------------------------------------------------
    # 1. VixSrc API -> embed src
    # ---------------------------------------------------------------
    api_started = time.perf_counter()
    api_res = await _get(api_url, api_headers, "API")
    api_elapsed = time.perf_counter() - api_started

    if api_res.status_code == 404:
        return dict(NOT_FOUND)

    if api_res.status_code != 200:
        logger.info(
            "VixSrc API %s -> HTTP %s",
            api_url,
            api_res.status_code,
        )
        raise VixSrcUnavailable(f"HTTP {api_res.status_code}")

    try:
        payload = api_res.json()
        src = (payload or {}).get("src")
    except ValueError:
        raise VixSrcUnavailable("invalid JSON")

    if not src:
        return dict(NOT_FOUND)

    embed_url = urljoin(VIXSRC_BASE + "/", str(src))

    # Safety check: never accept a MediaFlow URL as VixSrc embed.
    if "mediaflow" in embed_url.lower():
        raise VixSrcUnavailable(
            "VixSrc returned a MediaFlow URL instead of a VixSrc embed"
        )

    # ---------------------------------------------------------------
    # 2. VixSrc embed -> inline masterPlaylist data
    # ---------------------------------------------------------------
    embed_started = time.perf_counter()
    embed_res = await _get(embed_url, embed_headers, "EMBED")
    embed_elapsed = time.perf_counter() - embed_started

    if embed_res.status_code == 404:
        return dict(NOT_FOUND)

    if embed_res.status_code != 200:
        logger.info(
            "VixSrc embed %s -> HTTP %s",
            embed_url,
            embed_res.status_code,
        )
        raise VixSrcUnavailable(f"embed HTTP {embed_res.status_code}")

    html = embed_res.text

    # Handle JSON/JS escaped forward slashes without logging page contents.
    search_html = html
    url_m = _URL_RE.search(search_html)

    if not url_m:
        search_html = html.replace("\\/", "/")
        url_m = _URL_RE.search(search_html)

    if not url_m:
        logger.info(
            "VixSrc: playlist url not found for %s (html=%d bytes)",
            embed_url,
            len(html),
        )
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
        "[VIXSRC] RESOLVED tmdb=%s type=%s api=%.3fs embed=%.3fs total=%.3fs "
        "html=%d token=%s expires=%s fhd=%s",
        tmdb_id,
        media_type,
        api_elapsed,
        embed_elapsed,
        total_elapsed,
        len(html),
        bool(token_m),
        bool(expires_m),
        bool(fhd_m and fhd_m.group(1).lower() == "true"),
    )

    return {
        "success": True,
        "stream": playlist_url,
        "type": "hls",
        "source": "vixsrc",
        "headers": {
            "Referer": embed_url,
            "User-Agent": USER_AGENT,
        },
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
                return raw.strip().lower() in {
                    "1",
                    "true",
                    "yes",
                    "on",
                    "enabled",
                }

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
        return await resolve_vixsrc(
            tmdb_id,
            season,
            episode,
            media_type,
        )
