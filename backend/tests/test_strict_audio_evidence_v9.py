"""Standalone smoke test for the v9 Italian-audio evidence policy.

This file deliberately uses only the Python standard library so the CI quality
gate can validate the critical fail-closed rule without importing the full
backend or installing a test framework.
"""
import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "services" / "strict_audio_evidence.py"
spec = importlib.util.spec_from_file_location("strict_audio_evidence_v9_test", MODULE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load policy module: {MODULE_PATH}")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class FakeEpisodePolicy:
    @staticmethod
    def _normal(value):
        return str(value or "").strip().lower().replace("_", "-")

    @staticmethod
    def _is_italian(value):
        text = FakeEpisodePolicy._normal(value)
        return text in {"it", "ita", "it-it", "italian", "italiano", "italiana"}

    @staticmethod
    def _is_original_only(value):
        text = FakeEpisodePolicy._normal(value)
        return text in {"en", "eng", "en-us", "en-gb", "english", "original", "originale"}


def hints(payload):
    return policy._strict_language_hints_factory(FakeEpisodePolicy)(payload)


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def run():
    generic = {
        "lang": "it",
        "locale": "it-IT",
        "url": "https://player.invalid/embed/123?lang=it&locale=it-IT",
        "data": {"language": "it"},
    }
    detected = hints(generic)
    check(detected == [], f"generic locale leaked into audio evidence: {detected!r}")

    detected = hints({"tracks": [{"type": "audio", "language": "it"}]})
    check("it" in detected, f"explicit audio track was not detected: {detected!r}")
    check(policy._explicit_italian(FakeEpisodePolicy, detected) is True, "Italian audio track rejected")

    detected = hints({"audio_language": "it-IT"})
    check("it-IT" in detected, f"audio_language was not detected: {detected!r}")
    check(policy._explicit_italian(FakeEpisodePolicy, detected) is True, "audio_language=it-IT rejected")

    detected = hints({"audio": {"language": "en", "label": "English"}})
    check(policy._explicit_italian(FakeEpisodePolicy, detected) is False, "English audio accepted as Italian")

    check(policy._explicit_italian(FakeEpisodePolicy, []) is False, "missing audio evidence did not fail closed")

    mixed = hints({"audio": {"language": "it", "alternate": "en"}})
    check(policy._explicit_italian(FakeEpisodePolicy, mixed) is False, f"mixed/ambiguous audio incorrectly accepted: {mixed!r}")

    print("strict-audio-evidence-v9: PASS")


# pytest can still collect this if desired, but CI executes the deterministic
# standalone path below.
def test_policy_smoke():
    run()


if __name__ == "__main__":
    run()
