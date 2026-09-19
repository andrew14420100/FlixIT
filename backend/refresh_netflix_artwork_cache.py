"""Refresh the existing FLIX-IT Netflix artwork cache in place.

This utility does not add an artwork provider and does not touch playback. It
re-runs the current strict Netflix artwork matcher for entries already present in
``netflix_artwork_matches`` and refreshes their native artwork/logo variants.

Run from /app/backend:
    /root/.venv/bin/python refresh_netflix_artwork_cache.py

Use --limit while testing, for example:
    /root/.venv/bin/python refresh_netflix_artwork_cache.py --limit 20
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter

import server


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh cached Netflix artwork matches")
    parser.add_argument("--limit", type=int, default=0, help="Maximum entries to refresh; 0 = all")
    parser.add_argument(
        "--delay",
        type=float,
        default=0.15,
        help="Delay in seconds between Netflix requests (default: 0.15)",
    )
    return parser.parse_args()


async def run(limit: int, delay: float) -> int:
    resolver = server._player.artwork_resolver
    if resolver is None:
        print("ERROR: Netflix artwork resolver non inizializzato")
        return 2

    cfg = resolver.config()
    print("enabled:", cfg.get("enabled"))
    print("region:", cfg.get("region"))
    print("cookie_configured:", cfg.get("cookie_configured"))
    print("cookie_source:", cfg.get("cookie_source"))

    if not cfg.get("cookie_configured"):
        print("ERROR: sessione Netflix non configurata; nessun refresh eseguito")
        return 2

    query = {
        "tmdbId": {"$exists": True},
        "type": {"$in": ["movie", "tv"]},
    }
    projection = {
        "_id": 0,
        "type": 1,
        "tmdbId": 1,
        "status": 1,
        "reason": 1,
        "netflix_id": 1,
    }
    cursor = resolver.matches.find(query, projection).sort([("type", 1), ("tmdbId", 1)])
    if limit > 0:
        cursor = cursor.limit(limit)
    docs = list(cursor)

    print(f"cached_entries: {len(docs)}")
    if not docs:
        print("Nessuna entry Netflix artwork già cacheata da aggiornare.")
        return 0

    stats: Counter[str] = Counter()

    for index, doc in enumerate(docs, start=1):
        media_type = "tv" if doc.get("type") == "tv" else "movie"
        try:
            tmdb_id = int(doc.get("tmdbId"))
        except Exception:
            stats["invalid_id"] += 1
            continue

        # Respect explicit/admin blocks. Every other cached state is re-evaluated
        # with the current matching/artwork policy.
        if doc.get("status") == "not_netflix" and doc.get("reason") == "admin_blocked":
            stats["admin_blocked"] += 1
            print(f"[{index}/{len(docs)}] {media_type}:{tmdb_id} SKIP admin_blocked")
            continue

        try:
            updated = await resolver.auto_match(media_type, tmdb_id, force=True)
            status = str(updated.get("status") or "unknown")
            reason = str(updated.get("reason") or "")
            assets = len(updated.get("assets") or [])
            stats[status] += 1
            if status in {"matched", "manual"}:
                stats["with_assets" if assets else "without_assets"] += 1
            print(
                f"[{index}/{len(docs)}] {media_type}:{tmdb_id} "
                f"status={status} assets={assets} reason={reason}"
            )
        except Exception as exc:
            stats["error"] += 1
            print(f"[{index}/{len(docs)}] {media_type}:{tmdb_id} ERROR {exc}")

        if delay > 0:
            await asyncio.sleep(delay)

    print("\n=== SUMMARY ===")
    for key in sorted(stats):
        print(f"{key}: {stats[key]}")
    return 0 if not stats.get("error") else 1


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(asyncio.run(run(max(0, args.limit), max(0.0, args.delay))))
