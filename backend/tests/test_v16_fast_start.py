"""Regression checks: the persistent Italian index must never block app startup."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
SERVICES = BACKEND / "services"


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def run():
    startup = (BACKEND / "sitecustomize.py").read_text(encoding="utf-8")
    wrapper = (SERVICES / "italian_media_index_v16_fastboot.py").read_text(encoding="utf-8")

    check(
        "install_italian_media_index_v16_fastboot" in startup,
        "sitecustomize does not use the non-blocking v16 installer",
    )
    check(
        "from services.italian_media_index_v16 import install_italian_media_index_v16" not in startup,
        "blocking v16 installer is still imported directly during service registration",
    )
    check(
        "base.hydrate_index = lambda _db: None" in wrapper,
        "fastboot wrapper no longer removes synchronous Mongo hydration",
    )
    check(
        "await asyncio.to_thread(original_hydrate, db)" in wrapper,
        "persisted index is not hydrated in a background thread",
    )
    check(
        "_keep(asyncio.create_task(hydrate_after_startup()))" in wrapper,
        "background hydration task is not strongly retained",
    )
    check(
        'if not getattr(base, "_movie_ready", False):' in wrapper,
        "Home can be filtered to zero movies during cold start",
    )
    check(
        'if not getattr(base, "_episode_ready", False):' in wrapper,
        "Home can be filtered to zero TV titles during cold start",
    )

    print("v16-fast-start: PASS")


if __name__ == "__main__":
    run()
