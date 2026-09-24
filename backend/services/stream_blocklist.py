"""Negative availability cache: titles whose stream resolution failed with not_found.

Home/catalogue rows only show titles present in the vixsrc Italian catalogue; a
few of them still have no playable stream. The player records those here and
`is_on_vixsrc` hides them until a later resolution succeeds again.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger("flixit.stream_blocklist")

_collection = None
_blocked: dict[str, set[int]] = {"movie": set(), "tv": set()}


def init(db) -> None:
    global _collection
    _collection = db["stream_failures"]
    try:
        _collection.create_index([("type", 1), ("tmdbId", 1)], unique=True)
        for doc in _collection.find({}, {"_id": 0, "type": 1, "tmdbId": 1}):
            _blocked["tv" if doc.get("type") == "tv" else "movie"].add(int(doc.get("tmdbId") or 0))
    except Exception as exc:
        logger.warning("stream blocklist load failed: %s", exc)
    logger.info("stream blocklist loaded: %d movie, %d tv", len(_blocked["movie"]), len(_blocked["tv"]))


def is_blocked(media_type: str, tmdb_id: int) -> bool:
    return int(tmdb_id) in _blocked["tv" if media_type == "tv" else "movie"]


def mark_failure(media_type: str, tmdb_id: int, reason: str = "not_found") -> None:
    media_type = "tv" if media_type == "tv" else "movie"
    _blocked[media_type].add(int(tmdb_id))
    if _collection is None:
        return
    try:
        _collection.update_one(
            {"type": media_type, "tmdbId": int(tmdb_id)},
            {"$set": {"reason": reason, "failed_at": datetime.now(timezone.utc).isoformat()}, "$inc": {"count": 1}},
            upsert=True,
        )
    except Exception as exc:
        logger.warning("stream blocklist write failed: %s", exc)


def clear_failure(media_type: str, tmdb_id: int) -> None:
    media_type = "tv" if media_type == "tv" else "movie"
    if int(tmdb_id) not in _blocked[media_type]:
        return
    _blocked[media_type].discard(int(tmdb_id))
    if _collection is not None:
        try:
            _collection.delete_one({"type": media_type, "tmdbId": int(tmdb_id)})
        except Exception as exc:
            logger.warning("stream blocklist delete failed: %s", exc)


def blocked_counts() -> dict:
    return {key: len(value) for key, value in _blocked.items()}
