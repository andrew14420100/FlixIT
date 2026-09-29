"""Regression checks for the v16 pre-indexed Italian media architecture."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
SERVICES = BACKEND / "services"
FRONTEND = ROOT / "frontend" / "src"
STARTUP = BACKEND / "sitecustomize.py"

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def run():
    v16 = load("italian_media_index_v16_test", SERVICES / "italian_media_index_v16.py")
    check(v16.POLICY_VERSION == "italian-media-index-v16", "wrong v16 policy")

    movie = v16._movie_id_from_row({"tmdb_id": 786892})
    check(movie == 786892, "movie catalogue parser lost TMDB id")

    episode = v16._episode_key_from_row({
        "tmdb_id": 65334,
        "s": 6,
        "e": 18,
    })
    check(episode == (65334, 6, 18), "episode catalogue parser lost series/season/episode")

    nested_episode = v16._episode_key_from_row({
        "data": {"tmdbId": 65334, "season_number": 6, "episode_number": 17}
    })
    check(nested_episode == (65334, 6, 17), "nested episode catalogue parser failed")

    for number in (19, 20, 21):
        check((65334, 6, number) in v16._HARD_NEGATIVE_EPISODES, f"Miraculous S6E{number} negative missing")

    source = (SERVICES / "italian_media_index_v16.py").read_text(encoding="utf-8")
    route_start = source.index("async def indexed_italian_season")
    route_end = source.index("@router.get(STATUS_PATH)", route_start)
    route_body = source[route_start:route_end]
    check("_episode_payload" in route_body, "season route does not read the index snapshot")
    check("_fetch_complete_catalog" not in route_body, "season route still calls provider catalogue")
    check("httpx" not in route_body, "season route still performs network validation")
    check("request_time_provider_checks\": False" in source, "v16 does not declare request-time provider checks disabled")
    check("Atomic pointer swap" in source, "index refresh is not generation-swapped atomically")
    check("/api/list/{kind}/" in source, "background catalogue loader missing")
    check("indexed_resolve" in source and "episode_allowed" in source and "movie_allowed" in source, "player is not index-gated")

    startup = STARTUP.read_text(encoding="utf-8")
    check("install_italian_media_index_v16" in startup, "v16 index is not installed")
    check("install_strict_italian_media" not in startup, "old request-time movie verifier is still installed")
    check("install_strict_italian_episode_catalog_v15" not in startup, "v15 request-time season route is still installed")

    use_episodes = (FRONTEND / "pages" / "detail" / "useEpisodes.ts").read_text(encoding="utf-8")
    check('flixit:it-episodes-v16:' in use_episodes, "frontend still uses pre-v16 episode cache")
    check("isIndexedSnapshot" in use_episodes, "frontend does not require final v16 snapshots")
    check("refetchInterval:" not in use_episodes, "frontend still polls language/provider state")
    check("checkingItalian: false" in use_episodes, "frontend still exposes request-time Italian checking")

    runtime = (FRONTEND / "runtimeIntegrityBootstrap.ts").read_text(encoding="utf-8")
    check('EPISODE_SCHEMA = "16"' in runtime, "pre-v16 browser cache is not invalidated")
    check('"flixit:it-episodes-v15:"' in runtime, "v15 cache prefix is not purged")

    print("italian-media-index-v16: PASS")


if __name__ == "__main__":
    run()
