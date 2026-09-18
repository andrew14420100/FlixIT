"""Netflix-style artwork resolution for FLIX-IT.

This module intentionally keeps Netflix metadata access isolated behind a provider.
It uses an authenticated Netflix session supplied by the site owner and never
attempts to obtain cookies, bypass authentication, DRM, CAPTCHA, or other access
controls. The public site only consumes resolved/cached artwork metadata.

Safety invariants for artwork selection:
- Netflix artwork is considered only after Netflix Italy availability is verified.
- Automatic matching is intentionally strict; ambiguous title/year matches remain
  ``uncertain`` and do not affect the public UI.
- A manual ``not_netflix`` decision blocks future automatic matching until reset.
- Manual artwork overrides always win.
- When Netflix artwork is disabled, callers receive no visual override.
- Existing artwork remains the fallback and is not overwritten in MongoDB.
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

import httpx

NETFLIX_GRAPHQL_URL = "https://web.prod.cloud.netflix.com/graphql"
NETFLIX_MINIMODAL_QUERY_ID = "96c87721-2e20-416f-aa6f-87c8a889c955"
NETFLIX_SEARCH_QUERY_ID = "72c86526-8d73-4949-82f6-43f3ee66cbb4"
NETFLIX_QUERY_VERSION = 102
MATCH_TTL = timedelta(hours=24)
ARTWORK_TTL = timedelta(days=7)
AUTO_MATCH_THRESHOLD = 0.95
AUTO_MATCH_GAP = 0.08
DEFAULT_REGION = "IT"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _now().isoformat()


def _bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _safe_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def normalize_title(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("&", " e ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _year(value: Any) -> Optional[int]:
    if value is None:
        return None
    match = re.search(r"(?:19|20)\d{2}", str(value))
    return int(match.group(0)) if match else None


def _area(asset: Optional[dict]) -> int:
    if not asset:
        return 0
    try:
        return max(0, int(asset.get("width") or 0)) * max(0, int(asset.get("height") or 0))
    except Exception:
        return 0


def _ratio(asset: Optional[dict]) -> float:
    if not asset:
        return 0.0
    try:
        w = float(asset.get("width") or 0)
        h = float(asset.get("height") or 0)
        return w / h if h else 0.0
    except Exception:
        return 0.0


def _image_dict(raw: Any, kind: str, source: str = "netflix") -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    url = raw.get("url")
    if not url:
        artwork = raw.get("artwork")
        if isinstance(artwork, dict):
            url = artwork.get("url")
            raw = {**artwork, **raw}
    if not url:
        return None
    try:
        width = int(raw.get("width") or 0)
        height = int(raw.get("height") or 0)
    except Exception:
        width, height = 0, 0
    return {
        "type": kind,
        "source": source,
        "url": str(url),
        "width": width,
        "height": height,
        "focalPoint": raw.get("focalPoint"),
        "key": raw.get("key"),
        "available": raw.get("available", True),
    }


def _dedupe_assets(items: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for item in items:
        url = str(item.get("url") or "")
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(item)
    return out


class NetflixArtworkProvider:
    """Thin provider around the authenticated Netflix GraphQL calls.

    The request shapes follow the public reference implementations supplied by
    the project owner (nf-scrape / NetflixDemo). Query ids are undocumented and
    therefore treated as replaceable provider details rather than application
    contracts.
    """

    def __init__(self, cookie_getter: Callable[[], str]):
        self._cookie_getter = cookie_getter
        self._client: Optional[httpx.AsyncClient] = None

    def _headers(self, operation: str) -> dict:
        cookies = (self._cookie_getter() or "").strip()
        if not cookies:
            raise RuntimeError("Netflix cookies non configurati")
        return {
            "content-type": "application/json",
            "cookie": cookies,
            "accept": "*/*",
            "accept-language": "it-IT,it;q=0.9,en;q=0.7",
            "origin": "https://www.netflix.com",
            "referer": "https://www.netflix.com/browse",
            "user-agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
            ),
            "x-netflix.clienttype": "akira",
            "x-netflix.browsername": "Chrome",
            "x-netflix.context.locales": "it-IT",
            "x-netflix.context.operation-name": operation,
        }

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=6.0),
                limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
                follow_redirects=True,
            )
        return self._client

    async def _post(self, operation: str, payload: dict) -> dict:
        response = await self._http().post(
            NETFLIX_GRAPHQL_URL,
            headers=self._headers(operation),
            json=payload,
        )
        if response.status_code in (401, 403):
            raise RuntimeError("Sessione Netflix non valida o scaduta")
        if response.status_code != 200:
            raise RuntimeError(f"Netflix GraphQL HTTP {response.status_code}")
        data = response.json()
        if data.get("errors"):
            message = ((data.get("errors") or [{}])[0] or {}).get("message") or "GraphQL error"
            raise RuntimeError(f"Netflix GraphQL: {message}")
        return data

    async def metadata(self, netflix_id: str) -> dict:
        payload = {
            "operationName": "MiniModalQuery",
            "variables": {
                "opaqueImageFormat": "WEBP",
                "transparentImageFormat": "WEBP",
                "videoMerchEnabled": True,
                "fetchPromoVideoOverride": False,
                "hasPromoVideoOverride": False,
                "promoVideoId": 0,
                "videoMerchContext": "BROWSE",
                "isLiveEpisodic": False,
                "artworkContext": {
                    "groupLoc": "eyJrLnR5cGUiOiJ3aW5kb3dlZGNvbWluZ3Nvb24iLCJrLnRpbWVXaW5kb3ciOiJuZXh0d2VlayJ9"
                },
                "textEvidenceUiContext": "BOB",
                "unifiedEntityIds": [f"Video:{netflix_id}"],
            },
            "extensions": {
                "persistedQuery": {
                    "id": NETFLIX_MINIMODAL_QUERY_ID,
                    "version": NETFLIX_QUERY_VERSION,
                }
            },
        }
        data = await self._post("MiniModalQuery", payload)
        entities = ((data.get("data") or {}).get("unifiedEntities") or [])
        if not entities:
            raise RuntimeError("Netflix ID non trovato")
        entity = entities[0] or {}
        return entity

    async def search(self, title: str) -> list[dict]:
        """Search Netflix and request a large horizontal artwork candidate.

        Search remains a provider implementation detail. Automatic matching does
        not trust the search result alone; region, exact title and year checks are
        applied later by ArtworkResolver.
        """
        payload = {
            "operationName": "SearchPageQueryResults",
            "variables": {
                "artworkParamsStandardBoxshot": {
                    "artworkType": "SDP",
                    "dimension": {"width": 1280, "height": 720},
                    "features": {"fallbackStrategy": "STILL"},
                },
                "artworkParamsStandardCloudAppIcon": {
                    "artworkType": "GAME_CLOUD_BOXART_HORIZONTAL_INCOMPATIBLE",
                    "dimension": {"width": 342, "height": 192},
                    "features": {"fallbackStrategy": "STILL", "topContentTypeBadge": True},
                },
                "artworkParamsStandardMobileAppIcon": {
                    "artworkType": "GAME_ICON_BOXART_HORIZONTAL_CARD",
                    "dimension": {"width": 342, "height": 192},
                    "features": {"fallbackStrategy": "STILL", "topContentTypeBadge": True},
                },
                "pageSize": 48,
                "options": {
                    "pageCapabilities": {
                        "base": {
                            "canHandlePlayingCloudGames": False,
                            "capabilitiesBySection": {
                                "pinotGallery": {
                                    "base": {
                                        "capabilitiesBySectionTreatment": {
                                            "pinotCreatorHome": {
                                                "base": {
                                                    "capabilitiesByEntityTreatment": {
                                                        "pinotStandardBoxshot": {
                                                            "base": {"canHandleEntityKinds": ["VIDEO"]}
                                                        }
                                                    },
                                                    "maxTotalEntities": 300,
                                                }
                                            },
                                            "pinotStandard": {
                                                "base": {
                                                    "capabilitiesByEntityTreatment": {
                                                        "pinotStandardBoxshot": {
                                                            "base": {"canHandleEntityKinds": ["VIDEO"]}
                                                        }
                                                    },
                                                    "maxTotalEntities": 300,
                                                }
                                            },
                                        }
                                    }
                                },
                                "pinotList": {
                                    "base": {
                                        "capabilitiesBySectionTreatment": {
                                            "pinotSuggestions": {
                                                "base": {
                                                    "capabilitiesByEntityTreatment": {
                                                        "pinotSuggestion": {
                                                            "base": {
                                                                "canHandleEntityKinds": [
                                                                    "AUTOCOMPLETE", "VIDEO", "CHARACTER",
                                                                    "GENERIC_CONTAINER", "GENRE", "PERSON"
                                                                ]
                                                            }
                                                        }
                                                    },
                                                    "maxTotalEntities": 100,
                                                }
                                            }
                                        }
                                    }
                                },
                            },
                            "maxTotalSections": 2,
                        },
                        "canHandleComplexSectionId": True,
                    },
                    "session": {"id": hashlib.sha256(f"{title}:{_iso_now()}".encode()).hexdigest()[:32]},
                },
                "searchTerm": title,
                "endCursor": None,
            },
            "extensions": {
                "persistedQuery": {
                    "id": NETFLIX_SEARCH_QUERY_ID,
                    "version": NETFLIX_QUERY_VERSION,
                }
            },
        }
        data = await self._post("SearchPageQueryResults", payload)
        found: list[dict] = []

        def walk(node: Any) -> None:
            if isinstance(node, dict):
                entity_id = node.get("entityId") or node.get("suggestionEntityId")
                title_value = node.get("title") or node.get("displayString")
                if isinstance(entity_id, str) and entity_id.startswith("Video:") and title_value:
                    artwork = _image_dict(node.get("artwork"), "contextualArtwork")
                    found.append(
                        {
                            "netflix_id": entity_id.replace("Video:", "", 1),
                            "title": str(title_value),
                            "year": node.get("releaseYear") or node.get("latestYear"),
                            "entity_type": node.get("entityType") or node.get("__typename"),
                            "contextualArtwork": artwork,
                        }
                    )
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)

        walk(data.get("data") or {})
        deduped: dict[str, dict] = {}
        for row in found:
            nid = row["netflix_id"]
            current = deduped.get(nid)
            if current is None or _area(row.get("contextualArtwork")) > _area(current.get("contextualArtwork")):
                deduped[nid] = row
        return list(deduped.values())


class ArtworkResolver:
    def __init__(
        self,
        db,
        get_setting: Optional[Callable[[str, Any], Any]] = None,
        set_setting: Optional[Callable[[str, Any], None]] = None,
        tmdb_api_key: Optional[str] = None,
    ):
        self.db = db
        self.get_setting = get_setting or (lambda _key, default=None: default)
        self.set_setting = set_setting or (lambda _key, _value: None)
        self.tmdb_api_key = tmdb_api_key or os.environ.get("TMDB_API_KEY", "")
        self.matches = db["netflix_artwork_matches"]
        self.matches.create_index([("type", 1), ("tmdbId", 1)], unique=True)
        self.matches.create_index([("status", 1), ("checked_at", -1)])
        self.provider = NetflixArtworkProvider(self._cookies)
        self._tmdb_client: Optional[httpx.AsyncClient] = None

    def _cookies(self) -> str:
        # Environment wins so production can keep the session outside Mongo.
        env_value = (os.environ.get("NETFLIX_COOKIES") or "").strip()
        if env_value:
            return env_value
        return str(self.get_setting("netflix_cookies", "") or "").strip()

    def region(self) -> str:
        value = str(
            self.get_setting("netflix_artwork_region", os.environ.get("NETFLIX_REGION", DEFAULT_REGION))
            or DEFAULT_REGION
        ).upper()
        return value if re.fullmatch(r"[A-Z]{2}", value) else DEFAULT_REGION

    def enabled(self) -> bool:
        stored = self.get_setting("netflix_artwork_enabled", None)
        if stored is not None:
            return _bool(stored, False)
        return _bool(os.environ.get("NETFLIX_ARTWORK_ENABLED"), False)

    def config(self) -> dict:
        cookies = self._cookies()
        return {
            "enabled": self.enabled(),
            "region": self.region(),
            "cookie_configured": bool(cookies),
            "cookie_source": "env" if os.environ.get("NETFLIX_COOKIES") else ("admin" if cookies else "none"),
            "auto_match_threshold": AUTO_MATCH_THRESHOLD,
        }

    def update_config(
        self,
        *,
        enabled: Optional[bool] = None,
        region: Optional[str] = None,
        cookies: Optional[str] = None,
    ) -> dict:
        if enabled is not None:
            self.set_setting("netflix_artwork_enabled", bool(enabled))
        if region is not None:
            normalized = region.strip().upper()
            if not re.fullmatch(r"[A-Z]{2}", normalized):
                raise ValueError("Regione non valida")
            self.set_setting("netflix_artwork_region", normalized)
        if cookies is not None:
            # Empty string deliberately clears the admin-stored session.
            self.set_setting("netflix_cookies", cookies.strip())
        return self.config()

    def _tmdb_http(self) -> httpx.AsyncClient:
        if self._tmdb_client is None or self._tmdb_client.is_closed:
            self._tmdb_client = httpx.AsyncClient(
                timeout=httpx.Timeout(12.0, connect=5.0),
                limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
            )
        return self._tmdb_client

    async def _tmdb(self, endpoint: str, params: Optional[dict] = None) -> Optional[dict]:
        if not self.tmdb_api_key:
            return None
        q = dict(params or {})
        headers: dict[str, str] = {}
        if self.tmdb_api_key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {self.tmdb_api_key}"
        else:
            q["api_key"] = self.tmdb_api_key
        response = await self._tmdb_http().get(
            f"https://api.themoviedb.org/3{endpoint}", params=q, headers=headers
        )
        if response.status_code != 200:
            return None
        return response.json()

    async def netflix_it_available(self, media_type: str, tmdb_id: int) -> Optional[bool]:
        data = await self._tmdb(f"/{media_type}/{tmdb_id}/watch/providers")
        if not data:
            return None
        offers = ((data.get("results") or {}).get(self.region()) or {})
        providers = [
            p
            for key in ("flatrate", "ads", "free")
            for p in (offers.get(key) or [])
            if isinstance(p, dict)
        ]
        return any(
            int(p.get("provider_id") or 0) == 8
            or "netflix" in str(p.get("provider_name") or "").lower()
            for p in providers
        )

    async def _tmdb_identity(self, media_type: str, tmdb_id: int) -> Optional[dict]:
        data = await self._tmdb(f"/{media_type}/{tmdb_id}", {"language": "it-IT"})
        if not data:
            return None
        return {
            "title": data.get("title") or data.get("name") or "",
            "original_title": data.get("original_title") or data.get("original_name") or "",
            "year": _year(data.get("release_date") or data.get("first_air_date")),
            "backdrop_path": data.get("backdrop_path"),
            "poster_path": data.get("poster_path"),
        }

    def _score_match(self, identity: dict, candidate: dict) -> float:
        wanted = {
            normalize_title(identity.get("title")),
            normalize_title(identity.get("original_title")),
        }
        wanted.discard("")
        got = normalize_title(candidate.get("title"))
        if not got or got not in wanted:
            return 0.0
        expected_year = identity.get("year")
        candidate_year = _year(candidate.get("year"))
        # Exact title without a usable year is intentionally insufficient for
        # automatic assignment. Manual matching remains available in admin.
        if not expected_year or not candidate_year:
            return 0.82
        if candidate_year == expected_year:
            return 0.98
        if abs(candidate_year - expected_year) == 1:
            return 0.89
        return 0.55

    async def _search_exact(self, media_type: str, tmdb_id: int) -> dict:
        available = await self.netflix_it_available(media_type, tmdb_id)
        identity = await self._tmdb_identity(media_type, tmdb_id)
        base = {
            "type": media_type,
            "tmdbId": tmdb_id,
            "region": self.region(),
            "checked_at": _iso_now(),
        }
        if available is False:
            return {
                **base,
                "status": "auto",
                "netflix_available": False,
                "confidence": 1.0,
                "reason": "not_available_on_netflix_in_region",
            }
        if available is None:
            return {
                **base,
                "status": "uncertain",
                "netflix_available": None,
                "confidence": 0.0,
                "reason": "region_verification_unavailable",
            }
        if not identity or not identity.get("title"):
            return {
                **base,
                "status": "uncertain",
                "netflix_available": True,
                "confidence": 0.0,
                "reason": "tmdb_identity_unavailable",
            }

        queries = [identity.get("title"), identity.get("original_title")]
        candidates: dict[str, dict] = {}
        for query in [q for q in queries if q]:
            try:
                rows = await self.provider.search(str(query))
            except Exception as exc:
                return {
                    **base,
                    "status": "uncertain",
                    "netflix_available": True,
                    "confidence": 0.0,
                    "reason": "netflix_search_failed",
                    "error": str(exc),
                }
            for row in rows:
                row = {**row, "score": self._score_match(identity, row)}
                current = candidates.get(row["netflix_id"])
                if current is None or row["score"] > current["score"]:
                    candidates[row["netflix_id"]] = row

        ranked = sorted(candidates.values(), key=lambda row: row.get("score", 0), reverse=True)
        top = ranked[0] if ranked else None
        second = ranked[1] if len(ranked) > 1 else None
        confidence = float((top or {}).get("score") or 0)
        gap = confidence - float((second or {}).get("score") or 0)
        safe = bool(top and confidence >= AUTO_MATCH_THRESHOLD and (second is None or gap >= AUTO_MATCH_GAP))
        if not safe:
            return {
                **base,
                "status": "uncertain",
                "netflix_available": True,
                "confidence": round(confidence, 4),
                "reason": "ambiguous_or_low_confidence",
                "identity": identity,
                "candidates": ranked[:8],
            }
        return {
            **base,
            "status": "matched",
            "netflix_available": True,
            "netflix_id": top["netflix_id"],
            "confidence": round(confidence, 4),
            "reason": "strict_title_year_match",
            "identity": identity,
            "contextualArtwork": top.get("contextualArtwork"),
            "candidates": ranked[:8],
        }

    async def _fetch_assets(self, doc: dict, force: bool = False) -> dict:
        netflix_id = str(doc.get("netflix_id") or "")
        if not netflix_id:
            return doc
        fetched = _safe_datetime(doc.get("artwork_fetched_at"))
        if not force and fetched and _now() - fetched < ARTWORK_TTL and doc.get("assets"):
            return doc
        entity = await self.provider.metadata(netflix_id)
        assets = []
        contextual = doc.get("contextualArtwork")
        if contextual:
            assets.append(contextual)
        for field, kind in (
            ("storyArt", "storyArt"),
            ("boxartHighRes", "boxartHighRes"),
            ("boxart", "boxart"),
            ("titleLogoUnbranded", "titleLogoUnbranded"),
            ("titleLogoBranded", "titleLogoBranded"),
            ("brandLogoSmall", "brandLogoSmall"),
        ):
            image = _image_dict(entity.get(field), kind)
            if image:
                assets.append(image)
        doc = {
            **doc,
            "netflix_title": entity.get("title") or doc.get("netflix_title"),
            "netflix_year": entity.get("latestYear") or doc.get("netflix_year"),
            "netflix_is_available": entity.get("isAvailable"),
            "assets": _dedupe_assets(assets),
            "artwork_fetched_at": _iso_now(),
        }
        return doc

    async def auto_match(self, media_type: str, tmdb_id: int, force: bool = False) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        current = self.matches.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0})
        if current and current.get("status") == "not_netflix":
            return current
        if current and current.get("status") == "manual" and current.get("netflix_id"):
            try:
                updated = await self._fetch_assets(current, force=force)
                self.matches.update_one(
                    {"type": media_type, "tmdbId": tmdb_id}, {"$set": updated}, upsert=True
                )
                return updated
            except Exception as exc:
                return {**current, "error": str(exc)}
        checked = _safe_datetime((current or {}).get("checked_at"))
        if not force and current and checked and _now() - checked < MATCH_TTL:
            if current.get("status") == "matched" and current.get("netflix_id"):
                try:
                    updated = await self._fetch_assets(current, force=False)
                    self.matches.update_one(
                        {"type": media_type, "tmdbId": tmdb_id}, {"$set": updated}, upsert=True
                    )
                    return updated
                except Exception as exc:
                    return {**current, "error": str(exc)}
            return current

        doc = await self._search_exact(media_type, tmdb_id)
        if doc.get("status") == "matched" and doc.get("netflix_id"):
            try:
                doc = await self._fetch_assets(doc, force=True)
            except Exception as exc:
                doc = {**doc, "status": "uncertain", "reason": "metadata_fetch_failed", "error": str(exc)}
        # Preserve admin choices if they already exist.
        if current:
            if current.get("overrides"):
                doc["overrides"] = current["overrides"]
        self.matches.update_one(
            {"type": media_type, "tmdbId": tmdb_id}, {"$set": doc}, upsert=True
        )
        return doc

    async def manual_match(self, media_type: str, tmdb_id: int, netflix_id: str) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        if not re.fullmatch(r"\d+", str(netflix_id or "").strip()):
            raise ValueError("Netflix ID non valido")
        available = await self.netflix_it_available(media_type, tmdb_id)
        if available is not True:
            raise ValueError("Il contenuto non risulta disponibile su Netflix nella regione configurata")
        identity = await self._tmdb_identity(media_type, tmdb_id)
        doc = self.matches.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0}) or {}
        doc.update(
            {
                "type": media_type,
                "tmdbId": tmdb_id,
                "region": self.region(),
                "status": "manual",
                "netflix_available": True,
                "netflix_id": str(netflix_id),
                "confidence": 1.0,
                "reason": "admin_manual_match",
                "identity": identity,
                "checked_at": _iso_now(),
            }
        )
        # Search only to recover contextual artwork for the explicitly selected id.
        if identity and identity.get("title"):
            try:
                for row in await self.provider.search(identity["title"]):
                    if str(row.get("netflix_id")) == str(netflix_id):
                        doc["contextualArtwork"] = row.get("contextualArtwork")
                        break
            except Exception:
                pass
        doc = await self._fetch_assets(doc, force=True)
        self.matches.update_one(
            {"type": media_type, "tmdbId": tmdb_id}, {"$set": doc}, upsert=True
        )
        return doc

    def block(self, media_type: str, tmdb_id: int) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        doc = {
            "type": media_type,
            "tmdbId": tmdb_id,
            "region": self.region(),
            "status": "not_netflix",
            "netflix_available": False,
            "reason": "admin_blocked",
            "checked_at": _iso_now(),
            "assets": [],
        }
        self.matches.update_one(
            {"type": media_type, "tmdbId": tmdb_id}, {"$set": doc}, upsert=True
        )
        return doc

    def reset_match(self, media_type: str, tmdb_id: int) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        current = self.matches.find_one({"type": media_type, "tmdbId": tmdb_id}, {"_id": 0}) or {}
        overrides = current.get("overrides") or {}
        self.matches.delete_one({"type": media_type, "tmdbId": tmdb_id})
        if overrides:
            self.matches.insert_one(
                {
                    "type": media_type,
                    "tmdbId": tmdb_id,
                    "status": "auto",
                    "region": self.region(),
                    "overrides": overrides,
                }
            )
        return {"type": media_type, "tmdbId": tmdb_id, "status": "auto", "region": self.region()}

    def set_override(self, media_type: str, tmdb_id: int, context: str, asset: dict) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        context = (context or "home").strip().lower()
        if not asset.get("url"):
            raise ValueError("URL artwork obbligatorio")
        clean = {
            "url": str(asset["url"]),
            "type": asset.get("type") or "manual",
            "width": int(asset.get("width") or 0),
            "height": int(asset.get("height") or 0),
            "source": "manual",
            "updated_at": _iso_now(),
        }
        self.matches.update_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {
                "$set": {
                    f"overrides.{context}": clean,
                    "region": self.region(),
                },
                "$setOnInsert": {"status": "auto"},
            },
            upsert=True,
        )
        return clean

    def reset_override(self, media_type: str, tmdb_id: int, context: str) -> None:
        media_type = "tv" if media_type == "tv" else "movie"
        self.matches.update_one(
            {"type": media_type, "tmdbId": tmdb_id},
            {"$unset": {f"overrides.{(context or 'home').strip().lower()}": ""}},
        )

    async def _existing_quality(self, media_type: str, tmdb_id: int) -> dict:
        """Best-known dimensions of the artwork already used by FLIX-IT."""
        current = self.db["media_assets"].find_one(
            {"type": media_type, "tmdbId": tmdb_id}, {"_id": 0}
        ) or {}
        images = await self._tmdb(
            f"/{media_type}/{tmdb_id}/images",
            {"include_image_language": "it,en,null"},
        ) or {}
        by_path: dict[str, dict] = {}
        for group in ("backdrops", "posters", "logos"):
            for image in images.get(group) or []:
                path = image.get("file_path")
                if path:
                    by_path[path] = {
                        "width": image.get("width") or 0,
                        "height": image.get("height") or 0,
                        "path": path,
                    }
        return {
            "backdrop": by_path.get(current.get("titled_backdrop_path"))
            or by_path.get(current.get("backdrop_path")),
            "poster": by_path.get(current.get("poster_path")),
            "logo": by_path.get(current.get("logo_path")),
        }

    def _asset_score(self, asset: dict, context: str, viewport: str) -> float:
        kind = asset.get("type") or ""
        ratio = _ratio(asset)
        area = _area(asset)
        if area <= 0:
            return -1000.0

        if context == "hero":
            target, min_w, min_h = 16 / 9, 1280, 650
            kind_weight = {"storyArt": 120, "contextualArtwork": 108, "boxartHighRes": 55, "boxart": 35}.get(kind, 0)
        elif context == "top10":
            target, min_w, min_h = 0.70, 500, 700
            kind_weight = {"boxartHighRes": 125, "boxart": 112, "contextualArtwork": 65, "storyArt": 55}.get(kind, 0)
        else:
            target, min_w, min_h = 16 / 9, 640, 320
            kind_weight = {"contextualArtwork": 125, "storyArt": 112, "boxartHighRes": 62, "boxart": 45}.get(kind, 0)

        width = int(asset.get("width") or 0)
        height = int(asset.get("height") or 0)
        if width < min_w or height < min_h:
            return -500.0
        ratio_penalty = abs(math.log(max(ratio, 0.01) / target)) * 90
        quality_bonus = min(80.0, math.log2(max(area, 1)) * 3.2)
        mobile_bonus = 0.0
        if viewport == "mobile" and context not in {"hero", "top10"}:
            # Mobile still uses the horizontal card component. Prefer a little
            # more crop tolerance without ever choosing a lower-resolution asset.
            mobile_bonus = 4.0 if 1.4 <= ratio <= 1.9 else 0.0
        return kind_weight + quality_bonus + mobile_bonus - ratio_penalty

    def _logo(self, assets: list[dict], existing: Optional[dict]) -> Optional[dict]:
        logos = [a for a in assets if a.get("type") in {"titleLogoUnbranded", "titleLogoBranded"}]
        logos.sort(
            key=lambda a: (
                1 if a.get("type") == "titleLogoUnbranded" else 0,
                _area(a),
            ),
            reverse=True,
        )
        if not logos:
            return None
        best = logos[0]
        if existing and _area(existing) and _area(best) < _area(existing):
            return None
        return best

    def _choose(
        self,
        doc: dict,
        *,
        context: str,
        viewport: str,
        profile_id: str,
        existing: dict,
    ) -> tuple[Optional[dict], Optional[dict]]:
        context = (context or "home").lower()
        viewport = "mobile" if viewport == "mobile" else "desktop"
        override = ((doc.get("overrides") or {}).get(context))
        if override:
            return override, None

        assets = [a for a in (doc.get("assets") or []) if a.get("available", True)]
        visual = [
            a
            for a in assets
            if a.get("type") not in {"titleLogoUnbranded", "titleLogoBranded", "brandLogoSmall"}
        ]
        scored = [(self._asset_score(a, context, viewport), a) for a in visual]
        scored = [(score, asset) for score, asset in scored if score > 0]
        scored.sort(key=lambda pair: (pair[0], _area(pair[1])), reverse=True)
        if not scored:
            return None, self._logo(assets, existing.get("logo"))

        top_score = scored[0][0]
        # Only variants within a small score band are considered equivalent.
        equivalent = [a for score, a in scored if top_score - score <= 5 and _area(a) >= _area(scored[0][1]) * 0.8]
        seed = f"{profile_id or 'guest'}|{doc.get('tmdbId')}|{context}|{viewport}|v1"
        digest = int(hashlib.sha256(seed.encode()).hexdigest()[:16], 16)
        chosen = equivalent[digest % len(equivalent)] if equivalent else scored[0][1]

        existing_key = "poster" if context == "top10" else "backdrop"
        existing_visual = existing.get(existing_key)
        if existing_visual and _area(existing_visual) and _area(chosen) < _area(existing_visual) * 0.75:
            chosen = None
        return chosen, self._logo(assets, existing.get("logo"))

    async def resolve(
        self,
        media_type: str,
        tmdb_id: int,
        *,
        context: str = "home",
        viewport: str = "desktop",
        profile_id: str = "guest",
        preview: bool = False,
        force_match: bool = False,
    ) -> dict:
        media_type = "tv" if media_type == "tv" else "movie"
        if not preview and not self.enabled():
            return {
                "active": False,
                "enabled": False,
                "region": self.region(),
                "reason": "feature_disabled",
            }

        doc = await self.auto_match(media_type, tmdb_id, force=force_match)
        base = {
            "active": False,
            "enabled": self.enabled(),
            "region": self.region(),
            "status": doc.get("status", "auto"),
            "netflix_id": doc.get("netflix_id"),
            "confidence": doc.get("confidence", 0),
            "reason": doc.get("reason"),
            "netflix_available": doc.get("netflix_available"),
        }
        if doc.get("status") not in {"matched", "manual"} or not doc.get("netflix_id"):
            if preview:
                base["candidates"] = doc.get("candidates") or []
                base["error"] = doc.get("error")
            return base

        existing = await self._existing_quality(media_type, tmdb_id)
        artwork, logo = self._choose(
            doc,
            context=context,
            viewport=viewport,
            profile_id=profile_id,
            existing=existing,
        )
        result = {
            **base,
            "active": bool(artwork or logo),
            "artwork": artwork,
            "logo": logo,
            "context": context,
            "viewport": viewport,
            "netflix_title": doc.get("netflix_title"),
        }
        if preview:
            result["assets"] = doc.get("assets") or []
            result["overrides"] = doc.get("overrides") or {}
            result["identity"] = doc.get("identity")
            result["candidates"] = doc.get("candidates") or []
            result["existing_quality"] = existing
            result["error"] = doc.get("error")
        return result

    async def test_connection(self) -> dict:
        if not self._cookies():
            return {"ok": False, "detail": "Cookie Netflix non configurati"}
        # A configured manual id, if any, avoids relying on a hard-coded title.
        existing = self.matches.find_one({"netflix_id": {"$exists": True}}, {"_id": 0, "netflix_id": 1})
        if existing and existing.get("netflix_id"):
            try:
                entity = await self.provider.metadata(str(existing["netflix_id"]))
                return {"ok": True, "detail": "Sessione Netflix valida", "sample_title": entity.get("title")}
            except Exception as exc:
                return {"ok": False, "detail": str(exc)}
        try:
            rows = await self.provider.search("Netflix")
            return {
                "ok": True,
                "detail": "Sessione Netflix valida",
                "search_results": len(rows),
            }
        except Exception as exc:
            return {"ok": False, "detail": str(exc)}

    def admin_list(self, limit: int = 100, status: Optional[str] = None) -> list[dict]:
        query = {"status": status} if status else {}
        return list(
            self.matches.find(query, {"_id": 0}).sort("checked_at", -1).limit(max(1, min(limit, 500)))
        )
