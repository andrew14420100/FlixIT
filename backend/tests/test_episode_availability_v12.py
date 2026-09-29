"""Regression checks for v13 fast per-episode Italian playback policy."""
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
    policy = load("episode_availability_v13_test", SERVICES / "episode_availability_v12.py")
    vix = load("vixsrc_v13_test", SERVICES / "vixsrc.py")

    check(policy.POLICY_VERSION == "strict-it-v13-fast-episode-lang-it", "wrong v13 policy")

    it_manifest = '''#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="it",NAME="Italiano",DEFAULT=YES\n'''
    en_manifest = '''#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",DEFAULT=YES\n'''
    muxed_manifest = '''#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000\nvideo.m3u8\n'''

    check(policy._audio_tag_verdict(it_manifest) is True, "Italian HLS audio rejected")
    check(policy._audio_tag_verdict(en_manifest) is False, "English-only HLS audio accepted")
    check(policy._audio_tag_verdict(muxed_manifest) is None, "Muxed audio should be unknown, not rejected")

    check(policy._payload_language_verdict({"src": "https://x/embed?lang=it"}) is None, "lang=it candidate rejected")
    check(policy._payload_language_verdict({"src": "https://x/embed?lang=en"}) is False, "explicit English candidate accepted")

    forced = vix._with_lang_it("https://example.invalid/embed?token=x&lang=en")
    check("lang=it" in forced, f"Italian language not forced: {forced}")
    check("lang=en" not in forced, f"Old language survived: {forced}")
    check("token=x" in forced, "Existing token lost")

    for episode in (19, 20, 21):
        check((65334, 6, episode) in policy._BOOTSTRAP_NEGATIVE_OVERRIDES, f"S6E{episode} override missing")

    source = (SERVICES / "episode_availability_v12.py").read_text(encoding="utf-8")
    check("_background_tasks" in source and "_season_tasks" in source, "background tasks are not strongly retained")
    check("await asyncio.wait({warm_task}" in source, "season warm-up must not be cancelled by a request timeout")
    check("vixsrc_episode_api_lang_it" in source, "fast lang=it API evidence missing")

    use_episodes = (FRONTEND / "pages" / "detail" / "useEpisodes.ts").read_text(encoding="utf-8")
    check('flixit:it-episodes-v13:' in use_episodes, "frontend still uses an old episode cache namespace")
    check("if (!hasVerifiedEpisodes(value))" in use_episodes, "empty season responses can still be persisted")

    runtime = (FRONTEND / "runtimeIntegrityBootstrap.ts").read_text(encoding="utf-8")
    check('EPISODE_SCHEMA = "13"' in runtime, "runtime did not invalidate v12 episode cache")
    check('strict-it-v13-fast-episode-lang-it' in runtime, "runtime policy does not match backend v13")

    print("episode-availability-v13: PASS")


if __name__ == "__main__":
    run()
