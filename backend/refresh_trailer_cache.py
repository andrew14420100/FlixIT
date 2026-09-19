"""Refresh cached FLIX-IT trailer resolutions with the current selection policy.

This preserves manual trailer selections. Automatic cached titles are resolved
again so old short autoplay-preview candidates do not remain selected after the
full-trailer ranking update.

Run from /app/backend:
    /root/.venv/bin/python refresh_trailer_cache.py

Test a small batch first:
    /root/.venv/bin/python refresh_trailer_cache.py --limit 10
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter

import server


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh cached trailer resolutions")
    parser.add_argument("--limit", type=int, default=0, help="Maximum titles; 0 = all cached titles")
    parser.add_argument("--delay", type=float, default=0.1, help="Delay between titles in seconds")
    return parser.parse_args()


async def run(limit: int, delay: float) -> int:
    resolver = getattr(server.app.state, "trailer_resolver", None)
    if resolver is None:
        print("ERROR: trailer resolver non inizializzato")
        return 2

    query = {"tmdbId": {"$exists": True}, "type": {"$in": ["movie", "tv"]}}
    projection = {"_id": 0, "type": 1, "tmdbId": 1, "title": 1, "manual": 1}
    cursor = resolver.results.find(query, projection).sort([("type", 1), ("tmdbId", 1)])
    if limit > 0:
        cursor = cursor.limit(limit)
    docs = list(cursor)

    print("cached_titles:", len(docs))
    stats: Counter[str] = Counter()

    for index, doc in enumerate(docs, start=1):
        media_type = "tv" if doc.get("type") == "tv" else "movie"
        tmdb_id = int(doc.get("tmdbId"))
        title = str(doc.get("title") or "")

        if ((doc.get("manual") or {}).get("enabled")):
            stats["manual_preserved"] += 1
            print(f"[{index}/{len(docs)}] {media_type}:{tmdb_id} SKIP manual {title}")
            continue

        try:
            refreshed = await resolver.resolve(media_type, tmdb_id, force=True)
            selected = refreshed.get("selected") or {}
            duration = selected.get("duration_seconds")
            source = selected.get("source") or "none"
            trailer_type = selected.get("trailer_type") or "none"
            height = selected.get("height") or selected.get("resolution") or 0
            if selected:
                stats["refreshed"] += 1
            else:
                stats["unavailable"] += 1
            print(
                f"[{index}/{len(docs)}] {media_type}:{tmdb_id} "
                f"source={source} type={trailer_type} height={height} duration={duration} {title}"
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
