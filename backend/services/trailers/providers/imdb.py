from __future__ import annotations

import asyncio
import json
import re

from ..base import TrailerCandidate, normalize_title
from ..manifest import _find_media_binary
from .common import USER_AGENT, client

IMDB_GRAPHQL_URL = "https://graphql.imdb.com/"
# Keep this query deliberately small. IMDb's GraphQL shape changes less often
# when we only request fields needed for playback selection.
IMDB_TRAILER_QUERY = r'''
query Trailer($id: ID!) {
  title(id: $id) {
    primaryVideos(first: 6) {
      edges {
        node {
          id
          name { value }
          runtime { value }
          playbackURLs {
            url
            displayName { value }
            videoMimeType
          }
        }
      }
    }
  }
}
'''


def _height_from_label(value) -> int | None:
    match = re.search(r"(\d{3,4})p", str(value or ""), re.I)
    return int(match.group(1)) if match else None


def _trailer_type(title: str, content_type: str = "") -> str:
    """Normalize IMDb video labels into the resolver's trailer priority types."""
    text = normalize_title(f"{content_type} {title}")
    if "final trailer" in text:
        return "Final Trailer"
    if "official teaser" in text:
        return "Official Teaser"
    if "teaser" in text:
        return "Teaser"
    if "clip" in text and "trailer" not in text:
        return "Clip"
    return "Official Trailer" if "trailer" in text else "Trailer"


def _best_probe_row(node: dict) -> dict | None:
    """Select one native MP4 rendition per IMDb video before probing."""
    rows = []
    unknown = []
    for raw in node.get("playbackURLs") or []:
        row = raw or {}
        url = str(row.get("url") or "").strip()
        mime = str(row.get("videoMimeType") or "").upper()
        if not url or "MP4" not in mime:
            continue
        label = ((row.get("displayName") or {}).get("value") if isinstance(row.get("displayName"), dict) else row.get("displayName")) or ""
        height = _height_from_label(label)
        item = {"url": url, "reported_height": height}
        if height is None:
            unknown.append(item)
        elif height >= 1080:
            rows.append(item)

    if rows:
        rows.sort(key=lambda x: int(x.get("reported_height") or 0), reverse=True)
        return rows[0]
    return unknown[0] if unknown else None


def _parse_probe_json(stdout: bytes) -> dict | None:
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
        fps = None
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


async def _probe_imdb_mp4(url: str, timeout: float = 12.0) -> dict | None:
    """Probe IMDb's signed MP4 directly.

    The generic probe previously passed two separate ``-show_entries`` options;
    older ffprobe builds may keep only the last one, leaving no stream metadata.
    IMDb's CDN can also be stricter with bare media-tool requests.  Use one
    combined show_entries expression plus browser-like HTTP headers, then retry
    once without the HTTP-specific options for compatibility with local/static
    ffprobe builds.
    """
    ffprobe = _find_media_binary("ffprobe")
    if not ffprobe:
        return None

    entries = (
        "stream=index,codec_type,codec_name,profile,width,height,bit_rate,r_frame_rate:"
        "stream_tags=language:format=bit_rate,duration"
    )
    header_blob = "Referer: https://www.imdb.com/\r\nOrigin: https://www.imdb.com\r\nAccept: */*\r\n"

    attempts = [
        [
            ffprobe,
            "-v", "error",
            "-user_agent", USER_AGENT,
            "-headers", header_blob,
            "-show_entries", entries,
            "-of", "json",
            url,
        ],
        [
            ffprobe,
            "-v", "error",
            "-show_entries", entries,
            "-of", "json",
            url,
        ],
    ]

    for args in attempts:
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                proc.kill()
                await proc.communicate()
            except Exception:
                pass
            continue
        except Exception:
            continue

        if proc.returncode != 0:
            continue
        parsed = _parse_probe_json(stdout)
        if parsed:
            return parsed

    return None


class IMDbTrailerProvider:
    """Resolve IMDb-hosted trailers directly from IMDb GraphQL.

    TMDB already supplies an IMDb id, so this provider needs no search service.
    Only direct IMDb MP4 playback URLs are considered and every selected file is
    verified before it can enter the >=1080 resolver pipeline.
    """

    name = "imdb"

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        imdb_id = str((identity.get("external_ids") or {}).get("imdb_id") or "").strip()
        if not re.fullmatch(r"tt\d+", imdb_id):
            return []

        async with client() as http:
            response = await http.post(
                IMDB_GRAPHQL_URL,
                headers={
                    "Content-Type": "application/json",
                    "Referer": "https://www.imdb.com/",
                    "Origin": "https://www.imdb.com",
                },
                json={"query": IMDB_TRAILER_QUERY, "variables": {"id": imdb_id}},
            )
            if response.status_code != 200:
                raise RuntimeError(f"IMDb GraphQL HTTP {response.status_code}")
            try:
                payload = response.json()
            except Exception as exc:
                raise RuntimeError("IMDb GraphQL returned invalid JSON") from exc

        if payload.get("errors"):
            message = str((payload.get("errors") or [{}])[0].get("message") or "GraphQL error")
            raise RuntimeError(f"IMDb GraphQL: {message[:180]}")

        title_data = ((payload.get("data") or {}).get("title") or {})
        edges = ((title_data.get("primaryVideos") or {}).get("edges") or [])[:6]
        if not edges:
            return []

        probe_sem = asyncio.Semaphore(3)

        async def build_candidate(edge) -> TrailerCandidate | None:
            node = (edge or {}).get("node") or {}
            row = _best_probe_row(node)
            if not row:
                return None

            async with probe_sem:
                probed = await _probe_imdb_mp4(row["url"], timeout=12.0)
            if not probed or int(probed.get("height") or 0) < 1080:
                return None

            video_id = str(node.get("id") or "").strip()
            title = str(((node.get("name") or {}).get("value")) or "Trailer")
            trailer_type = _trailer_type(title)

            return TrailerCandidate(
                source=self.name,
                trailer_url=row["url"],
                provider_id=video_id or imdb_id,
                provider_page=f"https://www.imdb.com/video/{video_id}/" if video_id else f"https://www.imdb.com/title/{imdb_id}/",
                matched_title=identity.get("title"),
                matched_year=identity.get("year"),
                media_type=identity.get("type"),
                title=title,
                trailer_type=trailer_type,
                official=trailer_type in {"Official Trailer", "Final Trailer", "Official Teaser"},
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
                metadata={
                    "imdb_id": imdb_id,
                    "reported_height": row.get("reported_height"),
                    "discovery": "graphql",
                },
            )

        built = await asyncio.gather(*(build_candidate(edge) for edge in edges), return_exceptions=True)
        candidates: list[TrailerCandidate] = []
        for item in built:
            if isinstance(item, TrailerCandidate):
                candidates.append(item)
        return candidates
