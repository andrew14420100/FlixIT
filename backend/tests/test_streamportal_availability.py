from __future__ import annotations

import pytest

from services.streamportal_availability import (
    POLICY_VERSION,
    VixSrcAvailabilityVerifier,
    _api_url,
    _public_url,
)


class _Collection:
    def __init__(self):
        self.docs = {}

    def create_index(self, *args, **kwargs):
        return None

    def find_one(self, query, projection=None):
        key = tuple(sorted(query.items()))
        return self.docs.get(key)

    def update_one(self, query, update, upsert=False):
        key = tuple(sorted(query.items()))
        current = dict(self.docs.get(key) or {})
        current.update((update or {}).get("$set") or {})
        self.docs[key] = current
        return None

    def find(self, *args, **kwargs):
        return _Cursor([])


class _Cursor(list):
    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self


class _DB:
    def __init__(self):
        self.collections = {}

    def __getitem__(self, name):
        return self.collections.setdefault(name, _Collection())


class _Blocklist:
    def __init__(self, blocked=None):
        self.blocked = set(blocked or [])

    def is_blocked(self, media_type, tmdb_id):
        return (media_type, int(tmdb_id)) in self.blocked


class _Core:
    def __init__(self):
        self._vix_ids = {"movie": set(), "tv": set()}
        self._stream_blocklist = _Blocklist()


class _Response:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _Client:
    def __init__(self, responses):
        self.responses = list(responses)

    async def get(self, url):
        return self.responses.pop(0)


@pytest.mark.parametrize(
    "media_type,expected_public,expected_api",
    [
        ("movie", "https://vixsrc.to/movie/27205", "https://vixsrc.to/api/movie/27205"),
        ("tv", "https://vixsrc.to/tv/1399/1/1", "https://vixsrc.to/api/tv/1399/1/1"),
    ],
)
def test_provider_urls(media_type, expected_public, expected_api):
    assert _public_url(media_type, 27205 if media_type == "movie" else 1399) == expected_public
    assert _api_url(media_type, 27205 if media_type == "movie" else 1399) == expected_api


def test_catalog_membership_fails_closed_when_catalog_is_missing():
    core = _Core()
    verifier = VixSrcAvailabilityVerifier(core, _DB())
    assert verifier.catalog_loaded("movie") is False
    assert verifier.catalog_member("movie", 27205) is False


def test_catalog_membership_accepts_only_real_catalog_ids_and_blocklist_wins():
    core = _Core()
    core._vix_ids["movie"] = {27205}
    verifier = VixSrcAvailabilityVerifier(core, _DB())

    assert verifier.catalog_member("movie", 27205) is True
    assert verifier.catalog_member("movie", 1) is False

    core._stream_blocklist = _Blocklist({("movie", 27205)})
    assert verifier.catalog_member("movie", 27205) is False


@pytest.mark.asyncio
async def test_api_player_source_confirms_playability_without_using_source_value():
    core = _Core()
    core._vix_ids["movie"] = {27205}
    verifier = VixSrcAvailabilityVerifier(core, _DB())
    verifier.client = lambda: _Client([_Response(200, {"src": "https://example.invalid/embed"})])

    result, reason = await verifier._probe_endpoint("movie", 27205)
    assert result is True
    assert reason == "api_player_source"


@pytest.mark.asyncio
async def test_api_without_player_source_is_confirmed_unavailable():
    core = _Core()
    core._vix_ids["movie"] = {27205}
    verifier = VixSrcAvailabilityVerifier(core, _DB())
    verifier.client = lambda: _Client([_Response(200, {"src": ""})])

    result, reason = await verifier._probe_endpoint("movie", 27205)
    assert result is False
    assert reason == "api_no_player_source"


def test_policy_version_is_explicit():
    assert POLICY_VERSION == "streamportal-live-v1"
