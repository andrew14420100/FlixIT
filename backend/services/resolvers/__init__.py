"""Modular stream resolvers for the native player.

Compatibility aliases intentionally keep the historical class names imported by
`player.py` while swapping their implementations:
- StremioAddonResolver -> OmniAddonResolver
- VixSrcResolver       -> ItalianProviderBridgeResolver

This lets the existing player/admin wiring keep working without a frontend
migration.
"""
from .base import BaseResolver, ResolveContext
from .admin_source import AdminSourceResolver
from .internet_archive import InternetArchiveResolver, PUBLIC_DOMAIN_SETTING_KEY
from .omni_addon import OmniAddonResolver
from .italianprovider_bridge import ItalianProviderBridgeResolver

# Backwards-compatible names consumed by backend/player.py.
StremioAddonResolver = OmniAddonResolver
VixSrcResolver = ItalianProviderBridgeResolver

__all__ = [
    "BaseResolver",
    "ResolveContext",
    "AdminSourceResolver",
    "InternetArchiveResolver",
    "OmniAddonResolver",
    "ItalianProviderBridgeResolver",
    "StremioAddonResolver",
    "VixSrcResolver",
    "PUBLIC_DOMAIN_SETTING_KEY",
]
