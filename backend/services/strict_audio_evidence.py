"""Authoritative Italian-audio policy for public TV episodes.

VixSrc exposes a language-filtered *episode* catalogue.  That catalogue is a
better source of truth than trying to infer a dub from the JSON returned by the
single-episode endpoint, because that endpoint often exposes only an embed URL
and no audio metadata at all.

Policy v10 therefore works as follows:
- warm and persist ``/api/list/episode?lang=it``;
- membership in that catalogue is explicit Italian-audio evidence;
- absence from a successfully loaded Italian catalogue fails closed;
- if the catalogue is temporarily unavailable, keep the older explicit-track
  detector as a conservative fallback;
- persist the final verdict so Detail/season snapshots are instant after restart.
"""
from __future__ import annotations

import asyncio
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

POLICY_VERSION = "strict-it-v10-vixsrc-episode-catalog"
AVAILABILITY_VERSION = "streamportal-live-v6-vixsrc-episode-catalog"
CATALOG_URL = os.environ.get(
    "VIXSRC_EPISODE_CATALOG_URL",
    "https://vixsrc.to/api/list/episode/",
)
CATALOG_TTL_SECONDS = max(120, int(os.environ.get("VIXSRC_EPISODE_CATALOG_TTL_SECONDS", "900")))
CATALOG_PERSIST_MAX_AGE_SECONDS = max(
    CATALOG_TTL_SECONDS,
    int(os.environ.get("VIXSRC_EPISODE_CATALOG_PERSIST_MAX_AGE_SECONDS", "86400")),
)

_INSTALLED = False
_catalog_keys: set[tuple[int, int, int]] = set()
_catalog_loaded_at = 0.0
_catalog_lock: Optional[asyncio.Lock] = None
_catalog_db = None


def _leaf_strings(value: Any, limit: int = 40) -> list[str]:
    out: list[str] = []

    def walk(node: Any) -> None:
        if len(out) >= limit:
            return
        if isinstance(node, (str, int, float, bool)):
            text = str(node).strip()
            if text:
                out.append(text)
            return
        if isinstance(node, dict):
            for child in node.values():
                walk(child)
                if len(out) >= limit:
                    return
        elif isinstance(node, (list, tuple, set)):
            for child in node:
                walk(child)
                if len(out) >= limit:
                    return

    walk(value)
    return out


def _strict_language_hints_factory(policy_module):
    """Collect only language evidence attached to an audio/dub/voice context."""

    def strict_language_hints(payload: dict) -> list[str]:
        hints: list[str] = []

        def add(value: Any) -> None:
            for item in _leaf_strings(value):
                text = str(item).strip()
                if not text or "://" in text or text.startswith("/"):
                    continue
                if text not in hints:
                    hints.append(text)

        def marker_is_audio(value: Any) -> bool:
            text = policy_module._normal(value).replace("-", "")
            return any(
                marker in text
                for marker in ("audio", "dub", "voice", "soundtrack", "audiotrack")
            )

        def walk(node: Any, audio_context: bool = False) -> None:
            if isinstance(node, dict):
                node_audio = audio_context or any(
                    marker_is_audio(node.get(key))
                    for key in ("type", "kind", "role", "stream_type", "content_type")
                    if node.get(key) is not None
                )
                for raw_key, value in node.items():
                    key = policy_module._normal(raw_key).replace("-", "")
                    is_audio_key = any(
                        marker in key
                        for marker in ("audio", "dub", "voice", "soundtrack", "audiotrack")
                    )
                    neutral = key in {
                        "tracks", "track", "streams", "stream", "variants", "renditions"
                    }
                    next_context = node_audio or is_audio_key
                    if is_audio_key:
                        add(value)
                    elif node_audio and key in {
                        "lang", "language", "locale", "name", "label", "title", "code"
                    }:
                        add(value)
                    if isinstance(value, (dict, list, tuple)):
                        walk(value, next_context if not neutral else node_audio)
            elif isinstance(node, (list, tuple)):
                for child in node:
                    walk(child, audio_context)

        if isinstance(payload, dict):
            walk(payload, False)
        return hints[:40]

    return strict_language_hints


