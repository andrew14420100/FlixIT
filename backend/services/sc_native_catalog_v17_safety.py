"""Safety patches for the SC-native v17 index."""
from __future__ import annotations

import asyncio
import time


def _truthy(value) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def install_sc_v17_safety() -> None:
    from services import sc_native_catalog_v17 as base

    if getattr(base, "_flixit_sc_v17_safety", False):
        return

    original_get_title = base._get_title

    async def get_title_with_type(client, path: str, preferred_base: str = ""):
        title, working_base = await original_get_title(client, path, preferred_base)
        # SC exposes `sub_ita` on the title. The user asked for dubbed Italian
        # only, so subtitle-only/original-language titles never enter the index.
        if title and _truthy(title.get("sub_ita")):
            return {}, working_base
        if title and not title.get("type"):
            has_seasons = bool(title.get("seasons")) or bool(base._int(title.get("seasons_count")))
            if has_seasons:
                title = {**title, "type": "tv"}
        return title, working_base

    get_title_with_type._flixit_sc_v17_safety = True
    get_title_with_type._original = original_get_title
    base._get_title = get_title_with_type

    original_crawl_batch = base._crawl_batch
    full_crawl_clock = {"completed": 0.0}

    async def crawl_batch_safe(db):
        now = time.monotonic()
        if base._catalog_complete:
            if not full_crawl_clock["completed"]:
                full_crawl_clock["completed"] = now
                return 0, True
            if now - full_crawl_clock["completed"] < base.FULL_REFRESH_SECONDS:
                return 0, True
            base._catalog_complete = False

        success, finished = await original_crawl_batch(db)
        if not finished:
            return success, finished

        try:
            base.CATALOG.load()
            source_count = len(base.CATALOG.records or [])
        except Exception:
            source_count = 0
        indexed_count = len(base._movie_ids) + len(base._tv_ids)

        # Never switch Home/Catalogue to strict SC membership after a mostly
        # failed crawl. Existing per-title snapshots remain usable while the next
        # background pass retries missing records.
        minimum = max(100, int(source_count * 0.75)) if source_count else 100
        if indexed_count < minimum:
            base._catalog_complete = False
            try:
                await asyncio.to_thread(
                    db[base.META_COLLECTION].update_one,
                    {"key": "catalog"},
                    {
                        "$set": {
                            "key": "catalog",
                            "catalog_complete": False,
                            "indexed_count": indexed_count,
                            "source_count": source_count,
                            "policy": base.POLICY_VERSION,
                        },
                        "$unset": {"full_pass_completed_at": ""},
                    },
                    True,
                )
            except Exception:
                pass
        else:
            base._catalog_complete = True
            full_crawl_clock["completed"] = time.monotonic()
            try:
                await asyncio.to_thread(
                    db[base.META_COLLECTION].update_one,
                    {"key": "catalog"},
                    {"$set": {
                        "key": "catalog",
                        "catalog_complete": True,
                        "indexed_count": indexed_count,
                        "source_count": source_count,
                        "policy": base.POLICY_VERSION,
                    }},
                    True,
                )
            except Exception:
                pass
        return success, finished

    crawl_batch_safe._flixit_sc_v17_safety = True
    crawl_batch_safe._original = original_crawl_batch
    base._crawl_batch = crawl_batch_safe
    base._flixit_sc_v17_safety = True


__all__ = ["install_sc_v17_safety"]
