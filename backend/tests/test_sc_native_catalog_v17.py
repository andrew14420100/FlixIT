"""Regression tests for the StreamingCommunity-native v17 catalogue."""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))


def check(value, message):
    if not value:
        raise AssertionError(message)


def inertia_document(props: dict) -> str:
    raw = json.dumps({"component": "Titles/Show", "props": props}, separators=(",", ":"))
    return f'<div id="app" data-page="{html.escape(raw, quote=True)}"></div>'


def run():
    from services import sc_native_catalog_v17 as sc

    title_doc = inertia_document({
        "title": {
            "id": 991,
            "name": "Miraculous - Le storie di Ladybug e Chat Noir",
            "tmdb_id": 65334,
            # Intentionally omit `type`: public SC clients determine TV-ness
            # from seasons/preview metadata, so the v17 safety layer must cope.
            "seasons_count": 6,
            "seasons": [
                {"number": 1, "title_id": 991},
                {"number": 6, "title_id": 991},
            ],
        }
    })
    title = sc._title_from_document(title_doc)
    check(title.get("tmdb_id") == 65334, "exact SC tmdb_id was not parsed")
    seasons = sc._season_descriptors(title)
    check([row["season_number"] for row in seasons] == [1, 6], "SC seasons were not preserved")

    season_doc = inertia_document({
        "loadedSeason": {
            "episodes": [
                {"id": 1001, "number": 1, "name": "Episodio 1", "duration": 22},
                {"id": 1018, "number": 18, "name": "Episodio 18", "duration": 22},
                # 19, 20, 21 are deliberately absent: SC membership, not a
                # hard-coded language exception, must decide their visibility.
                {"id": 1022, "number": 22, "name": "Episodio 22", "duration": 22},
            ]
        }
    })
    loaded = sc._loaded_season_from_document(season_doc)
    episodes = sc._episodes_from_loaded(loaded, 6)
    numbers = [row["episode_number"] for row in episodes]
    check(numbers == [1, 18, 22], f"loadedSeason episodes mismatch: {numbers}")
    check(19 not in numbers and 20 not in numbers and 21 not in numbers, "episodes absent from SC leaked back in")

    source = (BACKEND / "services" / "sc_native_catalog_v17.py").read_text(encoding="utf-8")
    sitecustomize = (BACKEND / "sitecustomize.py").read_text(encoding="utf-8")
    frontend = (ROOT / "frontend" / "src" / "pages" / "detail" / "useEpisodes.ts").read_text(encoding="utf-8")
    safety = (BACKEND / "services" / "sc_native_catalog_v17_safety.py").read_text(encoding="utf-8")

    check('/api/list/' not in source and 'VIXSRC_BASE' not in source, "v17 still derives catalogue membership from VixSrc")
    check('props.loadedSeason.episodes' in source, "v17 no longer documents SC loadedSeason as episode authority")
    check('props.title.seasons' in source, "v17 no longer documents SC seasons as authority")
    check('request_time_provider_checks": False' in source, "request-time provider checks reappeared")

    handler = source.split("async def sc_tv_episodes", 1)[1].split("async def status_payload", 1)[0]
    check("_get_title" not in handler and "httpx" not in handler and "client.get" not in handler,
          "season request path performs upstream work")

    check("install_sc_native_catalog_v17" in sitecustomize, "v17 is not installed")
    check("install_italian_media_index_v16_fastboot" not in sitecustomize,
          "old v16 VixSrc catalogue is still registered as authority")
    check('POLICY = "sc-native-catalog-v17"' in frontend, "frontend does not require SC v17 snapshots")
    check("flixit:it-episodes-v16:" not in frontend, "old v16 episode cache can leak into v17")
    check("flixit:sc-seasons-v17:" in frontend, "SC season cache is not versioned")
    check('title = {**title, "type": "tv"}' in safety, "TV inference safety is missing")
    check("indexed_count < minimum" in safety, "failed SC crawl can still become authoritative")

    print("sc-native-catalog-v17: PASS")


if __name__ == "__main__":
    run()
