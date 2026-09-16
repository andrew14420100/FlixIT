"""
Native player: FastAPI router + admin stream-source management.

Stream resolution is delegated to a modular ResolverRegistry
(services/resolver_registry.py) with pluggable providers:

  1. AdminSource     - admin-configured .m3u8/.mp4 from Mongo `stream_sources` (always first)
  2. InternetArchive - optional public-domain fallback (toggle in Admin > Impostazioni)
  ... more providers can be registered without touching this module.

Chain / order / cache TTL are configured from Admin > Impostazioni.
Response shape: {"success": true, "stream": "...", "type": "hls"|"mp4", "source": "<provider_id>"}
or {"success": false, "reason": "not_found"} -> frontend shows "Stream non disponibile".
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from services.resolver_registry import ResolverRegistry
from services.resolvers import (
    AdminSourceResolver,
    InternetArchiveResolver,
    StremioAddonResolver,
    VixSrcResolver,
    PUBLIC_DOMAIN_SETTING_KEY,  # re-exported for server.py backward compatibility
    ResolveContext,
)
from services.resolvers.base import stream_type_for

logger = logging.getLogger("player")

router = APIRouter(prefix="/api/player", tags=["player"])

VIDEO_EXTS = (".m3u8", ".mp4", ".m4v", ".webm", ".ogv", ".mov")

_db = None
registry = ResolverRegistry()

__all__ = [
    "router", "registry", "init_player", "resolve_stream",
    "StreamSourceUpdate", "upsert_stream_source", "list_stream_sources", "delete_stream_source",
    "count_stream_sources", "clear_cache", "PUBLIC_DOMAIN_SETTING_KEY",
]


def init_player(db, get_setting=None, set_setting=None):
    """Bind Mongo + settings accessors and register the built-in resolvers."""
    global _db
    _db = db
    registry.bind(db, get_setting, set_setting)
    registry.register(AdminSourceResolver())
    registry.register(VixSrcResolver())  # primary source
    registry.register(StremioAddonResolver())
    registry.register(InternetArchiveResolver())
    try:
        db["stream_sources"].create_index(
            [("tmdbId", 1), ("media_type", 1), ("season", 1), ("episode", 1)], unique=True
        )
        db["stream_cache"].create_index([("key", 1)], unique=True)
    except Exception as e:  # index errors must never block startup
        logger.warning(f"stream index init failed: {e}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Admin stream-source model + CRUD (used by endpoints in server.py)
# ---------------------------------------------------------------------------
class StreamSourceUpdate(BaseModel):
    stream_url: str
    season: Optional[int] = None
    episode: Optional[int] = None

    @field_validator("stream_url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        v = (v or "").strip()
        parsed = urlparse(v)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("URL non valido: deve iniziare con http:// o https://")
        if not parsed.path.lower().endswith(VIDEO_EXTS):
            raise ValueError("Formato non supportato: usa un file .m3u8 o .mp4")
        return v


def upsert_stream_source(tmdb_id: int, media_type: str, data: StreamSourceUpdate) -> dict:
    season = data.season if media_type == "tv" else None
    episode = data.episode if media_type == "tv" else None
    if media_type == "tv" and (season is None or episode is None):
        raise HTTPException(status_code=400, detail="Per le serie TV indica stagione ed episodio")
    doc = {
        "tmdbId": tmdb_id, "media_type": media_type, "season": season, "episode": episode,
        "stream_url": data.stream_url, "type": stream_type_for(data.stream_url), "updatedAt": _now().isoformat(),
    }
    _db["stream_sources"].update_one(
        {"tmdbId": tmdb_id, "media_type": media_type, "season": season, "episode": episode},
        {"$set": doc}, upsert=True,
    )
    registry.clear_cache(registry.cache_key(media_type, tmdb_id, season, episode))
    return doc


def list_stream_sources(tmdb_id: int) -> list:
    return list(_db["stream_sources"].find({"tmdbId": tmdb_id}, {"_id": 0}).sort([("season", 1), ("episode", 1)]))


def delete_stream_source(tmdb_id: int, season: Optional[int], episode: Optional[int]) -> int:
    query = {"tmdbId": tmdb_id}
    if season is not None:
        query["season"] = season
    if episode is not None:
        query["episode"] = episode
    res = _db["stream_sources"].delete_many(query)
    registry.clear_cache_for_title(tmdb_id)
    return res.deleted_count


def count_stream_sources() -> int:
    return _db["stream_sources"].count_documents({}) if _db is not None else 0


def clear_cache() -> int:
    return registry.clear_cache()


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------
async def resolve_stream(media_type: str, tmdb_id: int, season: Optional[int] = None, episode: Optional[int] = None) -> dict:
    if _db is None:
        raise HTTPException(status_code=503, detail="Player non inizializzato")
    return await registry.resolve(ResolveContext(media_type, tmdb_id, season, episode))


@router.get("/movie/{tmdb_id}")
async def player_movie(tmdb_id: int):
    return await resolve_stream("movie", tmdb_id)


@router.get("/tv/{tmdb_id}/{season}/{episode}")
async def player_tv(tmdb_id: int, season: int, episode: int):
    if season < 0 or episode < 1:
        raise HTTPException(status_code=400, detail="Stagione/episodio non validi")
    return await resolve_stream("tv", tmdb_id, season, episode)
