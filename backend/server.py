from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime, timezone, timedelta
import os
from pymongo import MongoClient, DESCENDING, ASCENDING
import logging
from dotenv import load_dotenv
import bcrypt
import jwt
import re
import httpx
import asyncio
import random
import json
import ssl
import certifi

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Netflix Clone API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB Connection
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "netflix_clone")

# TMDB Configuration
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "4f153630f8d7e92d542dde3a38fbddf2")
TMDB_BASE_URL = "https://api.themoviedb.org/3"

logger.info(f"Connecting to MongoDB: {MONGO_URL}, DB: {DB_NAME}")

# Connect to MongoDB - handle both local and Atlas connections
try:
    if "mongodb+srv" in MONGO_URL or "mongodb.net" in MONGO_URL:
        # Atlas connection - try with SSL
        try:
            client = MongoClient(
                MONGO_URL,
                tls=True,
                tlsCAFile=certifi.where(),
                serverSelectionTimeoutMS=30000,
                connectTimeoutMS=30000
            )
            client.admin.command('ping')
            logger.info("Connected to MongoDB Atlas with certifi")
        except Exception:
            client = MongoClient(
                MONGO_URL,
                tls=True,
                tlsAllowInvalidCertificates=True,
                tlsAllowInvalidHostnames=True,
                serverSelectionTimeoutMS=30000,
                connectTimeoutMS=30000
            )
            client.admin.command('ping')
            logger.info("Connected to MongoDB Atlas with tlsInsecure")
    else:
        # Local MongoDB - simple connection
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        logger.info("Connected to local MongoDB")
except Exception as e:
    logger.error(f"MongoDB connection failed: {e}")
    # Fallback to local
    client = MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=5000)
    logger.info("Fallback to local MongoDB")
db = client[DB_NAME]

# Collections
user_lists = db["user_lists"]
user_likes = db["user_likes"]
contents = db["contents"]
hero_settings = db["hero_settings"]
sections = db["sections"]
admin_logs = db["admin_logs"]
admin_users = db["admin_users"]
menu_items = db["menu_items"]
users = db["users"]
tv_seasons = db["tv_seasons"]
tv_episodes = db["tv_episodes"]
user_ratings = db["user_ratings"]
content_views = db["content_views"]  # Track views for Top 10
watch_progress = db["watch_progress"]  # Track watch progress per user

# JWT Configuration
JWT_SECRET = os.environ.get("JWT_SECRET", "netflix-admin-super-secret-key-2024")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

security = HTTPBearer()

# Create indexes
contents.create_index("tmdbId", unique=True)
contents.create_index([("release_date", DESCENDING)])
contents.create_index([("popularity", DESCENDING)])
contents.create_index([("vote_average", DESCENDING)])
contents.create_index([("createdAt", DESCENDING)])
contents.create_index("type")
admin_users.create_index("email", unique=True)
menu_items.create_index("order")
tv_seasons.create_index([("tmdbId", 1), ("season_number", 1)], unique=True)
tv_episodes.create_index([("tmdbId", 1), ("season_number", 1), ("episode_number", 1)], unique=True)
watch_progress.create_index([("user_id", 1), ("tmdb_id", 1)], unique=True)
watch_progress.create_index([("user_id", 1), ("updated_at", DESCENDING)])

# =====================
# MODELS
# =====================

class MenuItem(BaseModel):
    id: Optional[str] = None
    name: str
    path: str
    order: int = 1
    active: bool = True

class MenuItemUpdate(BaseModel):
    name: Optional[str] = None
    path: Optional[str] = None
    order: Optional[int] = None
    active: Optional[bool] = None

class ListItem(BaseModel):
    user_id: str
    media_id: int
    media_type: str
    title: Optional[str] = None
    poster_path: Optional[str] = None
    backdrop_path: Optional[str] = None

class LikeItem(BaseModel):
    user_id: str
    media_id: int
    media_type: str

class AdminLogin(BaseModel):
    email: str
    password: str

class ContentCreate(BaseModel):
    tmdbId: int
    type: Literal["movie", "tv"]
    available: bool = True
    availableSeason: Optional[int] = None

class ContentUpdate(BaseModel):
    available: Optional[bool] = None
    availableSeason: Optional[int] = None

class HeroUpdate(BaseModel):
    contentId: str
    mediaType: Optional[Literal["movie", "tv"]] = "tv"
    customTitle: Optional[str] = None
    customDescription: Optional[str] = None
    customBackdrop: Optional[str] = None
    seasonLabel: Optional[str] = None

class SectionCreate(BaseModel):
    name: str
    apiString: str
    mediaType: Literal["movie", "tv"]
    active: bool = True
    order: int = 0

class SectionUpdate(BaseModel):
    active: Optional[bool] = None
    order: Optional[int] = None

class RatingItem(BaseModel):
    user_id: str
    media_id: int
    media_type: str
    rating: int

# =====================
# HELPER FUNCTIONS
# =====================

def sanitize_string(s: str) -> str:
    """Sanitize string to prevent XSS"""
    if not s:
        return s
    return re.sub(r'<[^>]*>', '', s)

