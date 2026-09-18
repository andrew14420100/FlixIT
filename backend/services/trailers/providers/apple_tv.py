from __future__ import annotations

import html as html_lib
import json
import re
from typing import Any

from ..base import TrailerCandidate, confidence_for_identity, extract_year, normalize_title
from ..manifest import inspect_hls
from .common import client, google_site_search, meta


def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _serialized(html: str) -> list[Any]:
    out = []
    for sid in ("serialized-server-data", "shoebox-uts-api-cache"):
        m = re.search(rf'<script[^>]+id=["\']{sid}["\'][^>]*>(.*?)</script>', html, re.I | re.S)
        if not m:
            continue
        try:
            out.append(json.loads(html_lib.unescape(m.group(1))))
        except Exception:
            pass
    return out


def _page_identity(html: str) -> tuple[str, int | None]:
    title = meta(html, "og:title") or ""
    title = re.split(r"[|–—]", title)[0].strip()
    year = None
    for root in _serialized(html):
        for row in _walk(root):
            if not title:
                title = str(row.get("title") or row.get("name") or "")
            year = year or extract_year(row.get("releaseDate") or row.get("release_date") or row.get("year"))
            if title and year:
                return title, year
    return title, year


def _trailers(html: str) -> list[dict]:
    found: list[dict] = []
    for root in _serialized(html):
        for row in _walk(root):
            hls = row.get("hlsUrl") or row.get("hlsURL")
            if hls:
                title = str(row.get("title") or row.get("name") or "Trailer")
                if any(word in normalize_title(title) for word in ("trailer", "teaser", "clip")):
                    found.append({"title": title, "hls": hls})
    og = meta(html, "og:video")
    if og and not found:
        found.append({"title": "Official Trailer", "hls": og})
    dedupe = {}
    for item in found:
        dedupe[item["hls"]] = item
    return list(dedupe.values())


class AppleTVTrailerProvider:
    name = "apple_tv"

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        query = f"{identity.get('title') or identity.get('original_title')} {identity.get('year') or ''}".strip()
        pages = []
        manual = ((identity.get("provider_pages") or {}).get("apple_tv") or "").strip()
        if manual:
            pages.append(manual)
        for result in await google_site_search(query, "tv.apple.com", 5):
            url = result.get("link")
            if url and url not in pages:
                pages.append(url)
        candidates: list[TrailerCandidate] = []
        async with client() as http:
            for page_url in pages[:5]:
                try:
                    response = await http.get(page_url)
                    if response.status_code != 200:
                        continue
                    page_title, page_year = _page_identity(response.text)
                    confidence = confidence_for_identity(identity, page_title, page_year, identity.get("type"))
                    if confidence < 0.90:
                        continue
                    for trailer in _trailers(response.text):
                        rows = await inspect_hls(
                            http,
                            trailer["hls"],
                            source=self.name,
                            confidence=confidence,
                            provider_page=page_url,
                            matched_title=page_title,
                            matched_year=page_year,
                            trailer_type=trailer["title"],
                            official=True,
                            default_language="it-IT" if "/it/" in page_url.lower() else None,
                        )
                        candidates.extend(rows)
                except Exception:
                    continue
        return candidates
