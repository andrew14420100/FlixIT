"""
VixSrcResolver: resolves the direct HLS master playlist from vixsrc.to.

Adapted (2026) from https://github.com/Schumynet/vixsrc-without-embed. vixsrc.to
is now a client-rendered app, so the flow is two steps:

  1. GET /api/{movie|tv}/{id}[/{season}/{episode}]  -> JSON {"src": "/embed/<id>?token=..&expires=..&canPlayFHD=1"}
  2. GET the embed page                              -> inline `window.masterPlaylist`
     ({token, expires, url}) + `window.canPlayFHD`

The final playlist URL is `url` with `token`, `expires` and (when FHD) `h=1`
appended. vixsrc.to playlists/segments require `Referer: <embed url>`, so the
payload carries `headers`; the ResolverRegistry routes the stream through the
internal HLS proxy (or MediaFlow) which injects those headers.
"""
import logging
import re
from typing import Optional
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, urljoin

import httpx

from .base import BaseResolver

logger = logging.getLogger("player.vixsrc")

VIXSRC_BASE = "https://vixsrc.to"
ENABLED_KEY = "vixsrc_enabled"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_TOKEN_RE = re.compile(r"['\"]token['\"]\s*:\s*['\"]([^'\"]+)['\"]")
_EXPIRES_RE = re.compile(r"['\"]expires['\"]\s*:\s*['\"]([^'\"]+)['\"]")
_URL_RE = re.compile(r"\burl\s*:\s*['\"](https?://[^'\"]+)['\"]")
_FHD_RE = re.compile(r"canPlayFHD\s*=\s*(true|false)", re.IGNORECASE)


def _api_url(tmdb_id, season: Optional[int], episode: Optional[int]) -> str:
    if season is not None and episode is not None:
        return f"{VIXSRC_BASE}/api/tv/{tmdb_id}/{season}/{episode}"
    return f"{VIXSRC_BASE}/api/movie/{tmdb_id}"


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
    tmdb_id, season: Optional[int] = None, episode: Optional[int] = None, media_type: str = "movie"
) -> Optional[dict]:
    is_tv = media_type == "tv"
    api_url = _api_url(tmdb_id, season if is_tv else None, episode if is_tv else None)
    base_headers = {
        "User-Agent": USER_AGENT,
        "Referer": f"{VIXSRC_BASE}/",
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=10.0), follow_redirects=True) as client:
            api_res = await client.get(api_url, headers=base_headers)
            if api_res.status_code != 200:
                logger.info("VixSrc API %s -> HTTP %s", api_url, api_res.status_code)
                return None
            try:
                src = (api_res.json() or {}).get("src")
            except ValueError:
                return None
            if not src:
                return None

            embed_url = urljoin(VIXSRC_BASE + "/", src)
            embed_res = await client.get(embed_url, headers={**base_headers, "Referer": f"{VIXSRC_BASE}/"})
            if embed_res.status_code != 200:
                logger.info("VixSrc embed %s -> HTTP %s", embed_url, embed_res.status_code)
                return None
            html = embed_res.text

            url_m = _URL_RE.search(html) or _URL_RE.search(html.replace("\\/", "/"))
            if not url_m:
                logger.info("VixSrc: playlist url not found for %s", embed_url)
                return None
            token_m = _TOKEN_RE.search(html)
            expires_m = _EXPIRES_RE.search(html)
            fhd_m = _FHD_RE.search(html)

            playlist_url = _build_playlist_url(
                url_m.group(1).strip(),
                token_m.group(1) if token_m else "",
                expires_m.group(1) if expires_m else "",
                bool(fhd_m and fhd_m.group(1).lower() == "true"),
            )
            return {
                "success": True,
                "stream": playlist_url,
                "type": "hls",
                "source": "vixsrc",
                "headers": {"Referer": embed_url, "User-Agent": USER_AGENT},
            }
    except httpx.HTTPError as e:
        logger.warning("VixSrc HTTP error for %s: %s", api_url, e)
        return None
    except Exception as e:
        logger.warning("VixSrc resolve error for %s: %s", api_url, e)
        return None


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
