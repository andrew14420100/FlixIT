from __future__ import annotations

import json
import re
from typing import Any

from ..base import TrailerCandidate, confidence_for_identity, extract_year
from ..manifest import inspect_dash
from .common import client, google_site_search, meta


def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _hydration(html: str) -> dict:
    m = re.search(r'<script[^>]+id=["\']dv-web-page-hydration-data["\'][^>]*>(.*?)</script>', html, re.I | re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except Exception:
        return {}


def _title_id(html: str, data: dict) -> str | None:
    for row in _walk(data):
        asins = row.get("asins")
        if isinstance(asins, list) and asins:
            return str(asins[0])
        for key in ("titleID", "titleId", "titleIdValue", "catalogId"):
            value = row.get(key)
            if value and re.fullmatch(r"[A-Z0-9]+", str(value), re.I):
                return str(value)
    m = re.search(r"DVWebNode\.pageTypeId=['\"]([^'\"]+)", html)
    return m.group(1) if m else None


def _page_identity(html: str, data: dict) -> tuple[str, int | None]:
    title = meta(html, "og:title") or ""
    title = re.split(r"[|–—]", title)[0].strip()
    year = None
    for row in _walk(data):
        if not title:
            title = str(row.get("title") or row.get("displayTitle") or row.get("name") or "")
        year = year or extract_year(row.get("releaseYear") or row.get("year") or row.get("releaseDate"))
        if title and year:
            break
    return title, year


def _pick_manifest(payload: dict, wanted_lang: str = "it") -> tuple[str | None, str | None, list[dict]]:
    playback = payload.get("playbackUrls") or {}
    tracks = playback.get("audioTracks") or []
    audio = next((x for x in tracks if str(x.get("languageCode") or "").lower().startswith(wanted_lang)), None)
    if not audio:
        audio = next((x for x in tracks if str(x.get("languageCode") or "").lower().startswith("en")), None)
    if not audio and tracks:
        audio = tracks[0]
    audio_id = (audio or {}).get("audioTrackId")
    sets = playback.get("urlSets") or {}
    scored = []
    for row in sets.values():
        manifest = ((row.get("urls") or {}).get("manifest") or {})
        url = manifest.get("url")
        if not url:
            continue
        track_id = manifest.get("audioTrackId")
        quality = str(manifest.get("videoQuality") or "")
        score = (2 if audio_id and track_id in (audio_id, "ALL", None, "") else 0) + (1 if quality.upper() in ("UHD", "HD") else 0)
        scored.append((score, url))
    scored.sort(reverse=True)
    subtitles = [
        {"language": x.get("languageCode"), "url": x.get("url")}
        for x in (payload.get("subtitleUrls") or [])
        if x.get("url") and (not audio or x.get("trackGroupId") == audio.get("trackGroupId"))
    ]
    return (scored[0][1] if scored else None), (audio or {}).get("languageCode"), subtitles


class PrimeVideoTrailerProvider:
    name = "prime_video"

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        query = f"{identity.get('title') or identity.get('original_title')} {identity.get('year') or ''}".strip()
        pages = []
        manual = ((identity.get("provider_pages") or {}).get("prime_video") or "").strip()
        if manual:
            pages.append(manual)
        for result in await google_site_search(query, "primevideo.com", 5):
            url = result.get("link")
            if url and url not in pages:
                pages.append(url)
        candidates: list[TrailerCandidate] = []
        async with client() as http:
            for page_url in pages[:5]:
                try:
                    page = await http.get(page_url)
                    if page.status_code != 200:
                        continue
                    data = _hydration(page.text)
                    title, year = _page_identity(page.text, data)
                    confidence = confidence_for_identity(identity, title, year, identity.get("type"))
                    if confidence < 0.90:
                        continue
                    title_id = _title_id(page.text, data)
                    if not title_id:
                        continue
                    response = await http.get(
                        "https://atv-ps.primevideo.com/cdp/catalog/GetPlaybackResources",
                        params={
                            "deviceTypeID": "AOAGZA014O5RE",
                            "firmware": "1",
                            "consumptionType": "Streaming",
                            "desiredResources": "PlaybackUrls,SubtitleUrls",
                            "resourceUsage": "ImmediateConsumption",
                            "videoMaterialType": "Trailer",
                            "titleId": title_id,
                            "audioTrackId": "ALL",
                            "deviceStreamingTechnologyOverride": "DASH",
                        },
                    )
                    if response.status_code != 200:
                        continue
                    payload = response.json()
                    if payload.get("error"):
                        continue
                    mpd, audio_lang, subtitles = _pick_manifest(payload)
                    if not mpd:
                        continue
                    rows = await inspect_dash(
                        http,
                        mpd,
                        source=self.name,
                        confidence=confidence,
                        provider_id=title_id,
                        provider_page=page_url,
                        matched_title=title,
                        matched_year=year,
                        trailer_type="Official Trailer",
                        official=True,
                        preferred_language=audio_lang or "it-IT",
                    )
                    for row in rows:
                        row.subtitles = subtitles
                        if audio_lang:
                            row.audio_language = audio_lang
                    candidates.extend(rows)
                except Exception:
                    continue
        return candidates
