import logging
import re
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from fastapi import HTTPException

logger = logging.getLogger("uvicorn.error")

_HTTP_CLIENT: httpx.AsyncClient | None = None

def _get_http_client() -> httpx.AsyncClient:
    global _HTTP_CLIENT
    if _HTTP_CLIENT is None or _HTTP_CLIENT.is_closed:
        _HTTP_CLIENT = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=5.0, read=12.0, write=8.0, pool=3.0),
            limits=httpx.Limits(
                max_connections=20,
                max_keepalive_connections=10,
                keepalive_expiry=30.0,
            ),
        )
    return _HTTP_CLIENT


VIXSRC_BASE = "https://vixsrc.to"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


def _absolute_url(url: str, base: str = VIXSRC_BASE) -> str:
    if not url:
        return ""
    url = url.strip().strip("'\"")
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return base.rstrip("/") + url
    return url


def _with_lang_it(url: str) -> str:
    """Force the provider/player language preference without dropping tokens."""
    if not url:
        return url
    try:
        parts = urlsplit(url)
        query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key.lower() != "lang"]
        query.append(("lang", "it"))
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
    except Exception:
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}lang=it"


def _extract_js_value(html: str, key: str) -> str:
    pattern = rf"""["']?{re.escape(key)}["']?\s*:\s*["']([^"']+)["']"""
    match = re.search(pattern, html, re.IGNORECASE)
    return match.group(1) if match else ""


def _extract_m3u8_url(html: str) -> str:
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
    return playlist_url + separator + "&".join(f"{key}={value}" for key, value in params)


async def resolve_vixsrc_stream(
    tmdb_id: str,
    season: Optional[int] = None,
    episode: Optional[int] = None,
):
    """Resolve a direct VixSrc HLS playlist with Italian explicitly selected."""
    try:
        client = _get_http_client()
        headers = {
            "User-Agent": USER_AGENT,
            "Referer": f"{VIXSRC_BASE}/",
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9",
        }

        if season is not None and episode is not None:
            api_url = f"{VIXSRC_BASE}/api/tv/{tmdb_id}/{season}/{episode}"
        else:
            api_url = f"{VIXSRC_BASE}/api/movie/{tmdb_id}"

        api_res = await client.get(api_url, params={"lang": "it"}, headers=headers)
        if api_res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Errore API VixSrc: HTTP {api_res.status_code}")

        try:
            data = api_res.json()
        except ValueError:
            raise HTTPException(status_code=502, detail="La API VixSrc non ha restituito JSON valido")

        embed_url = data.get("src")
        if not embed_url:
            raise HTTPException(status_code=404, detail="URL embed non trovato nella risposta JSON VixSrc")

        embed_url = _with_lang_it(_absolute_url(embed_url))
        if "mediaflow" in embed_url.lower():
            raise HTTPException(status_code=502, detail="VixSrc ha restituito un URL MediaFlow invece dell'embed VixSrc")

        embed_headers = {**headers, "Referer": f"{VIXSRC_BASE}/"}
        embed_res = await client.get(embed_url, headers=embed_headers)
        if embed_res.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Impossibile raggiungere la pagina embed VixSrc: HTTP {embed_res.status_code}",
            )

        html = embed_res.text
        token = _extract_js_value(html, "token")
        expires = _extract_js_value(html, "expires")
        playlist_url = _extract_m3u8_url(html)
        if not playlist_url:
            playlist_url = _extract_m3u8_url(html.replace("\\/", "/"))
        if not playlist_url:
            raise HTTPException(status_code=422, detail="Impossibile estrarre l'URL .m3u8 dalla pagina embed VixSrc")

        playlist_url = _append_auth_params(playlist_url, token, expires)
        playlist_url = _with_lang_it(playlist_url)

        return {
            "stream_url": playlist_url,
            "headers": {
                "User-Agent": USER_AGENT,
                "Referer": embed_url,
                "Accept-Language": "it-IT,it;q=0.9",
            },
            "language": "it",
        }

    except HTTPException:
        raise
    except httpx.TimeoutException:
        logger.exception("Timeout durante la risoluzione VixSrc (TMDB: %s)", tmdb_id)
        raise HTTPException(status_code=504, detail="Timeout durante la risoluzione del flusso VixSrc")
    except httpx.HTTPError as e:
        logger.exception("Errore HTTP resolver VixSrc (TMDB: %s): %s", tmdb_id, e)
        raise HTTPException(status_code=502, detail=f"Errore HTTP VixSrc: {e.__class__.__name__}")
    except Exception as e:
        logger.exception("Errore resolver VixSrc (TMDB: %s): %s", tmdb_id, e)
        raise HTTPException(status_code=500, detail=str(e))
