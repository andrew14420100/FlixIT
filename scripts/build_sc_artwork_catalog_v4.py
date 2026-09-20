#!/usr/bin/env python3
"""Build the largest repository-backed SC artwork catalog available.

This wraps the throttled archive builder and adds every useful public SC artwork
snapshot already present on GitHub. Seed records are normalized to SC title id +
image filename, so old hostnames are never persisted.
"""
from __future__ import annotations

import re
from typing import Any, Optional

import build_sc_artwork_catalog as base

base.VERSION = "sc-artwork-catalog-v4-expanded-seeds"
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

    # Some snapshots already contain a proper SC images array. Keep every role
    # when present; otherwise the scraped card image is treated as the cover.
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


base.record_from_seed = _seed_record

if __name__ == "__main__":
    raise SystemExit(base.main())
