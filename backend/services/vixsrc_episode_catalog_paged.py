"""Paged loader for VixSrc's Italian episode catalogue.

VixSrc deployments have exposed this endpoint in two forms: a complete JSON
array from the documented URL, and a Laravel-style paginated object (`data`,
`current_page`, `last_page`). Request the documented URL first; only if it is
paginated do we fetch the remaining pages concurrently with a bounded pool.
Only a *complete* page set replaces the authoritative catalogue; partial network
failures keep the last persisted snapshot instead of hiding valid episodes.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

_INSTALLED = False


def _page_number(value: Any, default: int) -> int:
    try:
        number = int(value)
        return number if number > 0 else default
    except Exception:
        return default


def install_paged_episode_catalog(policy_module) -> bool:
    global _INSTALLED
    if _INSTALLED:
        return True

    original_warm = policy_module.warm_italian_episode_catalog
    if getattr(original_warm, "_flixit_paged_catalog", False):
        _INSTALLED = True
        return True

    async def warm_paged(force: bool = False) -> bool:
        now = time.monotonic()
        if (
            policy_module._catalog_keys
            and not force
            and now - policy_module._catalog_loaded_at < policy_module.CATALOG_TTL_SECONDS
        ):
            return True

        if policy_module._catalog_lock is None:
            policy_module._catalog_lock = asyncio.Lock()

        async with policy_module._catalog_lock:
            now = time.monotonic()
            if (
                policy_module._catalog_keys
                and not force
                and now - policy_module._catalog_loaded_at < policy_module.CATALOG_TTL_SECONDS
            ):
                return True

            if not policy_module._catalog_keys:
                persisted, loaded_at = await asyncio.to_thread(policy_module._load_persisted_catalog)
                if persisted:
                    policy_module._catalog_keys = persisted
                    policy_module._catalog_loaded_at = loaded_at or time.monotonic()
                    if (
                        not force
                        and time.monotonic() - policy_module._catalog_loaded_at
                        < policy_module.CATALOG_TTL_SECONDS
                    ):
                        return True

            try:
                import httpx

                timeout = httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=5.0)
                limits = httpx.Limits(max_connections=16, max_keepalive_connections=12)
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
                    "Accept": "application/json",
                    "Accept-Language": "it-IT,it;q=0.9",
                }

                async with httpx.AsyncClient(
                    timeout=timeout,
                    limits=limits,
                    follow_redirects=True,
                    headers=headers,
                ) as client:
                    # Try the exact documented URL first. On deployments that
                    # still return the complete array, this is a single request.
                    first = await client.get(
                        policy_module.CATALOG_URL,
                        params={"lang": "it"},
                    )
                    if first.status_code != 200:
                        return bool(policy_module._catalog_keys)
                    first_payload = first.json()
                    keys = policy_module._parse_episode_catalog(first_payload)

                    if isinstance(first_payload, dict):
                        current = _page_number(first_payload.get("current_page"), 1)
                        last = _page_number(first_payload.get("last_page"), current)
                    else:
                        current = 1
                        last = 1

                    if last < current or last > 500:
                        return bool(policy_module._catalog_keys)

                    complete = True
                    if last > current:
                        semaphore = asyncio.Semaphore(12)

                        async def fetch_page(page: int):
                            async with semaphore:
                                try:
                                    response = await client.get(
                                        policy_module.CATALOG_URL,
                                        params={"lang": "it", "page": page},
                                    )
                                    if response.status_code != 200:
                                        return None
                                    return policy_module._parse_episode_catalog(response.json())
                                except Exception:
                                    return None

                        results = await asyncio.gather(
                            *(fetch_page(page) for page in range(current + 1, last + 1)),
                            return_exceptions=True,
                        )
                        for result in results:
                            if not isinstance(result, set):
                                complete = False
                                break
                            keys.update(result)

                    if not complete:
                        return bool(policy_module._catalog_keys)

                if keys:
                    policy_module._catalog_keys = keys
                    policy_module._catalog_loaded_at = time.monotonic()
                    await asyncio.to_thread(policy_module._persist_catalog, keys)
                    return True
            except Exception:
                pass

            return bool(policy_module._catalog_keys)

    warm_paged._flixit_paged_catalog = True
    warm_paged._original = original_warm
    policy_module.warm_italian_episode_catalog = warm_paged
    _INSTALLED = True
    return True


__all__ = ["install_paged_episode_catalog"]
