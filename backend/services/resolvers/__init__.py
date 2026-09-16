"""Modular stream resolvers for the native player."""
from .base import BaseResolver, ResolveContext
from .admin_source import AdminSourceResolver
from .internet_archive import InternetArchiveResolver, PUBLIC_DOMAIN_SETTING_KEY
from .stremio_addon import StremioAddonResolver
from .vixsrc import VixSrcResolver

__all__ = [
    "BaseResolver",
    "ResolveContext",
    "AdminSourceResolver",
    "InternetArchiveResolver",
    "StremioAddonResolver",
    "VixSrcResolver",
    "PUBLIC_DOMAIN_SETTING_KEY",
]
