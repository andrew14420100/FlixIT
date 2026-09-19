"""Omni-compatible resolver for FlixIT.

Omni exposes the Stremio addon protocol, so FlixIT can reuse its existing
TMDB -> IMDb conversion and Stremio client.  The configured
`stremio_addon_url` should point to an Omni deployment compatible with
https://github.com/SaLuGiSa/Omni.

The resolver keeps the historical id `stremio_addon` so existing admin
settings, resolver ordering and API tests remain backwards compatible.  The
payload also includes `provider=omni` to make the actual adapter explicit.
"""

import logging
from typing import Optional

from .base import BaseResolver
from .. import stremio

logger = logging.getLogger("player.omni")

REPO_URL = "https://github.com/SaLuGiSa/Omni"


class OmniAddonResolver(BaseResolver):
    id = "stremio_addon"
    label = "Omni (Stremio)"
    always_active = False
    configurable = True

    def is_active(self) -> bool:
        return stremio.get_config(self._get_setting)["enabled"]

    async def resolve(
        self,
        tmdb_id: int,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        media_type: str = "movie",
    ) -> Optional[dict]:
        cfg = stremio.get_config(self._get_setting)
        if not cfg["enabled"]:
            return None

        imdb_id = await stremio.fetch_imdb_id(media_type, tmdb_id, self._db)
        if not imdb_id:
            return None

        try:
            streams = await stremio.fetch_streams(
                cfg["url"],
                media_type,
                imdb_id,
                season,
                episode,
            )
        except stremio.StremioError as exc:
            logger.warning(
                "Omni addon failed for %s/%s: %s",
                media_type,
                tmdb_id,
                exc,
            )
            return None

        best = stremio.pick_best(streams)
        if not best:
            return None

        stream_url = str(best.get("url") or "").strip()
        headers = best.get("headers") or {}
        if not stream_url:
            return None

        payload = {
            "success": True,
            "stream": stream_url,
            "type": "hls" if ".m3u8" in stream_url.lower() else best["type"],
            "source": self.id,
            "provider": "omni",
            "provider_repo": REPO_URL,
            "imdb_id": imdb_id,
            "stream_name": best.get("name") or "Omni",
            "stream_title": best.get("title") or "",
        }
        if headers:
            payload["headers"] = headers

        return payload