def _explicit_italian(policy_module, hints: Any) -> bool:
    values = hints if isinstance(hints, (list, tuple, set)) else []
    has_it = any(policy_module._is_italian(value) for value in values)
    has_original = any(policy_module._is_original_only(value) for value in values)
    return bool(has_it and not has_original)


def _positive_int(value: Any) -> Optional[int]:
    try:
        number = int(str(value).strip())
    except Exception:
        return None
    return number if number > 0 else None


def _first_int(row: dict, keys: tuple[str, ...]) -> Optional[int]:
    for key in keys:
        if key in row:
            value = _positive_int(row.get(key))
            if value is not None:
                return value
    return None


def _episode_key_from_row(row: Any) -> Optional[tuple[int, int, int]]:
    """Parse known VixSrc episode-list row shapes without trusting provider ids."""
    if not isinstance(row, dict):
        return None

    tmdb_id = _first_int(
        row,
        ("tmdb_id", "tmdbId", "tmdb", "themoviedb_id", "theMovieDbId"),
    )
    season = _first_int(
        row,
        ("season", "season_number", "seasonNumber", "season_num", "s"),
    )
    episode = _first_int(
        row,
        ("episode", "episode_number", "episodeNumber", "episode_num", "e"),
    )

    # Some catalogues nest the episode identity under media/data/episode_data.
    for nested_key in ("media", "data", "episode_data", "episodeData", "meta"):
        nested = row.get(nested_key)
        if not isinstance(nested, dict):
            continue
        tmdb_id = tmdb_id or _first_int(
            nested,
            ("tmdb_id", "tmdbId", "tmdb", "themoviedb_id", "theMovieDbId"),
        )
        season = season or _first_int(
            nested,
            ("season", "season_number", "seasonNumber", "season_num", "s"),
        )
        episode = episode or _first_int(
            nested,
            ("episode", "episode_number", "episodeNumber", "episode_num", "e"),
        )

    if tmdb_id and season and episode:
        return tmdb_id, season, episode

    # Last-resort support for explicit composite media keys. Do not parse the
    # provider's generic numeric ``id`` because it is not necessarily a TMDB id.
    for field in ("media_key", "mediaKey", "tmdb_key", "tmdbKey", "video_key", "videoKey"):
        value = str(row.get(field) or "").strip()
        if not value:
            continue
        match = re.fullmatch(r"(?:tv:)?(\d+)[^0-9]+(\d+)[^0-9]+(\d+)", value, re.I)
        if match:
            parsed = tuple(int(part) for part in match.groups())
            if all(part > 0 for part in parsed):
                return parsed  # type: ignore[return-value]
    return None


