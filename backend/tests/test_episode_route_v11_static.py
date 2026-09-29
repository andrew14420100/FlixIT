"""Static regression guard for the v11 direct Italian episode route.

Uses only stdlib so GitHub Actions can run it without installing backend deps.
"""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROUTE = ROOT / "services" / "direct_italian_episode_route_v11.py"
STARTUP = ROOT / "sitecustomize.py"


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def run():
    route = ROUTE.read_text(encoding="utf-8")
    startup = STARTUP.read_text(encoding="utf-8")

    check(
        'POLICY_VERSION = "strict-it-v11-direct-vixsrc-episode-catalog"' in route,
        "v11 route policy missing",
    )
    check(
        "EMPTY_RETRY_AFTER = timedelta(seconds=20)" in route,
        "empty snapshots must not remain fresh for long",
    )
    check(
        "strict_audio._catalog_keys" in route,
        "route is no longer driven by the Italian episode catalogue",
    )
    check(
        '"italian_audio_evidence_explicit": True' in route,
        "frontend evidence bit missing",
    )
    check(
        '"vixsrc_available": True' in route,
        "verified episodes are not marked playable",
    )
    check(
        'instant_snapshots.Number = int' in startup,
        "legacy Python Number(...) runtime guard missing",
    )

    direct_pos = startup.find("install_direct_italian_episode_route")
    prewarm_pos = startup.find("launch_episode_prewarm")
    check(direct_pos >= 0 and prewarm_pos > direct_pos, "v11 route must install before episode prewarm")

    print("episode-route-v11-static: PASS")


def test_route_static_regressions():
    run()


if __name__ == "__main__":
    run()
