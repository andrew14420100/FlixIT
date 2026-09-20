"""Full StreamingCommunity artwork catalog for FLIX-IT.

The catalogue stores metadata and CDN references only; image binaries stay on the
upstream CDN. The committed JSON snapshot is the primary source. A full runtime
archive rebuild is optional because walking hundreds of SC pages must never block
the first card request in production.
"""
from __future__ import annotations

import asyncio
import html as html_lib
import json
import os
import re
import time
import unicodedata
from pathlib import Path
from typing import Any, Optional

CATALOG_VERSION = "sc-artwork-catalog-v2-paginated"
SC_BASE_URL = os.getenv("SC_BASE_URL", "https://streamingcommunityz.ninja").rstrip("/")
SC_CDN_BASE = os.getenv("SC_CDN_BASE", f"{SC_BASE_URL}/images/").rstrip("/") + "/"
SC_ARCHIVE_PATHS = (
    "/it/archive?sort=name",
    "/it/archive?type=movie&sort=name",
    "/it/archive?type=tv&sort=name",
)
CATALOG_PATH = Path(
    os.getenv(
        "SC_ARTWORK_CATALOG_PATH",
        str(Path(__file__).resolve().parents[1] / "data" / "sc_artwork_catalog.json"),
    )
)
MIN_ARCHIVE_ROWS = max(100, int(os.getenv("SC_ARTWORK_MIN_ARCHIVE_ROWS", "1000")))
MAX_ARCHIVE_PAGES = max(50, int(os.getenv("SC_ARTWORK_MAX_ARCHIVE_PAGES", "500")))
REFRESH_RETRY_SECONDS = max(60, int(os.getenv("SC_ARTWORK_REFRESH_RETRY_SECONDS", "900")))
RUNTIME_REFRESH_ENABLED = str(os.getenv("SC_ARTWORK_ALLOW_RUNTIME_REFRESH", "0")).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


