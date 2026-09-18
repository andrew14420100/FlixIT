"""
Native player: FastAPI router + admin stream-source management.

Stream resolution is delegated to a modular ResolverRegistry
(services/resolver_registry.py) with pluggable providers.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from services.resolver_registry import ResolverRegistry
from services.resolvers import (
    AdminSourceResolver,
    InternetArchiveResolver,
    StremioAddonResolver,
    VixSrcResolver,
    PUBLIC_DOMAIN_SETTING_KEY,
    ResolveContext,
)
from services.resolvers.base import stream_type_for

logger = logging.getLogger("player")
router = APIRouter(prefix="/api/player", tags=["player"])
VIDEO_EXTS = (".m3u8", ".mp4", ".m4v", ".webm", ".ogv", ".mov")
MIN_SITE_RATING_VOTES = 3

_db = None
registry = ResolverRegistry()

__all__ = [
    "router", "registry", "init_player", "resolve_stream",
    "StreamSourceUpdate", "upsert_stream_source", "list_stream_sources", "delete_stream_source",
    "count_stream_sources", "clear_cache", "PUBLIC_DOMAIN_SETTING_KEY",
]


def init_player(db, get_setting=None, set_setting=None):
    global _db
    _db = db
    registry.bind(db, get_setting, set_setting)
    registry.register(AdminSourceResolver())
    registry.register(VixSrcResolver())
    registry.register(StremioAddonResolver())
    registry.register(InternetArchiveResolver())
    try:
        db["stream_sources"].create_index(
            [("tmdbId", 1), ("media_type", 1), ("season", 1), ("episode", 1)], unique=True
        )
        db["stream_cache"].create_index([("key", 1)], unique=True)
    except Exception as e:
        logger.warning(f"stream index init failed: {e}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


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
        "tmdbId": tmdb_id,
        "media_type": media_type,
        "season": season,
        "episode": episode,
        "stream_url": data.stream_url,
        "type": stream_type_for(data.stream_url),
        "updatedAt": _now().isoformat(),
    }
    _db["stream_sources"].update_one(
        {"tmdbId": tmdb_id, "media_type": media_type, "season": season, "episode": episode},
        {"$set": doc},
        upsert=True,
    )
    registry.clear_cache(registry.cache_key(media_type, tmdb_id, season, episode))
    return doc


def list_stream_sources(tmdb_id: int) -> list:
    return list(
        _db["stream_sources"].find({"tmdbId": tmdb_id}, {"_id": 0}).sort(
            [("season", 1), ("episode", 1)]
        )
    )


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
# Site-vote Top 10
# ---------------------------------------------------------------------------
def _rating_candidates(limit: int = 30) -> list:
    """Rank titles from FLIX-IT user votes.

    A title needs at least MIN_SITE_RATING_VOTES independent rating records to
    qualify for the rating-led part of Top 10. This prevents one isolated 5-star
    vote from putting a title at the top. Missing positions are filled from real
    FLIX-IT viewing activity and finally from available catalogue entries.
    """
    if _db is None:
        return []

    ratings = list(
        _db["user_ratings"].find(
            {}, {"_id": 0, "media_id": 1, "media_type": 1, "rating": 1}
        )
    )
    numeric = [
        float(r.get("rating") or 0)
        for r in ratings
        if 1 <= float(r.get("rating") or 0) <= 5
    ]
    global_mean = sum(numeric) / len(numeric) if numeric else 3.5

    grouped = {}
    for row in ratings:
        try:
            rating = float(row.get("rating") or 0)
            media_id = int(row.get("media_id"))
        except (TypeError, ValueError):
            continue
        if rating < 1 or rating > 5:
            continue
        media_type = "tv" if row.get("media_type") == "tv" else "movie"
        key = (media_type, media_id)
        bucket = grouped.setdefault(key, {"sum": 0.0, "votes": 0})
        bucket["sum"] += rating
        bucket["votes"] += 1

    ranked = []
    prior_votes = 3.0
    for (media_type, media_id), data in grouped.items():
        votes = int(data["votes"])
        if votes < MIN_SITE_RATING_VOTES:
            continue
        average = data["sum"] / votes
        score = (
            (votes / (votes + prior_votes)) * average
            + (prior_votes / (votes + prior_votes)) * global_mean
        )
        ranked.append(
            {
                "tmdbId": media_id,
                "id": media_id,
                "type": media_type,
                "media_type": media_type,
                "site_rating": round(average, 2),
                "site_votes": votes,
                "site_score": round(score, 4),
                "ranking_source": "ratings",
            }
        )

    ranked.sort(
        key=lambda x: (x["site_score"], x["site_votes"], x["site_rating"]),
        reverse=True,
    )

    seen = {(x["type"], x["tmdbId"]) for x in ranked}
    if len(ranked) < limit:
        for view in (
            _db["content_views"]
            .find({}, {"_id": 0})
            .sort("views", -1)
            .limit(100)
        ):
            try:
                media_id = int(view.get("tmdbId"))
            except (TypeError, ValueError):
                continue
            media_type = "tv" if view.get("type") == "tv" else "movie"
            key = (media_type, media_id)
            if key in seen:
                continue
            seen.add(key)
            ranked.append(
                {
                    "tmdbId": media_id,
                    "id": media_id,
                    "type": media_type,
                    "media_type": media_type,
                    "site_rating": 0,
                    "site_votes": 0,
                    "site_score": 0,
                    "site_views": int(view.get("views") or 0),
                    "ranking_source": "views",
                }
            )
            if len(ranked) >= limit:
                break

    return ranked[:limit]


async def _tmdb_card(candidate: dict) -> Optional[dict]:
    key = os.environ.get("TMDB_API_KEY", "")
    if not key:
        return None

    media_type = candidate["type"]
    tmdb_id = candidate["tmdbId"]
    params = {"language": "it-IT"}
    headers = {}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    else:
        params["api_key"] = key

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                f"https://api.themoviedb.org/3/{media_type}/{tmdb_id}",
                params=params,
                headers=headers,
            )
        if response.status_code != 200:
            return None
        data = response.json()
    except Exception as exc:
        logger.warning(
            "Top10 TMDB lookup failed for %s/%s: %s",
            media_type,
            tmdb_id,
            exc.__class__.__name__,
        )
        return None

    return {
        **candidate,
        **data,
        "id": tmdb_id,
        "tmdbId": tmdb_id,
        "type": media_type,
        "media_type": media_type,
        "title": data.get("title") or data.get("name") or "",
        "name": data.get("name") or data.get("title") or "",
        "genre_ids": [
            genre.get("id") for genre in data.get("genres", []) if genre.get("id")
        ],
    }


@router.get("/top10-ratings")
async def top10_ratings():
    if _db is None:
        raise HTTPException(status_code=503, detail="Player non inizializzato")

    candidates = _rating_candidates(30)
    cards = await asyncio.gather(*[_tmdb_card(item) for item in candidates[:20]])
    items = [
        item
        for item in cards
        if item and (item.get("backdrop_path") or item.get("poster_path"))
    ]

    if len(items) < 10:
        seen = {(item.get("type"), item.get("tmdbId")) for item in items}
        fillers = list(
            _db["contents"]
            .find(
                {"available": {"$ne": False}},
                {"_id": 0, "tmdbId": 1, "type": 1},
            )
            .sort("createdAt", -1)
            .limit(80)
        )
        filler_candidates = []
        for row in fillers:
            try:
                media_id = int(row.get("tmdbId"))
            except (TypeError, ValueError):
                continue
            media_type = "tv" if row.get("type") == "tv" else "movie"
            if (media_type, media_id) in seen:
                continue
            seen.add((media_type, media_id))
            filler_candidates.append(
                {
                    "tmdbId": media_id,
                    "id": media_id,
                    "type": media_type,
                    "media_type": media_type,
                    "site_rating": 0,
                    "site_votes": 0,
                    "site_score": 0,
                    "ranking_source": "catalogue",
                }
            )
            if len(filler_candidates) >= 10 - len(items):
                break
        if filler_candidates:
            filler_cards = await asyncio.gather(
                *[_tmdb_card(item) for item in filler_candidates]
            )
            items.extend(
                [
                    item
                    for item in filler_cards
                    if item and (item.get("backdrop_path") or item.get("poster_path"))
                ]
            )

    return {
        "items": items[:10],
        "total": min(10, len(items)),
        "ranking": "flixit_user_ratings",
        "minimum_rating_votes": MIN_SITE_RATING_VOTES,
    }


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------
async def resolve_stream(
    media_type: str,
    tmdb_id: int,
    season: Optional[int] = None,
    episode: Optional[int] = None,
) -> dict:
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
