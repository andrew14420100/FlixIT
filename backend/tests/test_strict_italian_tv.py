from services import strict_italian_tv as policy


class _EpisodePolicy:
    POLICY_VERSION = policy.STRICT_EPISODE_POLICY_VERSION

    @staticmethod
    def _is_italian(value):
        text = str(value or "").strip().lower().replace("_", "-")
        return text in {"it", "ita", "it-it", "italian", "italiano"}


def test_unconfirmed_positive_is_hidden():
    result = policy._strict_episode_result(
        _EpisodePolicy,
        {
            "italian_available": True,
            "italian_audio_status": "italian",
            "source_available": True,
            "detected_languages": [],
        },
    )
    assert result["italian_available"] is False
    assert result["italian_audio_status"] == "language_unconfirmed"


def test_english_positive_is_hidden():
    result = policy._strict_episode_result(
        _EpisodePolicy,
        {
            "italian_available": True,
            "italian_audio_status": "italian",
            "source_available": True,
            "detected_languages": ["en", "english"],
        },
    )
    assert result["italian_available"] is False
    assert result["italian_audio_status"] == "language_unconfirmed"


def test_explicit_italian_stays_visible():
    result = policy._strict_episode_result(
        _EpisodePolicy,
        {
            "italian_available": True,
            "italian_audio_status": "italian",
            "source_available": True,
            "detected_languages": ["it-IT"],
        },
    )
    assert result["italian_available"] is True
    assert result["italian_audio_status"] == "italian"
    assert result["italian_audio_policy_version"] == policy.STRICT_EPISODE_POLICY_VERSION
