from __future__ import annotations

import re

from ..base import TrailerCandidate, normalize_title
from ..manifest import probe_direct_file
from .common import client

IMDB_GRAPHQL_URL = "https://graphql.imdb.com/"
IMDB_TRAILER_QUERY = r'''
query Trailer($id: ID!) {
  title(id: $id) {
    primaryVideos(first: 12) {
      edges {
        node {
          id
          name { value }
          contentType { id displayName { value } }
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


def _trailer_type(title: str, content_type: str) -> str:
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


class IMDbTrailerProvider:
    """Resolve IMDb-hosted trailers directly from IMDb's GraphQL response.

    IMDb's normal HTML title/video pages are currently protected by a WAF and
    can return an empty/challenge document to non-browser HTTP clients.  The
    GraphQL path avoids parsing __NEXT_DATA__ and gives us the direct playback
    URLs for a TMDB-derived IMDb id, so no search service is required.
    """

    name = "imdb"

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        imdb_id = str((identity.get("external_ids") or {}).get("imdb_id") or "").strip()
        if not re.fullmatch(r"tt\d+", imdb_id):
            return []

        async with client() as http:
            try:
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
                    return []
                payload = response.json()
            except Exception:
                return []

        title_data = ((payload.get("data") or {}).get("title") or {})
        edges = ((title_data.get("primaryVideos") or {}).get("edges") or [])
        candidates: list[TrailerCandidate] = []

        for edge in edges:
            node = (edge or {}).get("node") or {}
            video_id = str(node.get("id") or "").strip()
            title = str(((node.get("name") or {}).get("value")) or "Trailer")
            content_type = str(
                ((node.get("contentType") or {}).get("id"))
                or (((node.get("contentType") or {}).get("displayName") or {}).get("value"))
                or ""
            )
            trailer_type = _trailer_type(title, content_type)

            # Keep true trailer/teaser material first. Generic video entries are
            # accepted only when their title itself identifies them as a trailer.
            normalized_kind = normalize_title(f"{content_type} {title}")
            if not any(token in normalized_kind for token in ("trailer", "teaser", "clip")):
                continue

            for row in node.get("playbackURLs") or []:
                url = str((row or {}).get("url") or "").strip()
                mime = str((row or {}).get("videoMimeType") or "").upper()
                if not url or mime != "MP4":
                    continue

                label = ((row.get("displayName") or {}).get("value") if isinstance(row.get("displayName"), dict) else row.get("displayName")) or ""
                reported_height = _height_from_label(label)

                # Do not trust IMDb's display label alone. ffprobe verifies the
                # actual native stream so the >=1080 rule and ranking stay real.
                probed = await probe_direct_file(url)
                if not probed:
                    continue

                candidates.append(
                    TrailerCandidate(
                        source=self.name,
                        trailer_url=url,
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
                            "reported_height": reported_height,
                            "discovery": "graphql",
                        },
                    )
                )

        return candidates
