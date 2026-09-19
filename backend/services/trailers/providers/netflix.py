from __future__ import annotations

from urllib.parse import urlparse

from ..base import TrailerCandidate, is_blocked_url
from ..manifest import inspect_hls, probe_direct_file
from .common import client, meta


def _duration_seconds(value) -> float | None:
    try:
        raw = float(value)
    except Exception:
        return None
    if raw <= 0:
        return None
    return raw / 1000.0 if raw > 10000 else raw


class NetflixTrailerProvider:
    """Netflix provider restricted to publicly exposed trailer assets.

    It deliberately does not call playapi/cadmium, does not request protected
    manifests, does not use DRM keys and does not bypass authentication. A
    confirmed Netflix ID can come from the existing artwork matcher; if the
    public title page does not expose a directly usable trailer the provider
    simply returns no candidates and the resolver continues with other sources.
    """

    name = "netflix"

    def __init__(self, db):
        self.matches = db["netflix_artwork_matches"]

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        doc = self.matches.find_one(
            {"type": identity.get("type"), "tmdbId": int(identity.get("tmdbId"))},
            {"_id": 0},
        ) or {}
        if doc.get("status") not in ("matched", "manual") or not doc.get("netflix_available", True):
            return []
        netflix_id = str(doc.get("netflix_id") or "").strip()
        if not netflix_id.isdigit():
            return []
        page_url = f"https://www.netflix.com/it/title/{netflix_id}"
        async with client() as http:
            try:
                response = await http.get(page_url)
                if response.status_code != 200:
                    return []
            except Exception:
                return []
            direct = meta(response.text, "og:video") or meta(response.text, "og:video:url")
            if not direct or is_blocked_url(direct):
                return []
            duration = _duration_seconds(
                meta(response.text, "video:duration")
                or meta(response.text, "og:video:duration")
            )
            host = (urlparse(direct).hostname or "").lower()
            if host.endswith("netflix.com") and "/title/" in direct:
                return []
            try:
                if ".m3u8" in direct.lower():
                    rows = await inspect_hls(
                        http,
                        direct,
                        source=self.name,
                        confidence=1.0,
                        provider_id=netflix_id,
                        provider_page=page_url,
                        matched_title=identity.get("title"),
                        matched_year=identity.get("year"),
                        trailer_type="Official Trailer",
                        official=True,
                        default_language="it-IT",
                    )
                    for candidate in rows:
                        candidate.duration_seconds = duration
                        candidate.metadata = {
                            **(candidate.metadata or {}),
                            "duration_seconds": duration,
                            "public_page_asset": True,
                        }
                    return rows
                probed = await probe_direct_file(direct)
                if not probed:
                    return []
                return [
                    TrailerCandidate(
                        source=self.name,
                        trailer_url=direct,
                        provider_id=netflix_id,
                        provider_page=page_url,
                        matched_title=identity.get("title"),
                        matched_year=identity.get("year"),
                        media_type=identity.get("type"),
                        title="Official Trailer",
                        trailer_type="Official Trailer",
                        official=True,
                        width=probed.get("width"),
                        height=probed.get("height"),
                        bitrate=probed.get("bitrate"),
                        codec=probed.get("codec"),
                        fps=probed.get("fps"),
                        duration_seconds=duration,
                        audio_language=probed.get("audio_language") or "it-IT",
                        audio_codec=probed.get("audio_codec"),
                        audio_bitrate=probed.get("audio_bitrate"),
                        confidence=1.0,
                        verified=True,
                        browser_compatible=True,
                        compatibility="mp4",
                        metadata={"duration_seconds": duration, "public_page_asset": True},
                    )
                ]
            except Exception:
                return []