def get_current_admin(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify JWT token and return admin user"""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        email = payload.get("email")
        if not email:
            raise HTTPException(status_code=401, detail="Invalid token")
        admin = admin_users.find_one({"email": email}, {"_id": 0, "password": 0})
        if not admin:
            raise HTTPException(status_code=401, detail="Admin not found")
        return admin
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def log_admin_action(action: str, content_id: Optional[str] = None, metadata: Optional[dict] = None):
    """Log admin action"""
    admin_logs.insert_one({
        "action": action,
        "contentId": content_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metadata": metadata or {}
    })

# Anime genre IDs to exclude (Animation genre often contains anime)
# We exclude content that is primarily Japanese animation
ANIME_GENRE_ID = 16  # Animation genre
EXCLUDED_ORIGIN_COUNTRIES = ["JP"]  # Japan

def is_anime_content(item: dict) -> bool:
    """
    Check if content is anime based on:
    - Genre ID 16 (Animation) + origin country JP
    - Original language 'ja' (Japanese) + Animation genre
    """
    genre_ids = item.get("genre_ids", [])
    origin_country = item.get("origin_country", [])
    original_language = item.get("original_language", "")
    
    # If it has Animation genre AND is from Japan, likely anime
    if ANIME_GENRE_ID in genre_ids:
        if any(country in EXCLUDED_ORIGIN_COUNTRIES for country in origin_country):
            return True
        if original_language == "ja":
            return True
    
    return False

TMDB_CACHE_TTL = timedelta(hours=1)
TMDB_CACHE_MAX = 4000
_tmdb_cache: dict = {}


async def fetch_tmdb_data(endpoint: str, params: dict = None) -> dict:
    """Fetch data from TMDB API (1h in-memory cache so rows refresh at most hourly)"""
    if params is None:
        params = {}
    params["language"] = "it-IT"
    cache_key = (endpoint, tuple(sorted((k, str(v)) for k, v in params.items())))
    hit = _tmdb_cache.get(cache_key)
    now = datetime.now(timezone.utc)
    if hit and now - hit[0] < TMDB_CACHE_TTL:
        return hit[1]
    headers = {}
    if TMDB_API_KEY.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {TMDB_API_KEY}"
    else:
        params["api_key"] = TMDB_API_KEY
    
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{TMDB_BASE_URL}{endpoint}", params=params, headers=headers)
        if response.status_code == 200:
            data = response.json()
            if len(_tmdb_cache) >= TMDB_CACHE_MAX:
                for k in sorted(_tmdb_cache, key=lambda k: _tmdb_cache[k][0])[: TMDB_CACHE_MAX // 4]:
                    _tmdb_cache.pop(k, None)
            _tmdb_cache[cache_key] = (now, data)
            return data
        logger.error(f"TMDB API error: {response.status_code} - {response.text}")
        return None

# =====================
# MEDIA ASSETS - uniform extraction pipeline (titled backdrop, logo, trailer, runtime, certification)
# =====================
media_assets = db["media_assets"]
media_assets.create_index([("type", 1), ("tmdbId", 1)], unique=True)
ASSETS_TTL_HOURS = 24 * 14
_assets_semaphore = asyncio.Semaphore(8)

US_MOVIE_CERT = {"G": "T", "PG": "7+", "PG-13": "13+", "R": "16+", "NC-17": "18+"}
US_TV_CERT = {"TV-Y": "T", "TV-Y7": "7+", "TV-G": "T", "TV-PG": "12+", "TV-14": "14+", "TV-MA": "18+"}
IT_CERT = {"T": "T", "6+": "6+", "12+": "12+", "14+": "14+", "16+": "16+", "18+": "18+", "VM14": "14+", "VM18": "18+"}


def _lang_rank(lang: Optional[str]) -> int:
    return {"it": 0, "en": 1}.get(lang or "", 2)


def _pick_certification(media_type: str, data: dict) -> Optional[str]:
    if media_type == "movie":
        results = (data.get("release_dates") or {}).get("results") or []
        by_country = {r.get("iso_3166_1"): r for r in results}
        for country, mapping in (("IT", IT_CERT), ("US", US_MOVIE_CERT)):
            for rd in (by_country.get(country) or {}).get("release_dates") or []:
                cert = (rd.get("certification") or "").strip()
                if cert in mapping:
                    return mapping[cert]
    else:
        results = (data.get("content_ratings") or {}).get("results") or []
        by_country = {r.get("iso_3166_1"): r.get("rating") for r in results}
        for country, mapping in (("IT", IT_CERT), ("US", US_TV_CERT)):
            cert = (by_country.get(country) or "").strip()
            if cert in mapping:
                return mapping[cert]
    return None


def _pick_logo(logos: Optional[list]) -> Optional[str]:
    if not logos:
        return None
    ranked = sorted(logos, key=lambda l: (
        _lang_rank(l.get("iso_639_1")),
        0 if (l.get("file_path") or "").endswith(".png") else 1,
        -(l.get("vote_average") or 0),
    ))
    return ranked[0].get("file_path")


def _pick_titled_backdrop(backdrops: Optional[list]) -> Optional[str]:
    cands = [b for b in (backdrops or []) if b.get("iso_639_1") in ("it", "en")]
    if not cands:
        return None
    cands.sort(key=lambda b: (_lang_rank(b.get("iso_639_1")), -(b.get("vote_average") or 0), -(b.get("vote_count") or 0)))
    return cands[0].get("file_path")


def _pick_trailer(videos: Optional[list]) -> Optional[str]:
    yt = [v for v in (videos or []) if v.get("site") == "YouTube" and v.get("key")]
    if not yt:
        return None
    yt.sort(key=lambda v: (
        _lang_rank(v.get("iso_639_1")),
        {"Trailer": 0, "Teaser": 1}.get(v.get("type"), 2),
        0 if v.get("official") else 1,
    ))
    return yt[0].get("key")


async def get_media_assets(media_type: str, tmdb_id: int, force: bool = False) -> Optional[dict]:
    media_type = "tv" if media_type == "tv" else "movie"
    cached = media_assets.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0})
    if cached and not force:
        fetched_at = cached.get("fetched_at")
        if fetched_at and datetime.fromisoformat(fetched_at) > datetime.now(timezone.utc) - timedelta(hours=ASSETS_TTL_HOURS):
            return cached
    extra = "release_dates" if media_type == "movie" else "content_ratings"
    async with _assets_semaphore:
        data = await fetch_tmdb_data(f"/{media_type}/{tmdb_id}", {
            "append_to_response": f"images,videos,{extra}",
            "include_image_language": "it,en,null",
            "include_video_language": "it,en,null",
        })
    if not data:
        return cached
    images = data.get("images") or {}
    runtime = data.get("runtime")
    if media_type == "tv":
        ert = data.get("episode_run_time") or []
        runtime = ert[0] if ert else None
    doc = {
        "type": media_type,
        "tmdbId": tmdb_id,
        "title": data.get("title") or data.get("name"),
        "release_date": data.get("release_date") or data.get("first_air_date"),
        "backdrop_path": data.get("backdrop_path"),
        "poster_path": data.get("poster_path"),
        "titled_backdrop_path": _pick_titled_backdrop(images.get("backdrops")),
        "logo_path": _pick_logo(images.get("logos")),
        "trailer_key": _pick_trailer((data.get("videos") or {}).get("results")),
        "runtime": runtime,
        "number_of_seasons": data.get("number_of_seasons"),
        "certification": _pick_certification(media_type, data) or ("18+" if data.get("adult") else None),
        "genre_ids": [g["id"] for g in data.get("genres") or []],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    media_assets.update_one({"type": media_type, "tmdbId": tmdb_id}, {"$set": doc}, upsert=True)
    return doc


ASSET_FIELDS = ("titled_backdrop_path", "logo_path", "trailer_key", "runtime", "number_of_seasons", "certification")


async def enrich_items(items: list) -> list:
    """Attach uniform media assets to every list item (cached, concurrent)."""
    async def one(item):
        try:
            assets = await get_media_assets(item.get("type", "movie"), item["tmdbId"])
        except Exception as e:
            logger.warning(f"Media assets failed for {item.get('tmdbId')}: {e}")
            assets = None
        for f in ASSET_FIELDS:
            item[f] = (assets or {}).get(f)
        if not item.get("backdrop_path") and assets:
            item["backdrop_path"] = assets.get("backdrop_path")
    await asyncio.gather(*(one(i) for i in items if i.get("tmdbId")))
    return items


@app.get("/api/public/media-assets/{media_type}/{tmdb_id}")
async def get_public_media_assets(media_type: str, tmdb_id: int):
    """Uniform media assets for a title: titled backdrop, logo, trailer key, runtime, certification."""
    assets = await get_media_assets(media_type, tmdb_id)
    if not assets:
        raise HTTPException(status_code=404, detail="Content not found")
    return assets


# =====================
# VIXSRC CATALOG - only titles actually available on vixsrc.to are shown
# =====================
vixsrc_catalog = db["vixsrc_catalog"]
app_settings = db["app_settings"]
VIX_REFRESH_HOURS = 6
VIX_LIST_URL = "https://vixsrc.to/api/list/{type}/?lang=it"  # lang=it -> only titles with an Italian audio track
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
_vix_ids = {"movie": set(), "tv": set()}
_vix_loaded_at: Optional[datetime] = None
_vix_lock = asyncio.Lock()


def get_setting(key: str, default=None):
    doc = app_settings.find_one({"key": key}, {"_id": 0})
    return doc.get("value", default) if doc else default


def set_setting(key: str, value):
    app_settings.update_one({"key": key}, {"$set": {"key": key, "value": value, "updatedAt": datetime.now(timezone.utc).isoformat()}}, upsert=True)


async def refresh_vixsrc_catalog(force: bool = False) -> dict:
    global _vix_loaded_at
    now = datetime.now(timezone.utc)
    if not force and _vix_loaded_at and _vix_ids["movie"] and now - _vix_loaded_at < timedelta(hours=VIX_REFRESH_HOURS):
        return {t: len(v) for t, v in _vix_ids.items()}
    async with _vix_lock:
        for t in ("movie", "tv"):
            doc = vixsrc_catalog.find_one({"type": t}, {"_id": 0})
            fresh = doc and datetime.fromisoformat(doc["updated_at"]) > now - timedelta(hours=VIX_REFRESH_HOURS)
            if fresh and not force:
                _vix_ids[t] = set(doc["ids"])
                try:
                    _record_added(t, _vix_ids[t])
                except Exception as e:
                    logger.warning(f"vixsrc added-tracking failed for {t}: {e}")
                continue
            try:
                async with httpx.AsyncClient(timeout=90.0, follow_redirects=True, headers={"User-Agent": BROWSER_UA}) as client:
                    r = await client.get(VIX_LIST_URL.format(type=t))
                    ids = {int(x["tmdb_id"]) for x in r.json() if x.get("tmdb_id")} if r.status_code == 200 else set()
                if ids:
                    _vix_ids[t] = ids
                    vixsrc_catalog.update_one({"type": t}, {"$set": {"type": t, "ids": sorted(ids), "count": len(ids), "updated_at": now.isoformat()}}, upsert=True)
                    logger.info(f"vixsrc catalog refreshed: {t}={len(ids)}")
                elif doc:
                    _vix_ids[t] = set(doc["ids"])
            except Exception as e:
                logger.warning(f"vixsrc catalog refresh failed for {t}: {e}")
                if doc:
                    _vix_ids[t] = set(doc["ids"])
            try:
                _record_added(t, _vix_ids[t])
            except Exception as e:
                logger.warning(f"vixsrc added-tracking failed for {t}: {e}")
        _vix_loaded_at = now
    return {t: len(v) for t, v in _vix_ids.items()}


# First-seen timestamp per catalog id -> powers the "Data di aggiunta" ordering of the Archive
vixsrc_added = db["vixsrc_added"]
vixsrc_added.create_index([("type", 1), ("tmdbId", 1)], unique=True)
vixsrc_added.create_index([("type", 1), ("added_at", -1), ("tmdbId", -1)])


def _record_added(t: str, ids: set):
    if not ids:
        return
    known = set(vixsrc_added.distinct("tmdbId", {"type": t}))
    new = ids - known
    if new:
        now = datetime.now(timezone.utc).isoformat()
        vixsrc_added.insert_many([{"type": t, "tmdbId": i, "added_at": now} for i in new], ordered=False)
        logger.info(f"vixsrc added-tracking: {len(new)} new {t} ids")


def is_on_vixsrc(media_type: str, tmdb_id: int) -> bool:
    """Strict Italian-audio filter: only titles in the vixsrc lang=it catalog pass."""
    ids = _vix_ids["tv" if media_type == "tv" else "movie"]
    if not ids:
        logger.warning("vixsrc catalog not loaded yet: language filter temporarily disabled")
        return True
    return tmdb_id in ids


async def filter_available(items: list, limit: int = 24) -> list:
    """Keep only titles dubbed in Italian (present in the vixsrc lang=it catalog)."""
    await refresh_vixsrc_catalog()
    return [i for i in items if is_on_vixsrc(i.get("type", "movie"), i.get("tmdbId"))][:limit]


async def fetch_tmdb_pages(endpoint: str, params: dict, pages: int = 2) -> Optional[dict]:
    """Fetch N consecutive TMDB pages so rows stay full after the vixsrc filter."""
    start = int(params.get("page", 1) or 1)
    first = start * pages - (pages - 1)
    results = await asyncio.gather(*(fetch_tmdb_data(endpoint, {**params, "page": first + i}) for i in range(pages)))
    merged, seen = [], set()
    for data in results:
        for item in (data or {}).get("results") or []:
            if item.get("id") not in seen:
                seen.add(item.get("id"))
                merged.append(item)
    return {"results": merged} if merged else None


class AvailabilityRequest(BaseModel):
    items: List[dict]


@app.post("/api/public/availability")
async def check_availability(req: AvailabilityRequest):
    """Return which of the given {type,id} items are available on vixsrc."""
    await refresh_vixsrc_catalog()
    out = []
    for it in req.items[:200]:
        try:
            tid = int(it.get("id") or it.get("tmdbId"))
        except (TypeError, ValueError):
            continue
        mt = "tv" if it.get("type") == "tv" else "movie"
        if is_on_vixsrc(mt, tid):
            out.append({"type": mt, "id": tid})
    return {"available": out, "catalog_loaded": bool(_vix_ids["movie"])}


@app.get("/api/public/availability/{media_type}/{tmdb_id}")
async def check_single_availability(media_type: str, tmdb_id: int):
    await refresh_vixsrc_catalog()
    return {"available": is_on_vixsrc(media_type, tmdb_id), "catalog_loaded": bool(_vix_ids["movie"])}


# =====================
# STREAMINGCOMMUNITY TRAILER SCRAPER (trailers are YouTube ids on SC as well)
# =====================
_sc_semaphore = asyncio.Semaphore(2)


def _sc_base_url() -> Optional[str]:
    return (get_setting("sc_base_url") or os.environ.get("SC_BASE_URL") or "").strip().rstrip("/") or None


def _extract_sc_trailer(html: str) -> Optional[str]:
    import html as html_lib
    import re
    m = re.search(r'data-page="([^"]+)"', html)
    if m:
        try:
            page = json.loads(html_lib.unescape(m.group(1)))
            trailers = ((page.get("props") or {}).get("title") or {}).get("trailers") or []
            for t in trailers:
                if t.get("youtube_id"):
                    return t["youtube_id"]
        except Exception:
            pass
    m = re.search(r'<slider-trailer[^>]*videos="([^"]+)"', html)
    if m:
        try:
            for t in json.loads(html_lib.unescape(m.group(1))):
                key = t.get("url") or t.get("youtube_id")
                if key:
                    return key
        except Exception:
            pass
    return None


async def scrape_sc_trailer(media_type: str, tmdb_id: int, title: str, year: Optional[str]) -> Optional[str]:
    base = _sc_base_url()
    if not base or not title:
        return None
    headers = {"User-Agent": BROWSER_UA, "Accept": "text/html,application/json", "Referer": base + "/"}
    async with _sc_semaphore:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=headers) as client:
            r = await client.get(f"{base}/api/search", params={"q": title})
            if r.status_code != 200 or "text/html" in r.headers.get("content-type", "") and "Just a moment" in r.text:
                logger.warning(f"SC search blocked/unavailable ({r.status_code}) for {title}")
                return None
            data = r.json()
            results = data.get("data") if isinstance(data, dict) else data
            wanted_type = "tv" if media_type == "tv" else "movie"
            match = None
            for res in results or []:
                if str(res.get("tmdb_id") or "") == str(tmdb_id):
                    match = res
                    break
            if not match:
                for res in results or []:
                    if res.get("type") == wanted_type and (res.get("name") or "").strip().lower() == title.strip().lower():
                        if not year or str(res.get("last_air_date") or "").startswith(year) or not res.get("last_air_date"):
                            match = res
                            break
            if not match:
                return None
            page = await client.get(f"{base}/it/titles/{match['id']}-{match.get('slug', '')}")
            if page.status_code != 200:
                page = await client.get(f"{base}/titles/{match['id']}-{match.get('slug', '')}")
            return _extract_sc_trailer(page.text) if page.status_code == 200 else None


async def ensure_sc_trailer(media_type: str, tmdb_id: int) -> Optional[str]:
    """Look up the StreamingCommunity trailer once per title and cache it in media_assets."""
    media_type = "tv" if media_type == "tv" else "movie"
    assets = media_assets.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0})
    if not assets:
        return None
    if assets.get("sc_checked_at") and not _sc_base_url():
        return assets.get("sc_trailer_key")
    checked = assets.get("sc_checked_at")
    if checked and datetime.fromisoformat(checked) > datetime.now(timezone.utc) - timedelta(days=7):
        return assets.get("sc_trailer_key")
    key = None
    try:
        year = (assets.get("release_date") or "")[:4] or None
        key = await scrape_sc_trailer(media_type, tmdb_id, assets.get("title") or "", year)
    except Exception as e:
        logger.warning(f"SC trailer scrape failed for {tmdb_id}: {e}")
    media_assets.update_one({"type": media_type, "tmdbId": tmdb_id},
                            {"$set": {"sc_trailer_key": key, "sc_checked_at": datetime.now(timezone.utc).isoformat()}})
    return key


@app.get("/api/public/trailer/{media_type}/{tmdb_id}")
async def get_public_trailer(media_type: str, tmdb_id: int):
    """Best trailer for hover/hero: StreamingCommunity first (if configured), TMDB otherwise."""
    assets = await get_media_assets(media_type, tmdb_id)
    if not assets:
        raise HTTPException(status_code=404, detail="Content not found")
    sc_key = await ensure_sc_trailer(media_type, tmdb_id) if _sc_base_url() else None
    return {"trailer_key": sc_key or assets.get("trailer_key"), "source": "streamingcommunity" if sc_key else "tmdb"}


class AppSettingsUpdate(BaseModel):
    sc_base_url: Optional[str] = None


@app.get("/api/admin/settings")
async def get_admin_settings(admin = Depends(get_current_admin)):
    counts = await refresh_vixsrc_catalog()
    docs = {d["type"]: d for d in vixsrc_catalog.find({}, {"_id": 0, "ids": 0})}
    return {
        "sc_base_url": get_setting("sc_base_url", ""),
        "vixsrc": {t: {"count": counts.get(t, 0), "updated_at": (docs.get(t) or {}).get("updated_at")} for t in ("movie", "tv")},
    }


@app.put("/api/admin/settings")
def update_admin_settings(data: AppSettingsUpdate, admin = Depends(get_current_admin)):
    if data.sc_base_url is not None:
        set_setting("sc_base_url", data.sc_base_url.strip().rstrip("/"))
    log_admin_action("UPDATE_SETTINGS", metadata=data.model_dump(exclude_none=True))
    return {"success": True}


@app.post("/api/admin/settings/refresh-catalog")
async def admin_refresh_catalog(admin = Depends(get_current_admin)):
    counts = await refresh_vixsrc_catalog(force=True)
    log_admin_action("REFRESH_VIXSRC_CATALOG", metadata=counts)
    return {"success": True, "vixsrc": counts}


@app.on_event("startup")
async def _startup_catalog():
    async def loop():
        while True:
            try:
                await refresh_vixsrc_catalog()
            except Exception as e:
                logger.warning(f"catalog loop error: {e}")
            await asyncio.sleep(VIX_REFRESH_HOURS * 3600)
    asyncio.create_task(loop())




async def check_vixsrc_availability(tmdb_id: int, content_type: str) -> dict:
    """
    Check if content is available on vixsrc.to
    Returns dict with available status and source_url
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    
    # Build URL based on content type
    if content_type == "tv":
        url = f"https://vixsrc.to/tv/{tmdb_id}/1/1"
    else:
        url = f"https://vixsrc.to/movie/{tmdb_id}"
    
    is_available = False
    
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.head(url)
            if response.status_code == 200:
                is_available = True
            else:
                response = await client.get(url)
                if response.status_code == 200 and "not found" not in response.text.lower():
                    is_available = True
    except Exception as e:
        logger.warning(f"Vixsrc check failed for {tmdb_id}: {e}")
    
    return {
        "available": is_available,
        "source_url": url if is_available else None,
        "checked_at": now_iso
    }

async def check_vixsrc_episode_availability(
    tmdb_id: int,
    season: int,
    episode: int
) -> bool:
    """
    Check availability of specific TV episode with DB cache
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    cache_query = {
        "tmdbId": tmdb_id,
        "type": "tv",
        "season": season,
        "episode": episode
    }

    # Check cache first
    cached = vixsrc_cache.find_one(cache_query)
    if cached:
        try:
            cached_at = cached.get("checked_at", "")
            if cached_at:
                if "+" in cached_at or "Z" in cached_at:
                    cache_time = datetime.fromisoformat(cached_at.replace("Z", "+00:00"))
                else:
                    cache_time = datetime.fromisoformat(cached_at).replace(tzinfo=timezone.utc)
                if now - cache_time < timedelta(hours=6):
                    return cached.get("available", False)
        except Exception as e:
            logger.warning(f"Cache time parse error: {e}")

    url = f"https://vixsrc.to/tv/{tmdb_id}/{season}/{episode}"
    is_available = False

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.head(url)
            if response.status_code == 200:
                is_available = True
            else:
                response = await client.get(url)
                if response.status_code == 200 and "not found" not in response.text.lower():
                    is_available = True
    except Exception as e:
        logger.warning(f"Vixsrc episode check failed for {tmdb_id} S{season}E{episode}: {e}")

    # Save cache
    vixsrc_cache.update_one(
        cache_query,
        {
            "$set": {
                "tmdbId": tmdb_id,
                "type": "tv",
                "season": season,
                "episode": episode,
                "available": is_available,
                "source_url": url if is_available else None,
                "checked_at": now_iso
            }
        },
        upsert=True
    )

    return is_available

async def import_content_from_tmdb(tmdb_id: int, content_type: str, check_vixsrc: bool = True) -> dict:
    """Import content data from TMDB and optionally verify vixsrc availability"""
    endpoint = f"/{content_type}/{tmdb_id}"
    data = await fetch_tmdb_data(endpoint)
    
    if not data:
        return None
    
    now = datetime.now(timezone.utc).isoformat()
    
    # Check vixsrc availability if requested
    vixsrc_available = False
    vixsrc_url = None
    if check_vixsrc:
        vixsrc_status = await check_vixsrc_availability(tmdb_id, content_type)
        vixsrc_available = vixsrc_status["available"]
        vixsrc_url = vixsrc_status.get("source_url")
    
    content = {
        "tmdbId": tmdb_id,
        "type": content_type,
        "title": data.get("title") or data.get("name"),
        "original_title": data.get("original_title") or data.get("original_name"),
        "overview": data.get("overview"),
        "poster_path": data.get("poster_path"),
        "backdrop_path": data.get("backdrop_path"),
        "release_date": data.get("release_date") or data.get("first_air_date"),
        "vote_average": data.get("vote_average", 0),
        "vote_count": data.get("vote_count", 0),
        "popularity": data.get("popularity", 0),
        "genres": data.get("genres", []),
        "runtime": data.get("runtime"),
        "status": data.get("status"),
        "tagline": data.get("tagline"),
        "spoken_languages": data.get("spoken_languages", []),
        "production_companies": data.get("production_companies", []),
        "production_countries": data.get("production_countries", []),
        "available": vixsrc_available,
        "vixsrc_available": vixsrc_available,
        "vixsrc_url": vixsrc_url,
        "vixsrc_checked_at": now if check_vixsrc else None,
        "createdAt": now,
        "updatedAt": now
    }
    
    # For TV shows, add additional fields
    if content_type == "tv":
        content["number_of_seasons"] = data.get("number_of_seasons", 0)
        content["number_of_episodes"] = data.get("number_of_episodes", 0)
        content["episode_run_time"] = data.get("episode_run_time", [])
        content["in_production"] = data.get("in_production", False)
        content["networks"] = data.get("networks", [])
        content["created_by"] = data.get("created_by", [])
        content["seasons_info"] = data.get("seasons", [])
    
    return content

async def import_tv_seasons_episodes(tmdb_id: int) -> dict:
    """Import all seasons and episodes for a TV show from TMDB"""
    # First get TV show details to know number of seasons
    tv_data = await fetch_tmdb_data(f"/tv/{tmdb_id}")
    if not tv_data:
        return {"success": False, "error": "TV show not found"}
    
    seasons_imported = 0
    episodes_imported = 0
    
    seasons_list = tv_data.get("seasons", [])
    
    for season_info in seasons_list:
        season_number = season_info.get("season_number")
        if season_number is None or season_number == 0:  # Skip specials (season 0)
            continue
        
        # Fetch season details
        season_data = await fetch_tmdb_data(f"/tv/{tmdb_id}/season/{season_number}")
        if not season_data:
            continue
        
        # Save season
        season_doc = {
            "tmdbId": tmdb_id,
            "season_number": season_number,
            "name": season_data.get("name"),
            "overview": season_data.get("overview"),
            "poster_path": season_data.get("poster_path"),
            "air_date": season_data.get("air_date"),
            "episode_count": len(season_data.get("episodes", [])),
            "vote_average": season_data.get("vote_average", 0),
            "updatedAt": datetime.now(timezone.utc).isoformat()
        }
        
        tv_seasons.update_one(
            {"tmdbId": tmdb_id, "season_number": season_number},
            {"$set": season_doc},
            upsert=True
        )
        seasons_imported += 1
        
        # Save episodes
        for ep in season_data.get("episodes", []):
            episode_doc = {
                "tmdbId": tmdb_id,
                "season_number": season_number,
                "episode_number": ep.get("episode_number"),
                "name": ep.get("name"),
                "overview": ep.get("overview"),
                "still_path": ep.get("still_path"),
                "air_date": ep.get("air_date"),
                "runtime": ep.get("runtime"),
                "vote_average": ep.get("vote_average", 0),
                "vote_count": ep.get("vote_count", 0),
                "updatedAt": datetime.now(timezone.utc).isoformat()
            }
            
            tv_episodes.update_one(
                {"tmdbId": tmdb_id, "season_number": season_number, "episode_number": ep.get("episode_number")},
                {"$set": episode_doc},
                upsert=True
            )
            episodes_imported += 1
    
    return {
        "success": True,
        "seasons_imported": seasons_imported,
        "episodes_imported": episodes_imported
    }

def format_italian_date(date_str: str) -> str:
    """Convert date string to Italian format (es. 15 Gennaio 2024)"""
    if not date_str:
        return None
    
    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        months = {
            1: "Gennaio", 2: "Febbraio", 3: "Marzo", 4: "Aprile",
            5: "Maggio", 6: "Giugno", 7: "Luglio", 8: "Agosto",
            9: "Settembre", 10: "Ottobre", 11: "Novembre", 12: "Dicembre"
        }
        return f"{date_obj.day} {months[date_obj.month]} {date_obj.year}"
    except Exception:
        return date_str

def init_default_admin():
    """Create default admin if not exists"""
    existing = admin_users.find_one({"email": "admin@admin.com"})
    if not existing:
        hashed = bcrypt.hashpw("admin123".encode(), bcrypt.gensalt())
        admin_users.insert_one({
            "email": "admin@admin.com",
            "password": hashed.decode(),
            "createdAt": datetime.now(timezone.utc).isoformat()
        })
        logger.info("Default admin created: admin@admin.com / admin123")

def init_default_sections():
    """No default sections - user adds them from admin panel"""
    pass

# Initialize defaults on startup
init_default_admin()
init_default_sections()

# Health Check
@app.get("/api/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

# =====================
# ADMIN AUTH ENDPOINTS
# =====================

@app.post("/api/admin/login")
def admin_login(data: AdminLogin):
    """Admin login endpoint"""
    admin = admin_users.find_one({"email": data.email})
    if not admin:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not bcrypt.checkpw(data.password.encode(), admin["password"].encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    payload = {
        "email": admin["email"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": datetime.now(timezone.utc)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    log_admin_action("LOGIN", metadata={"email": admin["email"]})
    
    return {
        "token": token,
        "email": admin["email"],
        "expiresIn": JWT_EXPIRATION_HOURS * 3600
    }

@app.get("/api/admin/me")
def get_admin_profile(admin = Depends(get_current_admin)):
    """Get current admin profile"""
    return admin

# =====================
# CONTENT MANAGEMENT ENDPOINTS
# =====================

@app.post("/api/admin/contents")
async def create_content(data: ContentCreate, admin = Depends(get_current_admin)):
    """Add new content to managed list - imports from TMDB and verifies vixsrc availability"""
    existing = contents.find_one({"tmdbId": data.tmdbId})
    if existing:
        raise HTTPException(status_code=400, detail="Content already exists")
    
    # Import from TMDB and verify vixsrc
    content = await import_content_from_tmdb(data.tmdbId, data.type, check_vixsrc=True)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found on TMDB")
    
    # Override available status if manually set
    if data.available is not None:
        content["available"] = data.available
    content["availableSeason"] = data.availableSeason
    
    result = contents.insert_one(content)
    
    # If TV show, import all seasons and episodes
    if data.type == "tv":
        import_result = await import_tv_seasons_episodes(data.tmdbId)
        logger.info(f"Imported TV show {data.tmdbId}: {import_result}")
    
    log_admin_action("CREATE_CONTENT", str(data.tmdbId), {
        "type": data.type,
        "vixsrc_available": content.get("vixsrc_available", False)
    })
    
    # Return without _id
    content.pop("_id", None)
    return {"success": True, "content": content, "vixsrc_available": content.get("vixsrc_available", False)}

@app.get("/api/admin/contents")
def get_contents(
    available: Optional[bool] = None,
    type: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    sort_by: str = "createdAt",
    sort_order: str = "desc",
    admin = Depends(get_current_admin)
):
    """Get all managed contents with filters and sorting"""
    query = {}
    if available is not None:
        query["available"] = available
    if type:
        query["type"] = type
    if search:
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"original_title": {"$regex": search, "$options": "i"}}
        ]
    
    total = contents.count_documents(query)
    skip = (page - 1) * limit
    
    sort_direction = DESCENDING if sort_order == "desc" else ASCENDING
    items = list(contents.find(query, {"_id": 0}).sort(sort_by, sort_direction).skip(skip).limit(limit))
    
    # Add formatted Italian date
    for item in items:
        item["release_date_it"] = format_italian_date(item.get("release_date"))
    
    return {
        "items": items,
        "total": total,
        "page": page,
        "totalPages": (total + limit - 1) // limit
    }

@app.get("/api/admin/contents/{tmdb_id}")
def get_content(tmdb_id: int, admin = Depends(get_current_admin)):
    """Get single content by TMDB ID"""
    content = contents.find_one({"tmdbId": tmdb_id}, {"_id": 0})
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    content["release_date_it"] = format_italian_date(content.get("release_date"))
    return content

@app.put("/api/admin/contents/{tmdb_id}")
def update_content(tmdb_id: int, data: ContentUpdate, admin = Depends(get_current_admin)):
    """Update content availability or season"""
    content = contents.find_one({"tmdbId": tmdb_id})
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    
    update_data = {"updatedAt": datetime.now(timezone.utc).isoformat()}
    if data.available is not None:
        update_data["available"] = data.available
    if data.availableSeason is not None:
        update_data["availableSeason"] = data.availableSeason
    
    contents.update_one({"tmdbId": tmdb_id}, {"$set": update_data})
    log_admin_action("UPDATE_CONTENT", str(tmdb_id), update_data)
    
    return {"success": True}

@app.delete("/api/admin/contents/{tmdb_id}")
def delete_content(tmdb_id: int, admin = Depends(get_current_admin)):
    """Delete content from managed list"""
    result = contents.delete_one({"tmdbId": tmdb_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Content not found")
    
    # Also delete associated seasons and episodes
    tv_seasons.delete_many({"tmdbId": tmdb_id})
    tv_episodes.delete_many({"tmdbId": tmdb_id})
    
    log_admin_action("DELETE_CONTENT", str(tmdb_id))
    
    return {"success": True}

@app.post("/api/admin/contents/{tmdb_id}/refresh")
async def refresh_content(tmdb_id: int, admin = Depends(get_current_admin)):
    """Refresh content data from TMDB and re-check vixsrc availability"""
    existing = contents.find_one({"tmdbId": tmdb_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Content not found")
    
    content = await import_content_from_tmdb(tmdb_id, existing["type"], check_vixsrc=True)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found on TMDB")
    
    # Keep local fields but update vixsrc status
    content["availableSeason"] = existing.get("availableSeason")
    content["createdAt"] = existing.get("createdAt")
    
    contents.update_one({"tmdbId": tmdb_id}, {"$set": content})
    
    # Refresh seasons/episodes for TV shows
    if existing["type"] == "tv":
        await import_tv_seasons_episodes(tmdb_id)
    
    log_admin_action("REFRESH_CONTENT", str(tmdb_id))
    
    return {"success": True, "vixsrc_available": content.get("vixsrc_available", False)}

@app.post("/api/admin/contents/{tmdb_id}/check-vixsrc")
async def check_content_vixsrc(tmdb_id: int, admin = Depends(get_current_admin)):
    """Check vixsrc availability for a specific content"""
    existing = contents.find_one({"tmdbId": tmdb_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Content not found")
    
    vixsrc_status = await check_vixsrc_availability(tmdb_id, existing["type"])
    
    # Update content with vixsrc status
    contents.update_one(
        {"tmdbId": tmdb_id},
        {"$set": {
            "available": vixsrc_status["available"],
            "vixsrc_available": vixsrc_status["available"],
            "vixsrc_url": vixsrc_status.get("source_url"),
            "vixsrc_checked_at": vixsrc_status.get("checked_at"),
            "updatedAt": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"success": True, "vixsrc_available": vixsrc_status["available"], "vixsrc_url": vixsrc_status.get("source_url")}

@app.post("/api/admin/import-from-tmdb")
async def import_trending_from_tmdb(
    content_type: str = "movie",
    category: str = "popular",
    page: int = 1,
    verify_vixsrc: bool = False,
    admin = Depends(get_current_admin)
):
    """
    Import trending/popular content from TMDB and verify availability on vixsrc.to
    Categories: popular, top_rated, trending, now_playing (movies), on_the_air (tv)
    """
    # Fetch from TMDB based on category
    if category == "trending":
        endpoint = f"/trending/{content_type}/week"
    elif category == "now_playing" and content_type == "movie":
        endpoint = "/movie/now_playing"
    elif category == "on_the_air" and content_type == "tv":
        endpoint = "/tv/on_the_air"
    else:
        endpoint = f"/{content_type}/{category}"
    
    tmdb_data = await fetch_tmdb_data(endpoint, {"page": page})
    if not tmdb_data or "results" not in tmdb_data:
        raise HTTPException(status_code=500, detail="Failed to fetch from TMDB")
    
    imported = 0
    available_on_vixsrc = 0
    skipped = 0
    results = []
    
    for item in tmdb_data["results"][:20]:  # Limit to 20 per request
        tmdb_id = item.get("id")
        media_type = item.get("media_type", content_type)
        
        # Skip if already exists
        existing = contents.find_one({"tmdbId": tmdb_id})
        if existing:
            skipped += 1
            continue
        
        # Import with vixsrc check
        content = await import_content_from_tmdb(tmdb_id, media_type, check_vixsrc=verify_vixsrc)
        if not content:
            continue
        
        # Only save if available on vixsrc (or if verify_vixsrc is False)
        if not verify_vixsrc or content.get("vixsrc_available", False):
            try:
                contents.insert_one(content)
                imported += 1
                if content.get("vixsrc_available"):
                    available_on_vixsrc += 1
                
                # Import seasons/episodes for TV
                if media_type == "tv":
                    await import_tv_seasons_episodes(tmdb_id)
                
                results.append({
                    "tmdbId": tmdb_id,
                    "title": content.get("title"),
                    "type": media_type,
                    "vixsrc_available": content.get("vixsrc_available", False)
                })
            except Exception as e:
                logger.error(f"Error importing {tmdb_id}: {e}")
    
    log_admin_action("IMPORT_FROM_TMDB", metadata={
        "category": category,
        "content_type": content_type,
        "imported": imported,
        "available_on_vixsrc": available_on_vixsrc
    })
    
    return {
        "success": True,
        "imported": imported,
        "available_on_vixsrc": available_on_vixsrc,
        "skipped": skipped,
        "results": results
    }

@app.post("/api/admin/verify-all-vixsrc")
async def verify_all_vixsrc_availability(admin = Depends(get_current_admin)):
    """Re-verify vixsrc availability for all contents in database"""
    all_contents = list(contents.find({}, {"tmdbId": 1, "type": 1, "_id": 0}))
    
    verified = 0
    available = 0
    unavailable = 0
    
    for item in all_contents:
        vixsrc_status = await check_vixsrc_availability(item["tmdbId"], item["type"])
        
        contents.update_one(
            {"tmdbId": item["tmdbId"]},
            {"$set": {
                "available": vixsrc_status["available"],
                "vixsrc_available": vixsrc_status["available"],
                "vixsrc_url": vixsrc_status.get("source_url"),
                "vixsrc_checked_at": vixsrc_status.get("checked_at"),
                "updatedAt": datetime.now(timezone.utc).isoformat()
            }}
        )
        
        verified += 1
        if vixsrc_status["available"]:
            available += 1
        else:
            unavailable += 1
    
    log_admin_action("VERIFY_ALL_VIXSRC", metadata={
        "verified": verified,
        "available": available,
        "unavailable": unavailable
    })
    
    return {
        "success": True,
        "verified": verified,
        "available": available,
        "unavailable": unavailable
    }

@app.post("/api/admin/cleanup")
async def cleanup_database(admin = Depends(get_current_admin)):
    """Clean up and reimport all content from database"""
    # Get all existing content IDs
    existing_ids = list(contents.find({}, {"tmdbId": 1, "type": 1, "_id": 0}))
    
    # Clear all data
    contents.delete_many({})
    tv_seasons.delete_many({})
    tv_episodes.delete_many({})
    
    # Reimport everything
    reimported = 0
    for item in existing_ids:
        try:
            content = await import_content_from_tmdb(item["tmdbId"], item["type"])
            if content:
                content["available"] = True
                contents.insert_one(content)
                
                if item["type"] == "tv":
                    await import_tv_seasons_episodes(item["tmdbId"])
                
                reimported += 1
        except Exception as e:
            logger.error(f"Error reimporting {item['tmdbId']}: {e}")
    
    log_admin_action("CLEANUP_DATABASE", metadata={"reimported": reimported})
    
    return {"success": True, "reimported": reimported, "total": len(existing_ids)}

# =====================
# HERO MANAGEMENT ENDPOINTS
# =====================

@app.get("/api/admin/hero")
def get_hero(admin = Depends(get_current_admin)):
    """Get current hero settings"""
    from fastapi.responses import JSONResponse
    
    hero = hero_settings.find_one({}, {"_id": 0})
    return JSONResponse(
        content=hero if hero else {},
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.put("/api/admin/hero")
def update_hero(data: HeroUpdate, admin = Depends(get_current_admin)):
    """Update hero section"""
    hero_data = {
        "contentId": sanitize_string(data.contentId),
        "mediaType": data.mediaType,
        "customTitle": sanitize_string(data.customTitle) if data.customTitle else None,
        "customDescription": sanitize_string(data.customDescription) if data.customDescription else None,
        "customBackdrop": data.customBackdrop,
        "seasonLabel": sanitize_string(data.seasonLabel) if data.seasonLabel else None,
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }
    
    hero_settings.update_one({}, {"$set": hero_data}, upsert=True)
    log_admin_action("UPDATE_HERO", data.contentId, {"mediaType": data.mediaType})
    
    return {"success": True, "hero": hero_data}

# =====================
# SECTIONS MANAGEMENT ENDPOINTS
# =====================

class SectionCreateFull(BaseModel):
    name: str
    section_type: str = "popular"
    media_type: str = "movie"
    visible: bool = True
    order: int = 0

class SectionUpdateFull(BaseModel):
    name: Optional[str] = None
    section_type: Optional[str] = None
    media_type: Optional[str] = None
    visible: Optional[bool] = None
    order: Optional[int] = None

@app.get("/api/admin/sections")
def get_sections(admin = Depends(get_current_admin)):
    """Get all sections"""
    items = list(sections.find({}, {"_id": 0}).sort("order", 1))
    for i, item in enumerate(items):
        item["id"] = item.get("name", f"section_{i}")
    return {"sections": items, "items": items}

@app.post("/api/admin/sections")
def create_section(data: SectionCreateFull, admin = Depends(get_current_admin)):
    """Create new section"""
    existing = sections.find_one({"name": data.name})
    if existing:
        raise HTTPException(status_code=400, detail="Section with this name already exists")
    
    now = datetime.now(timezone.utc).isoformat()
    section = {
        "name": data.name,
        "section_type": data.section_type,
        "apiString": data.section_type,
        "media_type": data.media_type,
        "mediaType": data.media_type,
        "visible": data.visible,
        "active": data.visible,
        "order": data.order,
        "createdAt": now,
        "updatedAt": now
    }
    sections.insert_one(section)
    
    log_admin_action("CREATE_SECTION", data.name, {"section_type": data.section_type})
    
    section["id"] = data.name
    section.pop("_id", None)
    return section

@app.put("/api/admin/sections/reorder")
def reorder_sections(orders: List[dict], admin = Depends(get_current_admin)):
    """Reorder all sections"""
    for item in orders:
        section_id = item.get("id") or item.get("name")
        sections.update_one(
            {"name": section_id},
            {"$set": {"order": item["order"], "updatedAt": datetime.now(timezone.utc).isoformat()}}
        )
    
    log_admin_action("REORDER_SECTIONS")
    return {"success": True}

@app.put("/api/admin/sections/{section_id}")
def update_section(section_id: str, data: SectionUpdateFull, admin = Depends(get_current_admin)):
    """Update section by id/name"""
    existing = sections.find_one({"name": section_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Section not found")
    
    update_data = {"updatedAt": datetime.now(timezone.utc).isoformat()}
    if data.name is not None:
        update_data["name"] = data.name
    if data.section_type is not None:
        update_data["section_type"] = data.section_type
        update_data["apiString"] = data.section_type
    if data.media_type is not None:
        update_data["media_type"] = data.media_type
        update_data["mediaType"] = data.media_type
    if data.visible is not None:
        update_data["visible"] = data.visible
        update_data["active"] = data.visible
    if data.order is not None:
        update_data["order"] = data.order
    
    sections.update_one({"name": section_id}, {"$set": update_data})
    log_admin_action("UPDATE_SECTION", section_id, update_data)
    
    updated = sections.find_one({"name": data.name if data.name else section_id}, {"_id": 0})
    updated["id"] = updated["name"]
    return updated

@app.delete("/api/admin/sections/{section_id}")
def delete_section(section_id: str, admin = Depends(get_current_admin)):
    """Delete section by id/name"""
    result = sections.delete_one({"name": section_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Section not found")
    
    log_admin_action("DELETE_SECTION", section_id)
    return {"success": True}

# =====================
# MENU MANAGEMENT ENDPOINTS
# =====================

class MenuItemCreate(BaseModel):
    name: str
    path: str = ""
    order: int = 0
    active: bool = True

@app.get("/api/admin/menu")
def get_menu_items(admin = Depends(get_current_admin)):
    """Get all menu items"""
    items = list(menu_items.find({}, {"_id": 0}).sort("order", 1))
    return {"items": items}

@app.post("/api/admin/menu")
def create_menu_item(data: MenuItemCreate, admin = Depends(get_current_admin)):
    """Create new menu item"""
    import uuid
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "id": str(uuid.uuid4())[:8],
        "name": data.name,
        "path": data.path,
        "order": data.order,
        "active": data.active,
        "createdAt": now,
        "updatedAt": now
    }
    menu_items.insert_one(item)
    
    log_admin_action("CREATE_MENU_ITEM", item["id"], {"name": data.name})
    
    item.pop("_id", None)
    return item

class MenuReorderItem(BaseModel):
    id: str
    order: int

class MenuReorderRequest(BaseModel):
    items: List[MenuReorderItem]

@app.put("/api/admin/menu/reorder")
def reorder_menu_items(request: MenuReorderRequest, admin = Depends(get_current_admin)):
    """Reorder menu items"""
    for item in request.items:
        menu_items.update_one(
            {"id": item.id},
            {"$set": {"order": item.order, "updatedAt": datetime.now(timezone.utc).isoformat()}}
        )
    
    log_admin_action("REORDER_MENU")
    return {"success": True}

@app.put("/api/admin/menu/{item_id}")
def update_menu_item(item_id: str, data: MenuItemUpdate, admin = Depends(get_current_admin)):
    """Update menu item"""
    existing = menu_items.find_one({"id": item_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Menu item not found")
    
    update_data = {"updatedAt": datetime.now(timezone.utc).isoformat()}
    for field in ["name", "path", "order", "active"]:
        value = getattr(data, field, None)
        if value is not None:
            update_data[field] = value
    
    menu_items.update_one({"id": item_id}, {"$set": update_data})
    log_admin_action("UPDATE_MENU_ITEM", item_id, update_data)
    
    updated = menu_items.find_one({"id": item_id}, {"_id": 0})
    return updated

@app.delete("/api/admin/menu/{item_id}")
def delete_menu_item(item_id: str, admin = Depends(get_current_admin)):
    """Delete menu item"""
    result = menu_items.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Menu item not found")
    
    log_admin_action("DELETE_MENU_ITEM", item_id)
    return {"success": True}

@app.get("/api/public/menu")
def get_public_menu():
    """Get visible menu items for public frontend"""
    items = list(menu_items.find({"active": True}, {"_id": 0}).sort("order", 1))
    return {"items": items}

@app.get("/api/public/sections")
def get_public_sections():
    """Get active sections for public frontend homepage"""
    items = list(sections.find({"active": True}, {"_id": 0}).sort("order", 1))
    for i, item in enumerate(items):
        item["id"] = item.get("name", f"section_{i}")
    return {"sections": items}

# Predefined section templates for admin
# Movie genre id <-> TV genre id equivalents (TMDB uses different ids for some genres)
MOVIE_TO_TV_GENRE = {28: 10759, 12: 10759, 878: 10765, 14: 10765, 10752: 10768, 10751: 10751,
                     16: 16, 35: 35, 80: 80, 99: 99, 18: 18, 9648: 9648, 37: 37}
TV_TO_MOVIE_GENRE = {10759: 28, 10765: 878, 10768: 10752, 10762: 10751, 10751: 10751,
                     16: 16, 35: 35, 80: 80, 99: 99, 18: 18, 9648: 9648, 37: 37}
TV_ONLY_GENRES = {10764, 10766, 10767, 10763, 10770}


def genre_pair(genre_id: int):
    """Return (movie_genre_id, tv_genre_id) for a mixed row; None when a side has no equivalent."""
    if genre_id in TV_ONLY_GENRES:
        return None, genre_id
    if genre_id in MOVIE_TO_TV_GENRE:
        return genre_id, MOVIE_TO_TV_GENRE[genre_id]
    if genre_id in TV_TO_MOVIE_GENRE:
        return TV_TO_MOVIE_GENRE[genre_id], genre_id
    return genre_id, None


AVAILABLE_SECTIONS = [
    {"name": "I titoli del momento", "section_type": "trending", "media_type": "mixed", "description": "Contenuti di tendenza"},
    {"name": "Aggiunti di recente", "section_type": "latest", "media_type": "mixed", "description": "Ultimi contenuti aggiunti"},
    {"name": "Top 10 titoli oggi", "section_type": "top10", "media_type": "mixed", "description": "I 10 titoli più visti oggi"},
    {"name": "In arrivo", "section_type": "upcoming", "media_type": "movie", "description": "Film in uscita prossimamente"},
    {"name": "Animazione", "section_type": "genre", "media_type": "mixed", "genre_id": 16, "description": "Film e serie di animazione"},
    {"name": "Azione", "section_type": "genre", "media_type": "mixed", "genre_id": 28, "description": "Azione e avventura, film e serie"},
    {"name": "Avventura", "section_type": "genre", "media_type": "mixed", "genre_id": 12, "description": "Avventure epiche"},
    {"name": "Commedia", "section_type": "genre", "media_type": "mixed", "genre_id": 35, "description": "Risate garantite"},
    {"name": "Crime", "section_type": "genre", "media_type": "mixed", "genre_id": 80, "description": "Crimini e investigazioni"},
    {"name": "Dramma", "section_type": "genre", "media_type": "mixed", "genre_id": 18, "description": "Storie drammatiche"},
    {"name": "Mistero", "section_type": "genre", "media_type": "mixed", "genre_id": 9648, "description": "Misteri e intrighi"},
    {"name": "Thriller", "section_type": "genre", "media_type": "mixed", "genre_id": 53, "description": "Suspense e tensione"},
    {"name": "Horror", "section_type": "genre", "media_type": "mixed", "genre_id": 27, "description": "Film dell'orrore"},
    {"name": "Fantascienza", "section_type": "genre", "media_type": "mixed", "genre_id": 878, "description": "Mondi futuristici, film e serie"},
    {"name": "Fantasy", "section_type": "genre", "media_type": "mixed", "genre_id": 14, "description": "Mondi fantastici, film e serie"},
    {"name": "Famiglia", "section_type": "genre", "media_type": "mixed", "genre_id": 10751, "description": "Per tutta la famiglia"},
    {"name": "Romance", "section_type": "genre", "media_type": "mixed", "genre_id": 10749, "description": "Storie d'amore"},
    {"name": "Guerra", "section_type": "genre", "media_type": "mixed", "genre_id": 10752, "description": "Guerra e politica, film e serie"},
    {"name": "Storia", "section_type": "genre", "media_type": "mixed", "genre_id": 36, "description": "Fatti storici"},
    {"name": "Western", "section_type": "genre", "media_type": "mixed", "genre_id": 37, "description": "Il selvaggio West"},
    {"name": "Musica", "section_type": "genre", "media_type": "mixed", "genre_id": 10402, "description": "Film e serie musicali"},
    {"name": "Documentario", "section_type": "genre", "media_type": "mixed", "genre_id": 99, "description": "Documentari"},
    {"name": "Korean drama", "section_type": "genre", "media_type": "mixed", "genre_id": 18, "description": "K-Drama coreani", "origin_country": "KR"},
    {"name": "Reality", "section_type": "genre", "media_type": "mixed", "genre_id": 10764, "description": "Reality show"},
    {"name": "Soap", "section_type": "genre", "media_type": "mixed", "genre_id": 10766, "description": "Soap opera"},
]

@app.get("/api/admin/available-sections")
def get_available_sections(admin = Depends(get_current_admin)):
    """Get list of predefined sections that admin can add"""
    existing_names = set(s["name"] for s in sections.find({}, {"name": 1, "_id": 0}))
    available = [s for s in AVAILABLE_SECTIONS if s["name"] not in existing_names]
    return {"available": available, "all": AVAILABLE_SECTIONS}

@app.get("/api/public/available-sections")
def get_public_available_sections():
    """Predefined section templates (used by the homepage infinite feed)."""
    return {"sections": AVAILABLE_SECTIONS}

class AddPredefinedSection(BaseModel):
    name: str
    order: Optional[int] = None

@app.post("/api/admin/sections/add-predefined")
def add_predefined_section(data: AddPredefinedSection, admin = Depends(get_current_admin)):
    """Add a predefined section by name"""
    template = next((s for s in AVAILABLE_SECTIONS if s["name"] == data.name), None)
    if not template:
        raise HTTPException(status_code=400, detail=f"Section '{data.name}' not found in available sections")

    existing = sections.find_one({"name": data.name})
    if existing:
        raise HTTPException(status_code=400, detail=f"Section '{data.name}' already exists")

    max_order = sections.find_one({}, sort=[("order", -1)])
    next_order = (max_order.get("order", 0) + 1) if max_order else 0

    now = datetime.now(timezone.utc).isoformat()
    section = {
        "name": template["name"],
        "section_type": template["section_type"],
        "apiString": template["section_type"],
        "media_type": template["media_type"],
        "mediaType": template["media_type"],
        "genre_id": template.get("genre_id"),
        "origin_country": template.get("origin_country"),
        "visible": True,
        "active": True,
        "order": data.order if data.order is not None else next_order,
        "createdAt": now,
        "updatedAt": now,
    }
    sections.insert_one(section)
    section.pop("_id", None)
    section["id"] = template["name"]
    log_admin_action("ADD_PREDEFINED_SECTION", template["name"])
    return section

@app.get("/api/public/tmdb/genre/{genre_id}/{media_type}")
async def get_tmdb_by_genre(genre_id: int, media_type: str = "movie", page: int = 1, origin_country: Optional[str] = None):
    """Get content by genre from TMDB. media_type 'mixed' merges movies and TV shows in one row."""
    def base_params(gid):
        p = {"with_genres": gid, "page": page, "sort_by": "popularity.desc"}
        if origin_country:
            p["with_origin_country"] = origin_country
        return p

    if media_type == "mixed":
        movie_gid, tv_gid = genre_pair(genre_id)
        # Pool = most popular (3 pages) + most recent (1 page) for each side, then a daily-seeded shuffle:
        # every genre row shows a different, mixed selection that changes once a day.
        today_iso = datetime.now(timezone.utc).date().isoformat()

        def recent_params(gid, side):
            field = "primary_release_date" if side == "movie" else "first_air_date"
            return {**base_params(gid), "sort_by": f"{field}.desc", "vote_count.gte": 30, f"{field}.lte": today_iso}

        tasks = []
        if movie_gid:
            tasks += [("movie", fetch_tmdb_pages("/discover/movie", base_params(movie_gid), pages=3)), ("movie", fetch_tmdb_data("/discover/movie", recent_params(movie_gid, "movie")))]
        if tv_gid:
            tasks += [("tv", fetch_tmdb_pages("/discover/tv", base_params(tv_gid), pages=3)), ("tv", fetch_tmdb_data("/discover/tv", recent_params(tv_gid, "tv")))]
        results = await asyncio.gather(*(t[1] for t in tasks))
        sources = list(zip((t[0] for t in tasks), results))
    else:
        endpoint = "/discover/tv" if media_type == "tv" else "/discover/movie"
        sources = [(media_type, await fetch_tmdb_pages(endpoint, base_params(genre_id)))]

    items, seen = [], set()
    for mtype, data in sources:
        for item in (data or {}).get("results") or []:
            if is_anime_content(item) or (mtype, item.get("id")) in seen:
                continue
            seen.add((mtype, item.get("id")))
            items.append({
                "tmdbId": item.get("id"),
                "type": mtype,
                "title": item.get("title") or item.get("name"),
                "overview": item.get("overview"),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "release_date": item.get("release_date") or item.get("first_air_date"),
                "vote_average": item.get("vote_average", 0),
                "popularity": item.get("popularity", 0),
                "genre_ids": item.get("genre_ids", []),
            })
    if media_type == "mixed":
        items = await filter_available(items, limit=500)
        daily = random.Random(f"{datetime.now(timezone.utc).date()}-{genre_id}-{origin_country or ''}")
        daily.shuffle(items)
        items = items[:24]
    else:
        items = await filter_available(items)
    return {"items": await enrich_items(items), "total": len(items)}




# =====================
# USER ACCOUNT ENDPOINTS
# =====================

users.create_index("email", unique=True)

class UserRegister(BaseModel):
    email: str
    password: str
    name: str = ""

class UserLogin(BaseModel):
    email: str
    password: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    profileImage: Optional[str] = None

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify JWT token and return user"""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = users.find_one({"id": user_id}, {"_id": 0, "password": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if user.get("banned"):
            raise HTTPException(status_code=403, detail={"code": "banned", "message": "Account sospeso", "reason": user.get("ban_reason") or ""})
        changed_at = user.get("password_changed_at")
        if changed_at and payload.get("iat") and datetime.fromisoformat(changed_at).timestamp() > float(payload["iat"]) + 1:
            raise HTTPException(status_code=401, detail="Sessione scaduta, accedi di nuovo")
        users.update_one({"id": user_id}, {"$set": {"last_seen_at": datetime.now(timezone.utc).isoformat()}})
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def issue_user_token(user: dict) -> str:
    payload = {
        "user_id": user["id"],
        "email": user["email"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS * 7),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def public_user(user: dict) -> dict:
    return {
        "id": user["id"], "email": user["email"], "name": user.get("name"), "profileImage": user.get("profileImage"),
        "role": user.get("role", "user"), "must_reset_password": bool(user.get("must_reset_password")),
    }

@app.post("/api/auth/register")
def register_user(data: UserRegister):
    """Register new user"""
    import uuid
    
    existing = users.find_one({"email": data.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    if not re.match(r'^[\w\.-]+@[\w\.-]+\.\w+$', data.email):
        raise HTTPException(status_code=400, detail="Invalid email format")
    
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    
    now = datetime.now(timezone.utc).isoformat()
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt())
    
    user = {
        "id": str(uuid.uuid4()),
        "email": data.email.lower(),
        "password": hashed.decode(),
        "name": sanitize_string(data.name) or data.email.split("@")[0],
        "profileImage": None,
        "role": "user",
        "banned": False,
        "must_reset_password": False,
        "createdAt": now,
        "updatedAt": now
    }
    users.insert_one(user)
    return {"token": issue_user_token(user), "user": public_user(user)}

@app.post("/api/auth/login")
def login_user(data: UserLogin):
    """Login user"""
    user = users.find_one({"email": data.email.lower()})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not bcrypt.checkpw(data.password.encode(), user["password"].encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("banned"):
        raise HTTPException(status_code=403, detail={"code": "banned", "message": "Account sospeso", "reason": user.get("ban_reason") or ""})
    users.update_one({"id": user["id"]}, {"$set": {"last_login_at": datetime.now(timezone.utc).isoformat()}})
    return {"token": issue_user_token(user), "user": public_user(user)}

@app.get("/api/auth/me")
def get_user_profile(user = Depends(get_current_user)):
    """Get current user profile"""
    return user

@app.put("/api/auth/profile")
def update_user_profile(data: UserUpdate, user = Depends(get_current_user)):
    """Update user profile"""
    update_data = {"updatedAt": datetime.now(timezone.utc).isoformat()}
    
    if data.name is not None:
        update_data["name"] = sanitize_string(data.name)
    
    if data.email is not None:
        existing = users.find_one({"email": data.email.lower(), "id": {"$ne": user["id"]}})
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        if not re.match(r'^[\w\.-]+@[\w\.-]+\.\w+$', data.email):
            raise HTTPException(status_code=400, detail="Invalid email format")
        update_data["email"] = data.email.lower()
    
    if data.password is not None:
        if len(data.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt())
        update_data["password"] = hashed.decode()
        update_data["password_changed_at"] = datetime.now(timezone.utc).isoformat()
        update_data["must_reset_password"] = False
    
    if data.profileImage is not None:
        update_data["profileImage"] = data.profileImage
    
    users.update_one({"id": user["id"]}, {"$set": update_data})
    updated = users.find_one({"id": user["id"]}, {"_id": 0, "password": 0})
    if data.password is not None:
        updated["token"] = issue_user_token(updated)
    return updated

@app.get("/api/auth/history")
def get_user_history(user = Depends(get_current_user)):
    """Get user watch history"""
    history = list(user_lists.find({"user_id": user["id"]}, {"_id": 0}).sort("added_at", -1).limit(50))
    return {"items": history}


@app.delete("/api/auth/profile")
def delete_user_account(user = Depends(get_current_user)):
    """Delete user account and all associated data"""
    user_id = user["id"]
    users.delete_one({"id": user_id})
    user_lists.delete_many({"user_id": user_id})
    watch_progress.delete_many({"user_id": user_id})
    return {"status": "deleted"}

# =====================
# WATCH PROGRESS ENDPOINTS
# =====================

class WatchProgressUpdate(BaseModel):
    tmdb_id: int
    media_type: str  # "movie" or "tv"
    progress: float  # seconds watched
    duration: float  # total duration in seconds
    title: Optional[str] = None
    backdrop_path: Optional[str] = None
    poster_path: Optional[str] = None
    season: Optional[int] = None
    episode: Optional[int] = None

@app.post("/api/auth/watch-progress")
def save_watch_progress(data: WatchProgressUpdate, user = Depends(get_current_user)):
    """Save or update watch progress for a content item"""
    now = datetime.now(timezone.utc).isoformat()
    user_id = user["id"]

    # If progress >= 95% of duration, mark as completed and remove
    if data.duration > 0 and (data.progress / data.duration) >= 0.95:
        watch_progress.delete_one({"user_id": user_id, "tmdb_id": data.tmdb_id})
        return {"status": "completed", "message": "Content marked as completed and removed from continue watching"}

    # Only save if progress >= 10 seconds (avoid accidental saves)
    if data.progress < 10:
        return {"status": "skipped", "message": "Progress too short to save"}

    doc = {
        "user_id": user_id,
        "tmdb_id": data.tmdb_id,
        "media_type": data.media_type,
        "progress": data.progress,
        "duration": data.duration,
        "title": data.title or "",
        "backdrop_path": data.backdrop_path or "",
        "poster_path": data.poster_path or "",
        "updated_at": now,
    }
    if data.season is not None:
        doc["season"] = data.season
    if data.episode is not None:
        doc["episode"] = data.episode

    watch_progress.update_one(
        {"user_id": user_id, "tmdb_id": data.tmdb_id},
        {"$set": doc, "$setOnInsert": {"created_at": now}},
        upsert=True
    )
    return {"status": "saved", "progress": data.progress, "duration": data.duration}

@app.get("/api/auth/watch-progress")
def get_all_watch_progress(user = Depends(get_current_user)):
    """Get all watch progress items for the current user (continue watching list)"""
    items = list(
        watch_progress.find(
            {"user_id": user["id"]},
            {"_id": 0, "user_id": 0}
        ).sort("updated_at", DESCENDING).limit(20)
    )
    return {"items": items, "username": user.get("name", "Utente")}

@app.get("/api/auth/watch-progress/{tmdb_id}")
def get_watch_progress(tmdb_id: int, user = Depends(get_current_user)):
    """Get watch progress for a specific content"""
    item = watch_progress.find_one(
        {"user_id": user["id"], "tmdb_id": tmdb_id},
        {"_id": 0, "user_id": 0}
    )
    if not item:
        return {"progress": 0, "duration": 0}
    return item

@app.delete("/api/auth/watch-progress/{tmdb_id}")
def delete_watch_progress(tmdb_id: int, user = Depends(get_current_user)):
    """Remove a content from continue watching"""
    watch_progress.delete_one({"user_id": user["id"], "tmdb_id": tmdb_id})
    return {"status": "deleted"}

@app.get("/api/admin/stats")
def get_stats(admin = Depends(get_current_admin)):
    """Get dashboard statistics"""
    total = contents.count_documents({})
    movies = contents.count_documents({"type": "movie"})
    tv = contents.count_documents({"type": "tv"})
    visible = contents.count_documents({"available": True})
    hidden = contents.count_documents({"available": False})
    vixsrc_available = contents.count_documents({"vixsrc_available": True})
    total_seasons = tv_seasons.count_documents({})
    total_episodes = tv_episodes.count_documents({})
    
    last_added = contents.find_one({}, {"_id": 0}, sort=[("createdAt", -1)])
    hero = hero_settings.find_one({}, {"_id": 0})
    
    return {
        "total": total,
        "movies": movies,
        "tvShows": tv,
        "visible": visible,
        "hidden": hidden,
        "vixsrc_available": vixsrc_available,
        "totalSeasons": total_seasons,
        "totalEpisodes": total_episodes,
        "lastAdded": last_added,
        "currentHero": hero
    }

# =====================
# ADMIN LOGS ENDPOINTS
# =====================

@app.get("/api/admin/logs")
def get_admin_logs(
    action: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    admin = Depends(get_current_admin)
):
    """Get admin activity logs"""
    query = {}
    if action:
        query["action"] = action
    
    total = admin_logs.count_documents(query)
    skip = (page - 1) * limit
    
    items = list(admin_logs.find(query, {"_id": 0}).sort("timestamp", -1).skip(skip).limit(limit))
    
    return {
        "items": items,
        "total": total,
        "page": page,
        "totalPages": (total + limit - 1) // limit
    }

# =====================
# PUBLIC API ENDPOINTS (for frontend)
# =====================

# Cache for vixsrc availability checks (to avoid too many requests)
vixsrc_cache = db["vixsrc_cache"]
# Drop old index and create compound index for episodes
try:
    vixsrc_cache.drop_index("tmdbId_1")
except Exception:
    pass
vixsrc_cache.create_index([("tmdbId", 1), ("type", 1), ("season", 1), ("episode", 1)], unique=True)
vixsrc_cache.create_index("checked_at")

async def check_vixsrc_with_cache(tmdb_id: int, content_type: str, cache_hours: int = 24) -> bool:
    """Check vixsrc availability with caching"""
    # Check cache first
    cached = vixsrc_cache.find_one({"tmdbId": tmdb_id, "type": content_type})
    if cached:
        cache_time = datetime.fromisoformat(cached["checked_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - cache_time < timedelta(hours=cache_hours):
            return cached.get("available", False)
    
    # Check vixsrc
    result = await check_vixsrc_availability(tmdb_id, content_type)
    
    # Update cache
    vixsrc_cache.update_one(
        {"tmdbId": tmdb_id},
        {"$set": {
            "tmdbId": tmdb_id,
            "type": content_type,
            "available": result["available"],
            "checked_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    
    return result["available"]

@app.get("/api/public/tmdb/trending/{media_type}")
async def get_tmdb_trending(media_type: str = "all", page: int = 1, verify_vixsrc: bool = False):
    """Get trending content directly from TMDB, filtered by vixsrc availability and NO ANIME"""
    endpoint = f"/trending/{media_type}/week"
    data = await fetch_tmdb_pages(endpoint, {"page": page})
    
    if not data or "results" not in data:
        return {"items": [], "total": 0}
    
    items = []
    for item in data["results"]:
        # ❌ SKIP ANIME CONTENT
        if is_anime_content(item):
            continue
            
        tmdb_id = item.get("id")
        item_type = item.get("media_type", media_type if media_type != "all" else "movie")
        
        # Check vixsrc availability
        if verify_vixsrc:
            is_available = await check_vixsrc_with_cache(tmdb_id, item_type)
            if not is_available:
                continue
        
        items.append({
            "tmdbId": tmdb_id,
            "type": item_type,
            "title": item.get("title") or item.get("name"),
            "overview": item.get("overview"),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("release_date") or item.get("first_air_date"),
            "vote_average": item.get("vote_average", 0),
            "popularity": item.get("popularity", 0),
            "genre_ids": item.get("genre_ids", []),
            "vixsrc_available": True
        })
    
    # ✅ SORT BY TMDB ID for deterministic order
    items.sort(key=lambda x: x["tmdbId"])
    
    items = await filter_available(items)
    return {"items": await enrich_items(items), "total": len(items), "page": page}

@app.get("/api/public/tmdb/popular/{media_type}")
async def get_tmdb_popular(media_type: str = "movie", page: int = 1, verify_vixsrc: bool = False):
    """Get popular content directly from TMDB, filtered by vixsrc availability and NO ANIME"""
    endpoint = f"/{media_type}/popular"
    data = await fetch_tmdb_pages(endpoint, {"page": page})
    
    if not data or "results" not in data:
        return {"items": [], "total": 0}
    
    items = []
    for item in data["results"]:
        # ❌ SKIP ANIME CONTENT
        if is_anime_content(item):
            continue
            
        tmdb_id = item.get("id")
        
        if verify_vixsrc:
            is_available = await check_vixsrc_with_cache(tmdb_id, media_type)
            if not is_available:
                continue
        
        items.append({
            "tmdbId": tmdb_id,
            "type": media_type,
            "title": item.get("title") or item.get("name"),
            "overview": item.get("overview"),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("release_date") or item.get("first_air_date"),
            "vote_average": item.get("vote_average", 0),
            "popularity": item.get("popularity", 0),
            "genre_ids": item.get("genre_ids", []),
            "vixsrc_available": True
        })
    
    # ✅ SORT BY TMDB ID for deterministic order
    items.sort(key=lambda x: x["tmdbId"])
    
    items = await filter_available(items)
    return {"items": await enrich_items(items), "total": len(items), "page": page}

@app.get("/api/public/tmdb/top_rated/{media_type}")
async def get_tmdb_top_rated(media_type: str = "movie", page: int = 1, verify_vixsrc: bool = False):
    """Get top rated content directly from TMDB, filtered by vixsrc availability and NO ANIME"""
    endpoint = f"/{media_type}/top_rated"
    data = await fetch_tmdb_pages(endpoint, {"page": page})
    
    if not data or "results" not in data:
        return {"items": [], "total": 0}
    
    items = []
    for item in data["results"]:
        # ❌ SKIP ANIME CONTENT
        if is_anime_content(item):
            continue
            
        tmdb_id = item.get("id")
        
        if verify_vixsrc:
            is_available = await check_vixsrc_with_cache(tmdb_id, media_type)
            if not is_available:
                continue
        
        items.append({
            "tmdbId": tmdb_id,
            "type": media_type,
            "title": item.get("title") or item.get("name"),
            "overview": item.get("overview"),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("release_date") or item.get("first_air_date"),
            "vote_average": item.get("vote_average", 0),
            "popularity": item.get("popularity", 0),
            "genre_ids": item.get("genre_ids", []),
            "vixsrc_available": True
        })
    
    # ✅ SORT BY TMDB ID for deterministic order
    items.sort(key=lambda x: x["tmdbId"])
    
    items = await filter_available(items)
    return {"items": await enrich_items(items), "total": len(items), "page": page}

@app.get("/api/public/tmdb/now_playing")
async def get_tmdb_now_playing(page: int = 1, verify_vixsrc: bool = False):
    """Get now playing movies from TMDB, filtered by vixsrc availability and NO ANIME"""
    data = await fetch_tmdb_pages("/movie/now_playing", {"page": page})
    
    if not data or "results" not in data:
        return {"items": [], "total": 0}
    
    items = []
    for item in data["results"]:
        # ❌ SKIP ANIME CONTENT
        if is_anime_content(item):
            continue
            
        tmdb_id = item.get("id")
        
        if verify_vixsrc:
            is_available = await check_vixsrc_with_cache(tmdb_id, "movie")
            if not is_available:
                continue
        
        items.append({
            "tmdbId": tmdb_id,
            "type": "movie",
            "title": item.get("title"),
            "overview": item.get("overview"),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("release_date"),
            "vote_average": item.get("vote_average", 0),
            "popularity": item.get("popularity", 0),
            "genre_ids": item.get("genre_ids", []),
            "vixsrc_available": True
        })
    
    # ✅ SORT BY TMDB ID for deterministic order
    items.sort(key=lambda x: x["tmdbId"])
    
    items = await filter_available(items)
    return {"items": await enrich_items(items), "total": len(items), "page": page}


@app.get("/api/public/tmdb/upcoming")
async def get_tmdb_upcoming(page: int = 1):
    """Upcoming movies: only titles with a FUTURE release date (Italian region), soonest first."""
    today = datetime.now(timezone.utc).date()
    tomorrow = (today + timedelta(days=1)).isoformat()
    horizon = (today + timedelta(days=180)).isoformat()
    params = {"page": page, "region": "IT", "sort_by": "popularity.desc", "with_release_type": "2|3",
              "primary_release_date.gte": tomorrow, "primary_release_date.lte": horizon, "vote_count.gte": 0}
    data = await fetch_tmdb_pages("/discover/movie", params, pages=2)
    if not data or "results" not in data:
        return {"items": [], "total": 0}
    items = []
    for item in data["results"]:
        if is_anime_content(item) or not (item.get("release_date") or "") > today.isoformat():
            continue
        items.append({
            "tmdbId": item.get("id"),
            "type": "movie",
            "title": item.get("title"),
            "overview": item.get("overview"),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("release_date"),
            "vote_average": item.get("vote_average", 0),
            "popularity": item.get("popularity", 0),
            "genre_ids": item.get("genre_ids", []),
            "upcoming": True,
        })
    items = sorted((i for i in items if i.get("backdrop_path") or i.get("poster_path")), key=lambda i: i.get("release_date") or "")[:24]
    return {"items": await enrich_items(items), "total": len(items), "page": page}

@app.get("/api/public/tmdb/airing_today")
async def get_tmdb_airing_today(page: int = 1):
    """Get TV airing today from TMDB"""
    data = await fetch_tmdb_pages("/tv/airing_today", {"page": page})
    if not data or "results" not in data:
        return {"items": [], "total": 0}
    items = []
    for item in data["results"]:
        if is_anime_content(item):
            continue
        items.append({
            "tmdbId": item.get("id"),
            "type": "tv",
            "title": item.get("name"),
            "overview": item.get("overview"),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("first_air_date"),
            "vote_average": item.get("vote_average", 0),
            "popularity": item.get("popularity", 0),
            "genre_ids": item.get("genre_ids", []),
        })
    items = await filter_available(items)
    return {"items": await enrich_items(items), "total": len(items), "page": page}


@app.get("/api/public/tmdb/on_the_air")
async def get_tmdb_on_the_air(page: int = 1, verify_vixsrc: bool = False):
    """Get TV shows on the air from TMDB, filtered by vixsrc availability and NO ANIME"""
    data = await fetch_tmdb_pages("/tv/on_the_air", {"page": page})
    
    if not data or "results" not in data:
        return {"items": [], "total": 0}
    
    items = []
    for item in data["results"]:
        # ❌ SKIP ANIME CONTENT
        if is_anime_content(item):
            continue
            
        tmdb_id = item.get("id")
        
        if verify_vixsrc:
            is_available = await check_vixsrc_with_cache(tmdb_id, "tv")
            if not is_available:
                continue
        
        items.append({
            "tmdbId": tmdb_id,
            "type": "tv",
            "title": item.get("name"),
            "overview": item.get("overview"),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("first_air_date"),
            "vote_average": item.get("vote_average", 0),
            "popularity": item.get("popularity", 0),
            "genre_ids": item.get("genre_ids", []),
            "vixsrc_available": True
        })
    
    # ✅ SORT BY TMDB ID for deterministic order
    items.sort(key=lambda x: x["tmdbId"])
    
    items = await filter_available(items)
    return {"items": await enrich_items(items), "total": len(items), "page": page}

@app.get("/api/public/contents/home")
async def get_home_contents(limit: int = 50, verify_vixsrc: bool = False):
    """Get contents for home page directly from TMDB, filtered by vixsrc availability and NO ANIME"""
    all_items = []
    
    # Fetch trending
    trending_data = await fetch_tmdb_data("/trending/all/week", {"page": 1})
    if trending_data and "results" in trending_data:
        for item in trending_data["results"][:20]:
            # ❌ SKIP ANIME CONTENT
            if is_anime_content(item):
                continue
                
            tmdb_id = item.get("id")
            item_type = item.get("media_type", "movie")
            
            if verify_vixsrc:
                is_available = await check_vixsrc_with_cache(tmdb_id, item_type)
                if not is_available:
                    continue
            
            all_items.append({
                "tmdbId": tmdb_id,
                "type": item_type,
                "title": item.get("title") or item.get("name"),
                "overview": item.get("overview"),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "release_date": item.get("release_date") or item.get("first_air_date"),
                "vote_average": item.get("vote_average", 0),
                "popularity": item.get("popularity", 0),
                "genre_ids": item.get("genre_ids", []),
                "_section": "trending",
                "vixsrc_available": True
            })
    
    # Fetch popular movies
    popular_movies = await fetch_tmdb_data("/movie/popular", {"page": 1})
    if popular_movies and "results" in popular_movies:
        for item in popular_movies["results"][:15]:
            # ❌ SKIP ANIME CONTENT
            if is_anime_content(item):
                continue
                
            tmdb_id = item.get("id")
            
            if verify_vixsrc:
                is_available = await check_vixsrc_with_cache(tmdb_id, "movie")
                if not is_available:
                    continue
            
            all_items.append({
                "tmdbId": tmdb_id,
                "type": "movie",
                "title": item.get("title"),
                "overview": item.get("overview"),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "release_date": item.get("release_date"),
                "vote_average": item.get("vote_average", 0),
                "popularity": item.get("popularity", 0),
                "genre_ids": item.get("genre_ids", []),
                "_section": "popular_movies",
                "vixsrc_available": True
            })
    
    # Fetch popular TV
    popular_tv = await fetch_tmdb_data("/tv/popular", {"page": 1})
    if popular_tv and "results" in popular_tv:
        for item in popular_tv["results"][:15]:
            # ❌ SKIP ANIME CONTENT
            if is_anime_content(item):
                continue
                
            tmdb_id = item.get("id")
            
            if verify_vixsrc:
                is_available = await check_vixsrc_with_cache(tmdb_id, "tv")
                if not is_available:
                    continue
            
            all_items.append({
                "tmdbId": tmdb_id,
                "type": "tv",
                "title": item.get("name"),
                "overview": item.get("overview"),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "release_date": item.get("first_air_date"),
                "vote_average": item.get("vote_average", 0),
                "popularity": item.get("popularity", 0),
                "genre_ids": item.get("genre_ids", []),
                "_section": "popular_tv",
                "vixsrc_available": True
            })
    
    # Fetch top rated
    top_rated = await fetch_tmdb_data("/movie/top_rated", {"page": 1})
    if top_rated and "results" in top_rated:
        for item in top_rated["results"][:10]:
            # ❌ SKIP ANIME CONTENT
            if is_anime_content(item):
                continue
                
            tmdb_id = item.get("id")
            
            if verify_vixsrc:
                is_available = await check_vixsrc_with_cache(tmdb_id, "movie")
                if not is_available:
                    continue
            
            all_items.append({
                "tmdbId": tmdb_id,
                "type": "movie",
                "title": item.get("title"),
                "overview": item.get("overview"),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "release_date": item.get("release_date"),
                "vote_average": item.get("vote_average", 0),
                "popularity": item.get("popularity", 0),
                "genre_ids": item.get("genre_ids", []),
                "_section": "top_rated",
                "vixsrc_available": True
            })
    
    # Remove duplicates and sort deterministically
    seen = set()
    unique_items = []
    for item in all_items:
        if item["tmdbId"] not in seen:
            seen.add(item["tmdbId"])
            item["release_date_it"] = format_italian_date(item.get("release_date"))
            unique_items.append(item)
    
    # ✅ SORT EACH SECTION BY TMDB ID for deterministic order
    # Group by section first
    sections = {
        "trending": sorted([c for c in unique_items if c.get("_section") == "trending"], key=lambda x: x["tmdbId"])[:12],
        "popular_movies": sorted([c for c in unique_items if c.get("_section") == "popular_movies"], key=lambda x: x["tmdbId"])[:12],
        "popular_tv": sorted([c for c in unique_items if c.get("_section") == "popular_tv"], key=lambda x: x["tmdbId"])[:12],
        "top_rated": sorted([c for c in unique_items if c.get("_section") == "top_rated"], key=lambda x: x["tmdbId"])[:12],
    }
    
    return {
        "items": unique_items[:limit],
        "total": len(unique_items),
        "sections": sections
    }

@app.get("/api/public/contents/all")
async def get_all_contents(
    media_type: str = None,
    limit: int = 100,
    sort_by: str = "popularity",
    verify_vixsrc: bool = False
):
    """Get all contents from TMDB, filtered by vixsrc availability"""
    items = []
    
    # Determine which endpoint to use
    if media_type == "tv":
        endpoints = ["/tv/popular", "/tv/top_rated", "/tv/on_the_air"]
    elif media_type == "movie":
        endpoints = ["/movie/popular", "/movie/top_rated", "/movie/now_playing"]
    else:
        endpoints = ["/trending/all/week", "/movie/popular", "/tv/popular"]
    
    for endpoint in endpoints:
        data = await fetch_tmdb_data(endpoint, {"page": 1})
        if not data or "results" not in data:
            continue
        
        for item in data["results"]:
            tmdb_id = item.get("id")
            item_type = item.get("media_type") or ("tv" if "/tv/" in endpoint else "movie")
            
            if media_type and media_type != "mixed" and item_type != media_type:
                continue
            
            if verify_vixsrc:
                is_available = await check_vixsrc_with_cache(tmdb_id, item_type)
                if not is_available:
                    continue
            
            items.append({
                "tmdbId": tmdb_id,
                "type": item_type,
                "title": item.get("title") or item.get("name"),
                "overview": item.get("overview"),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "release_date": item.get("release_date") or item.get("first_air_date"),
                "vote_average": item.get("vote_average", 0),
                "popularity": item.get("popularity", 0),
                "genre_ids": item.get("genre_ids", []),
                "vixsrc_available": True
            })
    
    # Remove duplicates
    seen = set()
    unique_items = []
    for item in items:
        if item["tmdbId"] not in seen:
            seen.add(item["tmdbId"])
            item["release_date_it"] = format_italian_date(item.get("release_date"))
            unique_items.append(item)
    
    # Sort
    if sort_by == "vote_average":
        unique_items.sort(key=lambda x: x.get("vote_average", 0), reverse=True)
    elif sort_by == "release_date":
        unique_items.sort(key=lambda x: x.get("release_date", ""), reverse=True)
    else:
        unique_items.sort(key=lambda x: x.get("popularity", 0), reverse=True)
    
    return {"items": unique_items[:limit], "total": len(unique_items)}

@app.get("/api/public/contents/available")
async def get_available_contents():
    """Get available content IDs from TMDB trending, verified on vixsrc"""
    data = await fetch_tmdb_data("/trending/all/week", {"page": 1})
    
    if not data or "results" not in data:
        return {"items": []}
    
    items = []
    for item in data["results"]:
        tmdb_id = item.get("id")
        item_type = item.get("media_type", "movie")
        
        is_available = await check_vixsrc_with_cache(tmdb_id, item_type)
        if is_available:
            items.append({
                "tmdbId": tmdb_id,
                "type": item_type,
                "vixsrc_available": True
            })
    
    return {"items": items}

@app.get("/api/public/hero")
async def get_public_hero():
    """Get hero settings - fetch content details from TMDB"""
    from fastapi.responses import JSONResponse
    
    hero = hero_settings.find_one({}, {"_id": 0})
    await refresh_vixsrc_catalog()

    async def trending_fallback():
        trending = await fetch_tmdb_data("/trending/all/day")
        for it in (trending or {}).get("results") or []:
            mt = it.get("media_type")
            if mt in ("movie", "tv") and is_on_vixsrc(mt, it.get("id")) and not is_anime_content(it):
                return it["id"], mt
        return None

    if not hero or not hero.get("contentId"):
        fb = await trending_fallback()
        hero = {"contentId": str(fb[0]), "mediaType": fb[1], "fallback": True} if fb else None

    if hero and hero.get("contentId"):
        # Fetch content details from TMDB
        tmdb_id = int(hero["contentId"])
        media_type = hero.get("mediaType", "tv")

        # Strict Italian-audio filter also applies to the hero: fall back to the first trending title available
        if not is_on_vixsrc(media_type, tmdb_id):
            fb = await trending_fallback()
            if fb:
                tmdb_id, media_type = fb
                hero = {k: v for k, v in hero.items() if k not in ("customTitle", "customDescription", "customBackdrop", "seasonLabel")}
                hero["contentId"] = str(tmdb_id)
                hero["fallback"] = True
        
        tmdb_data = await fetch_tmdb_data(f"/{media_type}/{tmdb_id}")
        
        hero_response = dict(hero)
        if tmdb_data:
            hero_response["mediaType"] = media_type
            hero_response["release_date_it"] = format_italian_date(
                tmdb_data.get("release_date") or tmdb_data.get("first_air_date")
            )
        else:
            hero_response["mediaType"] = media_type
        
        return JSONResponse(
            content=hero_response,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    return JSONResponse(
        content={},
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.get("/api/public/check-availability/{media_type}/{tmdb_id}")
async def check_content_availability(media_type: str, tmdb_id: int):
    """
    Check if a specific content is available on vixsrc.to
    Now returns availability status but doesn't block content display
    """
    # First verify it exists on TMDB
    tmdb_data = await fetch_tmdb_data(f"/{media_type}/{tmdb_id}")
    if not tmdb_data:
        return {
            "tmdb_exists": False,
            "vixsrc_available": False,
            "available": True,  # Still allow to show details
            "show_warning": True,
            "reason": "Content not found on TMDB"
        }
    
    # Check vixsrc availability
    vixsrc_result = await check_vixsrc_with_cache(tmdb_id, media_type)
    
    return {
        "tmdb_exists": True,
        "vixsrc_available": vixsrc_result,
        "available": True,  # Always allow content to be shown
        "show_warning": not vixsrc_result,  # Show warning if not on vixsrc
        "tmdb_id": tmdb_id,
        "media_type": media_type,
        "title": tmdb_data.get("title") or tmdb_data.get("name"),
        "warning_message": "Questo contenuto potrebbe non essere disponibile per la visione" if not vixsrc_result else None
    }

@app.get("/api/public/sections/data")
async def get_sections_with_content():
    """
    Get all active sections with their content filtered by vixsrc availability.
    This is the main endpoint for the home page.
    """
    # Get active sections from database ordered by order field
    active_sections = list(sections.find({"active": True}, {"_id": 0}).sort("order", 1))
    
    if not active_sections:
        return {"sections": [], "message": "No sections configured. Admin must create sections."}
    
    result_sections = []
    
    for section in active_sections:
        section_type = section.get("apiString") or section.get("section_type", "popular")
        media_type = section.get("mediaType") or section.get("media_type", "movie")
        section_name = section.get("name", "Contenuti")
        
        # Determine the TMDB endpoint based on section type
        if section_type == "trending":
            if media_type == "mixed" or media_type == "all":
                endpoint = "/trending/all/week"
            else:
                endpoint = f"/trending/{media_type}/week"
        elif section_type == "popular":
            endpoint = f"/{media_type}/popular"
        elif section_type == "top_rated":
            endpoint = f"/{media_type}/top_rated"
        elif section_type == "now_playing":
            endpoint = "/movie/now_playing"
        elif section_type == "upcoming":
            endpoint = "/movie/upcoming"
        elif section_type == "airing_today":
            endpoint = "/tv/airing_today"
        elif section_type == "on_the_air":
            endpoint = "/tv/on_the_air"
        else:
            endpoint = f"/{media_type}/popular"
        
        # Fetch from TMDB
        tmdb_data = await fetch_tmdb_data(endpoint, {"page": 1})
        
        if not tmdb_data or "results" not in tmdb_data:
            continue
        
        # Filter by vixsrc availability
        items = []
        for item in tmdb_data["results"][:20]:
            item_id = item.get("id")
            item_type = item.get("media_type", media_type if media_type not in ["mixed", "all"] else "movie")
            
            # Check vixsrc availability
            is_available = await check_vixsrc_with_cache(item_id, item_type)
            if not is_available:
                continue
            
            items.append({
                "tmdbId": item_id,
                "id": item_id,
                "type": item_type,
                "media_type": item_type,
                "title": item.get("title") or item.get("name"),
                "name": item.get("name") or item.get("title"),
                "overview": item.get("overview"),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "release_date": item.get("release_date") or item.get("first_air_date"),
                "vote_average": item.get("vote_average", 0),
                "popularity": item.get("popularity", 0),
                "genre_ids": item.get("genre_ids", []),
                "vixsrc_available": True
            })
            
            # Limit to 12 items per section
            if len(items) >= 12:
                break
        
        if items:
            result_sections.append({
                "name": section_name,
                "section_type": section_type,
                "media_type": media_type,
                "order": section.get("order", 0),
                "items": items
            })
    
    return {"sections": result_sections}

# =====================
# VIEW TRACKING & TOP 10 ENDPOINTS
# =====================

class ViewRecord(BaseModel):
    tmdb_id: int
    media_type: str  # "movie" or "tv"

@app.post("/api/public/record-view")
async def record_view(data: ViewRecord):
    """
    Record a view for a piece of content.
    Upserts the view count in the content_views collection.
    """
    if data.media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type must be 'movie' or 'tv'")

    now = datetime.now(timezone.utc).isoformat()
    content_views.update_one(
        {"tmdbId": data.tmdb_id, "type": data.media_type},
        {
            "$inc": {"views": 1},
            "$setOnInsert": {"tmdbId": data.tmdb_id, "type": data.media_type, "createdAt": now},
            "$set": {"updatedAt": now}
        },
        upsert=True
    )
    return {"success": True}


@app.get("/api/public/top10")
async def get_top10():
    """
    Return the top 10 most-viewed contents from the content_views collection.
    Each item is enriched with TMDB metadata.
    Falls back to TMDB popularity when no views are recorded yet.
    """
    # Fetch top 10 by views from DB
    top_views = list(
        content_views.find({}, {"_id": 0})
        .sort("views", DESCENDING)
        .limit(20)  # fetch extra to account for TMDB fetch failures
    )

    await refresh_vixsrc_catalog()
    items = []
    if top_views:
        for i, record in enumerate(top_views):
            tmdb_id = record["tmdbId"]
            media_type = record["type"]
            if not is_on_vixsrc(media_type, tmdb_id):
                continue
            tmdb_data = await fetch_tmdb_data(f"/{media_type}/{tmdb_id}")
            if not tmdb_data:
                continue
            items.append({
                "tmdbId": tmdb_id,
                "type": media_type,
                "title": tmdb_data.get("title") or tmdb_data.get("name"),
                "overview": tmdb_data.get("overview", ""),
                "poster_path": tmdb_data.get("poster_path"),
                "backdrop_path": tmdb_data.get("backdrop_path"),
                "release_date": tmdb_data.get("release_date") or tmdb_data.get("first_air_date"),
                "vote_average": tmdb_data.get("vote_average", 0),
                "genre_ids": [g["id"] for g in tmdb_data.get("genres", [])],
                "views": record.get("views", 0),
                "position": len(items) + 1,
            })
            if len(items) >= 10:
                break

    # Fallback: use TMDB trending when no views recorded yet
    if len(items) < 10:
        trending_data = await fetch_tmdb_pages("/trending/all/week", {"page": 1}, pages=2)
        existing_ids = {it["tmdbId"] for it in items}
        if trending_data and "results" in trending_data:
            for item in trending_data["results"]:
                tmdb_id = item.get("id")
                if tmdb_id in existing_ids:
                    continue
                if is_anime_content(item):
                    continue
                media_type = item.get("media_type", "movie")
                if not is_on_vixsrc(media_type, tmdb_id):
                    continue
                items.append({
                    "tmdbId": tmdb_id,
                    "type": media_type,
                    "title": item.get("title") or item.get("name"),
                    "overview": item.get("overview", ""),
                    "poster_path": item.get("poster_path"),
                    "backdrop_path": item.get("backdrop_path"),
                    "release_date": item.get("release_date") or item.get("first_air_date"),
                    "vote_average": item.get("vote_average", 0),
                    "genre_ids": item.get("genre_ids", []),
                    "views": 0,
                    "position": len(items) + 1,
                })
                existing_ids.add(tmdb_id)
                if len(items) >= 10:
                    break

    # Re-assign positions
    for i, item in enumerate(items):
        item["position"] = i + 1

    return {"enabled": True, "items": await enrich_items(items[:10])}


@app.get("/api/public/homepage/trending")
async def get_homepage_trending():
    """Get trending content for the homepage 'I titoli del momento' row."""
    data = await fetch_tmdb_pages("/trending/all/week", {"page": 1}, pages=3)
    if not data or "results" not in data:
        return {"items": []}

    items = []
    for item in data["results"]:
        if is_anime_content(item):
            continue
        tmdb_id = item.get("id")
        media_type = item.get("media_type", "movie")
        items.append({
            "tmdbId": tmdb_id,
            "type": media_type,
            "title": item.get("title") or item.get("name"),
            "overview": item.get("overview", ""),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("release_date") or item.get("first_air_date"),
            "vote_average": item.get("vote_average", 0),
            "genre_ids": item.get("genre_ids", []),
            "popularity": item.get("popularity", 0),
        })

    items = await filter_available(items)
    return {"items": await enrich_items(items)}


@app.get("/api/public/homepage/latest")
async def get_homepage_latest():
    """Get recently added / now playing content for the homepage 'Aggiunti di recente' row."""
    movies_data = await fetch_tmdb_pages("/movie/now_playing", {"page": 1})
    tv_data = await fetch_tmdb_pages("/tv/on_the_air", {"page": 1})

    items = []
    seen = set()

    for data, media_type in [(movies_data, "movie"), (tv_data, "tv")]:
        if not data or "results" not in data:
            continue
        for item in data["results"]:
            if is_anime_content(item):
                continue
            tmdb_id = item.get("id")
            if tmdb_id in seen:
                continue
            seen.add(tmdb_id)
            items.append({
                "tmdbId": tmdb_id,
                "type": media_type,
                "title": item.get("title") or item.get("name"),
                "overview": item.get("overview", ""),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "release_date": item.get("release_date") or item.get("first_air_date"),
                "vote_average": item.get("vote_average", 0),
                "genre_ids": item.get("genre_ids", []),
                "popularity": item.get("popularity", 0),
            })

    # Sort by release date descending
    items.sort(key=lambda x: x.get("release_date") or "", reverse=True)
    items = await filter_available(items)
    return {"items": await enrich_items(items[:20])}


# =====================
# TV SERIES ENDPOINTS - FROM TMDB
# =====================

@app.get("/api/public/tv/{tmdb_id}/seasons")
async def get_tv_seasons(tmdb_id: int):
    """Get all seasons for a TV show - OTTIMIZZATO per velocità"""
    # Fetch TV show details from TMDB
    tv_data = await fetch_tmdb_data(f"/tv/{tmdb_id}")
    if not tv_data:
        raise HTTPException(status_code=404, detail="TV show not found on TMDB")
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # Get seasons from TMDB data
    seasons_list = tv_data.get("seasons", [])
    
    # Return ALL seasons (except specials), SENZA check vixsrc per velocità
    all_seasons = []
    for season in seasons_list:
        season_number = season.get("season_number", 0)
        if season_number == 0:  # Skip specials
            continue
        
        season_air_date = season.get("air_date")
        
        # Check if season has aired
        is_aired = season_air_date and season_air_date <= today
        
        all_seasons.append({
            "season_number": season_number,
            "name": season.get("name"),
            "overview": season.get("overview"),
            "poster_path": season.get("poster_path"),
            "air_date": season_air_date,
            "air_date_it": format_italian_date(season_air_date),
            "episode_count": season.get("episode_count", 0),
            "vote_average": season.get("vote_average", 0),
            "is_aired": is_aired,
            "vixsrc_available": is_aired  # Se aired, consideriamo disponibile
        })
    
    return {
        "tmdbId": tmdb_id,
        "title": tv_data.get("name"),
        "status": tv_data.get("status"),
        "in_production": tv_data.get("in_production", False),
        "total_seasons": len(all_seasons),
        "seasons": all_seasons
    }

@app.get("/api/public/tv/{tmdb_id}/season/{season_number}")
async def get_tv_season_episodes(tmdb_id: int, season_number: int):
    """Get episodes for a specific season - OTTIMIZZATO per velocità"""
    # Fetch season details from TMDB
    season_data = await fetch_tmdb_data(f"/tv/{tmdb_id}/season/{season_number}")
    if not season_data:
        raise HTTPException(status_code=404, detail="Season not found on TMDB")
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    season_air_date = season_data.get("air_date")
    
    # Check if season has aired at all
    season_is_aired = season_air_date and season_air_date <= today
    
    if not season_is_aired:
        # Season not yet aired - return info with release date
        return {
            "tmdbId": tmdb_id,
            "season": {
                "season_number": season_number,
                "name": season_data.get("name"),
                "overview": season_data.get("overview"),
                "poster_path": season_data.get("poster_path"),
                "air_date": season_air_date,
                "air_date_it": format_italian_date(season_air_date),
            },
            "total_episodes": 0,
            "episodes": [],
            "is_aired": False,
            "release_date": season_air_date,
            "release_date_it": format_italian_date(season_air_date),
            "message": f"Questa stagione sarà disponibile dal {format_italian_date(season_air_date)}" if season_air_date else "Data di uscita non ancora annunciata"
        }
    
    # OTTIMIZZAZIONE: Mostra tutti gli episodi aired senza controllare vixsrc singolarmente
    # Questo rende il cambio stagione IMMEDIATO
    episodes_list = []
    for ep in season_data.get("episodes", []):
        air_date = ep.get("air_date")
        ep_number = ep.get("episode_number")
        
        # Skip episodes not yet aired
        if not air_date or air_date > today:
            continue
        
        # Include episode (vixsrc check rimosso per velocità)
        episodes_list.append({
            "episode_number": ep_number,
            "name": ep.get("name"),
            "overview": ep.get("overview"),
            "still_path": ep.get("still_path"),
            "air_date": air_date,
            "air_date_it": format_italian_date(air_date),
            "runtime": ep.get("runtime"),
            "vote_average": ep.get("vote_average", 0),
            "vote_count": ep.get("vote_count", 0),
            "vixsrc_available": True  # Assunto disponibile
        })
    
    season_info = {
        "season_number": season_number,
        "name": season_data.get("name"),
        "overview": season_data.get("overview"),
        "poster_path": season_data.get("poster_path"),
        "air_date": season_data.get("air_date"),
        "air_date_it": format_italian_date(season_data.get("air_date"))
    }
    
    return {
        "tmdbId": tmdb_id,
        "season": season_info,
        "total_episodes": len(episodes_list),
        "episodes": episodes_list
    }

@app.get("/api/public/content/{tmdb_id}")
async def get_content_by_tmdb_id(tmdb_id: int, media_type: str = "movie"):
    """Get single content by TMDB ID directly from TMDB, verify vixsrc availability"""
    # Try movie first, then TV
    content = await fetch_tmdb_data(f"/{media_type}/{tmdb_id}")
    if not content:
        # Try the other type
        other_type = "tv" if media_type == "movie" else "movie"
        content = await fetch_tmdb_data(f"/{other_type}/{tmdb_id}")
        if content:
            media_type = other_type
    
    if not content:
        raise HTTPException(status_code=404, detail="Content not found on TMDB")
    
    # Check vixsrc availability
    is_available = await check_vixsrc_with_cache(tmdb_id, media_type)
    
    result = {
        "tmdbId": tmdb_id,
        "type": media_type,
        "title": content.get("title") or content.get("name"),
        "original_title": content.get("original_title") or content.get("original_name"),
        "overview": content.get("overview"),
        "poster_path": content.get("poster_path"),
        "backdrop_path": content.get("backdrop_path"),
        "release_date": content.get("release_date") or content.get("first_air_date"),
        "release_date_it": format_italian_date(content.get("release_date") or content.get("first_air_date")),
        "vote_average": content.get("vote_average", 0),
        "vote_count": content.get("vote_count", 0),
        "popularity": content.get("popularity", 0),
        "genres": content.get("genres", []),
        "runtime": content.get("runtime"),
        "status": content.get("status"),
        "tagline": content.get("tagline"),
        "vixsrc_available": is_available
    }
    
    # Add TV-specific fields
    if media_type == "tv":
        result["number_of_seasons"] = content.get("number_of_seasons", 0)
        result["number_of_episodes"] = content.get("number_of_episodes", 0)
        result["networks"] = content.get("networks", [])
        result["created_by"] = content.get("created_by", [])
    
    return result

@app.get("/api/public/contents/by-section/{section_type}/{media_type}")
async def get_contents_by_section(
    section_type: str,
    media_type: str,
    page: int = 1,
    limit: int = 20,
    verify_vixsrc: bool = False
):
    """Get contents by section directly from TMDB, filtered by vixsrc availability"""
    # Map section type to TMDB endpoint
    endpoint_map = {
        "popular": f"/{media_type}/popular",
        "trending": f"/trending/{media_type}/week",
        "top_rated": f"/{media_type}/top_rated",
        "now_playing": "/movie/now_playing",
        "upcoming": "/movie/upcoming",
        "airing_today": "/tv/airing_today",
        "on_the_air": "/tv/on_the_air",
    }
    
    endpoint = endpoint_map.get(section_type, f"/{media_type}/popular")
    data = await fetch_tmdb_pages(endpoint, {"page": page})
    
    if not data or "results" not in data:
        return {"items": [], "total": 0, "page": page, "totalPages": 0}
    
    items = []
    for item in data["results"][:limit]:
        tmdb_id = item.get("id")
        item_type = item.get("media_type", media_type)
        
        if verify_vixsrc:
            is_available = await check_vixsrc_with_cache(tmdb_id, item_type)
            if not is_available:
                continue
        
        items.append({
            "tmdbId": tmdb_id,
            "type": item_type,
            "title": item.get("title") or item.get("name"),
            "overview": item.get("overview"),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("release_date") or item.get("first_air_date"),
            "release_date_it": format_italian_date(item.get("release_date") or item.get("first_air_date")),
            "vote_average": item.get("vote_average", 0),
            "popularity": item.get("popularity", 0),
            "vixsrc_available": True
        })
    
    return {
        "items": items,
        "total": len(items),
        "page": page,
        "totalPages": 1
    }

@app.get("/api/public/search")
async def search_contents(q: str, page: int = 1, limit: int = 20, verify_vixsrc: bool = False):
    """Search contents on TMDB, filtered by vixsrc availability"""
    if not q or len(q) < 2:
        return {"items": [], "total": 0}
    
    # Search on TMDB
    data = await fetch_tmdb_data("/search/multi", {"query": q, "page": page})
    
    if not data or "results" not in data:
        return {"items": [], "total": 0}
    
    items = []
    for item in data["results"]:
        media_type = item.get("media_type")
        if media_type not in ["movie", "tv"]:
            continue
        
        tmdb_id = item.get("id")
        
        if verify_vixsrc:
            is_available = await check_vixsrc_with_cache(tmdb_id, media_type)
            if not is_available:
                continue
        
        items.append({
            "tmdbId": tmdb_id,
            "type": media_type,
            "title": item.get("title") or item.get("name"),
            "overview": item.get("overview"),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("release_date") or item.get("first_air_date"),
            "release_date_it": format_italian_date(item.get("release_date") or item.get("first_air_date")),
            "vote_average": item.get("vote_average", 0),
            "popularity": item.get("popularity", 0),
            "vixsrc_available": True
        })
    
    items = await filter_available(items, limit=limit)
    return {
        "items": items,
        "total": len(items),
        "page": page,
        "totalPages": data.get("total_pages", 1)
    }

# =====================
# USER LIST ENDPOINTS
# =====================

@app.post("/api/user/list/add")
def add_to_list(item: ListItem):
    """Add item to user's list"""
    existing = user_lists.find_one({
        "user_id": item.user_id,
        "media_id": item.media_id,
        "media_type": item.media_type
    }, {"_id": 0})
    
    if existing:
        return {"success": True, "in_list": True, "message": "Already in list"}
    
    user_lists.insert_one({
        "user_id": item.user_id,
        "media_id": item.media_id,
        "media_type": item.media_type,
        "title": item.title,
        "poster_path": item.poster_path,
        "backdrop_path": item.backdrop_path,
        "added_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"success": True, "in_list": True, "message": "Added to list"}

@app.post("/api/user/list/remove")
def remove_from_list(item: ListItem):
    """Remove item from user's list"""
    result = user_lists.delete_one({
        "user_id": item.user_id,
        "media_id": item.media_id,
        "media_type": item.media_type
    })
    
    return {"success": True, "in_list": False, "deleted": result.deleted_count > 0}

@app.get("/api/user/list/check/{user_id}/{media_type}/{media_id}")
def check_in_list(user_id: str, media_type: str, media_id: int):
    """Check if item is in user's list"""
    existing = user_lists.find_one({
        "user_id": user_id,
        "media_id": media_id,
        "media_type": media_type
    }, {"_id": 0})
    
    return {"in_list": existing is not None}

@app.get("/api/user/list/{user_id}")
def get_user_list(user_id: str):
    """Get all items in user's list"""
    items = list(user_lists.find({"user_id": user_id}, {"_id": 0}))
    return {"items": items, "count": len(items)}

# =====================
# USER RATING ENDPOINTS
# =====================

@app.post("/api/user/rating")
def set_rating(item: RatingItem):
    """Set or update user rating for a media item"""
    if item.rating < 1 or item.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    
    user_ratings.update_one(
        {
            "user_id": item.user_id,
            "media_id": item.media_id,
            "media_type": item.media_type
        },
        {
            "$set": {
                "rating": item.rating,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        },
        upsert=True
    )
    
    return {"success": True, "rating": item.rating}

@app.get("/api/user/rating/{user_id}/{media_type}/{media_id}")
def get_rating(user_id: str, media_type: str, media_id: int):
    """Get user rating for a media item"""
    rating = user_ratings.find_one({
        "user_id": user_id,
        "media_id": media_id,
        "media_type": media_type
    }, {"_id": 0})
    
    return {"rating": rating.get("rating") if rating else 0}

# =====================
# USER LIKE ENDPOINTS
# =====================

@app.post("/api/user/like/toggle")
def toggle_like(item: LikeItem):
    """Toggle like status for an item"""
    existing = user_likes.find_one({
        "user_id": item.user_id,
        "media_id": item.media_id,
        "media_type": item.media_type
    }, {"_id": 0})
    
    if existing:
        user_likes.delete_one({
            "user_id": item.user_id,
            "media_id": item.media_id,
            "media_type": item.media_type
        })
        return {"success": True, "liked": False, "message": "Like removed"}
    
    user_likes.insert_one({
        "user_id": item.user_id,
        "media_id": item.media_id,
        "media_type": item.media_type,
        "liked_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"success": True, "liked": True, "message": "Liked"}

@app.get("/api/user/like/check/{user_id}/{media_type}/{media_id}")
def check_like(user_id: str, media_type: str, media_id: int):
    """Check if item is liked by user"""
    existing = user_likes.find_one({
        "user_id": user_id,
        "media_id": media_id,
        "media_type": media_type
    }, {"_id": 0})
    
    return {"liked": existing is not None}

@app.get("/api/user/likes/{user_id}")
def get_user_likes(user_id: str):
    """Get all liked items for user"""
    items = list(user_likes.find({"user_id": user_id}, {"_id": 0}))
    return {"items": items, "count": len(items)}

# =====================
# CONTENT VIEWS TRACKING (for automatic Top 10)
# =====================

@app.post("/api/content/view/{media_type}/{tmdb_id}")
async def track_content_view(media_type: str, tmdb_id: int):
    """Track a view for content - used to calculate Top 10"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # Increment view count for today
    content_views.update_one(
        {"tmdbId": tmdb_id, "type": media_type, "date": today},
        {
            "$inc": {"views": 1},
            "$setOnInsert": {"createdAt": datetime.now(timezone.utc).isoformat()}
        },
        upsert=True
    )
    return {"success": True}

@app.get("/api/public/homepage/genre/{genre_id}")
async def get_homepage_genre(genre_id: int, media_type: str = "movie", page: int = 1):
    """Get content by genre for infinite scroll sections"""
    endpoint = f"/discover/{media_type}"
    data = await fetch_tmdb_data(endpoint, {"with_genres": genre_id, "page": page, "sort_by": "popularity.desc"})
    
    if not data or "results" not in data:
        return {"items": [], "total": 0, "page": page, "total_pages": 0}
    
    items = []
    for item in data["results"]:
        if is_anime_content(item):
            continue
        tmdb_id = item.get("id")
        items.append({
            "id": tmdb_id,
            "tmdbId": tmdb_id,
            "type": media_type,
            "media_type": media_type,
            "title": item.get("title") or item.get("name"),
            "name": item.get("title") or item.get("name"),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "release_date": item.get("release_date") or item.get("first_air_date"),
            "vote_average": item.get("vote_average", 0),
            "popularity": item.get("popularity", 0),
            "genre_ids": item.get("genre_ids", []),
            "overview": item.get("overview")
        })
    
    return {
        "items": items,
        "total": data.get("total_results", 0),
        "page": page,
        "total_pages": data.get("total_pages", 0)
    }


# =====================
# ARCHIVE - advanced catalog browsing (filters + sorting on TMDB discover/search, strict Italian filter)
# =====================
ARCHIVE_PAGE_SIZE = 24
ARCHIVE_PROVIDERS = [
    {"id": 8, "name": "Netflix"}, {"id": 119, "name": "Prime Video"}, {"id": 337, "name": "Disney+"},
    {"id": 350, "name": "Apple TV+"}, {"id": 531, "name": "Paramount+"}, {"id": 39, "name": "NOW"},
    {"id": 222, "name": "RaiPlay"}, {"id": 359, "name": "Mediaset Infinity"}, {"id": 524, "name": "Discovery+"},
    {"id": 109, "name": "TIMVISION"},
]
ARCHIVE_COUNTRIES = [
    ("IT", "Italia"), ("US", "Stati Uniti"), ("GB", "Regno Unito"), ("FR", "Francia"), ("DE", "Germania"), ("ES", "Spagna"),
    ("KR", "Corea del Sud"), ("JP", "Giappone"), ("CN", "Cina"), ("IN", "India"), ("CA", "Canada"), ("AU", "Australia"),
    ("BR", "Brasile"), ("MX", "Messico"), ("AR", "Argentina"), ("TR", "Turchia"), ("SE", "Svezia"), ("DK", "Danimarca"),
    ("NO", "Norvegia"), ("NL", "Paesi Bassi"), ("BE", "Belgio"), ("IE", "Irlanda"), ("PL", "Polonia"), ("RU", "Russia"),
    ("TH", "Thailandia"), ("HK", "Hong Kong"),
]
ARCHIVE_AGE_GROUPS = {"7": {"T", "6+", "7+"}, "12": {"12+", "13+"}, "14": {"14+"}, "16": {"16+"}, "18": {"18+"}}
ARCHIVE_AGES = [{"key": k, "label": f"{k}+"} for k in ("7", "12", "14", "16", "18")]
# Views = real plays recorded by FlixIT users (content_views collection)
ARCHIVE_VIEWS = [{"key": v, "label": lbl} for v, lbl in ((25000, "25K+"), (50000, "50K+"), (75000, "75K+"), (100000, "100K+"), (200000, "200K+"),
                                                          (500000, "500K+"), (1000000, "1M+"), (2000000, "2M+"), (5000000, "5M+"), (10000000, "10M+"))]
# Quality is a transparent heuristic: CAM = in cinemas < 30 days and not on any Italian streaming service, TS = 30-60 days, SD = before 1995, HD = everything else
ARCHIVE_QUALITY_DAYS = {"cam": (0, 30), "ts": (30, 60)}
ARCHIVE_SD_BEFORE = "1995-01-01"
ARCHIVE_SORTS = [
    {"key": "popularity", "label": "Popolarità"}, {"key": "release", "label": "Data di uscita"}, {"key": "added", "label": "Data di aggiunta"},
    {"key": "rating", "label": "Valutazione"}, {"key": "votes", "label": "Più votati"}, {"key": "title", "label": "Titolo A-Z"},
]
ARCHIVE_QUALITIES = [{"key": "hd", "label": "HD"}, {"key": "sd", "label": "SD"}, {"key": "ts", "label": "TS"}, {"key": "cam", "label": "CAM"}]


@app.get("/api/public/archive/options")
async def get_archive_options():
    """Option lists for the Archive filter bar."""
    year_now = datetime.now(timezone.utc).year
    genres = [{"id": s["genre_id"], "name": s["name"]} for s in AVAILABLE_SECTIONS if s["section_type"] == "genre" and not s.get("origin_country")]
    return {
        "types": [{"key": "movie", "label": "Film"}, {"key": "tv", "label": "Serie TV"}],
        "genres": genres,
        "countries": [{"key": c, "label": n} for c, n in ARCHIVE_COUNTRIES],
        "years": [{"key": str(y), "label": str(y)} for y in range(year_now, 1979, -1)] + [{"key": f"{d}s", "label": f"Anni {str(d)[2:]}"} for d in (1970, 1960, 1950)],
        "ratings": [{"key": r, "label": f"{r} stell{'a' if r == 1 else 'e'}"} for r in range(10, 0, -1)],
        "views": ARCHIVE_VIEWS,
        "providers": [{"key": p["id"], "label": p["name"]} for p in ARCHIVE_PROVIDERS],
        "ages": ARCHIVE_AGES,
        "qualities": ARCHIVE_QUALITIES,
        "sorts": ARCHIVE_SORTS,
    }


def _archive_item(raw: dict, mtype: str) -> dict:
    return {
        "tmdbId": raw.get("id"), "type": mtype,
        "title": raw.get("title") or raw.get("name"), "overview": raw.get("overview", ""),
        "poster_path": raw.get("poster_path"), "backdrop_path": raw.get("backdrop_path"),
        "release_date": raw.get("release_date") or raw.get("first_air_date") or "",
        "vote_average": raw.get("vote_average") or 0, "vote_count": raw.get("vote_count") or 0,
        "popularity": raw.get("popularity") or 0,
        "genre_ids": raw.get("genre_ids") or [g.get("id") for g in raw.get("genres") or []],
        "origin_country": raw.get("origin_country") or [c.get("iso_3166_1") for c in raw.get("production_countries") or []],
    }


def _archive_sort_key(sort: str):
    return {
        "release": lambda i: i.get("release_date") or "",
        "rating": lambda i: (i.get("vote_average") or 0, i.get("vote_count") or 0),
        "votes": lambda i: i.get("vote_count") or 0,
        "title": lambda i: (i.get("title") or "").lower(),
    }.get(sort, lambda i: i.get("popularity") or 0)


def _year_bounds(year: Optional[str]):
    if not year:
        return None, None
    if year.endswith("s"):
        d = int(year[:-1])
        return f"{d}-01-01", f"{d + 9}-12-31"
    return f"{year}-01-01", f"{year}-12-31"


def _rating_threshold(rating) -> float:
    return 9.5 if rating and rating >= 10 else float(rating or 0)


def _archive_post_filter(items: list, genre, country, year, rating) -> list:
    lo, hi = _year_bounds(year)
    wanted = set(x for x in genre_pair(genre) if x) if genre else None
    out = []
    for i in items:
        if wanted and not wanted.intersection(i.get("genre_ids") or []):
            continue
        if country and country not in (i.get("origin_country") or []):
            continue
        if lo and not (lo <= (i.get("release_date") or "") <= hi):
            continue
        if rating and (i.get("vote_average") or 0) < _rating_threshold(rating):
            continue
        out.append(i)
    return out


def _discover_params(mtype: str, page: int, genre, country, year, rating, provider, sort, quality) -> Optional[dict]:
    today = datetime.now(timezone.utc).date()
    date_field = "primary_release_date" if mtype == "movie" else "first_air_date"
    p = {"page": page, "include_adult": "false", "vote_count.gte": 200 if sort == "rating" else 0}
    p["sort_by"] = {
        "popularity": "popularity.desc", "release": f"{date_field}.desc", "rating": "vote_average.desc",
        "votes": "vote_count.desc", "title": ("title.asc" if mtype == "movie" else "name.asc"),
    }.get(sort, "popularity.desc")
    if sort == "release":
        p[f"{date_field}.lte"] = today.isoformat()
    if genre:
        movie_gid, tv_gid = genre_pair(genre)
        gid = movie_gid if mtype == "movie" else tv_gid
        if not gid:
            return None
        p["with_genres"] = gid
    if country:
        p["with_origin_country"] = country
    lo, hi = _year_bounds(year)
    if lo:
        p[f"{date_field}.gte"], p[f"{date_field}.lte"] = lo, min(hi, p.get(f"{date_field}.lte", hi))
    if rating:
        p["vote_average.gte"] = _rating_threshold(rating)
        p["vote_count.gte"] = max(p["vote_count.gte"], 50)
    if provider:
        p["with_watch_providers"], p["watch_region"] = provider, "IT"
    if quality in ARCHIVE_QUALITY_DAYS:
        if mtype != "movie":
            return None
        d_hi, d_lo = ARCHIVE_QUALITY_DAYS[quality]
        p[f"{date_field}.gte"] = (today - timedelta(days=d_lo)).isoformat()
        p[f"{date_field}.lte"] = (today - timedelta(days=d_hi)).isoformat()
    elif quality == "sd":
        p[f"{date_field}.lte"] = min(ARCHIVE_SD_BEFORE, p.get(f"{date_field}.lte", ARCHIVE_SD_BEFORE))
    return p


async def _has_it_offer(item: dict) -> bool:
    data = await fetch_tmdb_data(f"/{item['type']}/{item['tmdbId']}/watch/providers")
    offers = ((data or {}).get("results") or {}).get("IT") or {}
    return any(offers.get(k) for k in ("flatrate", "ads", "free", "rent", "buy"))


async def _apply_quality(items: list, quality: Optional[str]) -> list:
    """Heuristic video quality (no real source exists): see ARCHIVE_QUALITY_DAYS / ARCHIVE_SD_BEFORE."""
    if not quality:
        return items
    today = datetime.now(timezone.utc).date()
    recent_from = (today - timedelta(days=60)).isoformat()
    if quality == "sd":
        return [i for i in items if (i.get("release_date") or "9999") < ARCHIVE_SD_BEFORE]
    if quality in ARCHIVE_QUALITY_DAYS:
        d_hi, d_lo = ARCHIVE_QUALITY_DAYS[quality]
        lo, hi = (today - timedelta(days=d_lo)).isoformat(), (today - timedelta(days=d_hi)).isoformat()
        window = [i for i in items if i.get("type") == "movie" and lo <= (i.get("release_date") or "") <= hi]
        flags = await asyncio.gather(*(_has_it_offer(i) for i in window))
        return [i for i, on_streaming in zip(window, flags) if not on_streaming]
    # hd: everything except very recent cinema-only titles and pre-1995 titles
    keep, recent = [], []
    for i in items:
        rd = i.get("release_date") or ""
        if rd < ARCHIVE_SD_BEFORE and rd:
            continue
        (recent if rd >= recent_from else keep).append(i)
    flags = await asyncio.gather(*(_has_it_offer(i) for i in recent))
    return keep + [i for i, on_streaming in zip(recent, flags) if on_streaming]


async def _archive_from_ids(docs: list, total: int, page: int, batch: int, genre, country, year, rating, provider) -> tuple:
    """Build archive items from a list of {type, tmdbId} docs (added / views orderings) using TMDB details."""
    async def details(doc):
        data = await fetch_tmdb_data(f"/{doc['type']}/{doc['tmdbId']}", {"append_to_response": "watch/providers"})
        if not data:
            return None
        item = _archive_item(data, doc["type"])
        if is_anime_content({**data, "genre_ids": item["genre_ids"], "origin_country": item["origin_country"]}):
            return None
        if provider:
            offers = ((data.get("watch/providers") or {}).get("results") or {}).get("IT") or {}
            ids = {o.get("provider_id") for k in ("flatrate", "ads", "free") for o in offers.get(k) or []}
            if provider not in ids:
                return None
        if "views" in doc:
            item["views"] = doc["views"]
        return item

    items = [i for i in await asyncio.gather(*(details(d) for d in docs)) if i]
    return _archive_post_filter(items, genre, country, year, rating), total, (page * batch) < total


async def _archive_added(types: list, page: int, genre, country, year, rating, provider) -> tuple:
    """Newest catalog entries first (first-seen timestamp, then TMDB id)."""
    await refresh_vixsrc_catalog()
    q = {"type": {"$in": types}}
    total = vixsrc_added.count_documents(q)
    batch = ARCHIVE_PAGE_SIZE * (2 if any([genre, country, year, rating, provider]) else 1)
    docs = list(vixsrc_added.find(q, {"_id": 0}).sort([("added_at", -1), ("tmdbId", -1)]).skip((page - 1) * batch).limit(batch))
    return await _archive_from_ids(docs, total, page, batch, genre, country, year, rating, provider)


async def _archive_by_views(types: list, min_views: int, page: int, genre, country, year, rating, provider) -> tuple:
    """Titles watched at least `min_views` times by FlixIT users, most viewed first."""
    q = {"type": {"$in": types}, "views": {"$gte": min_views}}
    total = content_views.count_documents(q)
    batch = ARCHIVE_PAGE_SIZE * 2
    docs = list(content_views.find(q, {"_id": 0}).sort([("views", -1), ("updatedAt", -1)]).skip((page - 1) * batch).limit(batch))
    return await _archive_from_ids(docs, total, page, batch, genre, country, year, rating, provider)


@app.get("/api/public/archive")
async def get_archive(
    q: Optional[str] = None, type: str = "all", genre: Optional[int] = None, country: Optional[str] = None,
    year: Optional[str] = None, rating: Optional[int] = None, views: Optional[int] = None, provider: Optional[int] = None,
    age: Optional[str] = None, quality: Optional[str] = None, sort: str = "popularity", page: int = 1,
):
    """Filtered, sorted, paginated catalog. Only Italian-dubbed titles are returned."""
    types = ["movie", "tv"] if type not in ("movie", "tv") else [type]
    page = max(1, page)
    total_estimate, has_more = 0, False

    if views:
        items, total_estimate, has_more = await _archive_by_views(types, views, page, genre, country, year, rating, provider)
        if sort != "popularity":
            items.sort(key=_archive_sort_key(sort), reverse=sort != "title")
    elif sort == "added" and not q:
        items, total_estimate, has_more = await _archive_added(types, page, genre, country, year, rating, provider)
    elif q:
        results = await asyncio.gather(*(fetch_tmdb_data(f"/search/{t}", {"query": q, "page": page, "include_adult": "false"}) for t in types))
        items = []
        for t, data in zip(types, results):
            items += [_archive_item(r, t) for r in (data or {}).get("results") or [] if not is_anime_content(r)]
            total_estimate += (data or {}).get("total_results") or 0
            has_more = has_more or page < ((data or {}).get("total_pages") or 0)
        items = _archive_post_filter(items, genre, country, year, rating)  # provider filter not applicable to text search
        items.sort(key=_archive_sort_key(sort), reverse=sort != "title")
    else:
        pages = 3 if (age or quality) else 2
        plans = [(t, _discover_params(t, page, genre, country, year, rating, provider, sort, quality)) for t in types]
        plans = [(t, p) for t, p in plans if p]
        results = await asyncio.gather(*(fetch_tmdb_pages(f"/discover/{t}", p, pages=pages) for t, p in plans))
        firsts = await asyncio.gather(*(fetch_tmdb_data(f"/discover/{t}", {**p, "page": 1}) for t, p in plans))
        items = []
        for (t, _), data, first in zip(plans, results, firsts):
            items += [_archive_item(r, t) for r in (data or {}).get("results") or [] if not is_anime_content(r)]
            total_estimate += (first or {}).get("total_results") or 0
            has_more = has_more or (page * pages) < min(500, (first or {}).get("total_pages") or 0)
        if len(plans) > 1:
            items.sort(key=_archive_sort_key(sort), reverse=sort != "title")

    items = await _apply_quality(items, quality)
    items = await filter_available(items, limit=ARCHIVE_PAGE_SIZE * 2)
    items = await enrich_items(items)
    if age in ARCHIVE_AGE_GROUPS:
        items = [i for i in items if i.get("certification") in ARCHIVE_AGE_GROUPS[age]]
    total_estimate = min(total_estimate, sum(len(_vix_ids[t]) for t in types) or total_estimate)
    return {"items": items[:ARCHIVE_PAGE_SIZE], "page": page, "hasMore": has_more, "total_estimate": total_estimate, "sort": sort}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)


# =====================
# SUPPORT MODULE: admin user management, forced password reset, tickets, notifications
# =====================
import support as _support  # noqa: E402
_support.register(app, db, get_current_user, get_current_admin, JWT_SECRET, log_admin_action, issue_user_token)
