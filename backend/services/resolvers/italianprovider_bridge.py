"""Primary-source adapter for Gian-Fr/ItalianProvider via an HTTP bridge.

The historical resolver id `vixsrc` is intentionally retained so the existing
Admin toggle/order slot is reused without requiring a frontend migration.  The
actual provider is exposed in the payload as `provider=italianprovider`.
"""

import logging
from typing import Optional

from .base import BaseResolver
from .. import italianprovider

logger = logging.getLogger("player.italianprovider_bridge")


class ItalianProviderBridgeResolver(BaseResolver):
    id = "vixsrc"
    label = "ItalianProvider Bridge"
    always_active = False
    configurable = True

    def bind(self, db, get_setting=None) -> None:
        super().bind(db, get_setting)
        # Drop only old cache rows produced by the previous VixSrc implementation.
        # New ItalianProvider rows carry provider=italianprovider and survive restarts.
        try:
            if db is not None:
                db["stream_cache"].delete_many({
                    "result.source": "vixsrc",
                    "result.provider": {"$ne": "italianprovider"},
                })
        except Exception as exc:
            logger.warning("Unable to clear legacy primary-source cache: %s", exc)

    def is_active(self) -> bool:
        return italianprovider.get_config(self._get_setting)["enabled"]

    async def resolve(
        self,
        tmdb_id: int,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        media_type: str = "movie",
    ) -> Optional[dict]:
        cfg = italianprovider.get_config(self._get_setting)
        if not cfg["enabled"]:
            return None

        try:
            streams = await italianprovider.fetch_streams(
                cfg["url"],
                media_type,
                tmdb_id,
                season,
                episode,
            )
        except italianprovider.ItalianProviderError as exc:
            logger.warning(
                "ItalianProvider bridge failed for %s/%s: %s",
                media_type,
                tmdb_id,
                exc,
            )
            return None

        best = italianprovider.pick_best(streams)
        if not best:
            return None

        payload = {
            "success": True,
            "stream": best["url"],
            "type": best["type"],
            "source": self.id,
            "provider": "italianprovider",
            "provider_repo": italianprovider.REPO_URL,
            "stream_name": best.get("name") or "ItalianProvider",
            "stream_title": best.get("title") or "",
        }
        if best.get("headers"):
            payload["headers"] = best["headers"]

        return payload
