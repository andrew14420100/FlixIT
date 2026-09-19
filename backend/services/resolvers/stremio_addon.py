"""
Omni resolver: TMDB id -> IMDb id -> embedded/remote Omni -> best HTTP(S) stream.

The stable resolver id remains `stremio_addon` for backward compatibility with
existing Admin settings and saved resolver order.
"""
import logging
from typing import Optional

from .base import BaseResolver
from .. import stremio
from .. import omni_embedded

logger = logging.getLogger("player.omni")


class StremioAddonResolver(BaseResolver):
    id = "stremio_addon"
    label = "Omni"
    # Omni is the primary network/source layer immediately after AdminSource.
    always_active = True
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

        if cfg.get("source") == "embedded":
            streams = omni_embedded.resolve_streams(
                self._db,
                imdb_id,
                media_type,
                season,
                episode,
            )
        else:
            try:
                streams = await stremio.fetch_streams(
                    cfg["url"],
                    media_type,
                    imdb_id,
                    season,
                    episode,
                )
            except stremio.StremioError as e:
                logger.warning("Omni failed for %s/%s: %s", media_type, tmdb_id, e)
                return None

        best = stremio.pick_best(streams)
        if not best:
            return None

        stream_url = str(best.get("url") or "").strip()
        headers = best.get("headers") or {}
        payload = {
            "success": True,
            "stream": stream_url,
            "type": best.get("type") or "hls",
            "source": self.id,
            "provider": "omni_embedded" if cfg.get("source") == "embedded" else "omni",
            "omni_mode": cfg.get("source") or "unknown",
            "imdb_id": imdb_id,
            "stream_name": best.get("name") or "Omni",
            "stream_title": best.get("title") or "",
        }
        if headers:
            payload["headers"] = headers
        return payload
