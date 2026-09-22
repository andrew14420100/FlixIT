"""
ResolverRegistry: central registry that owns provider ordering and stream cache.

AdminSource remains first. Omni uses the stable `stremio_addon` resolver id and
is promoted by its resolver to the first network source.
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from .resolvers.base import BaseResolver, ResolveContext
from . import mediaflow
from . import proxy

logger = logging.getLogger("player.registry")

CACHE_TTL_SETTING_KEY = "player_cache_ttl_hours"
RESOLVER_ORDER_SETTING_KEY = "player_resolver_order"
DEFAULT_CACHE_TTL_HOURS = 2.0
MISS_TTL = timedelta(minutes=15)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ResolverRegistry:
    def __init__(self):
        self._providers: dict[str, BaseResolver] = {}
        self._registration_order: list[str] = []
        self._db = None
        self._get_setting = None
        self._set_setting = None
        # Same movie/episode can be requested almost simultaneously by Hero
        # prefetch, Detail warmup and Watch (or by several clients). Only one
        # provider chain should run for a cache miss; everyone else awaits it.
        self._inflight: dict[str, asyncio.Task] = {}

    # ------------------------------------------------------------------ setup
    def bind(self, db, get_setting=None, set_setting=None) -> None:
        self._db = db
        self._get_setting = get_setting
        self._set_setting = set_setting
        for p in self._providers.values():
            p.bind(db, get_setting)

    def register(self, provider: BaseResolver) -> None:
        self._providers[provider.id] = provider
        if provider.id not in self._registration_order:
            self._registration_order.append(provider.id)
        if self._db is not None:
            provider.bind(self._db, self._get_setting)

    def get(self, provider_id: str) -> Optional[BaseResolver]:
        return self._providers.get(provider_id)

    # ------------------------------------------------------------------ ordering
    def _ordered_ids(self) -> list[str]:
        """Return all provider ids in resolution order (always-active providers first)."""
        saved = []
        if self._get_setting is not None:
            try:
                saved = list(self._get_setting(RESOLVER_ORDER_SETTING_KEY, []) or [])
            except Exception:
                saved = []
        ordered = [pid for pid in saved if pid in self._providers]
        for pid in self._registration_order:
            if pid not in ordered:
                ordered.append(pid)
        front = [pid for pid in ordered if self._providers[pid].always_active]
        rest = [pid for pid in ordered if not self._providers[pid].always_active]
        return front + rest

    def _active_ordered(self) -> list[BaseResolver]:
        result = []
        for pid in self._ordered_ids():
            p = self._providers[pid]
            if p.always_active or p.is_active():
                result.append(p)
        return result

    # ------------------------------------------------------------------ admin config
    def providers_config(self) -> list[dict]:
        cfg = []
        for idx, pid in enumerate(self._ordered_ids()):
            p = self._providers[pid]
            cfg.append({
                "id": p.id,
                "label": p.label,
                "active": True if p.always_active else p.is_active(),
                "always_active": p.always_active,
                "configurable": p.configurable,
                "order": idx,
            })
        return cfg

    def cache_ttl_hours(self) -> float:
        if self._get_setting is None:
            return DEFAULT_CACHE_TTL_HOURS
        try:
            val = float(self._get_setting(CACHE_TTL_SETTING_KEY, DEFAULT_CACHE_TTL_HOURS))
            return val if val > 0 else DEFAULT_CACHE_TTL_HOURS
        except Exception:
            return DEFAULT_CACHE_TTL_HOURS

    def set_order(self, ordered_ids: list[str]) -> None:
        if self._set_setting is None:
            return
        valid = [pid for pid in ordered_ids if pid in self._providers]
        self._set_setting(RESOLVER_ORDER_SETTING_KEY, valid)
        self.clear_cache()

    def set_cache_ttl_hours(self, hours: float) -> None:
        if self._set_setting is None:
            return
        self._set_setting(CACHE_TTL_SETTING_KEY, float(hours))

    # ------------------------------------------------------------------ cache
    @staticmethod
    def cache_key(media_type: str, tmdb_id: int, season: Optional[int], episode: Optional[int]) -> str:
        return f"{media_type}:{tmdb_id}:{season or 0}:{episode or 0}"

    def _cache_get(self, key: str) -> Optional[dict]:
        if self._db is None:
            return None
        doc = self._db["stream_cache"].find_one({"key": key}, {"_id": 0})
        if not doc:
            return None
        try:
            if datetime.fromisoformat(doc["expiresAt"]) < _now():
                return None
        except Exception:
            return None
        return doc.get("result")

    def _cache_set(self, key: str, result: dict) -> None:
        if self._db is None:
            return
        ttl = timedelta(hours=self.cache_ttl_hours()) if result.get("success") else MISS_TTL
        self._db["stream_cache"].update_one(
            {"key": key},
            {"$set": {"key": key, "result": result, "expiresAt": (_now() + ttl).isoformat()}},
            upsert=True,
        )

    def clear_cache(self, key: Optional[str] = None) -> int:
        if self._db is None:
            return 0
        query = {"key": key} if key else {}
        return self._db["stream_cache"].delete_many(query).deleted_count

    def clear_cache_for_title(self, tmdb_id: int) -> int:
        if self._db is None:
            return 0
        return self._db["stream_cache"].delete_many({"key": {"$regex": f"^(movie|tv):{tmdb_id}:"}}).deleted_count

    def _omni_active(self) -> bool:
        """True when the Omni resolver has an effective runtime/Admin URL."""
        provider = self._providers.get("stremio_addon")
        if provider is None:
            return False
        try:
            return bool(provider.is_active())
        except Exception:
            return False

    async def _resolve_uncached(self, ctx: ResolveContext, key: str) -> dict:
        not_found = {"success": False, "reason": "not_found", "message": "Stream non disponibile"}
        had_transient_error = False

        for provider in self._active_ordered():
            try:
                result = await provider.resolve(
                    ctx.tmdb_id, ctx.season, ctx.episode, media_type=ctx.media_type
                )
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning("resolver '%s' raised: %s", provider.id, e)
                had_transient_error = True
                continue
            if result and result.get("success") and result.get("stream"):
                result.setdefault("source", provider.id)
                self._cache_set(key, result)
                return self._route(result)

        if had_transient_error:
            # Do not negative-cache transient provider outages. A later request
            # can retry immediately instead of being stuck behind a false miss.
            return {
                **not_found,
                "reason": "temporary",
                "message": "Sorgente momentaneamente non raggiungibile, riprova",
            }

        self._cache_set(key, not_found)
        return not_found

    # ------------------------------------------------------------------ resolution
    async def resolve(self, ctx: ResolveContext) -> dict:
        if self._db is None:
            return {"success": False, "reason": "temporary", "message": "Player non inizializzato"}

        key = self.cache_key(ctx.media_type, ctx.tmdb_id, ctx.season, ctx.episode)
        cached = self._cache_get(key)
        if cached is not None:
            cached_stream = str(cached.get("stream") or "").lower()
            cached_source = str(cached.get("source") or "")

            if self._omni_active() and cached_source not in ("admin_source", "stremio_addon"):
                logger.info("Invalidating pre-Omni cached result for %s (source=%s)", key, cached_source or "miss")
                self.clear_cache(key)
            elif "/extractor/video.m3u8" in cached_stream and "vixsrc.to" in cached_stream:
                logger.info("Invalidating legacy cached VixSrc extractor stream for %s", key)
                self.clear_cache(key)
            else:
                return self._route(cached)

        pending = self._inflight.get(key)
        if pending is not None and not pending.done():
            # Shield the shared resolver from a browser disconnect/navigation.
            # The provider chain can finish and populate cache for the next page.
            return await asyncio.shield(pending)

        task = asyncio.create_task(self._resolve_uncached(ctx, key))
        self._inflight[key] = task

        def forget(done: asyncio.Task) -> None:
            if self._inflight.get(key) is done:
                self._inflight.pop(key, None)
            # Consume an exception if every original HTTP waiter disconnected.
            try:
                done.exception()
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

        task.add_done_callback(forget)
        return await asyncio.shield(task)

    def _route(self, result: dict) -> dict:
        """Route resolved streams exactly once."""
        stream = str(result.get("stream") or "").strip()
        if not stream:
            return result

        # Headerless Omni/Stremio streams are already browser-ready and should
        # stay direct. Proxy only when request headers (Referer/User-Agent/etc.)
        # are explicitly required; this removes one full manifest/segment hop
        # and substantially improves startup latency for public HLS streams.
        if result.get("source") == "stremio_addon":
            if result.get("headers"):
                return proxy.wrap_stream_internal(result)
            return {
                **result,
                "stream": stream,
                "original_stream": result.get("original_stream", stream),
                "proxied": False,
            }

        cfg = mediaflow.get_config(self._get_setting)
        mediaflow_base = str(cfg.get("url") or "").strip().rstrip("/")

        if mediaflow_base and stream.startswith(mediaflow_base + "/"):
            logger.info("Stream already proxied by MediaFlow; skipping second wrap")
            return {
                **result,
                "stream": stream,
                "original_stream": result.get("original_stream", stream),
                "proxied": True,
            }

        if cfg.get("enabled") and mediaflow_base:
            return mediaflow.wrap_stream(result, self._get_setting)

        if result.get("headers") or result.get("source") == "vixsrc":
            return proxy.wrap_stream_internal(result)

        return result