def _catalog_rows(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("results", "items", "episodes", "data", "catalog"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for nested in ("results", "items", "episodes", "data"):
                nested_value = value.get(nested)
                if isinstance(nested_value, list):
                    return nested_value
    return []


def _parse_episode_catalog(payload: Any) -> set[tuple[int, int, int]]:
    out: set[tuple[int, int, int]] = set()
    for row in _catalog_rows(payload):
        key = _episode_key_from_row(row)
        if key:
            out.add(key)
    return out


def _db_collections():
    if _catalog_db is None:
        return None, None
    try:
        return (
            _catalog_db["vixsrc_episode_catalog_it"],
            _catalog_db["vixsrc_episode_catalog_meta"],
        )
    except Exception:
        return None, None


def _load_persisted_catalog() -> tuple[set[tuple[int, int, int]], float]:
    collection, meta_collection = _db_collections()
    if collection is None or meta_collection is None:
        return set(), 0.0
    try:
        meta = meta_collection.find_one({"key": "it"}, {"_id": 0}) or {}
        updated_raw = meta.get("updated_at")
        updated = datetime.fromisoformat(str(updated_raw).replace("Z", "+00:00")) if updated_raw else None
        if updated and updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        if not updated:
            return set(), 0.0
        age = (datetime.now(timezone.utc) - updated).total_seconds()
        if age > CATALOG_PERSIST_MAX_AGE_SECONDS:
            return set(), 0.0
        keys = {
            (int(row["tmdbId"]), int(row["season"]), int(row["episode"]))
            for row in collection.find({}, {"_id": 0, "tmdbId": 1, "season": 1, "episode": 1})
            if row.get("tmdbId") and row.get("season") and row.get("episode")
        }
        return keys, max(1.0, time.monotonic() - min(age, CATALOG_TTL_SECONDS)) if keys else 0.0
    except Exception:
        return set(), 0.0


def _persist_catalog(keys: set[tuple[int, int, int]]) -> None:
    collection, meta_collection = _db_collections()
    if collection is None or meta_collection is None or not keys:
        return
    try:
        collection.create_index([("tmdbId", 1), ("season", 1), ("episode", 1)], unique=True)
        now = datetime.now(timezone.utc).isoformat()
        collection.delete_many({})
        batch: list[dict] = []
        for tmdb_id, season, episode in sorted(keys):
            batch.append({"tmdbId": tmdb_id, "season": season, "episode": episode})
            if len(batch) >= 1000:
                collection.insert_many(batch, ordered=False)
                batch = []
        if batch:
            collection.insert_many(batch, ordered=False)
        meta_collection.update_one(
            {"key": "it"},
            {"$set": {"key": "it", "updated_at": now, "count": len(keys), "policy": POLICY_VERSION}},
            upsert=True,
        )
    except Exception:
        pass


async def warm_italian_episode_catalog(force: bool = False) -> bool:
    """Ensure the Italian episode catalogue is ready; returns True if usable."""
    global _catalog_keys, _catalog_loaded_at, _catalog_lock
    now = time.monotonic()
    if _catalog_keys and not force and now - _catalog_loaded_at < CATALOG_TTL_SECONDS:
        return True

    if _catalog_lock is None:
        _catalog_lock = asyncio.Lock()

    async with _catalog_lock:
        now = time.monotonic()
        if _catalog_keys and not force and now - _catalog_loaded_at < CATALOG_TTL_SECONDS:
            return True

        if not _catalog_keys:
            persisted, loaded_at = await asyncio.to_thread(_load_persisted_catalog)
            if persisted:
                _catalog_keys = persisted
                _catalog_loaded_at = loaded_at or time.monotonic()

        try:
            import httpx
            timeout = httpx.Timeout(connect=5.0, read=35.0, write=5.0, pool=5.0)
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
                    "Accept": "application/json",
                    "Accept-Language": "it-IT,it;q=0.9",
                },
            ) as client:
                response = await client.get(CATALOG_URL, params={"lang": "it"})
            if response.status_code == 200:
                parsed = _parse_episode_catalog(response.json())
                if parsed:
                    _catalog_keys = parsed
                    _catalog_loaded_at = time.monotonic()
                    await asyncio.to_thread(_persist_catalog, parsed)
                    return True
        except Exception:
            pass

        return bool(_catalog_keys)


def italian_episode_catalog_contains(tmdb_id: int, season: int, episode: int) -> bool:
    try:
        return (int(tmdb_id), int(season), int(episode)) in _catalog_keys
    except Exception:
        return False


def _final_result(
    available: bool,
    status: str,
    *,
    evidence: str,
    source_available: bool,
    hints: Optional[list[str]] = None,
) -> dict:
    return {
        "italian_available": bool(available),
        "italian_audio_status": status,
        "source_available": bool(source_available),
        "availability_label": None,
        "detected_languages": hints or (["it"] if available else []),
        "italian_audio_evidence_explicit": bool(available),
        "italian_audio_evidence_source": evidence,
        "italian_audio_policy_version": POLICY_VERSION,
    }


