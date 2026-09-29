import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "services" / "strict_audio_evidence.py"
spec = importlib.util.spec_from_file_location("strict_audio_evidence_v9_test", MODULE_PATH)
policy = importlib.util.module_from_spec(spec)
assert spec and spec.loader
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


def test_generic_request_locale_is_not_audio_evidence():
    payload = {
        "lang": "it",
        "locale": "it-IT",
        "url": "https://player.invalid/embed/123?lang=it&locale=it-IT",
        "data": {"language": "it"},
    }
    assert hints(payload) == []


def test_explicit_audio_track_italian_is_accepted():
    detected = hints({"tracks": [{"type": "audio", "language": "it"}]})
    assert "it" in detected
    assert policy._explicit_italian(FakeEpisodePolicy, detected) is True


def test_explicit_audio_language_field_is_accepted():
    detected = hints({"audio_language": "it-IT"})
    assert "it-IT" in detected
    assert policy._explicit_italian(FakeEpisodePolicy, detected) is True


def test_original_audio_is_not_italian():
    detected = hints({"audio": {"language": "en", "label": "English"}})
    assert policy._explicit_italian(FakeEpisodePolicy, detected) is False


def test_missing_audio_evidence_fails_closed():
    assert policy._explicit_italian(FakeEpisodePolicy, []) is False
