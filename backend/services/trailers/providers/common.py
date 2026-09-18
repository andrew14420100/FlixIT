from __future__ import annotations

import json
import os
import re
from typing import Optional
from urllib.parse import urlparse

import httpx

from ..base import confidence_for_identity, normalize_title

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(15.0, connect=6.0),
        limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "it-IT,it;q=0.9,en;q=0.7"},
    )


async def google_site_search(query: str, domain: str, limit: int = 5) -> list[dict]:
    key = (os.environ.get("GOOGLE_SEARCH_API_KEY") or "").strip()
    cx = (os.environ.get("GOOGLE_SEARCH_ENGINE_ID") or "").strip()
    if not key or not cx:
        return []
    async with client() as c:
        r = await c.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": key, "cx": cx, "q": f"{query} site:{domain}", "num": min(max(limit, 1), 10)},
        )
    if r.status_code != 200:
        return []
    return [x for x in (r.json().get("items") or []) if domain in (urlparse(x.get("link") or "").hostname or "")]


def meta(html: str, key: str) -> Optional[str]:
    patterns = [
        rf'<meta[^>]+property=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']{re.escape(key)}["\']',
        rf'<meta[^>]+name=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)',
    ]
    for pattern in patterns:
        m = re.search(pattern, html, re.I)
        if m:
            return m.group(1).replace("&amp;", "&").strip()
    return None


def json_script(html: str, element_id: str) -> Optional[dict]:
    m = re.search(rf'<script[^>]+id=["\']{re.escape(element_id)}["\'][^>]*>(.*?)</script>', html, re.I | re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def page_confidence(identity: dict, html: str, fallback_title: str = "") -> float:
    title = meta(html, "og:title") or meta(html, "twitter:title") or fallback_title
    title = re.split(r"[|–—]", title or "")[0].strip()
    # Provider pages often omit year; exact title alone intentionally remains below auto threshold.
    return confidence_for_identity(identity, title, None, identity.get("type"))


def exact_result(identity: dict, title: str, year=None) -> float:
    return confidence_for_identity(identity, title, year, identity.get("type"))


def title_in_url(identity: dict, url: str) -> bool:
    wanted = normalize_title(identity.get("title") or identity.get("original_title"))
    slug = normalize_title(urlparse(url).path.replace("-", " "))
    return bool(wanted and wanted in slug)
