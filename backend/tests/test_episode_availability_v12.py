"""Regression checks for v12 per-episode Italian playback policy."""
import importlib.util
from pathlib import Path

SERVICES = Path(__file__).resolve().parents[1] / "services"


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
    v12 = load("episode_availability_v12_test", SERVICES / "episode_availability_v12.py")
    vix = load("vixsrc_v12_test", SERVICES / "vixsrc.py")

    check(v12.POLICY_VERSION == "strict-it-v12-direct-episode-lang-it", "wrong v12 policy")

    it_manifest = '''#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="it",NAME="Italiano",DEFAULT=YES\n'''
    en_manifest = '''#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",DEFAULT=YES\n'''
    muxed_manifest = '''#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000\nvideo.m3u8\n'''

    check(v12._audio_tag_verdict(it_manifest) is True, "Italian HLS audio rejected")
    check(v12._audio_tag_verdict(en_manifest) is False, "English-only HLS audio accepted")
    check(v12._audio_tag_verdict(muxed_manifest) is None, "Muxed audio should be unknown, not rejected")

    forced = vix._with_lang_it("https://example.invalid/embed?token=x&lang=en")
    check("lang=it" in forced, f"Italian language not forced: {forced}")
    check("lang=en" not in forced, f"Old language survived: {forced}")
    check("token=x" in forced, "Existing token lost")

    # Explicit user-confirmed examples from Miraculous must remain excluded even
    # if the provider's generic endpoint temporarily returns a source.
    for episode in (19, 20, 21):
        check((65334, 6, episode) in v12._BOOTSTRAP_NEGATIVE_OVERRIDES, f"S6E{episode} override missing")

    print("episode-availability-v12: PASS")


if __name__ == "__main__":
    run()
