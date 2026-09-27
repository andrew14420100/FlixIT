from __future__ import annotations

import html as html_lib
import re
from typing import Any
from urllib.parse import urljoin

from ..base import (
    TrailerCandidate,
    confidence_for_identity,
    extract_year,
    is_blocked_url,
    normalize_title,
)
from ..manifest import inspect_hls, probe_direct_file
from .common import client, meta

COMINGSOON_ROOT = "https://www.comingsoon.it"
ITUNES_SEARCH_URL = "https://itunes.apple.com/search"


def _strip_tags(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    return " ".join(html_lib.unescape(text).split())


def _is_italian(value: Any) -> bool:
    lang = str(value or "").strip().lower().replace("_", "-")
    return bool(
        lang == "it"
        or lang.startswith("it-")
        or lang in {"ita", "italian", "italiano", "italiana"}
        or lang.startswith("italian-")
    )


def _page_title_year(page_html: str) -> tuple[str, int | None]:
    raw = meta(page_html, "og:title") or ""
    title = re.split(r"\s+-\s+(?:Film|Serie TV)\b", raw, maxsplit=1, flags=re.I)[0].strip()
    year = extract_year(raw)
    if not year:
        match = re.search(r"\bAnno\s*:?[\s\S]{0,90}?((?:19|20)\d{2})\b", page_html, re.I)
        if match:
            year = int(match.group(1))
    return title, year


def _search_links(search_html: str, media_type: str) -> list[str]:
    wanted = "/serietv/" if media_type == "tv" else "/film/"
    out: list[str] = []
    for match in re.finditer(r'href=["\']([^"\']+)["\']', search_html or "", re.I):
        href = html_lib.unescape(match.group(1)).strip()
        if wanted not in href:
            continue
        path = href.split("?", 1)[0].rstrip("/") + "/"
        if media_type == "tv":
            if "/serietv/ricerca/" in path or not re.search(r"/serietv/[^/]+/\d+/$", path, re.I):
                continue
        else:
            if not re.search(r"/film/[^/]+/\d+/$", path, re.I):
                continue
        url = urljoin(COMINGSOON_ROOT, path)
        if url not in out:
            out.append(url)
    return out[:10]


def _italian_trailer_ids(video_html: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    anchor_re = re.compile(
        r'<a\b[^>]*href=["\']([^"\']*(?:\bvid=|\bidv=)\d+[^"\']*)["\'][^>]*>(.*?)</a>',
        re.I | re.S,
    )
    for match in anchor_re.finditer(video_html or ""):
        href = html_lib.unescape(match.group(1))
        label = _strip_tags(match.group(2))
        normalized = normalize_title(label)
        if "trailer" not in normalized:
            continue
        if not any(token in normalized for token in ("italiano", "italiana", " in italiano", " ita ")):
            continue
        id_match = re.search(r"(?:vid|idv)=(\d+)", href, re.I)
        if not id_match:
            continue
        video_id = id_match.group(1)
        if video_id in seen:
            continue
        seen.add(video_id)
        out.append((video_id, label or "Trailer Italiano"))
    return out[:5]


def _direct_media_urls(embed_html: str) -> list[str]:
    decoded = html_lib.unescape(embed_html or "")
    decoded = decoded.replace("\\/", "/").replace("\\u0026", "&")
    urls: list[str] = []
    for match in re.finditer(
        r'https?://[^\s"\'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"\'<>\\]*)?',
        decoded,
        re.I,
    ):
        url = match.group(0).rstrip("),;]")
        if is_blocked_url(url):
            continue
        if url not in urls:
            urls.append(url)
    return urls[:6]


class ItalianWebTrailerProvider:
    """Italian trailer fallback using public web pages and direct media only.

    ComingSoon is used only as a discovery/catalog page: a candidate is accepted
    when the page itself labels it as an Italian trailer and the public embed
    exposes a direct MP4/HLS URL. No ad bypass, browser automation or protected
    media extraction is attempted.

    For movies, Apple's public iTunes Search API is an additional fallback. Its
    preview is accepted only when ffprobe explicitly reports Italian audio.
    """

    name = "italian_web"

    async def _comingsoon_match(self, http, identity: dict) -> tuple[str, str, int | None, float] | None:
        media_type = "tv" if identity.get("type") == "tv" else "movie"
        search_url = (
            f"{COMINGSOON_ROOT}/serietv/ricerca/"
            if media_type == "tv"
            else f"{COMINGSOON_ROOT}/film/"
        )
        titles: list[str] = []
        for value in (identity.get("title"), identity.get("original_title")):
            text = str(value or "").strip()
            if text and text not in titles:
                titles.append(text)

        for query in titles[:2]:
            try:
                response = await http.get(search_url, params={"titolo": query}, timeout=14.0)
            except Exception:
                continue
            if response.status_code != 200:
                continue
            for page_url in _search_links(response.text, media_type):
                try:
                    page = await http.get(page_url, timeout=14.0)
                except Exception:
                    continue
                if page.status_code != 200:
                    continue
                page_title, page_year = _page_title_year(page.text)
                confidence = confidence_for_identity(identity, page_title, page_year, media_type)
                if confidence >= 0.90:
                    return page_url, page_title, page_year, confidence
        return None

    async def _comingsoon_candidates(self, http, identity: dict) -> list[TrailerCandidate]:
        matched = await self._comingsoon_match(http, identity)
        if not matched:
            return []
        page_url, page_title, page_year, confidence = matched
        video_page = urljoin(page_url, "video/")
        try:
            response = await http.get(video_page, timeout=14.0)
        except Exception:
            return []
        if response.status_code != 200:
            return []

        out: list[TrailerCandidate] = []
        for video_id, label in _italian_trailer_ids(response.text):
            embed_url = f"{COMINGSOON_ROOT}/videoplayer/embed/?idv={video_id}"
            try:
                embed = await http.get(embed_url, timeout=14.0)
            except Exception:
                continue
            if embed.status_code != 200:
                continue
            for media_url in _direct_media_urls(embed.text):
                official = "ufficial" in normalize_title(label)
                if ".m3u8" in media_url.lower():
                    try:
                        rows = await inspect_hls(
                            http,
                            media_url,
                            source="comingsoon_it",
                            confidence=confidence,
                            provider_id=video_id,
                            provider_page=video_page,
                            matched_title=page_title,
                            matched_year=page_year,
                            trailer_type=label,
                            official=official,
                            default_language="it",
                        )
                    except Exception:
                        rows = []
                    for row in rows:
                        row.audio_language = "it"
                        row.metadata = {
                            **(row.metadata or {}),
                            "italian_label": label,
                            "italian_web_source": "comingsoon",
                            "embed_url": embed_url,
                        }
                    out.extend(rows)
                    continue

                probe = await probe_direct_file(media_url)
                if not probe or int(probe.get("height") or 0) < 720:
                    continue
                out.append(
                    TrailerCandidate(
                        source="comingsoon_it",
                        trailer_url=media_url,
                        provider_id=video_id,
                        provider_page=video_page,
                        matched_title=page_title,
                        matched_year=page_year,
                        media_type=identity.get("type"),
                        title=label,
                        trailer_type=label,
                        official=official,
                        width=probe.get("width"),
                        height=probe.get("height"),
                        bitrate=probe.get("bitrate"),
                        codec=probe.get("codec"),
                        fps=probe.get("fps"),
                        audio_language="it",
                        audio_codec=probe.get("audio_codec"),
                        audio_bitrate=probe.get("audio_bitrate"),
                        confidence=confidence,
                        verified=True,
                        browser_compatible=True,
                        compatibility="mp4",
                        metadata={
                            "italian_label": label,
                            "italian_web_source": "comingsoon",
                            "embed_url": embed_url,
                            "ffprobe_audio_language": probe.get("audio_language"),
                        },
                    )
                )
        return out

    async def _itunes_movie_candidates(self, http, identity: dict) -> list[TrailerCandidate]:
        if identity.get("type") == "tv":
            return []
        titles = [
            str(value or "").strip()
            for value in (identity.get("title"), identity.get("original_title"))
            if str(value or "").strip()
        ]
        wanted = {normalize_title(value) for value in titles}
        out: list[TrailerCandidate] = []
        seen: set[str] = set()
        for query in titles[:2]:
            try:
                response = await http.get(
                    ITUNES_SEARCH_URL,
                    params={
                        "term": query,
                        "country": "IT",
                        "media": "movie",
                        "entity": "movie",
                        "limit": 12,
                        "lang": "it_it",
                    },
                    timeout=14.0,
                )
            except Exception:
                continue
            if response.status_code != 200:
                continue
            try:
                results = response.json().get("results") or []
            except Exception:
                results = []
            for item in results:
                title = str(item.get("trackName") or "").strip()
                if normalize_title(title) not in wanted:
                    continue
                year = extract_year(item.get("releaseDate"))
                confidence = confidence_for_identity(identity, title, year, "movie")
                if confidence < 0.90:
                    continue
                preview_url = str(item.get("previewUrl") or "").strip()
                if not preview_url or preview_url in seen or is_blocked_url(preview_url):
                    continue
                seen.add(preview_url)
                probe = await probe_direct_file(preview_url)
                if not probe or int(probe.get("height") or 0) < 720:
                    continue
                # Country=IT alone is not enough: keep this fallback strict and
                # only expose it when the media stream itself is tagged Italian.
                if not _is_italian(probe.get("audio_language")):
                    continue
                out.append(
                    TrailerCandidate(
                        source="apple_itunes_search_it",
                        trailer_url=preview_url,
                        provider_id=str(item.get("trackId") or ""),
                        provider_page=item.get("trackViewUrl"),
                        matched_title=title,
                        matched_year=year,
                        media_type="movie",
                        title=f"{title} - Preview Italiano",
                        trailer_type="Preview Italiano",
                        official=True,
                        width=probe.get("width"),
                        height=probe.get("height"),
                        bitrate=probe.get("bitrate"),
                        codec=probe.get("codec"),
                        fps=probe.get("fps"),
                        audio_language=probe.get("audio_language"),
                        audio_codec=probe.get("audio_codec"),
                        audio_bitrate=probe.get("audio_bitrate"),
                        confidence=confidence,
                        verified=True,
                        browser_compatible=True,
                        compatibility="mp4",
                        metadata={
                            "italian_web_source": "itunes-search-it",
                            "country": item.get("country") or "ITA",
                        },
                    )
                )
        return out

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        async with client() as http:
            comingsoon = await self._comingsoon_candidates(http, identity)
            itunes = await self._itunes_movie_candidates(http, identity)
            return [*comingsoon, *itunes]
