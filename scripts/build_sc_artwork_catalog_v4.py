#!/usr/bin/env python3
"""Build a complete repository-backed StreamingCommunity artwork catalog.

The primary source is StreamingCommunity's public JSON archive API, the same
archive interface used by current open-source StreamingCommunity clients. The
builder walks movie and TV offsets in chunks of 60 and stores image metadata
only (cover/poster/background/logo filenames), never image binaries.

Older public GitHub snapshots remain a fallback so a transient SC outage cannot
replace a good committed catalog with an empty one.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
from typing import Any, Optional

import build_sc_artwork_catalog as base

base.VERSION = "sc-artwork-catalog-v5-api-archive"
base.SEED_URLS = (
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/data_new.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/data.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/TV_images.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/output.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/img.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/1.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/1film.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/2.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/2film.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/3.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/3film.json",
)

API_PAGE_SIZE = 60
API_TYPES = ("movie", "tv")
API_LANG = os.getenv("SC_ARTWORK_LANG", "it").strip() or "it"
API_SORT = os.getenv("SC_ARTWORK_API_SORT", "name").strip() or "name"
API_MAX_PAGES_PER_TYPE = max(50, int(os.getenv("SC_ARTWORK_API_MAX_PAGES", "600")))


def _first_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _seed_record(row: dict) -> Optional[dict]:
    if not isinstance(row, dict):
        return None

    href = _first_text(
        row.get("parentHref"),
        row.get("href"),
        row.get("url"),
        row.get("link"),
        row.get("title_url"),
    )
    match = re.search(r"/titles/(\d+)-([^/?#]+)", href, re.I)
    if not match:
        return None

    sc_id = int(match.group(1))
    slug = match.group(2).strip("/")

    images = base.image_map(row)
    if not images:
        src = _first_text(
            row.get("currentSrc"),
            row.get("src"),
            row.get("image_url"),
            row.get("imageUrl"),
            row.get("thumbnail"),
            row.get("poster"),
            row.get("cover"),
        )
        if src:
            filename = src.rsplit("/", 1)[-1].split("?", 1)[0]
            if filename:
                images = {"cover": filename}
    if not images:
        return None

    name = _first_text(row.get("name"), row.get("title"))
    if not name or name.casefold() == slug.casefold():
        name = slug.replace("-", " ").strip().title()

    raw_type = _first_text(row.get("type"), row.get("media_type"), row.get("contentType")).lower()
    if "tv" in raw_type or "serie" in raw_type or "show" in raw_type:
        media_type = "tv"
    elif "movie" in raw_type or "film" in raw_type:
        media_type = "movie"
    else:
        media_type = None

    release_year = base.year(
        row.get("release_date")
        or row.get("first_air_date")
        or row.get("last_air_date")
        or row.get("year")
        or row.get("specs")
    )

    return {
        "id": sc_id,
        "slug": slug,
        "name": name,
        "type": media_type,
        "year": release_year,
        "images": images,
    }


def _titles_from_api_payload(payload: Any) -> list[dict]:
    if isinstance(payload, dict):
        titles = payload.get("titles")
        if isinstance(titles, list):
            return [row for row in titles if isinstance(row, dict)]
        props = payload.get("props")
        if isinstance(props, dict) and isinstance(props.get("titles"), list):
            return [row for row in props["titles"] if isinstance(row, dict)]
        data = payload.get("data")
        if isinstance(data, dict) and isinstance(data.get("titles"), list):
            return [row for row in data["titles"] if isinstance(row, dict)]
    return []


def _api_url(base_url: str, media_type: str, offset: int) -> str:
    query = urllib.parse.urlencode(
        {
            "lang": API_LANG,
            "offset": int(offset),
            "sort": API_SORT,
            "type": media_type,
        }
    )
    return f"{base_url.rstrip('/')}/api/archive?{query}"


def _api_archive_records(base_url: str, minimum: int) -> list[dict]:
    """Walk every SC movie/TV archive offset without per-title lookups."""
    records: list[dict] = []

    for media_type in API_TYPES:
        seen_ids: set[int] = set()
        type_count = 0

        for page_index in range(API_MAX_PAGES_PER_TYPE):
            offset = page_index * API_PAGE_SIZE
            url = _api_url(base_url, media_type, offset)
            try:
                payload = json.loads(base.get_text(url))
            except Exception as exc:
                print(
                    f"SC API {media_type} offset {offset}: {exc}",
                    file=sys.stderr,
                )
                break

            rows = _titles_from_api_payload(payload)
            if not rows:
                print(
                    f"SC API {media_type}: finished at offset {offset} (empty page)",
                    file=sys.stderr,
                )
                break

            new_on_page = 0
            for raw in rows:
                raw = dict(raw)
                raw["type"] = media_type
                item = base.record_from_archive(raw)
                if not item:
                    continue
                item["type"] = media_type
                sc_id = item.get("id")
                if isinstance(sc_id, int):
                    if sc_id in seen_ids:
                        continue
                    seen_ids.add(sc_id)
                records.append(item)
                type_count += 1
                new_on_page += 1

            if page_index == 0 or (page_index + 1) % 25 == 0:
                print(
                    f"SC API {media_type}: offset {offset}, {len(rows)} raw / "
                    f"{new_on_page} artwork, total {type_count}",
                    file=sys.stderr,
                )

            if len(rows) < API_PAGE_SIZE:
                print(
                    f"SC API {media_type}: final offset {offset} ({len(rows)} < {API_PAGE_SIZE})",
                    file=sys.stderr,
                )
                break

            if base.REQUEST_DELAY_SECONDS:
                time.sleep(base.REQUEST_DELAY_SECONDS)
        else:
            print(
                f"SC API {media_type}: reached safety limit of {API_MAX_PAGES_PER_TYPE} pages",
                file=sys.stderr,
            )

    unique_count = len(base.merge(records))
    print(
        f"SC API archive yielded {unique_count} unique artwork titles before GitHub fallback",
        file=sys.stderr,
    )
    return records


base.record_from_seed = _seed_record
base.archive_records = _api_archive_records

if __name__ == "__main__":
    raise SystemExit(base.main())