def normalize_title(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip().lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _year(value: Any) -> Optional[int]:
    match = re.search(r"(?:19|20)\d{2}", str(value or ""))
    return int(match.group(0)) if match else None


def _flatten_rows(value: Any) -> list[dict]:
    if isinstance(value, dict):
        for key in ("data", "items", "results", "titles"):
            nested = value.get(key)
            if isinstance(nested, list):
                return _flatten_rows(nested)
        return [value]
    out: list[dict] = []
    if isinstance(value, list):
        for item in value:
            out.extend(_flatten_rows(item))
    return out


def _extract_data_page(document: str) -> dict:
    match = re.search(r"data-page=(?:\"([^\"]+)\"|'([^']+)')", document or "", re.S | re.I)
    if not match:
        return {}
    raw = match.group(1) or match.group(2) or ""
    try:
        return json.loads(html_lib.unescape(raw))
    except Exception:
        return {}


def _extract_archive_rows(document: str) -> list[dict]:
    page = _extract_data_page(document)
    props = page.get("props") if isinstance(page, dict) else None
    if not isinstance(props, dict):
        return []
    for key in ("titles", "items", "results"):
        rows = _flatten_rows(props.get(key))
        if rows:
            return rows
    return []


def _image_map(row: dict) -> dict[str, str]:
    images = row.get("images") or row.get("artworks") or []
    if isinstance(images, dict):
        items = []
        for key, value in images.items():
            if isinstance(value, dict):
                items.append({"type": value.get("type") or key, **value})
            else:
                items.append({"type": key, "filename": value})
        images = items
    if not isinstance(images, list):
        images = []

    out: dict[str, str] = {}
    for image in images:
        if not isinstance(image, dict):
            continue
        kind = str(image.get("type") or image.get("kind") or image.get("role") or "").strip().lower()
        raw = str(
            image.get("filename")
            or image.get("file")
            or image.get("uuid")
            or image.get("path")
            or image.get("url")
            or image.get("src")
            or ""
        ).strip()
        if not kind or not raw:
            continue
        filename = raw.rsplit("/", 1)[-1].split("?", 1)[0]
        if filename:
            out.setdefault(kind, filename)
    return out


def _record(row: dict) -> Optional[dict]:
    name = str(row.get("name") or row.get("title") or "").strip()
    if not name:
        return None
    raw_id = row.get("id") or row.get("title_id") or row.get("sc_id")
    try:
        sc_id = int(raw_id) if raw_id is not None else None
    except Exception:
        sc_id = None
    slug = str(row.get("slug") or "").strip()
    media_type = str(row.get("type") or row.get("media_type") or "").strip().lower()
    if "tv" in media_type or "serie" in media_type or "show" in media_type:
        media_type = "tv"
    elif media_type:
        media_type = "movie"
    images = _image_map(row)
    if not images:
        return None
    return {
        "id": sc_id,
        "slug": slug,
        "name": name,
        "type": media_type or None,
        "year": _year(
            row.get("release_date")
            or row.get("first_air_date")
            or row.get("last_air_date")
            or row.get("year")
        ),
        "images": images,
    }


def _merge_records(rows: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for row in rows:
        record = _record(row)
        if not record:
            continue
        key = str(record.get("id") or "")
        if not key:
            key = f"{normalize_title(record.get('name'))}|{record.get('type') or ''}|{record.get('year') or ''}"
        current = merged.get(key)
        if current is None:
            merged[key] = record
            continue
        current_images = current.setdefault("images", {})
        current_images.update({k: v for k, v in (record.get("images") or {}).items() if v})
        for field in ("slug", "type", "year"):
            if not current.get(field) and record.get(field):
                current[field] = record[field]
    return sorted(
        merged.values(), key=lambda row: (normalize_title(row.get("name")), row.get("id") or 0)
    )


def _url_for(filename: Any) -> Optional[str]:
    text = str(filename or "").strip()
    if not text:
        return None
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return f"{SC_CDN_BASE}{text.lstrip('/')}"


def _role_url(record: dict, role: str) -> Optional[str]:
    images = record.get("images") or {}
    if role == "landscape":
        keys = ("cover", "cover_desktop", "landscape", "card")
    elif role == "poster":
        keys = ("poster", "cover_mobile", "poster_mobile", "cover")
    elif role == "background":
        keys = ("background", "backdrop", "hero", "wallpaper", "cover")
    else:
        keys = ("logo", "title_logo", "title-treatment", "title_treatment")
    for key in keys:
        if images.get(key):
            return _url_for(images[key])
    return None


def _paged_path(path: str, page: int) -> str:
    separator = "&" if "?" in path else "?"
    return f"{path}{separator}page={int(page)}"


def _page_fingerprint(rows: list[dict]) -> str:
    values = [
        str(row.get("id") or row.get("title_id") or row.get("slug") or row.get("name") or "")
        for row in rows
        if isinstance(row, dict)
    ]
    return "|".join(values[:8] + values[-8:]) if values else ""


class SCArtworkCatalog:
    def __init__(self, path: Path = CATALOG_PATH):
        self.path = Path(path)
        self.records: list[dict] = []
        self.by_title: dict[str, list[dict]] = {}
        self.by_token: dict[str, list[dict]] = {}
        self.loaded = False
        self.last_refresh_attempt = 0.0
        self.last_refresh_ok: Optional[float] = None
        self._lock = asyncio.Lock()

    def _reindex(self) -> None:
        by_title: dict[str, list[dict]] = {}
        by_token: dict[str, list[dict]] = {}
        for row in self.records:
            normalized = normalize_title(row.get("name"))
            if not normalized:
                continue
            by_title.setdefault(normalized, []).append(row)
            for token in set(normalized.split()):
                if len(token) >= 3:
                    by_token.setdefault(token, []).append(row)
        self.by_title = by_title
        self.by_token = by_token

    def load(self) -> int:
        if self.loaded:
            return len(self.records)
        self.loaded = True
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            rows = payload.get("titles") if isinstance(payload, dict) else payload
            if isinstance(rows, list):
                self.records = [row for row in rows if isinstance(row, dict)]
        except Exception:
            self.records = []
        self._reindex()
        return len(self.records)

    def _save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "version": CATALOG_VERSION,
                "source": SC_BASE_URL,
                "count": len(self.records),
                "titles": self.records,
            }
            tmp = self.path.with_suffix(self.path.suffix + ".tmp")
            tmp.write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            tmp.replace(self.path)
        except Exception:
            pass

    async def _paginate(self, http, path: str) -> list[dict]:
        rows: list[dict] = []
        seen_pages: set[str] = set()
        first_page_size: Optional[int] = None
        for page in range(1, MAX_ARCHIVE_PAGES + 1):
            try:
                response = await http.get(
                    f"{SC_BASE_URL}{_paged_path(path, page)}",
                    headers={
                        "Accept": "text/html,application/xhtml+xml",
                        "Accept-Language": "it-IT,it;q=0.9,en;q=0.7",
                        "Referer": f"{SC_BASE_URL}/",
                    },
                )
                if response.status_code != 200:
                    break
                page_rows = _extract_archive_rows(response.text)
            except Exception:
                break
            if not page_rows:
                break
            fingerprint = _page_fingerprint(page_rows)
            if fingerprint and fingerprint in seen_pages:
                break
            if fingerprint:
                seen_pages.add(fingerprint)
            if first_page_size is None:
                first_page_size = len(page_rows)
            rows.extend(page_rows)
            if first_page_size and len(page_rows) < first_page_size:
                break
            await asyncio.sleep(0.03)
        return rows

    async def refresh(self, http) -> int:
        """Optional full runtime refresh; disabled by default in production."""
        rows: list[dict] = []
        self.last_refresh_attempt = time.time()
        rows.extend(await self._paginate(http, SC_ARCHIVE_PATHS[0]))
        merged = _merge_records(rows)
        if len(merged) < MIN_ARCHIVE_ROWS:
            for path in SC_ARCHIVE_PATHS[1:]:
                rows.extend(await self._paginate(http, path))
            merged = _merge_records(rows)
        if len(merged) >= MIN_ARCHIVE_ROWS:
            self.records = merged
            self.loaded = True
            self._reindex()
            self._save()
            self.last_refresh_ok = time.time()
        return len(self.records)

    async def ensure(self, http) -> int:
        self.load()
        if self.records:
            return len(self.records)
        # With the committed catalog absent, keep the request fast and let the
        # existing per-title SC resolver handle this one card. Full archive
        # rebuilds belong to GitHub Actions unless explicitly enabled.
        if not RUNTIME_REFRESH_ENABLED:
            return 0
        now = time.time()
        if now - self.last_refresh_attempt < REFRESH_RETRY_SECONDS:
            return 0
        async with self._lock:
            if self.records:
                return len(self.records)
            if time.time() - self.last_refresh_attempt < REFRESH_RETRY_SECONDS:
                return 0
            return await self.refresh(http)

    def candidates(self, identity: dict) -> list[dict]:
        variants: list[str] = []
        for raw in (identity.get("title"), identity.get("original_title")):
            text = str(raw or "").strip()
            if not text:
                continue
            variants.extend(
                [
                    text,
                    re.split(r"\s*[:|–—-]\s*", text, maxsplit=1)[0],
                    re.sub(r"\s*\([^)]*\)\s*", " ", text).strip(),
                ]
            )

        out: list[dict] = []
        seen: set[int] = set()
        normalized_variants = [
            normalize_title(value) for value in variants if normalize_title(value)
        ]
        for key in normalized_variants:
            for row in self.by_title.get(key, []):
                marker = id(row)
                if marker not in seen:
                    seen.add(marker)
                    out.append(row)
        if out:
            return out

        tokens = {
            token
            for key in normalized_variants
            for token in key.split()
            if len(token) >= 3
        }
        ranked_tokens = sorted(tokens, key=len, reverse=True)[:4]
        for token in ranked_tokens:
            for row in self.by_token.get(token, [])[:250]:
                marker = id(row)
                if marker not in seen:
                    seen.add(marker)
                    out.append(row)
        return out[:400]

    def stats(self) -> dict:
        return {
            "version": CATALOG_VERSION,
            "path": str(self.path),
            "count": len(self.records),
            "loaded": self.loaded,
            "runtime_refresh_enabled": RUNTIME_REFRESH_ENABLED,
            "last_refresh_attempt": self.last_refresh_attempt or None,
            "last_refresh_ok": self.last_refresh_ok,
        }


CATALOG = SCArtworkCatalog()


def install_sc_catalog(policy_module) -> None:
    """Patch the current SC provider so card resolution uses the full local index first."""
    if getattr(policy_module, "_flixit_full_sc_catalog_installed", False):
        return
    original = policy_module._streamingcommunity

    async def streamingcommunity_from_catalog(self, identity: dict) -> dict:
        await CATALOG.ensure(self._http())
        candidates = CATALOG.candidates(identity)
        if candidates:
            ranked = sorted(
                (
                    (float(policy_module._match_score(row, identity)), row)
                    for row in candidates
                ),
                key=lambda pair: pair[0],
                reverse=True,
            )
            confidence, match = ranked[0]
            if confidence >= 0.62:
                landscape = _role_url(match, "landscape")
                poster = _role_url(match, "poster")
                background = _role_url(match, "background") or landscape or poster
                logo = _role_url(match, "logo")
                if landscape or poster:
                    landscape = landscape or poster
                    poster = poster or landscape
                    return {
                        "source": "streamingcommunity",
                        "provider_id": match.get("id") or match.get("slug"),
                        "provider_name": match.get("name"),
                        "confidence": round(float(min(confidence, 1.0)), 4),
                        "landscape_url": landscape,
                        "poster_url": poster,
                        "hero_landscape_url": background,
                        "logo_url": logo,
                        "logo_locale": "it" if logo else None,
                        "landscape_locale": "it",
                        "poster_locale": "it",
                        "hero_landscape_locale": "it",
                        "landscape_width": 0,
                        "landscape_height": 0,
                        "poster_width": 0,
                        "poster_height": 0,
                        "landscape_embedded_title_treatment": bool(landscape),
                        "poster_embedded_title_treatment": bool(poster),
                        "hero_embedded_title_treatment": background in {landscape, poster},
                        "sc_cover_imported": True,
                        "sc_catalog_hit": True,
                        "sc_catalog_size": len(CATALOG.records),
                        "sc_candidates_seen": len(candidates),
                    }
        result = await original(self, identity)
        if isinstance(result, dict) and result:
            result.setdefault("sc_catalog_hit", False)
            result.setdefault("sc_catalog_size", len(CATALOG.records))
        return result

    policy_module._streamingcommunity = streamingcommunity_from_catalog
    policy_module.POLICY_VERSION = "official-artwork-v9-sc-full-catalog-paginated"
    policy_module._flixit_full_sc_catalog_installed = True


__all__ = [
    "CATALOG",
    "CATALOG_PATH",
    "CATALOG_VERSION",
    "SCArtworkCatalog",
    "install_sc_catalog",
    "normalize_title",
]
