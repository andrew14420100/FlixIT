"""
BaseResolver: abstract contract every stream provider must implement.

A resolver receives a TMDB id (plus season/episode for TV) and returns either a
standardized stream payload or None if it cannot resolve the title:

    {"success": True, "stream": "https://.../video.m3u8", "type": "hls"|"mp4", "source": "<id>"}

Providers are pure resolvers: they never touch the cache or the registry ordering
(that is the ResolverRegistry's job).
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse


@dataclass
class ResolveContext:
    """Everything a resolver needs to look up a title."""
    media_type: str          # "movie" | "tv"
    tmdb_id: int
    season: Optional[int] = None
    episode: Optional[int] = None

    @property
    def is_tv(self) -> bool:
        return self.media_type == "tv"


def stream_type_for(url: str) -> str:
    """Infer the player type from the URL extension."""
    return "hls" if urlparse(url).path.lower().endswith(".m3u8") else "mp4"


class BaseResolver(ABC):
    """Abstract base class for all stream resolvers."""

    #: stable identifier, also used as the payload "source"
    id: str = "base"
    #: human label shown in Admin > Impostazioni
    label: str = "Base"
    #: when True the provider is always active and cannot be disabled/reordered (AdminSource)
    always_active: bool = False
    #: when False the provider has no admin on/off toggle
    configurable: bool = True

    def __init__(self):
        self._db = None
        self._get_setting = None

    def bind(self, db, get_setting=None) -> None:
        """Inject the Mongo database and the settings accessor."""
        self._db = db
        self._get_setting = get_setting

    def is_active(self) -> bool:
        """Whether the provider participates in resolution. Override for a toggle."""
        return True

    @abstractmethod
    async def resolve(
        self,
        tmdb_id: int,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        media_type: str = "movie",
    ) -> Optional[dict]:
        """Return a stream payload dict or None if this provider cannot resolve it."""
        raise NotImplementedError
