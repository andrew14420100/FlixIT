"""
InternetArchiveResolver: optional public-domain fallback.

Resolves a title to a public-domain copy hosted on the Internet Archive, using an
exact title + year match against known public-domain / open collections. Off by
default; controlled by the Admin > Impostazioni toggle (setting key below).
"""
import logging
import os
import re
import unicodedata
from typing import Optional
from urllib.parse import quote

import httpx

from .base import BaseResolver

logger = logging.getLogger("player.internet_archive")

#: Admin setting flag that enables this provider (kept for backward compatibility).
PUBLIC_DOMAIN_SETTING_KEY = "player_public_domain_fallback"

TMDB_BASE_URL = "https://api.themoviedb.org/3"
ARCHIVE_SEARCH_URL = "https://archive.org/advancedsearch.php"
ARCHIVE_META_URL = "https://archive.org/metadata/{identifier}"
ARCHIVE_DOWNLOAD_URL = "https://archive.org/download/{identifier}/{name}"
ARCHIVE_COLLECTIONS = [
    "feature_films", "publicdomainmovies", "moviesandfilms", "sci-fi_horror",
    "film_noir", "comedy_films", "silent_films", "classic_tv", "animationandcartoons",
]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return re.sub(r"^(the|a|an) ", "", s).strip()


_TITLE_NOISE = re.compile(
    r"\((?:19|20)\d{2}\)|\[[^\]]*\]|\b(?:19|20)\d{2}\b|full movie|1080p|720p|4k|hd|colorized|remastered|restored",
    re.I,
)


def _clean_title(t: str) -> str:
    """Normalize an Internet Archive item title: drop year, brackets and quality tags."""
    return _norm(_TITLE_NOISE.sub(" ", t or ""))


def _year_from(doc: dict) -> Optional[int]:
    for candidate in (str(doc.get("year") or "")[:4], *re.findall(r"\b((?:19|20)\d{2})\b", doc.get("title") or "")):
        if candidate and candidate.isdigit():
            return int(candidate)
    return None


def _pick_video_file(files: list) -> Optional[str]:
    """Prefer h.264 mp4, then the largest MPEG4 (skipping low-bitrate / HEVC derivatives)."""
    candidates = []
    for f in files:
        name = f.get("name") or ""
        low = name.lower()
        if not low.endswith((".mp4", ".m4v")):
            continue
        if "trailer" in low or "sample" in low:
            continue
        fmt = (f.get("format") or "").lower()
        try:
            size = int(f.get("size") or 0)
        except Exception:
            size = 0
        score = 0
        if "h.264" in fmt:
            score += 3
        if "512kb" in fmt or "512kb" in low:
            score -= 2
        if re.search(r"x265|hevc|h\.?265", low):
            score -= 4  # browsers rarely decode HEVC in <video>
        candidates.append((score, size, name))
    if not candidates:
        return None
    candidates.sort(key=lambda c: (c[0], c[1]), reverse=True)
    return candidates[0][2]


async def _tmdb_titles(media_type: str, tmdb_id: int) -> tuple[list, Optional[int]]:
    """Return ([title, original title], year) for the TMDB title."""
    api_key = os.environ.get("TMDB_API_KEY", "")
    if not api_key:
        return [], None
    params = {"language": "en-US"}
    headers = {}
    if api_key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {api_key}"
    else:
        params["api_key"] = api_key
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{TMDB_BASE_URL}/{media_type}/{tmdb_id}", params=params, headers=headers)
            if r.status_code != 200:
                return [], None
            d = r.json()
    except Exception as e:
        logger.warning(f"TMDB lookup failed for {media_type}/{tmdb_id}: {e}")
        return [], None
    titles = []
    for k in ("title", "name", "original_title", "original_name"):
        v = (d.get(k) or "").strip()
        if v and v not in titles:
            titles.append(v)
    date = d.get("release_date") or d.get("first_air_date") or ""
    year = int(date[:4]) if len(date) >= 4 and date[:4].isdigit() else None
    return titles, year


class InternetArchiveResolver(BaseResolver):
    id = "internet_archive"
    label = "Internet Archive (pubblico dominio)"
    always_active = False
    configurable = True

    def is_active(self) -> bool:
        if self._get_setting is None:
            return False
        try:
            return bool(self._get_setting(PUBLIC_DOMAIN_SETTING_KEY, False))
        except Exception:
            return False

    async def resolve(
        self,
        tmdb_id: int,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        media_type: str = "movie",
    ) -> Optional[dict]:
        titles, year = await _tmdb_titles(media_type, tmdb_id)
        return await self._archive_lookup(titles, year, season, episode)

    async def _archive_lookup(
        self, titles: list, year: Optional[int], season: Optional[int] = None, episode: Optional[int] = None
    ) -> Optional[dict]:
        if not titles:
            return None
        wanted = {_norm(t) for t in titles}
        title_q = " OR ".join(f'title:("{t}")' for t in titles[:2])
        coll_q = " OR ".join(f"collection:{c}" for c in ARCHIVE_COLLECTIONS)
        q = f"({title_q}) AND mediatype:movies AND ({coll_q})"
        params = {
            "q": q, "fl[]": ["identifier", "title", "year"], "rows": 15, "output": "json", "sort[]": "downloads desc",
        }
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                r = await client.get(ARCHIVE_SEARCH_URL, params=params)
                if r.status_code != 200:
                    return None
                docs = r.json().get("response", {}).get("docs", [])
                ep_tag = None
                if season is not None and episode is not None:
                    ep_tag = re.compile(rf"(s0?{season}e0?{episode}\b|\b{season}x0?{episode}\b)", re.I)
                matches = []
                for d in docs:
                    t = d.get("title") or ""
                    if re.search(r"trailer|scenes? from|speed ?run|rescore", t, re.I):
                        continue
                    if ep_tag:
                        if not ep_tag.search(t):
                            continue
                        base = _clean_title(ep_tag.sub("", t))
                        if not any(w and (w in base or base in w) for w in wanted):
                            continue
                    elif _clean_title(t) not in wanted:
                        continue
                    d_year = _year_from(d)
                    year_ok = year is None or d_year is None or abs(d_year - year) <= 1
                    if ep_tag or year_ok:
                        matches.append((0 if d_year == year else (1 if d_year else 2), d))
                matches.sort(key=lambda m: m[0])
                for _, d in matches[:4]:
                    ident = d["identifier"]
                    m = await client.get(ARCHIVE_META_URL.format(identifier=ident))
                    if m.status_code != 200:
                        continue
                    name = _pick_video_file(m.json().get("files", []))
                    if not name:
                        continue
                    url = ARCHIVE_DOWNLOAD_URL.format(identifier=ident, name=quote(name))
                    return {"success": True, "stream": url, "type": "mp4", "source": self.id, "archive_id": ident}
        except Exception as e:
            logger.warning(f"Internet Archive lookup failed: {e}")
        return None
