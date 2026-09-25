from __future__ import annotations

from .apple_tv import AppleTVTrailerProvider as _AppleTVTrailerProvider
from .imdb import IMDbTrailerProvider
from .prime_video import PrimeVideoTrailerProvider as _PrimeVideoTrailerProvider
from .netflix import NetflixTrailerProvider as _NetflixTrailerProvider
from .theryston import TherystonTrailerProvider


class _TherystonAugmentedProvider:
    """Keep the native provider as fallback while preferring Theryston's clean local media.

    Theryston works from an already-known provider page. When the native provider
    discovers that page during the same request, pass it straight to Theryston so
    the first resolution can already produce a local MP4 without waiting for a
    later cache refresh.
    """

    name = "provider"
    page_key = ""

    def __init__(self, native):
        self.native = native
        self.theryston = TherystonTrailerProvider()

    async def discover(self, identity: dict):
        native_rows = await self.native.discover(identity)

        existing_pages = identity.get("provider_pages") or {}
        page_url = str(existing_pages.get(self.page_key) or "").strip()
        if not page_url:
            for candidate in native_rows:
                value = str(getattr(candidate, "provider_page", None) or "").strip()
                if value.startswith("https://"):
                    page_url = value
                    break

        theryston_rows = []
        if page_url.startswith("https://"):
            enriched_identity = {
                **identity,
                "provider_pages": {self.page_key: page_url},
            }
            theryston_rows = await self.theryston.discover(enriched_identity)

        # Put Theryston first so an otherwise equal candidate resolves to the
        # locally served, branding-free media. Native candidates stay available
        # as an immediate fallback and can still win when objectively better.
        return [*theryston_rows, *native_rows]


class AppleTVTrailerProvider(_TherystonAugmentedProvider):
    name = "apple_tv"
    page_key = "apple_tv"

    def __init__(self):
        super().__init__(_AppleTVTrailerProvider())


class PrimeVideoTrailerProvider(_TherystonAugmentedProvider):
    name = "prime_video"
    page_key = "prime_video"

    def __init__(self):
        super().__init__(_PrimeVideoTrailerProvider())


class NetflixTrailerProvider(_TherystonAugmentedProvider):
    name = "netflix"
    page_key = "netflix"

    def __init__(self, db):
        super().__init__(_NetflixTrailerProvider(db))


__all__ = [
    "AppleTVTrailerProvider",
    "IMDbTrailerProvider",
    "PrimeVideoTrailerProvider",
    "NetflixTrailerProvider",
    "TherystonTrailerProvider",
]
