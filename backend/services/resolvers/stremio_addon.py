"""
StremioAddonResolver: resolves a title through the Stremio addon configured in
Admin > Impostazioni (TMDB id -> IMDb id -> addon /stream resource -> best http(s) stream).
"""
import logging
from typing import Optional

from .base import BaseResolver
from .. import stremio

logger = logging.getLogger("player.stremio_addon")


class StremioAddonResolver(BaseResolver):
    id = "stremio_addon"
    label = "Addon Stremio"
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

        imdb_id = await stremio.fetch_imdb_id(
            media_type,
            tmdb_id,
            self._db,
        )

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
        except stremio.StremioError as e:
            logger.warning(
                f"stremio addon failed for {media_type}/{tmdb_id}: {e}"
            )
            return None

        best = stremio.pick_best(streams)

        if not best:
            return None

        stream_url = str(best.get("url") or "").strip()
        headers = best.get("headers") or {}

        # VixSrc direct resolution DISATTIVATA TEMPORANEAMENTE.
        # Se l'addon restituisce un URL VixSrc /extractor/video.m3u8,
        # viene lasciato invariato e sarà gestito dal normale routing.
        if "/extractor/video.m3u8" in stream_url and "vixsrc.to" in stream_url.lower():
            logger.info(
                "VixSrc direct resolution DISABLED for %s/%s; "
                "using addon stream unchanged",
                media_type,
                tmdb_id,
            )

        payload = {
            "success": True,
            "stream": stream_url,
            "type": (
                "hls"
                if ".m3u8" in stream_url.lower()
                else best["type"]
            ),
            "source": self.id,
            "imdb_id": imdb_id,
            "stream_name": best["name"],
            "stream_title": best["title"],
        }

        if headers:
            payload["headers"] = headers

        return payload
