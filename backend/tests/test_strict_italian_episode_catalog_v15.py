"""Regression checks for v15 strict Italian TV episode visibility."""
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
    v15 = load(
        "strict_italian_episode_catalog_v15_test",
        SERVICES / "strict_italian_episode_catalog_v15.py",
    )

    check(
        v15.POLICY_VERSION == "strict-it-v15-season-catalog-plus-explicit-audio",
        "wrong v15 policy",
    )

    # A plain lang=it API success was the v14 false-positive path. It must never
    # be accepted as proof of Italian audio in v15.
    plain_lang_it = {
        "italian_available": True,
        "italian_audio_status": "italian",
        "italian_audio_evidence_source": "vixsrc_episode_api_lang_it",
    }
    check(
        v15._trusted_cached_result(plain_lang_it) is None,
        "lang=it preference is still treated as Italian-audio proof",
    )

    hls_it = {
        "italian_available": True,
        "italian_audio_status": "italian",
        "italian_audio_evidence_source": "hls_audio_language",
    }
    trusted = v15._trusted_cached_result(hls_it)
    check(trusted is not None, "explicit Italian HLS audio was rejected")
    check(
        trusted.get("italian_audio_policy_version") == v15.POLICY_VERSION,
        "trusted result was not upgraded to v15",
    )

    english = {
        "italian_available": False,
        "italian_audio_status": "english_or_original_audio",
        "italian_audio_evidence_source": "hls_audio_language",
    }
    check(
        v15._trusted_cached_result(english) is not None,
        "explicit English/original negative was lost",
    )

    source = (SERVICES / "strict_italian_episode_catalog_v15.py").read_text(encoding="utf-8")
    check("number not in allowed" in source, "catalog non-members are not hidden")
    check("if not allowed:" in source, "unrepresented season safeguard missing")
    check("CATALOG_FALLBACK_MAX_AGE = timedelta(days=7)" in source, "persisted catalogue fallback missing")
    check("install_paged_episode_catalog(catalog_policy)" in source, "complete paged catalogue loader missing")

    startup = STARTUP.read_text(encoding="utf-8")
    check("install_strict_italian_episode_catalog_v15" in startup, "v15 route not installed")
    check("await ensure_catalog_warm(force=False)" in startup, "startup catalogue warm missing")

    use_episodes = (FRONTEND / "pages" / "detail" / "useEpisodes.ts").read_text(encoding="utf-8")
    check('flixit:it-episodes-v15:' in use_episodes, "frontend still uses old episode cache")
    check("!isAuthoritativeSeason(value)" in use_episodes, "provisional season can still be cached")
    check("data?.catalog_pending === true" in use_episodes, "frontend does not poll while catalogue is pending")

    runtime = (FRONTEND / "runtimeIntegrityBootstrap.ts").read_text(encoding="utf-8")
    check('EPISODE_SCHEMA = "15"' in runtime, "v14 browser cache is not invalidated")
    check('"flixit:it-episodes-v14:"' in runtime, "v14 cache prefix is not purged")

    print("strict-italian-episode-catalog-v15: PASS")


if __name__ == "__main__":
    run()
