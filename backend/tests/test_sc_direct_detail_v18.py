from __future__ import annotations

import pathlib
import sys

from fastapi import FastAPI

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def run() -> None:
    from services import sc_direct_detail_v18 as direct
    from services import sc_direct_detail_runtime as runtime
    from services import sc_native_catalog_v17 as sc

    assert direct.POLICY_VERSION == "sc-direct-detail-v19-instant"

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
        "__flixit_sc_base": "https://streamingunity.vip",
        "episodes": [
            {
                "id": 1001,
                "number": 1,
                "name": "Uno",
                "duration": 22,
                "images": [{"type": "cover", "filename": "episode-one.webp"}],
            },
            {"id": 1002, "number": 2, "name": "Due", "duration": 23},
        ],
    }
    payload = direct._episodes_payload(65334, 6, loaded)
    assert payload["snapshot_source"] == "streamingcommunity_loadedSeason_direct"
    assert payload["italian_audio_policy_version"] == direct.POLICY_VERSION
    assert [row["episode_number"] for row in payload["episodes"]] == [1, 2]
    assert all(row["sc_available"] is True for row in payload["episodes"])
    assert payload["episodes"][0]["still_path"] == "https://cdn.streamingunity.vip/images/episode-one.webp"
    assert payload["episode_artwork_source"] == "streamingcommunity_episode_images"

    source = pathlib.Path(direct.__file__).read_text(encoding="utf-8")
    assert "/it/search" in source
    assert "sc._get_title" in source
    assert "sc._season_descriptors" in source
    assert "sc._get_season" in source
    assert "streamingcommunity_loadedSeason_direct" in source
    assert "_schedule_all_seasons" in source
    assert "cdn." in source and "/images/" in source

    assert "italian_media_index_v16" not in source
    assert "resolve_stream(" not in source

    frontend = (ROOT.parent / "frontend/src/pages/detail/useEpisodes.ts").read_text(encoding="utf-8")
    assert 'const POLICY = "sc-direct-detail-v19-instant"' in frontend
    assert "sc-episodes-v19" in frontend
    assert "sc-seasons-v19" in frontend
    assert 'image.fetchPriority = index < 8 ? "high" : "auto"' in frontend

    app = FastAPI()
    assert runtime.install_sc_direct_detail_runtime(app, object()) is True
    paths = {getattr(route, "path", "") for route in app.router.routes}
    assert direct.SEASONS_PATH in paths
    assert direct.SEASON_PATH in paths
    assert direct.STATUS_PATH in paths

    second_app = FastAPI()
    assert runtime.install_sc_direct_detail_runtime(second_app, object()) is True
    second_paths = {getattr(route, "path", "") for route in second_app.router.routes}
    assert direct.STATUS_PATH in second_paths

    strict_source = (ROOT / "services/strict_italian_tv.py").read_text(encoding="utf-8")
    assert "install_sc_direct_detail_runtime(app, core.db)" in strict_source

    trailer_policy = (ROOT / "services/trailers/sc_youtube_metadata_policy.py").read_text(encoding="utf-8")
    assert "does NOT turn SC ``youtube_id``" in trailer_policy
    assert "StreamingCommunityTrailerProvider" in trailer_policy
    assert "providers.insert(0, StreamingCommunityTrailerProvider())" in trailer_policy

    print("sc-direct-detail-v19: PASS")


if __name__ == "__main__":
    run()
