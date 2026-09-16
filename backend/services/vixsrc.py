import logging
import re
from typing import Optional

import httpx
from fastapi import HTTPException

logger = logging.getLogger("uvicorn.error")

VIXSRC_BASE = "https://vixsrc.to"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


def _absolute_url(url: str, base: str = VIXSRC_BASE) -> str:
    """Convert protocol-relative/relative URLs to absolute URLs."""
    if not url:
        return ""
    url = url.strip().strip("'\"")
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return base.rstrip("/") + url
    return url


def _extract_js_value(html: str, key: str) -> str:
    """
    Extract a simple quoted JS object value:
      token: "..."
      "token": '...'
    """
    pattern = rf"""["']?{re.escape(key)}["']?\s*:\s*["']([^"']+)["']"""
    match = re.search(pattern, html, re.IGNORECASE)
    return match.group(1) if match else ""


def _extract_m3u8_url(html: str) -> str:
    """Extract an m3u8 URL from the embed page/script."""
    patterns = [
        r"""(?:["']url["']|url)\s*:\s*["']([^"']+\.m3u8[^"']*)["']""",
        r"""["']([^"']+\.m3u8[^"']*)["']""",
        r"""(https?://[^"'\\\s]+\.m3u8[^"'\\\s]*)""",
    ]

    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return _absolute_url(match.group(1))

    return ""


def _append_auth_params(playlist_url: str, token: str, expires: str) -> str:
    """Append VixSrc authorization parameters without duplicating them."""
    params = []

    if token and "token=" not in playlist_url:
        params.append(("token", token))

    if expires and "expires=" not in playlist_url:
        params.append(("expires", expires))

    if "h=" not in playlist_url:
        params.append(("h", "1"))

    if not params:
        return playlist_url

    separator = "&" if "?" in playlist_url else "?"
    return playlist_url + separator + "&".join(
        f"{key}={value}" for key, value in params
    )


async def resolve_vixsrc_stream(
    tmdb_id: str,
    season: Optional[int] = None,
    episode: Optional[int] = None,
):
    """
    Resolve the direct VixSrc HLS playlist.

    Flow:
      1. Call VixSrc JSON API.
      2. Read the embed URL from `src`.
      3. Download the embed HTML.
      4. Extract token, expires and the actual .m3u8 URL.
      5. Return ONLY the VixSrc playlist URL.

    The returned stream_url must never be a MediaFlow /extractor URL.
    MediaFlow wrapping is handled separately by server.py.
    """
    try:
        timeout = httpx.Timeout(20.0, connect=10.0)

        headers = {
            "User-Agent": USER_AGENT,
            "Referer": f"{VIXSRC_BASE}/",
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        }

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout,
        ) as client:

            # 1. VixSrc API endpoint.
            if season is not None and episode is not None:
                api_url = (
                    f"{VIXSRC_BASE}/api/tv/"
                    f"{tmdb_id}/{season}/{episode}"
                )
            else:
                api_url = f"{VIXSRC_BASE}/api/movie/{tmdb_id}"

            api_res = await client.get(api_url, headers=headers)

            if api_res.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Errore API VixSrc: HTTP {api_res.status_code}",
                )

            try:
                data = api_res.json()
            except ValueError:
                raise HTTPException(
                    status_code=502,
                    detail="La API VixSrc non ha restituito JSON valido",
                )

            embed_url = data.get("src")

            if not embed_url:
                raise HTTPException(
                    status_code=404,
                    detail="URL embed non trovato nella risposta JSON VixSrc",
                )

            embed_url = _absolute_url(embed_url)

            # Safety check: resolver must resolve VixSrc, not MediaFlow.
            if "mediaflow" in embed_url.lower():
                raise HTTPException(
                    status_code=502,
                    detail="VixSrc ha restituito un URL MediaFlow invece dell'embed VixSrc",
                )

            # 2. Download embed page.
            embed_headers = {
                **headers,
                "Referer": f"{VIXSRC_BASE}/",
            }

            embed_res = await client.get(
                embed_url,
                headers=embed_headers,
            )

            if embed_res.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "Impossibile raggiungere la pagina embed VixSrc: "
                        f"HTTP {embed_res.status_code}"
                    ),
                )

            html = embed_res.text

            # Temporary diagnostic logging: do not print the full response.
            print(
                "[VIXSRC DEBUG] embed status=%s content_type=%s length=%s url=%s",
                embed_res.status_code,
                embed_res.headers.get("content-type"),
                len(html),
                str(embed_res.url),
            )
            print(
                "[VIXSRC DEBUG] contains m3u8=%s token=%s expires=%s",
                ".m3u8" in html.lower(),
                "token" in html.lower(),
                "expires" in html.lower(),
            )
            preview = html[:3000]
            preview = re.sub(
                r"((?:token|expires)\s*[=:]\s*[\"\'])([^\"\']+)",
                r"\1[REDACTED]",
                preview,
                flags=re.IGNORECASE,
            )
            print("[VIXSRC DEBUG] embed preview=%s", preview)

            # 3. Extract authorization data and playlist.
            token = _extract_js_value(html, "token")
            expires = _extract_js_value(html, "expires")
            playlist_url = _extract_m3u8_url(html)

            if not playlist_url:
                # Some pages escape forward slashes inside JSON/JS.
                normalized_html = html.replace("\\/", "/")
                playlist_url = _extract_m3u8_url(normalized_html)

            if not playlist_url:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Impossibile estrarre l'URL .m3u8 dalla pagina embed VixSrc"
                    ),
                )

            playlist_url = _append_auth_params(
                playlist_url,
                token,
                expires,
            )

            # The resolver returns the actual VixSrc URL.
            # Do NOT generate /extractor/video.m3u8 here.
            return {
                "stream_url": playlist_url,
                "headers": {
                    "User-Agent": USER_AGENT,
                    "Referer": embed_url,
                },
            }

    except HTTPException:
        raise
    except httpx.TimeoutException:
        logger.exception(
            "Timeout durante la risoluzione VixSrc (TMDB: %s)",
            tmdb_id,
        )
        raise HTTPException(
            status_code=504,
            detail="Timeout durante la risoluzione del flusso VixSrc",
        )
    except httpx.HTTPError as e:
        logger.exception(
            "Errore HTTP resolver VixSrc (TMDB: %s): %s",
            tmdb_id,
            e,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Errore HTTP VixSrc: {e.__class__.__name__}",
        )
    except Exception as e:
        logger.exception(
            "Errore resolver VixSrc (TMDB: %s): %s",
            tmdb_id,
            e,
        )
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )
