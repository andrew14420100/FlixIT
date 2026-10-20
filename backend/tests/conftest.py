"""Shared pytest hooks for source-adapter tests."""

import os

import pytest


def pytest_collection_modifyitems(config, items):
    """The old live VixSrc suite is obsolete after replacing that resolver.

    Keep it runnable only when an ItalianProvider bridge is explicitly supplied,
    because those tests exercise the primary-source/proxy path against a live
    upstream rather than isolated unit behavior.
    """
    if os.environ.get("ITALIANPROVIDER_BRIDGE_URL"):
        return

    marker = pytest.mark.skip(
        reason="Primary source replaced: ITALIANPROVIDER_BRIDGE_URL not configured"
    )
    for item in items:
        if item.fspath.basename == "test_vixsrc_integration.py":
            item.add_marker(marker)
