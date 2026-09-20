#!/usr/bin/env python3
"""Build the complete StreamingCommunity/StreamingUnity artwork manifest.

StreamingUnity deliberately caps an individual archive query at 20 pages. The
site itself exposes year and genre filters, so the catalogue is enumerated as
small public archive segments (type -> year -> genre when required), then
merged by SC title id. This mirrors the strategy used by current open-source SC
catalog clients and avoids runtime title-by-title artwork lookups.
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
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import build_sc_artwork_catalog as base

VERSION = "sc-artwork-catalog-v7-segmented-inertia"
PAGE_SIZE = 60
PAGE_CAP = 20
LANG = os.getenv("SC_ARTWORK_LANG", "it").strip() or "it"
MIN_YEAR = max(1900, int(os.getenv("SC_ARTWORK_MIN_YEAR", "1910")))
MAX_TRANSIENT_RETRIES = max(1, int(os.getenv("SC_ARTWORK_TRANSIENT_RETRIES", "8")))

GENRE_IDS = (
    4, 13, 11, 19, 12, 2, 24, 1, 16, 8, 22, 7, 25, 26, 14, 6,
    37, 18, 15, 3, 10, 23, 5, 21, 9, 17, 20,
)

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
            row.get("imageUrl"), row.get("thumbnail"), row.get("poster"), row.get("cover"),
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
            row.get("release_date") or row.get("first_air_date") or row.get("last_air_date")
            or row.get("year") or row.get("specs")
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
    payload = _data_page(document)
    props = payload.get("props") if isinstance(payload, dict) else None
    return props if isinstance(props, dict) else {}


def _html_rows(props: dict) -> list[dict]:
    raw = props.get("titles")
    return [row for row in raw if isinstance(row, dict)] if isinstance(raw, list) else []


def _normalize_cdn(value: Any, domain: str) -> str:
    raw = str(value or "").strip().rstrip("/")
    if not raw:
        host = domain.split("://", 1)[-1].split("/", 1)[0]
        raw = f"https://cdn.{host}"
    if not raw.endswith("/images"):
        raw += "/images"
    return raw + "/"


def _html_archive_url(domain: str, media_type: str, page: int = 1) -> str:
    params = urllib.parse.urlencode({"type": media_type, "sort": "name", "page": int(page)})
    return f"{domain.rstrip('/')}/{LANG}/archive?{params}"


def _probe_type(domain: str, media_type: str) -> Optional[dict]:
    try:
        props = _props(base.get_text(_html_archive_url(domain, media_type, 1)))
    except Exception as exc:
        print(f"SC probe {domain} {media_type}: {exc}", file=sys.stderr)
        return None
    rows = _html_rows(props)
    if not rows:
        return None
    raw_total = props.get("totalCount") or props.get("total_count") or props.get("total")
    try:
        total = int(raw_total) if raw_total is not None else None
    except Exception:
        total = None
    return {
        "rows": rows,
        "total": total,
        "cdn": _normalize_cdn(props.get("cdn_url"), domain),
    }


def discover_domain() -> dict:
    for domain in DOMAIN_CANDIDATES:
        if not domain:
            continue
        movie = _probe_type(domain, "movie")
        if not movie:
            continue
        tv = _probe_type(domain, "tv")
        if not tv:
            continue
        cdn = movie.get("cdn") or tv.get("cdn") or _normalize_cdn(None, domain)
        print(
            f"SC domain selected: {domain}; movie={movie.get('total')}, tv={tv.get('total')}, cdn={cdn}",
            file=sys.stderr,
        )
        return {"domain": domain, "cdn": cdn, "movie_total": movie.get("total"), "tv_total": tv.get("total")}
    raise RuntimeError("No current StreamingCommunity/StreamingUnity archive domain responded")


def _json_archive_url(domain: str, media_type: str, page: int, year: Optional[int] = None, genre_id: Optional[int] = None) -> str:
    params: list[tuple[str, str]] = [
        ("lang", LANG),
        ("page", str(int(page))),
        ("type", media_type),
    ]
    if year is not None:
        params.append(("year", str(int(year))))
    if genre_id is not None:
        params.append(("genre[]", str(int(genre_id))))
    return f"{domain.rstrip('/')}/{LANG}/archive?{urllib.parse.urlencode(params)}"


def _request_archive_json(domain: str, media_type: str, page: int, year: Optional[int] = None, genre_id: Optional[int] = None) -> Optional[dict]:
    url = _json_archive_url(domain, media_type, page, year, genre_id)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": base.USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.7",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{domain.rstrip('/')}/{LANG}/archive",
        },
    )

    for attempt in range(MAX_TRANSIENT_RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = json.loads(response.read().decode("utf-8", errors="replace"))
            if not isinstance(payload, dict):
                return None
            data = payload.get("data")
            if not isinstance(data, list):
                # Some deployments can still return an Inertia-style wrapper.
                props = payload.get("props") if isinstance(payload.get("props"), dict) else {}
                data = props.get("titles") if isinstance(props.get("titles"), list) else []
                total = props.get("totalCount") or len(data)
                last_page = math.ceil(int(total or 0) / PAGE_SIZE) if total else 1
                return {"records": data, "total": int(total or 0), "last_page": int(last_page), "limited": False}
            return {
                "records": [row for row in data if isinstance(row, dict)],
                "total": int(payload.get("total") or len(data)),
                "last_page": int(payload.get("last_page") or 1),
                "current_page": int(payload.get("current_page") or page),
                "limited": False,
            }
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            if exc.code in (422, 503) and re.search(r"page .*superiore a 20|page limit reached", body, re.I):
                return {"records": [], "total": 0, "last_page": PAGE_CAP, "limited": True}
            if exc.code not in (429, 502, 503, 504) or attempt >= MAX_TRANSIENT_RETRIES - 1:
                print(f"SC archive request failed {exc.code}: {url}", file=sys.stderr)
                return None
            delay = base._retry_delay(exc, attempt)
            print(f"transient HTTP {exc.code} for segment; retry in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
        except Exception as exc:
            if attempt >= MAX_TRANSIENT_RETRIES - 1:
                print(f"SC archive request failed: {url}: {exc}", file=sys.stderr)
                return None
            time.sleep(min(12.0, 2.0 * (attempt + 1)))
    return None


def _segment_key(media_type: str, year: Optional[int], genre_id: Optional[int]) -> str:
    return f"{media_type}:{year or '*'}:{genre_id or '*'}"


def _build_segments(domain: str) -> list[dict]:
    segments: list[dict] = []
    current_year = datetime.utcnow().year
    probes = 0

    for media_type in ("movie", "tv"):
        for year in range(current_year, MIN_YEAR - 1, -1):
            first = _request_archive_json(domain, media_type, 1, year=year)
            probes += 1
            if not first or first.get("total", 0) <= 0:
                continue

            last_page = int(first.get("last_page") or 1)
            if first.get("limited") or last_page > PAGE_CAP:
                # Keep the first 20 pages as a safety net for titles with no genre,
                # then use the site's public genre filter to expose the rest.
                segments.append({
                    "type": media_type, "year": year, "genre": None,
                    "first": first, "max_pages": PAGE_CAP, "mode": "year-top",
                })
                for genre_id in GENRE_IDS:
                    by_genre = _request_archive_json(domain, media_type, 1, year=year, genre_id=genre_id)
                    probes += 1
                    if not by_genre or by_genre.get("total", 0) <= 0:
                        continue
                    segments.append({
                        "type": media_type, "year": year, "genre": genre_id,
                        "first": by_genre,
                        "max_pages": min(PAGE_CAP, int(by_genre.get("last_page") or 1)),
                        "mode": "year-genre",
                    })
            else:
                segments.append({
                    "type": media_type, "year": year, "genre": None,
                    "first": first, "max_pages": min(PAGE_CAP, last_page), "mode": "year",
                })

            if base.REQUEST_DELAY_SECONDS:
                time.sleep(min(base.REQUEST_DELAY_SECONDS, 0.35))

        # Also keep the first 20 unfiltered pages to catch entries whose release
        # year is absent or outside the site's year filter choices.
        fallback = _request_archive_json(domain, media_type, 1)
        probes += 1
        if fallback and fallback.get("total", 0) > 0:
            segments.append({
                "type": media_type, "year": None, "genre": None,
                "first": fallback,
                "max_pages": min(PAGE_CAP, int(fallback.get("last_page") or PAGE_CAP)),
                "mode": "fallback-top",
            })

    print(f"prepared {len(segments)} public archive segments from {probes} probes", file=sys.stderr)
    return segments


def _records_from_rows(rows: list[dict], media_type: str) -> list[dict]:
    out: list[dict] = []
    for raw in rows:
        enriched = dict(raw)
        enriched["type"] = media_type
        item = base.record_from_archive(enriched)
        if item:
            item["type"] = media_type
            out.append(item)
    return out


def _crawl_segments(domain: str, segments: list[dict]) -> list[dict]:
    records: list[dict] = []
    for index, segment in enumerate(segments, start=1):
        media_type = segment["type"]
        year = segment["year"]
        genre = segment["genre"]
        first = segment["first"]
        max_pages = max(1, min(PAGE_CAP, int(segment.get("max_pages") or 1)))

        records.extend(_records_from_rows(first.get("records") or [], media_type))
        for page in range(2, max_pages + 1):
            payload = _request_archive_json(domain, media_type, page, year=year, genre_id=genre)
            if not payload or payload.get("limited"):
                break
            rows = payload.get("records") or []
            if not rows:
                break
            records.extend(_records_from_rows(rows, media_type))
            if len(rows) < PAGE_SIZE:
                break
            if base.REQUEST_DELAY_SECONDS:
                time.sleep(base.REQUEST_DELAY_SECONDS)

        if index == 1 or index % 25 == 0 or index == len(segments):
            unique_now = len(base.merge(records))
            print(
                f"segment {index}/{len(segments)} {segment['mode']} {_segment_key(media_type, year, genre)} -> {unique_now} unique artwork titles",
                file=sys.stderr,
            )
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="backend/data/sc_artwork_catalog.json")
    parser.add_argument("--minimum", type=int, default=18000)
    parser.add_argument("--no-seed-fallback", action="store_true")
    args = parser.parse_args()

    source = discover_domain()
    domain = source["domain"]
    cdn = source["cdn"]
    movie_total = source.get("movie_total")
    tv_total = source.get("tv_total")
    reported_total = int(movie_total or 0) + int(tv_total or 0)

    segments = _build_segments(domain)
    records = _crawl_segments(domain, segments)
    merged = base.merge(records)
    source_name = "streamingunity_segmented_public_archive"

    if len(merged) < max(1, args.minimum) and not args.no_seed_fallback:
        print(
            f"segmented archive yielded {len(merged)} entries; merging public GitHub snapshots as fallback",
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
        "reported_total_count": reported_total,
        "count": len(merged),
        "coverage_ratio": round((len(merged) / reported_total), 6) if reported_total else None,
        "titles": merged,
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"wrote {len(merged)} artwork titles to {output}; reported={reported_total}; coverage={payload['coverage_ratio']}; domain={domain}; cdn={cdn}"
    )
    return 0


base.record_from_seed = _seed_record

if __name__ == "__main__":
    raise SystemExit(main())
