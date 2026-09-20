#!/usr/bin/env python3
"""Build a committed StreamingCommunity artwork index for FLIX-IT.

The script stores metadata plus image filenames/URLs, not image binaries. It
walks every page of the current SC archive and can fall back to older public
GitHub snapshots only when the archive is temporarily unavailable/incomplete.
"""
from __future__ import annotations

import argparse
import html as html_lib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path
from typing import Any, Optional

VERSION = "sc-artwork-catalog-v2-paginated"
DEFAULT_BASE = os.getenv("SC_BASE_URL", "https://streamingcommunityz.ninja").rstrip("/")
# Start with the complete archive. If that route does not expose enough rows, the
# movie/TV archives are walked as a second strategy and merged by SC title id.
ARCHIVE_PATHS = (
    "/it/archive?sort=name",
    "/it/archive?type=movie&sort=name",
    "/it/archive?type=tv&sort=name",
)
SEED_URLS = (
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/img.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/1.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/1film.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/2.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/data/2film.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/3.json",
    "https://raw.githubusercontent.com/FREEDuu/TelegramBOT-anime/main/3film.json",
)
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36"
MAX_ARCHIVE_PAGES = max(50, int(os.getenv("SC_ARTWORK_MAX_ARCHIVE_PAGES", "500")))
REQUEST_DELAY_SECONDS = max(0.0, float(os.getenv("SC_ARTWORK_REQUEST_DELAY", "0.03")))


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip().lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def year(value: Any) -> Optional[int]:
    match = re.search(r"(?:19|20)\d{2}", str(value or ""))
    return int(match.group(0)) if match else None


def get_text(url: str, timeout: int = 45) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.7",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def flatten(value: Any) -> list[dict]:
    if isinstance(value, dict):
        # Laravel/Inertia paginator payloads commonly wrap rows in ``data``.
        for key in ("data", "items", "results", "titles"):
            nested = value.get(key)
            if isinstance(nested, list):
                return flatten(nested)
        return [value]
    out: list[dict] = []
    if isinstance(value, list):
        for item in value:
            out.extend(flatten(item))
    return out


def data_page_rows(document: str) -> list[dict]:
    match = re.search(r"data-page=(?:\"([^\"]+)\"|'([^']+)')", document or "", re.S | re.I)
    if not match:
        return []
    raw = html_lib.unescape(match.group(1) or match.group(2) or "")
    try:
        page = json.loads(raw)
    except Exception:
        return []
    props = page.get("props") if isinstance(page, dict) else None
    if not isinstance(props, dict):
        return []
    for key in ("titles", "items", "results"):
        rows = flatten(props.get(key))
        if rows:
            return rows
    return []


def image_map(row: dict) -> dict[str, str]:
    raw = row.get("images") or row.get("artworks") or []
    if isinstance(raw, dict):
        raw = [
            ({"type": key, **value} if isinstance(value, dict) else {"type": key, "filename": value})
            for key, value in raw.items()
        ]
    if not isinstance(raw, list):
        raw = []
    out: dict[str, str] = {}
    for image in raw:
        if not isinstance(image, dict):
            continue
        kind = str(image.get("type") or image.get("kind") or image.get("role") or "").strip().lower()
        value = str(
            image.get("filename")
            or image.get("file")
            or image.get("uuid")
            or image.get("path")
            or image.get("url")
            or image.get("src")
            or ""
        ).strip()
        if not kind or not value:
            continue
        filename = value.rsplit("/", 1)[-1].split("?", 1)[0]
        if filename:
            out.setdefault(kind, filename)
    return out


def record_from_archive(row: dict) -> Optional[dict]:
    name = str(row.get("name") or row.get("title") or "").strip()
    if not name:
        return None
    try:
        sc_id = int(row.get("id") or row.get("title_id") or row.get("sc_id"))
    except Exception:
        sc_id = None
    kind = str(row.get("type") or row.get("media_type") or "").lower()
    if "tv" in kind or "serie" in kind or "show" in kind:
        kind = "tv"
    elif kind:
        kind = "movie"
    images = image_map(row)
    if not images:
        return None
    return {
        "id": sc_id,
        "slug": str(row.get("slug") or "").strip(),
        "name": name,
        "type": kind or None,
        "year": year(
            row.get("release_date")
            or row.get("first_air_date")
            or row.get("last_air_date")
            or row.get("year")
        ),
        "images": images,
    }


def record_from_seed(row: dict) -> Optional[dict]:
    href = str(row.get("parentHref") or row.get("href") or "").strip()
    src = str(row.get("currentSrc") or row.get("src") or "").strip()
    match = re.search(r"/titles/(\d+)-([^/?#]+)", href)
    if not match or not src:
        return None
    sc_id = int(match.group(1))
    slug = match.group(2)
    filename = src.rsplit("/", 1)[-1].split("?", 1)[0]
    if not filename:
        return None
    return {
        "id": sc_id,
        "slug": slug,
        "name": slug.replace("-", " ").strip().title(),
        "type": None,
        "year": None,
        "images": {"cover": filename},
    }


