"""
Embedded Omni-compatible core for FLIX-IT.

This module runs inside the existing FastAPI backend. It intentionally does not
bundle third-party site scrapers. Instead it exposes the same stream selection
shape used by the Omni/Stremio client and resolves streams that are explicitly
stored in FLIX-IT's own database.

Supported collections:
- stream_sources: existing Admin > Contenuti sources, keyed by TMDB id.
- omni_stream_sources: optional multi-source collection keyed by IMDb id.

An omni_stream_sources document can contain:
{
  "imdb_id": "tt1234567",
  "media_type": "movie" | "tv",
  "season": 1,
  "episode": 2,
  "url": "https://.../master.m3u8",
  "name": "My authorized provider",
  "headers": {"Referer": "https://example.com/"},
  "enabled": true
}
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse

from .resolvers.base import stream_type_for


def _stream_type(url: str) -> str:
    path = urlparse(str(url or "")).path.lower()
    if path.endswith(".m3u8") or "/hls/" in path:
        return "hls"
    return stream_type_for(url)


def _valid_http_url(url: str) -> bool:
    parsed = urlparse(str(url or "").strip())
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _payload(url: str, name: str = "FlixIT Embedded", title: str = "", headers=None) -> dict:
    return {
        "url": url,
        "type": _stream_type(url),
        "name": name or "FlixIT Embedded",
        "title": title or "",
        "headers": {str(k): str(v) for k, v in (headers or {}).items() if v},
        "not_web_ready": False,
    }


def resolve_streams(
    db,
    imdb_id: str,
    media_type: str,
    season: Optional[int] = None,
    episode: Optional[int] = None,
) -> list[dict]:
    """Return authorized local streams using the same normalized shape as stremio.parse_streams."""
    if db is None or not imdb_id:
        return []

    out: list[dict] = []

    # Optional multi-source embedded collection. This is the preferred extension
    # point for authorized providers because several alternatives may coexist.
    query = {
        "imdb_id": imdb_id,
        "media_type": media_type,
        "enabled": {"$ne": False},
    }
    if media_type == "tv":
        query.update({"season": season, "episode": episode})
    else:
        query.update({"season": {"$in": [None, 0]}, "episode": {"$in": [None, 0]}})

    try:
        docs = list(db["omni_stream_sources"].find(query, {"_id": 0}).limit(20))
    except Exception:
        docs = []

    for doc in docs:
        url = str(doc.get("url") or doc.get("stream_url") or "").strip()
        if not _valid_http_url(url):
            continue
        out.append(
            _payload(
                url,
                name=str(doc.get("name") or doc.get("provider") or "FlixIT Embedded"),
                title=str(doc.get("title") or ""),
                headers=doc.get("headers") or {},
            )
        )

    # Existing Admin stream_sources remain a zero-configuration fallback.
    # external_ids is populated by stremio.fetch_imdb_id when titles are played.
    try:
        external = db["external_ids"].find_one(
            {"imdb_id": imdb_id, "media_type": media_type},
            {"_id": 0, "tmdbId": 1},
        )
    except Exception:
        external = None

    if external and external.get("tmdbId") is not None:
        admin_query = {
            "tmdbId": int(external["tmdbId"]),
            "media_type": media_type,
            "season": season if media_type == "tv" else None,
            "episode": episode if media_type == "tv" else None,
        }
        try:
            doc = db["stream_sources"].find_one(admin_query, {"_id": 0})
        except Exception:
            doc = None
        if doc:
            url = str(doc.get("stream_url") or "").strip()
            if _valid_http_url(url) and all(s.get("url") != url for s in out):
                out.append(
                    _payload(
                        url,
                        name="FlixIT Admin",
                        title="Sorgente locale autorizzata",
                        headers=doc.get("headers") or {},
                    )
                )

    return out
