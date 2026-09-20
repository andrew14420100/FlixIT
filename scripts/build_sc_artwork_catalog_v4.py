#!/usr/bin/env python3
"""Build the complete StreamingCommunity/StreamingUnity artwork manifest.

Current SC clients expose the catalogue through the localized Inertia archive
(`/it/archive?...&page=N`). Domains rotate, so this builder discovers a working
current domain first, reads `props.titles`, `props.totalCount` and `props.cdn_url`,
then walks every movie and TV page. Only metadata/image filenames are committed;
image binaries remain on the provider CDN.
"""
from __future__ import annotations

import argparse
import html as html_lib
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

import build_sc_artwork_catalog as base

VERSION = "sc-artwork-catalog-v6-current-domain-inertia"
PAGE_SIZE = 60
LANG = os.getenv("SC_ARTWORK_LANG", "it").strip() or "it"
SORT = os.getenv("SC_ARTWORK_SORT", "name").strip() or "name"
MAX_PAGES_PER_TYPE = max(50, int(os.getenv("SC_ARTWORK_MAX_PAGES", "600")))

# Most recent public clients first. `SC_BASE_URL` can override discovery without
# changing code when the provider rotates domains again.
DOMAIN_CANDIDATES = tuple(
    dict.fromkeys(
        [
            os.getenv("SC_BASE_URL", "").strip().rstrip("/"),
            "https://streamingunity.vip",
            "https://streamingunity.co",
            "https://streamingunity.biz",
            "https://streamingunity.so",
            "https://streamingunity.to",
            "https://streamingcommunityz.ninja",
        ]
    )
)

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
        row.get("parentHref"), row.get("href"), row.get("url"),
        row.get("link"), row.get("title_url"),
    )
    match = re.search(r"/titles/(\d+)-([^/?#]+)", href, re.I)
    if not match:
        return None

    sc_id = int(match.group(1))
    slug = match.group(2).strip("/")
    images = base.image_map(row)
    if not images:
        src = _first_text(
            row.get("currentSrc"), row.get("src"), row.get("image_url"),
            row.get("imageUrl"), row.get("thumbnail"), row.get("poster"),
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
    media_type = (
        "tv" if ("tv" in raw_type or "serie" in raw_type or "show" in raw_type)
        else "movie" if ("movie" in raw_type or "film" in raw_type)
        else None
    )

    return {
        "id": sc_id,
        "slug": slug,
        "name": name,
        "type": media_type,
        "year": base.year(
            row.get("release_date") or row.get("first_air_date")
            or row.get("last_air_date") or row.get("year") or row.get("specs")
        ),
        "images": images,
    }


def _data_page(document: str) -> dict:
    match = re.search(r"data-page=(?:\"([^\"]+)\"|'([^']+)')", document or "", re.S | re.I)
    if not match:
        return {}
    raw = html_lib.unescape(match.group(1) or match.group(2) or "")
    try:
        payload = json.loads(raw)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _props(document: str) -> dict:
    page = _data_page(document)
    props = page.get("props") if isinstance(page, dict) else None
    return props if isinstance(props, dict) else {}


def _rows(props: dict) -> list[dict]:
    raw = props.get("titles")
    if not isinstance(raw, list):
        return []
    rows: list[dict] = []
    for item in raw:
        if isinstance(item, list):
            rows.extend(row for row in item if isinstance(row, dict))
        elif isinstance(item, dict):
            rows.append(item)
    return rows


def _archive_url(domain: str, media_type: str, page: int) -> str:
    return f"{domain.rstrip('/')}/{LANG}/archive?type={media_type}&sort={SORT}&page={int(page)}"


def _normalize_cdn(value: Any, domain: str) -> str:
    raw = str(value or "").strip().rstrip("/")
    if not raw:
        host = domain.split("://", 1)[-1].split("/", 1)[0]
        raw = f"https://cdn.{host}"
    if not raw.endswith("/images"):
        raw += "/images"
    return raw + "/"


def _probe_domain(domain: str) -> Optional[dict]:
    if not domain:
        return None
    url = _archive_url(domain, "movie", 1)
    try:
        props = _props(base.get_text(url))
    except Exception as exc:
        print(f"SC domain probe {domain}: {exc}", file=sys.stderr)
        return None
    rows = _rows(props)
    if not rows:
        print(f"SC domain probe {domain}: no archive titles", file=sys.stderr)
        return None
    total = props.get("totalCount") or props.get("total_count") or props.get("total")
    try:
        total = int(total) if total is not None else None
    except Exception:
        total = None
    cdn = _normalize_cdn(props.get("cdn_url"), domain)
    print(
        f"SC domain selected: {domain} ({len(rows)} first-page titles, total={total}, cdn={cdn})",
        file=sys.stderr,
    )
    return {"domain": domain, "cdn": cdn, "first_props": props, "movie_total": total}


def discover_domain() -> dict:
    for domain in DOMAIN_CANDIDATES:
        hit = _probe_domain(domain)
        if hit:
            return hit
    raise RuntimeError("No current StreamingCommunity/StreamingUnity archive domain responded")


def _fingerprint(rows: list[dict]) -> str:
    ids = [str(row.get("id") or row.get("slug") or row.get("name") or "") for row in rows]
    return "|".join(ids[:6] + ids[-6:])


def _walk_type(domain: str, media_type: str, first_props: Optional[dict] = None) -> tuple[list[dict], Optional[int], Optional[str]]:
    records: list[dict] = []
    seen_pages: set[str] = set()
    known_total: Optional[int] = None
    found_cdn: Optional[str] = None

    for page in range(1, MAX_PAGES_PER_TYPE + 1):
        try:
            props = first_props if page == 1 and first_props is not None else _props(base.get_text(_archive_url(domain, media_type, page)))
        except Exception as exc:
            print(f"SC {media_type} page {page}: {exc}", file=sys.stderr)
            break

        rows = _rows(props)
        if not rows:
            print(f"SC {media_type}: empty page {page}; done", file=sys.stderr)
            break

        if not found_cdn and props.get("cdn_url"):
            found_cdn = _normalize_cdn(props.get("cdn_url"), domain)

        if known_total is None:
            raw_total = props.get("totalCount") or props.get("total_count") or props.get("total")
            try:
                known_total = int(raw_total) if raw_total is not None else None
            except Exception:
                known_total = None

        fingerprint = _fingerprint(rows)
        if fingerprint and fingerprint in seen_pages:
            print(f"SC {media_type}: repeated page {page}; done", file=sys.stderr)
            break
        if fingerprint:
            seen_pages.add(fingerprint)

        added = 0
        for raw in rows:
            enriched = dict(raw)
            enriched["type"] = media_type
            item = base.record_from_archive(enriched)
            if item:
                item["type"] = media_type
                records.append(item)
                added += 1

        if page == 1 or page % 25 == 0:
            print(
                f"SC {media_type}: page {page}, {len(rows)} raw / {added} artwork, total artwork={len(records)}, reported={known_total}",
                file=sys.stderr,
            )

        if len(rows) < PAGE_SIZE:
            print(f"SC {media_type}: final short page {page} ({len(rows)})", file=sys.stderr)
            break
        if known_total and page >= math.ceil(known_total / PAGE_SIZE):
            print(f"SC {media_type}: reached reported total on page {page}", file=sys.stderr)
            break
        if base.REQUEST_DELAY_SECONDS:
            time.sleep(base.REQUEST_DELAY_SECONDS)

    return records, known_total, found_cdn


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="backend/data/sc_artwork_catalog.json")
    parser.add_argument("--minimum", type=int, default=17000)
    parser.add_argument("--no-seed-fallback", action="store_true")
    args = parser.parse_args()

    source = discover_domain()
    domain = source["domain"]
    cdn = source["cdn"]

    movie_records, movie_total, movie_cdn = _walk_type(domain, "movie", source.get("first_props"))
    tv_records, tv_total, tv_cdn = _walk_type(domain, "tv")
    cdn = movie_cdn or tv_cdn or cdn

    merged = base.merge([*movie_records, *tv_records])
    source_name = "streamingunity_inertia_archive"
    if len(merged) < max(1, args.minimum) and not args.no_seed_fallback:
        print(
            f"current archive yielded {len(merged)} entries; merging public GitHub snapshots as fallback",
            file=sys.stderr,
        )
        merged = base.merge([*merged, *base.seed_records()])
        source_name += "+github_seed"

    if not merged:
        print("no artwork records found; refusing to overwrite catalog", file=sys.stderr)
        return 2

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": VERSION,
        "source": source_name,
        "source_base_url": domain,
        "cdn_base_url": cdn,
        "generated_at_unix": int(time.time()),
        "reported_movie_count": movie_total,
        "reported_tv_count": tv_total,
        "count": len(merged),
        "titles": merged,
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"wrote {len(merged)} artwork titles to {output} (domain={domain}, cdn={cdn}, movie_reported={movie_total}, tv_reported={tv_total})"
    )
    return 0


base.record_from_seed = _seed_record

if __name__ == "__main__":
    raise SystemExit(main())
