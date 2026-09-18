"""
Native player + artwork services.

Stream resolution is delegated to ResolverRegistry. Netflix-style artwork is
isolated in services/netflix_artwork.py and is disabled by default.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

from services.netflix_artwork import ArtworkResolver
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
_get_setting = None
_set_setting = None
registry = ResolverRegistry()
artwork_resolver: Optional[ArtworkResolver] = None
_artwork_security = HTTPBearer()

__all__ = [
    "router", "registry", "init_player", "resolve_stream",
    "StreamSourceUpdate", "upsert_stream_source", "list_stream_sources", "delete_stream_source",
    "count_stream_sources", "clear_cache", "PUBLIC_DOMAIN_SETTING_KEY",
]


def init_player(db, get_setting=None, set_setting=None):
    global _db, _get_setting, _set_setting, artwork_resolver
    _db = db
    _get_setting = get_setting
    _set_setting = set_setting
    registry.bind(db, get_setting, set_setting)
    registry.register(AdminSourceResolver())
    registry.register(VixSrcResolver())
    registry.register(StremioAddonResolver())
    registry.register(InternetArchiveResolver())
    artwork_resolver = ArtworkResolver(
        db,
        get_setting,
        set_setting,
        # server.py already uses this same environment key for TMDB.
        tmdb_api_key=os.environ.get("TMDB_API_KEY", ""),
    )
    try:
        db["stream_sources"].create_index(
            [("tmdbId", 1), ("media_type", 1), ("season", 1), ("episode", 1)], unique=True
        )
        db["stream_cache"].create_index([("key", 1)], unique=True)
    except Exception as e:
        logger.warning(f"stream index init failed: {e}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _artwork() -> ArtworkResolver:
    if artwork_resolver is None:
        raise HTTPException(status_code=503, detail="Artwork resolver non inizializzato")
    return artwork_resolver


def _media_type(value: str) -> str:
    if value not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type deve essere 'movie' o 'tv'")
    return value


def _require_artwork_admin(
    credentials: HTTPAuthorizationCredentials = Depends(_artwork_security),
):
    """Use the same JWT/user-role contract as server.py without a circular import."""
    if _db is None:
        raise HTTPException(status_code=503, detail="Backend non inizializzato")
    secret = os.environ.get("JWT_SECRET", "netflix-admin-super-secret-key-2024")
    try:
        payload = jwt.decode(credentials.credentials, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    query = (
        {"id": payload["user_id"]}
        if payload.get("user_id")
        else ({"email": str(payload.get("email") or "").lower()} if payload.get("email") else None)
    )
    if not query:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = _db["users"].find_one(query, {"_id": 0, "password": 0})
    if not user or user.get("role", "user") not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Permessi insufficienti")
    return user


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
# Netflix-style artwork resolver
# ---------------------------------------------------------------------------
class ArtworkConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    region: Optional[str] = None
    cookies: Optional[str] = None


class ArtworkManualMatch(BaseModel):
    netflix_id: str


class ArtworkOverrideUpdate(BaseModel):
    context: str = "home"
    url: str
    asset_type: Optional[str] = "manual"
    width: Optional[int] = 0
    height: Optional[int] = 0


@router.get("/artwork/config")
async def public_artwork_config():
    cfg = _artwork().config()
    # Never expose cookie state/source to the public client.
    return {"enabled": cfg["enabled"], "region": cfg["region"]}


@router.get("/artwork/admin/config")
async def admin_artwork_config(_admin=Depends(_require_artwork_admin)):
    return _artwork().config()


@router.put("/artwork/admin/config")
async def admin_update_artwork_config(data: ArtworkConfigUpdate, _admin=Depends(_require_artwork_admin)):
    try:
        return _artwork().update_config(
            enabled=data.enabled,
            region=data.region,
            cookies=data.cookies,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/artwork/admin/test")
async def admin_test_artwork(_admin=Depends(_require_artwork_admin)):
    return await _artwork().test_connection()


@router.get("/artwork/admin/matches")
async def admin_artwork_matches(
    status: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    _admin=Depends(_require_artwork_admin),
):
    return {"items": _artwork().admin_list(limit=limit, status=status)}


@router.get("/artwork/admin/{media_type}/{tmdb_id}")
async def admin_artwork_preview(
    media_type: str,
    tmdb_id: int,
    context: str = "home",
    viewport: str = "desktop",
    profile_id: str = "admin-preview",
    refresh: bool = False,
    _admin=Depends(_require_artwork_admin),
):
    return await _artwork().resolve(
        _media_type(media_type),
        tmdb_id,
        context=context,
        viewport=viewport,
        profile_id=profile_id,
        preview=True,
        force_match=refresh,
    )


@router.post("/artwork/admin/{media_type}/{tmdb_id}/auto-match")
async def admin_auto_match_artwork(
    media_type: str,
    tmdb_id: int,
    _admin=Depends(_require_artwork_admin),
):
    return await _artwork().resolve(
        _media_type(media_type), tmdb_id, preview=True, force_match=True
    )


@router.put("/artwork/admin/{media_type}/{tmdb_id}/manual-match")
async def admin_manual_match_artwork(
    media_type: str,
    tmdb_id: int,
    data: ArtworkManualMatch,
    _admin=Depends(_require_artwork_admin),
):
    try:
        doc = await _artwork().manual_match(_media_type(media_type), tmdb_id, data.netflix_id)
        return await _artwork().resolve(
            media_type, tmdb_id, preview=True, context="home", force_match=False
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/artwork/admin/{media_type}/{tmdb_id}/block")
async def admin_block_artwork(
    media_type: str,
    tmdb_id: int,
    _admin=Depends(_require_artwork_admin),
):
    return _artwork().block(_media_type(media_type), tmdb_id)


@router.delete("/artwork/admin/{media_type}/{tmdb_id}/match")
async def admin_reset_artwork_match(
    media_type: str,
    tmdb_id: int,
    _admin=Depends(_require_artwork_admin),
):
    return _artwork().reset_match(_media_type(media_type), tmdb_id)


@router.put("/artwork/admin/{media_type}/{tmdb_id}/override")
async def admin_set_artwork_override(
    media_type: str,
    tmdb_id: int,
    data: ArtworkOverrideUpdate,
    _admin=Depends(_require_artwork_admin),
):
    try:
        asset = _artwork().set_override(
            _media_type(media_type),
            tmdb_id,
            data.context,
            {
                "url": data.url,
                "type": data.asset_type,
                "width": data.width,
                "height": data.height,
            },
        )
        return {"success": True, "override": asset}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/artwork/admin/{media_type}/{tmdb_id}/override")
async def admin_reset_artwork_override(
    media_type: str,
    tmdb_id: int,
    context: str = "home",
    _admin=Depends(_require_artwork_admin),
):
    _artwork().reset_override(_media_type(media_type), tmdb_id, context)
    return {"success": True, "context": context}


@router.get("/artwork/{media_type}/{tmdb_id}")
async def public_artwork(
    media_type: str,
    tmdb_id: int,
    context: str = "home",
    viewport: str = "desktop",
    profile_id: str = "guest",
):
    # Public requests never force a refresh: first load can resolve and cache, then
    # subsequent cards reuse Mongo. Feature-disabled requests are constant-time.
    return await _artwork().resolve(
        _media_type(media_type),
        tmdb_id,
        context=context,
        viewport=viewport,
        profile_id=profile_id,
        preview=False,
    )


# ---------------------------------------------------------------------------
# Site-vote Top 10
# ---------------------------------------------------------------------------
def _rating_candidates(limit: int = 30) -> list:
    """Rank titles from FLIX-IT user votes.

    A title needs at least MIN_SITE_RATING_VOTES independent rating records to
    qualify for the rating-led part of Top 10. Missing positions are filled from
    real FLIX-IT viewing activity and finally from available catalogue entries.
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