def install_strict_audio_evidence(app=None) -> bool:
    global _INSTALLED, _catalog_db
    if _INSTALLED:
        return True

    try:
        import server_core as core
        import services.italian_episode_policy as episode_policy
        import services.strict_italian_tv as strict_tv
        import services.streamportal_availability as availability
    except Exception:
        return False

    _catalog_db = core.db
    episode_policy._language_hints = _strict_language_hints_factory(episode_policy)
    episode_policy.POLICY_VERSION = POLICY_VERSION
    strict_tv.STRICT_EPISODE_POLICY_VERSION = POLICY_VERSION
    strict_tv.STRICT_AVAILABILITY_POLICY_VERSION = AVAILABILITY_VERSION
    availability.POLICY_VERSION = AVAILABILITY_VERSION

    persistent = None
    try:
        persistent = core.db["italian_episode_audio_cache"]
    except Exception:
        persistent = None

    current_inspect = episode_policy._inspect_source
    if not getattr(current_inspect, "_flixit_episode_catalog_v10", False):
        async def catalog_backed_inspect(tmdb_id: int, season: int, episode: int):
            catalog_ready = await warm_italian_episode_catalog()
            key = (int(tmdb_id), int(season), int(episode))

            if catalog_ready:
                if key in _catalog_keys:
                    out = _final_result(
                        True,
                        "italian",
                        evidence="vixsrc_episode_catalog_it",
                        source_available=True,
                        hints=["it"],
                    )
                    ttl = 24 * 60 * 60.0
                else:
                    out = _final_result(
                        False,
                        "not_in_italian_catalog",
                        evidence="vixsrc_episode_catalog_it",
                        source_available=False,
                    )
                    ttl = 20 * 60.0
            else:
                # Conservative fallback for a temporary catalogue outage.
                raw = await current_inspect(tmdb_id, season, episode)
                out = dict(raw) if isinstance(raw, dict) else {}
                hints = out.get("detected_languages") or []
                explicit_it = _explicit_italian(episode_policy, hints)
                source_available = bool(out.get("source_available"))
                if explicit_it and source_available:
                    out.update(_final_result(
                        True,
                        "italian",
                        evidence="explicit_audio_track_fallback",
                        source_available=True,
                        hints=list(hints),
                    ))
                    ttl = 60 * 60.0
                else:
                    status = "original_only" if any(
                        episode_policy._is_original_only(value) for value in hints
                    ) else "language_unconfirmed"
                    out.update(_final_result(
                        False,
                        status,
                        evidence="explicit_audio_track_fallback",
                        source_available=source_available,
                        hints=list(hints),
                    ))
                    ttl = 60.0

            try:
                episode_policy._cache[key] = (time.monotonic() + ttl, dict(out))
            except Exception:
                pass

            if persistent is not None:
                try:
                    now_dt = datetime.now(timezone.utc)
                    def persist():
                        persistent.update_one(
                            {"tmdbId": key[0], "season": key[1], "episode": key[2]},
                            {"$set": {
                                "tmdbId": key[0],
                                "season": key[1],
                                "episode": key[2],
                                "result": dict(out),
                                "policy": POLICY_VERSION,
                                "checked_at": now_dt.isoformat(),
                                "expires_at": (now_dt + timedelta(seconds=ttl)).isoformat(),
                            }},
                            upsert=True,
                        )
                    await asyncio.to_thread(persist)
                except Exception:
                    pass
            return out

        catalog_backed_inspect._flixit_episode_catalog_v10 = True
        catalog_backed_inspect._original = current_inspect
        episode_policy._inspect_source = catalog_backed_inspect

    try:
        episode_policy._cache.clear()
    except Exception:
        pass

    try:
        if app is not None:
            app.state.flixit_strict_audio_evidence = {
                "installed": True,
                "policy": POLICY_VERSION,
                "mode": "vixsrc_italian_episode_catalog_fail_closed",
                "catalog_url": CATALOG_URL,
                "generic_lang_locale_is_not_audio_evidence": True,
                "frontend_evidence_bit": "italian_audio_evidence_explicit",
                "persistent_final_verdict": True,
            }
    except Exception:
        pass

    _INSTALLED = True
    return True


__all__ = [
    "install_strict_audio_evidence",
    "warm_italian_episode_catalog",
    "italian_episode_catalog_contains",
    "POLICY_VERSION",
    "AVAILABILITY_VERSION",
    "_explicit_italian",
    "_episode_key_from_row",
    "_parse_episode_catalog",
]
