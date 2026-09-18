from __future__ import annotations

import json
import re
from typing import Any

from ..base import TrailerCandidate, normalize_title
from ..manifest import probe_direct_file
from .common import client


def _next_data(html: str) -> dict:
    m = re.search(r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', html, re.I | re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except Exception:
        return {}


def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _video_ids(data: dict) -> list[str]:
    ids: list[str] = []
    for row in _walk(data):
        rid = row.get("id")
        ctype = normalize_title(((row.get("contentType") or {}).get("id") if isinstance(row.get("contentType"), dict) else row.get("contentType")) or "")
        if isinstance(rid, str) and rid.startswith("vi") and ("trailer" in ctype or "teaser" in ctype or not ctype):
            if rid not in ids:
                ids.append(rid)
    return ids[:12]


def _playback_rows(data: dict) -> tuple[str, list[dict]]:
    video = (((data.get("props") or {}).get("pageProps") or {}).get("videoPlaybackData") or {}).get("video") or {}
    title = str(((video.get("name") or {}).get("value") if isinstance(video.get("name"), dict) else video.get("name")) or "Trailer")
    rows = []
    for item in video.get("playbackURLs") or []:
        url = item.get("url")
        if not url or str(item.get("videoMimeType") or "").upper() == "M3U8":
            continue
        label = ((item.get("displayName") or {}).get("value") if isinstance(item.get("displayName"), dict) else item.get("displayName")) or ""
        m = re.search(r"(\d{3,4})p", str(label), re.I)
        rows.append({"url": url, "reported_height": int(m.group(1)) if m else None})
    return title, rows


class IMDbTrailerProvider:
    name = "imdb"

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        imdb_id = str((identity.get("external_ids") or {}).get("imdb_id") or "").strip()
        if not re.fullmatch(r"tt\d+", imdb_id):
            return []
        title_page = f"https://www.imdb.com/title/{imdb_id}/"
        candidates: list[TrailerCandidate] = []
        async with client() as http:
            try:
                response = await http.get(title_page)
                if response.status_code != 200:
                    return []
                ids = _video_ids(_next_data(response.text))
            except Exception:
                return []
            for video_id in ids:
                try:
                    page = await http.get(f"https://www.imdb.com/video/{video_id}/")
                    if page.status_code != 200:
                        continue
                    title, rows = _playback_rows(_next_data(page.text))
                    trailer_type = "Official Trailer" if "trailer" in normalize_title(title) else ("Teaser" if "teaser" in normalize_title(title) else "Trailer")
                    for row in rows:
                        # Do not trust IMDb's visual quality label alone: probe the actual remote file.
                        probed = await probe_direct_file(row["url"])
                        if not probed:
                            continue
                        candidates.append(
                            TrailerCandidate(
                                source=self.name,
                                trailer_url=row["url"],
                                provider_id=video_id,
                                provider_page=f"https://www.imdb.com/video/{video_id}/",
                                matched_title=identity.get("title"),
                                matched_year=identity.get("year"),
                                media_type=identity.get("type"),
                                title=title,
                                trailer_type=trailer_type,
                                official=True,
                                width=probed.get("width"),
                                height=probed.get("height"),
                                bitrate=probed.get("bitrate"),
                                codec=probed.get("codec"),
                                fps=probed.get("fps"),
                                audio_language=probed.get("audio_language") or "en",
                                audio_codec=probed.get("audio_codec"),
                                audio_bitrate=probed.get("audio_bitrate"),
                                confidence=1.0,
                                verified=True,
                                browser_compatible=True,
                                compatibility="mp4",
                                metadata={"imdb_id": imdb_id, "reported_height": row.get("reported_height")},
                            )
                        )
                except Exception:
                    continue
        return candidates
