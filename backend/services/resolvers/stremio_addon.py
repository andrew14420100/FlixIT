"""Omni resolver: optional fallback behind VixSrc.

The stable resolver id remains ``stremio_addon`` for backward compatibility,
but Omni is no longer forced active. FlixIT's normal playback path stays on the
Italian VixSrc resolver; Omni can only be re-enabled explicitly in settings.
"""
import asyncio
import logging
from typing import Optional

from .base import BaseResolver
from .. import stremio
from .. import omni_embedded

logger = logging.getLogger("player.omni")
OMNI_ENABLED_KEY = "omni_enabled"


class StremioAddonResolver(BaseResolver):
    id = "stremio_addon"
    label = "Omni"
    always_active = False
    configurable = True

    def is_active(self) -> bool:
        if self._get_setting is None:
            return False
        try:
            explicitly_enabled = self._get_setting(OMNI_ENABLED_KEY, False)
            if isinstance(explicitly_enabled, str):
                explicitly_enabled = explicitly_enabled.strip().lower() in {"1", "true", "yes", "on", "enabled"}
            if not bool(explicitly_enabled):
                return False
        except Exception:
            return False
        return bool(stremio.get_config(self._get_setting)["enabled"])

    async def resolve(
        self,
        tmdb_id: int,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        media_type: str = "movie",
    ) -> Optional[dict]:
        if not self.is_active():
            return None

        cfg = stremio.get_config(self._get_setting)
        imdb_id = await stremio.fetch_imdb_id(
            media_type,
            tmdb_id,
            self._db,
        )
        if not imdb_id:
            return None

        if cfg.get("source") == "embedded":
            streams = await asyncio.to_thread(
                omni_embedded.resolve_streams,
                self._db,
                imdb_id,
                media_type,
                season,
                episode,
                tmdb_id,
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
