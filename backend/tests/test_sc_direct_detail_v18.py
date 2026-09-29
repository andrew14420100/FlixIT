from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def run() -> None:
    from services import sc_direct_detail_v18 as direct
    from services import sc_native_catalog_v17 as sc

    assert direct.POLICY_VERSION == "sc-direct-detail-v18"

    title = {
        "id": 123,
        "type": "tv",
        "tmdb_id": 65334,
        "seasons": [
            {"number": 1, "title_id": 123},
            {"number": 6, "title_id": 123},
        ],
    }
    seasons = sc._season_descriptors(title)
    assert [row["season_number"] for row in seasons] == [1, 6]

    loaded = {
        "number": 6,
        "episodes": [
            {"id": 1001, "number": 1, "name": "Uno", "duration": 22},
            {"id": 1002, "number": 2, "name": "Due", "duration": 23},
        ],
    }
    payload = direct._episodes_payload(65334, 6, loaded)
    assert payload["snapshot_source"] == "streamingcommunity_loadedSeason_direct"
    assert payload["italian_audio_policy_version"] == direct.POLICY_VERSION
    assert [row["episode_number"] for row in payload["episodes"]] == [1, 2]
    assert all(row["sc_available"] is True for row in payload["episodes"])

    source = pathlib.Path(direct.__file__).read_text(encoding="utf-8")
    # Exact public SC flow used by open-source clients.
    assert "/it/search" in source
    assert "sc._get_title" in source
    assert "sc._season_descriptors" in source
    assert "sc._get_season" in source
    assert "streamingcommunity_loadedSeason_direct" in source

    # Detail catalogue membership must not fall back to the old v16 provider index.
    assert "italian_media_index_v16" not in source
    assert "resolve_stream(" not in source

    frontend = (ROOT.parent / "frontend/src/pages/detail/useEpisodes.ts").read_text(encoding="utf-8")
    assert 'const POLICY = "sc-direct-detail-v18"' in frontend
    assert "sc-episodes-v18" in frontend
    assert "sc-seasons-v18" in frontend

    print("sc-direct-detail-v18: PASS")


if __name__ == "__main__":
    run()
