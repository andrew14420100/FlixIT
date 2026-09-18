"""Best-effort media inspection for trailer candidates.

No transcoding/upscaling happens here. HLS/DASH manifests are inspected for
native representations; direct files can be probed with ffprobe when the
binary is available in the deployment image.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import xml.etree.ElementTree as ET
from typing import Optional
from urllib.parse import urljoin

import httpx

from .base import TrailerCandidate


def _attrs(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for match in re.finditer(r'([A-Z0-9-]+)=("[^"]*"|[^,]*)', raw or ""):
        value = match.group(2).strip()
        out[match.group(1)] = value[1:-1] if value.startswith('"') and value.endswith('"') else value
    return out


def _resolution(value: Optional[str]) -> tuple[int, int]:
    match = re.match(r"(\d+)x(\d+)", str(value or ""))
    return (int(match.group(1)), int(match.group(2))) if match else (0, 0)


def _is_hdr(attrs: dict) -> tuple[bool, bool]:
    vr = str(attrs.get("VIDEO-RANGE") or "").upper()
    codecs = str(attrs.get("CODECS") or "").lower()
    dolby = "dvhe" in codecs or "dvh1" in codecs or "dolby" in vr
    hdr = dolby or vr in {"PQ", "HLG", "HDR", "HDR10"}
    return hdr, dolby


async def fetch_text(client: httpx.AsyncClient, url: str, timeout: float = 12.0) -> str:
    response = await client.get(url, timeout=timeout, follow_redirects=True)
    response.raise_for_status()
    return response.text


async def inspect_hls(
    client: httpx.AsyncClient,
    url: str,
    *,
    source: str,
    confidence: float,
    provider_id: Optional[str] = None,
    provider_page: Optional[str] = None,
    matched_title: Optional[str] = None,
    matched_year: Optional[int] = None,
    trailer_type: str = "Trailer",
    official: bool = True,
    default_language: Optional[str] = None,
) -> list[TrailerCandidate]:
    text = await fetch_text(client, url)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    audio_languages: dict[str, list[str]] = {}
    for line in lines:
        if not line.startswith("#EXT-X-MEDIA:"):
            continue
        attrs = _attrs(line.split(":", 1)[1])
        if attrs.get("TYPE") != "AUDIO":
            continue
        group = attrs.get("GROUP-ID") or ""
        lang = attrs.get("LANGUAGE") or attrs.get("NAME")
        if lang:
            audio_languages.setdefault(group, []).append(lang)

    candidates: list[TrailerCandidate] = []
    for idx, line in enumerate(lines):
        if not line.startswith("#EXT-X-STREAM-INF:"):
            continue
        attrs = _attrs(line.split(":", 1)[1])
        w, h = _resolution(attrs.get("RESOLUTION"))
        if not h:
            continue
        uri = next((x for x in lines[idx + 1 :] if not x.startswith("#")), "")
        if not uri:
            continue
        codecs = attrs.get("CODECS") or ""
        hdr, dolby = _is_hdr(attrs)
        audio_group = attrs.get("AUDIO") or ""
        langs = audio_languages.get(audio_group) or []
        audio_lang = next((x for x in langs if str(x).lower().startswith("it")), None) or next(
            (x for x in langs if str(x).lower().startswith("en")), None
        ) or (langs[0] if langs else default_language)
        candidates.append(
            TrailerCandidate(
                source=source,
                trailer_url=url,
                manifest_url=url,
                provider_id=provider_id,
                provider_page=provider_page,
                matched_title=matched_title,
                matched_year=matched_year,
                trailer_type=trailer_type,
                official=official,
                width=w,
                height=h,
                bitrate=int(attrs.get("AVERAGE-BANDWIDTH") or attrs.get("BANDWIDTH") or 0) or None,
                codec=codecs,
                fps=float(attrs.get("FRAME-RATE") or 0) or None,
                hdr=hdr,
                dolby_vision=dolby,
                audio_language=audio_lang,
                confidence=confidence,
                verified=True,
                browser_compatible=True,
                compatibility="hls",
                metadata={"variant_url": urljoin(url, uri), "hls_audio_languages": langs},
            )
        )
    # A media playlist has no STREAM-INF. It is playable but its native height
    # cannot be proven, so it is intentionally not promoted to a final candidate.
    return candidates


def _local_name(tag: str) -> str:
    return tag.split("}")[-1]


def _child_text(node: ET.Element, name: str) -> Optional[str]:
    for child in list(node):
        if _local_name(child.tag).lower() == name.lower() and child.text:
            return child.text.strip()
    return None


async def inspect_dash(
    client: httpx.AsyncClient,
    url: str,
    *,
    source: str,
    confidence: float,
    provider_id: Optional[str] = None,
    provider_page: Optional[str] = None,
    matched_title: Optional[str] = None,
    matched_year: Optional[int] = None,
    trailer_type: str = "Trailer",
    official: bool = True,
    preferred_language: str = "it-IT",
) -> list[TrailerCandidate]:
    text = await fetch_text(client, url)
    root = ET.fromstring(text)
    # Protected DASH is not accepted by this trailer resolver.
    if any(_local_name(el.tag) == "ContentProtection" for el in root.iter()):
        return []

    audio_languages: list[str] = []
    audio_reps: list[dict] = []
    video_reps: list[dict] = []
    for adaptation in [el for el in root.iter() if _local_name(el.tag) == "AdaptationSet"]:
        mime = str(adaptation.attrib.get("mimeType") or adaptation.attrib.get("contentType") or "").lower()
        lang = adaptation.attrib.get("lang") or adaptation.attrib.get("language")
        if lang:
            audio_languages.append(lang)
        adaptation_base = _child_text(adaptation, "BaseURL")
        for rep in [x for x in list(adaptation) if _local_name(x.tag) == "Representation"]:
            base = _child_text(rep, "BaseURL") or adaptation_base
            row = {
                "id": rep.attrib.get("id"),
                "width": int(rep.attrib.get("width") or 0),
                "height": int(rep.attrib.get("height") or 0),
                "bitrate": int(rep.attrib.get("bandwidth") or 0),
                "codec": rep.attrib.get("codecs") or adaptation.attrib.get("codecs"),
                "fps": rep.attrib.get("frameRate") or adaptation.attrib.get("frameRate"),
                "base": urljoin(url, base) if base else None,
                "lang": lang,
            }
            kind = mime
            if not kind:
                if row["width"] or row["height"]:
                    kind = "video"
                elif lang:
                    kind = "audio"
            if "video" in kind:
                video_reps.append(row)
            elif "audio" in kind:
                audio_reps.append(row)

    wanted = preferred_language.lower().split("-")[0]
    audio = next((a for a in audio_reps if str(a.get("lang") or "").lower().startswith(wanted)), None)
    if not audio:
        audio = next((a for a in audio_reps if str(a.get("lang") or "").lower().startswith("en")), None)
    if not audio and audio_reps:
        audio = audio_reps[0]

    candidates: list[TrailerCandidate] = []
    for rep in video_reps:
        h = int(rep.get("height") or 0)
        if not h:
            continue
        codec = str(rep.get("codec") or "")
        fps_raw = str(rep.get("fps") or "")
        fps = None
        try:
            if "/" in fps_raw:
                a, b = fps_raw.split("/", 1)
                fps = float(a) / float(b)
            elif fps_raw:
                fps = float(fps_raw)
        except Exception:
            fps = None
        hdr = any(x in codec.lower() for x in ("hvc1.2", "hev1.2", "dvhe", "dvh1"))
        dolby = any(x in codec.lower() for x in ("dvhe", "dvh1"))
        candidates.append(
            TrailerCandidate(
                source=source,
                trailer_url=url,
                manifest_url=url,
                provider_id=provider_id,
                provider_page=provider_page,
                matched_title=matched_title,
                matched_year=matched_year,
                trailer_type=trailer_type,
                official=official,
                width=int(rep.get("width") or 0),
                height=h,
                bitrate=int(rep.get("bitrate") or 0) or None,
                codec=codec,
                fps=fps,
                hdr=hdr,
                dolby_vision=dolby,
                audio_language=(audio or {}).get("lang") or preferred_language,
                audio_bitrate=int((audio or {}).get("bitrate") or 0) or None,
                audio_codec=(audio or {}).get("codec"),
                confidence=confidence,
                verified=True,
                browser_compatible=False,
                compatibility="dash-remux",
                requires_remux=True,
                metadata={
                    "video_representation_url": rep.get("base"),
                    "audio_representation_url": (audio or {}).get("base"),
                    "audio_languages": audio_languages,
                },
            )
        )
    return candidates


async def probe_direct_file(url: str, *, timeout: float = 18.0) -> Optional[dict]:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    proc = await asyncio.create_subprocess_exec(
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "stream=index,codec_type,codec_name,profile,width,height,bit_rate,r_frame_rate:stream_tags=language",
        "-show_entries",
        "format=bit_rate,duration",
        "-of",
        "json",
        url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return None
    if proc.returncode != 0:
        return None
    try:
        data = json.loads(stdout.decode("utf-8", "replace"))
    except Exception:
        return None
    streams = data.get("streams") or []
    video = max(
        (s for s in streams if s.get("codec_type") == "video"),
        key=lambda s: int(s.get("width") or 0) * int(s.get("height") or 0),
        default=None,
    )
    if not video:
        return None
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fps = None
    try:
        raw = str(video.get("r_frame_rate") or "")
        if "/" in raw:
            a, b = raw.split("/", 1)
            fps = float(a) / float(b) if float(b) else None
        elif raw:
            fps = float(raw)
    except Exception:
        pass
    return {
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "bitrate": int(video.get("bit_rate") or (data.get("format") or {}).get("bit_rate") or 0) or None,
        "codec": video.get("codec_name"),
        "fps": fps,
        "audio_codec": (audio or {}).get("codec_name"),
        "audio_bitrate": int((audio or {}).get("bit_rate") or 0) or None,
        "audio_language": ((audio or {}).get("tags") or {}).get("language"),
    }
