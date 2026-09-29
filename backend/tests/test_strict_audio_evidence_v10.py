"""Standalone regression checks for the v10 Italian episode policy."""
import importlib.util
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


SERVICES = Path(__file__).resolve().parents[1] / "services"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


policy = load_module("strict_audio_evidence_v10_test", SERVICES / "strict_audio_evidence.py")
vix_audio = load_module("vixsrc_italian_audio_test", SERVICES / "vixsrc_italian_audio.py")


class FakeEpisodePolicy:
    @staticmethod
    def _normal(value):
        return str(value or "").strip().lower().replace("_", "-")

    @staticmethod
    def _is_italian(value):
        return FakeEpisodePolicy._normal(value) in {
            "it", "ita", "it-it", "italian", "italiano", "italiana"
        }

    @staticmethod
    def _is_original_only(value):
        return FakeEpisodePolicy._normal(value) in {
            "en", "eng", "en-us", "en-gb", "english", "original", "originale"
        }


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def run():
    check(policy.POLICY_VERSION == "strict-it-v10-vixsrc-episode-catalog", "wrong v10 policy")

    direct = policy._episode_key_from_row({
        "tmdb_id": 65334,
        "season": 6,
        "episode": 18,
    })
    check(direct == (65334, 6, 18), f"direct row not parsed: {direct!r}")

    aliased = policy._episode_key_from_row({
        "tmdbId": "65334",
        "season_number": "6",
        "episode_number": "19",
    })
    check(aliased == (65334, 6, 19), f"aliased row not parsed: {aliased!r}")

    nested = policy._episode_key_from_row({
        "data": {"tmdb_id": 65334, "seasonNumber": 6, "episodeNumber": 20}
    })
    check(nested == (65334, 6, 20), f"nested row not parsed: {nested!r}")

    composite = policy._episode_key_from_row({"media_key": "tv:65334:6:21"})
    check(composite == (65334, 6, 21), f"composite row not parsed: {composite!r}")

    parsed = policy._parse_episode_catalog({
        "episodes": [
            {"tmdb_id": 65334, "season": 6, "episode": 1},
            {"tmdb_id": 65334, "season": 6, "episode": 2},
        ]
    })
    check((65334, 6, 1) in parsed and (65334, 6, 2) in parsed, "catalog rows missing")

    # A generic UI locale must still not qualify as audio-track evidence in the
    # network-outage fallback path.
    hints = policy._strict_language_hints_factory(FakeEpisodePolicy)({
        "lang": "it",
        "locale": "it-IT",
        "src": "https://player.invalid/embed/123?lang=it",
    })
    check(hints == [], f"generic locale leaked into audio evidence: {hints!r}")

    hints = policy._strict_language_hints_factory(FakeEpisodePolicy)({
        "tracks": [{"type": "audio", "language": "it"}]
    })
    check(policy._explicit_italian(FakeEpisodePolicy, hints), "explicit Italian audio rejected")

    # Direct HLS playback must carry the same Italian preference that the VixSrc
    # iframe documents for its audio selector, replacing any old preference.
    forced = vix_audio._with_italian_lang("https://cdn.invalid/master.m3u8?token=x&lang=en")
    query = parse_qs(urlsplit(forced).query)
    check(query.get("lang") == ["it"], f"player language not forced to Italian: {forced}")
    check(query.get("token") == ["x"], "existing playlist query was lost")

    print("strict-audio-evidence-v10: PASS")


def test_policy_smoke():
    run()


if __name__ == "__main__":
    run()
