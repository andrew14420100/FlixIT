"""
AdminSourceResolver: returns the stream URL configured by an administrator from
Admin > Contenuti (or a bulk CSV import) and stored in Mongo `stream_sources`.

Always active and always first in the chain: internally-managed streams have
absolute priority over any other provider.
"""
from typing import Optional

from .base import BaseResolver, stream_type_for


class AdminSourceResolver(BaseResolver):
    id = "admin_source"
    label = "Sorgente Admin (Contenuti / CSV)"
    always_active = True
    configurable = False

    async def resolve(
        self,
        tmdb_id: int,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        media_type: str = "movie",
    ) -> Optional[dict]:
        if self._db is None:
            return None
        # TV sources are keyed per episode; movies use season/episode = None
        q_season = season if media_type == "tv" else None
        q_episode = episode if media_type == "tv" else None
        doc = self._db["stream_sources"].find_one(
            {"tmdbId": tmdb_id, "media_type": media_type, "season": q_season, "episode": q_episode},
            {"_id": 0},
        )
        if not doc:
            return None
        return {
            "success": True,
            "stream": doc["stream_url"],
            "type": doc.get("type") or stream_type_for(doc["stream_url"]),
            "source": self.id,
        }
