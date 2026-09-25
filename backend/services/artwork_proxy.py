"""Same-origin proxy for public StreamingUnity artwork images.

Some StreamingUnity CDN image hosts do not send browser CORS headers. FLIX-IT
uses this narrowly-scoped endpoint so artwork can be consumed by frontend code
without issuing cross-origin fetches. This endpoint is intentionally restricted
to known public image CDN hosts and /images/ paths; it is not a generic proxy and
never handles video/playback URLs.
"""
from __future__ import annotations

from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, Response


_ALLOWED_HOSTS = {
    "cdn.streamingunity.win",
    "cdn.streamingcommunityz.ninja",
}
_ALLOWED_CONTENT_TYPES = {
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/svg+xml",
    "image/webp",
}


def _validated_image_url(value: str) -> str:
    text = str(value or "").strip()
    try:
        parsed = urlparse(text)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="URL artwork non valido") from exc

    host = (parsed.hostname or "").lower().strip(".")
    if parsed.scheme not in {"http", "https"} or host not in _ALLOWED_HOSTS:
        raise HTTPException(status_code=400, detail="Host artwork non consentito")
    if not (parsed.path or "").startswith("/images/"):
        raise HTTPException(status_code=400, detail="Percorso artwork non consentito")
    return text


async def _download_image(url: str) -> httpx.Response:
    current = _validated_image_url(url)
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(15.0, connect=6.0),
        follow_redirects=False,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
    ) as client:
        for _ in range(4):
            response = await client.get(current)
            if response.status_code not in {301, 302, 303, 307, 308}:
                return response
            location = response.headers.get("location")
            if not location:
                return response
            current = _validated_image_url(urljoin(current, location))
    raise HTTPException(status_code=502, detail="Troppi redirect artwork")


def install_artwork_proxy(app) -> None:
    if getattr(app.state, "flixit_artwork_proxy_registered", False):
        return

    router = APIRouter()

    @router.get("/api/public/artwork-proxy")
    async def artwork_proxy(url: str = Query(..., min_length=12, max_length=2048)):
        source_url = _validated_image_url(url)
        try:
            upstream = await _download_image(source_url)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail="CDN artwork non raggiungibile") from exc

        if upstream.status_code != 200:
            raise HTTPException(status_code=502, detail=f"CDN artwork HTTP {upstream.status_code}")

        content_type = str(upstream.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        if content_type not in _ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=502, detail="Risorsa CDN non riconosciuta come immagine")

        return Response(
            content=upstream.content,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                "X-Content-Type-Options": "nosniff",
            },
        )

    app.include_router(router)
    app.state.flixit_artwork_proxy_registered = True


__all__ = ["install_artwork_proxy"]
