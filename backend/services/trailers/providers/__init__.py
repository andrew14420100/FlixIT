from __future__ import annotations

from .apple_tv import AppleTVTrailerProvider as _AppleTVTrailerProvider
from .imdb import IMDbTrailerProvider
from .prime_video import PrimeVideoTrailerProvider as _PrimeVideoTrailerProvider
from .netflix import NetflixTrailerProvider as _NetflixTrailerProvider
from .theryston import TherystonTrailerProvider


class _TherystonAugmentedProvider:
    """Keep the native provider as fallback while bridging first-run discovery.

    The central service already keeps Theryston as its own provider for pages
    persisted in providerPages. This wrapper only covers the missing first-run
    case: if the native provider discovers a provider page during this request,
    send that newly discovered page to Theryston immediately instead of waiting
    for a later cache refresh.
    """

    name = "provider"
    page_key = ""

    def __init__(self, native):
        self.native = native
        self.theryston = TherystonTrailerProvider()

    async def discover(self, identity: dict):
        native_rows = await self.native.discover(identity)

        existing_pages = identity.get("provider_pages") or {}
        existing_page = str(existing_pages.get(self.page_key) or "").strip()
        discovered_page = ""

        # Existing pages are handled by the central Theryston provider already.
        # Only bridge a provider page that appeared for the first time now.
        if not existing_page:
            for candidate in native_rows:
                value = str(getattr(candidate, "provider_page", None) or "").strip()
                if value.startswith("https://"):
                    discovered_page = value
                    break

        theryston_rows = []
        if discovered_page:
            enriched_identity = {
                **identity,
                "provider_pages": {self.page_key: discovered_page},
            }
            theryston_rows = await self.theryston.discover(enriched_identity)

        # Put the newly materialized local media first on exact ties. Native
        # candidates remain available as fallback and still win when the normal
        # language/quality ranking says they are objectively better.
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
