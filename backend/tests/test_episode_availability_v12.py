"""Regression checks for v14 metadata-first Italian episode visibility."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVICES = ROOT / "backend" / "services"
FRONTEND = ROOT / "frontend" / "src"


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
    policy = load("episode_availability_v14_test", SERVICES / "episode_availability_v12.py")
    vix = load("vixsrc_v14_test", SERVICES / "vixsrc.py")

    check(policy.POLICY_VERSION == "strict-it-v14-visible-while-validating", "wrong v14 policy")

    it_manifest = '''#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="it",NAME="Italiano",DEFAULT=YES\n'''
    en_manifest = '''#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",DEFAULT=YES\n'''
    muxed_manifest = '''#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000\nvideo.m3u8\n'''

    check(policy._audio_tag_verdict(it_manifest) is True, "Italian HLS audio rejected")
    check(policy._audio_tag_verdict(en_manifest) is False, "English-only HLS audio accepted")
    check(policy._audio_tag_verdict(muxed_manifest) is None, "Muxed audio should remain unknown")

    check(policy._payload_language_verdict({"src": "https://x/embed?lang=it"}) is None, "lang=it candidate rejected")
    check(policy._payload_language_verdict({"src": "https://x/embed?lang=en"}) is False, "explicit English candidate accepted")

    forced = vix._with_lang_it("https://example.invalid/embed?token=x&lang=en")
    check("lang=it" in forced, f"Italian language not forced: {forced}")
    check("lang=en" not in forced, f"Old language survived: {forced}")
    check("token=x" in forced, "Existing token lost")

    for episode in (19, 20, 21):
        check((65334, 6, episode) in policy._BOOTSTRAP_NEGATIVE_OVERRIDES, f"S6E{episode} override missing")

    # Unknown/transient states must remain visible. Only real negative evidence may
    # remove an episode from a season.
    check(policy._is_definitive_negative(None) is False, "missing verdict hides episode")
    check(policy._is_definitive_negative({
        "italian_available": False,
        "italian_audio_status": "provider_unavailable",
    }) is False, "provider outage hides episode")
    check(policy._is_definitive_negative({
        "italian_available": False,
        "italian_audio_status": "language_unconfirmed",
    }) is False, "unconfirmed language hides episode")
    check(policy._is_definitive_negative({
        "italian_available": False,
        "italian_audio_status": "english_or_original_audio",
    }) is True, "explicit English/original verdict is not hidden")
    check(policy._is_definitive_negative({
        "italian_available": False,
        "italian_audio_status": "user_confirmed_original_audio",
    }) is True, "manual negative is not hidden")

    source = (SERVICES / "episode_availability_v12.py").read_text(encoding="utf-8")
    check("_background_tasks" in source and "_season_tasks" in source, "background tasks are not retained")
    check("_start_season_warm(db, tmdb_id, season_number, missing)" in source, "background season validation missing")
    check("Never wait for the provider in the user's request path" in source, "route may block on provider validation")
    check("provider_unavailable" not in policy._DEFINITIVE_NEGATIVE_STATUSES, "provider outage became a definitive negative")

    use_episodes = (FRONTEND / "pages" / "detail" / "useEpisodes.ts").read_text(encoding="utf-8")
    check('flixit:it-episodes-v14:' in use_episodes, "frontend still uses an old episode cache namespace")
    check("episode?.italian_available !== false" in use_episodes, "frontend still requires positive verification before rendering")
    check("episode?.italian_available === true" not in use_episodes, "positive-only frontend filter survived")

    runtime = (FRONTEND / "runtimeIntegrityBootstrap.ts").read_text(encoding="utf-8")
    check('EPISODE_SCHEMA = "14"' in runtime, "runtime did not invalidate v13 episode cache")
    check("confirmedItalianEpisode" not in runtime, "runtime still filters season rows to positive-only verdicts")
    check("TV-season responses pass through unchanged" in runtime, "backend is not authoritative for season visibility")

    print("episode-availability-v14: PASS")


if __name__ == "__main__":
    run()