def merge(records: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for row in records:
        key = str(row.get("id") or "") or f"{normalize(row.get('name'))}|{row.get('type') or ''}|{row.get('year') or ''}"
        current = merged.get(key)
        if current is None:
            merged[key] = row
            continue
        current.setdefault("images", {}).update(
            {k: v for k, v in (row.get("images") or {}).items() if v}
        )
        for field in ("name", "slug", "type", "year"):
            if (
                not current.get(field)
                or (field == "name" and "-" in str(current.get(field)))
            ) and row.get(field):
                current[field] = row[field]
    return sorted(
        merged.values(), key=lambda row: (normalize(row.get("name")), row.get("id") or 0)
    )


def _paged_path(path: str, page: int) -> str:
    separator = "&" if "?" in path else "?"
    return f"{path}{separator}page={int(page)}"


def _page_fingerprint(rows: list[dict]) -> str:
    ids = [
        str(row.get("id") or row.get("title_id") or row.get("slug") or row.get("name") or "")
        for row in rows
        if isinstance(row, dict)
    ]
    if not ids:
        return ""
    sample = ids[:8] + ids[-8:]
    return "|".join(sample)


def paginate_archive(base_url: str, path: str) -> list[dict]:
    records: list[dict] = []
    seen_pages: set[str] = set()
    first_page_size: Optional[int] = None

    for page in range(1, MAX_ARCHIVE_PAGES + 1):
        paged_path = _paged_path(path, page)
        try:
            document = get_text(f"{base_url}{paged_path}")
            rows = data_page_rows(document)
        except Exception as exc:
            print(f"archive {paged_path}: {exc}", file=sys.stderr)
            break

        if not rows:
            print(f"archive {path}: stopped at empty page {page}", file=sys.stderr)
            break

        fingerprint = _page_fingerprint(rows)
        if fingerprint and fingerprint in seen_pages:
            print(
                f"archive {path}: repeated page detected at page {page}; stopping",
                file=sys.stderr,
            )
            break
        if fingerprint:
            seen_pages.add(fingerprint)

        if first_page_size is None:
            first_page_size = len(rows)
            print(
                f"archive {path}: page size {first_page_size}, walking all pages",
                file=sys.stderr,
            )

        before = len(records)
        for row in rows:
            item = record_from_archive(row)
            if item:
                records.append(item)
        added = len(records) - before

        if page == 1 or page % 25 == 0:
            print(
                f"archive {path}: page {page}, {len(rows)} raw / {added} artwork rows, total {len(records)}",
                file=sys.stderr,
            )

        # A short final page is the normal paginator terminator.
        if first_page_size and len(rows) < first_page_size:
            print(
                f"archive {path}: final page {page} ({len(rows)} < {first_page_size})",
                file=sys.stderr,
            )
            break

        if REQUEST_DELAY_SECONDS:
            time.sleep(REQUEST_DELAY_SECONDS)
    else:
        print(
            f"archive {path}: reached safety limit of {MAX_ARCHIVE_PAGES} pages",
            file=sys.stderr,
        )

    return records


def archive_records(base_url: str, minimum: int) -> list[dict]:
    # The unfiltered archive should contain the complete catalogue. Only if it
    # looks incomplete do we spend requests walking movie and TV separately.
    records = paginate_archive(base_url, ARCHIVE_PATHS[0])
    current = merge(records)
    if len(current) >= max(1, minimum):
        print(
            f"archive complete route yielded {len(current)} unique artwork titles",
            file=sys.stderr,
        )
        return records

    print(
        f"archive complete route yielded {len(current)}; walking typed archives too",
        file=sys.stderr,
    )
    for path in ARCHIVE_PATHS[1:]:
        records.extend(paginate_archive(base_url, path))
    return records


def seed_records() -> list[dict]:
    out: list[dict] = []
    for url in SEED_URLS:
        try:
            payload = json.loads(get_text(url))
        except Exception as exc:
            print(f"seed {url}: {exc}", file=sys.stderr)
            continue
        count = 0
        for row in flatten(payload):
            item = record_from_seed(row)
            if item:
                out.append(item)
                count += 1
        print(f"seed {url}: {count} rows", file=sys.stderr)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="backend/data/sc_artwork_catalog.json")
    parser.add_argument("--base-url", default=DEFAULT_BASE)
    parser.add_argument("--minimum", type=int, default=1000)
    parser.add_argument("--no-seed-fallback", action="store_true")
    args = parser.parse_args()

    records = archive_records(args.base_url.rstrip("/"), args.minimum)
    merged = merge(records)
    source = "streamingcommunity_archive_paginated"
    if len(merged) < max(1, args.minimum) and not args.no_seed_fallback:
        print(
            f"archive yielded only {len(merged)} entries; adding public GitHub seeds",
            file=sys.stderr,
        )
        merged = merge([*merged, *seed_records()])
        source = "streamingcommunity_archive_paginated+github_seed"

    if not merged:
        print("no artwork records found; refusing to overwrite the catalog", file=sys.stderr)
        return 2

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": VERSION,
        "source": source,
        "source_base_url": args.base_url.rstrip("/"),
        "generated_at_unix": int(time.time()),
        "count": len(merged),
        "titles": merged,
    }
    output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(merged)} titles to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
