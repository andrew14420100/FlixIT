from __future__ import annotations

import asyncio
import hashlib
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

import httpx

from ..base import TrailerCandidate, normalize_title
from ..manifest import probe_direct_file


class TherystonTrailerProvider:
    """Adapter for the local Theryston/trailers-api service.

    IMDb is intentionally NOT submitted here anymore: current IMDb HTML pages
    can be returned as WAF challenge/empty documents, which breaks Theryston's
    upstream __NEXT_DATA__ parser. FLIX-IT now resolves IMDb-hosted trailers
    directly through its dedicated GraphQL provider.

    Theryston remains the extraction engine for reliable provider pages already
    known for Apple TV, Prime Video or Netflix. Finished media is persisted in
    DATA_FOLDER/files and re-served by FastAPI, so normal page refreshes never
    trigger a new provider extraction.
    """

    name = "theryston"

    def __init__(self):
        self.api_url = (os.environ.get("THERYSTON_TRAILERS_API_URL") or "http://127.0.0.1:3011").rstrip("/")
        self.data_dir = Path(os.environ.get("THERYSTON_TRAILERS_DATA_DIR") or "/app/trailers-data").resolve()
        try:
            self.max_wait_seconds = max(20, min(300, int(os.environ.get("THERYSTON_TRAILERS_MAX_WAIT", "150"))))
        except Exception:
            self.max_wait_seconds = 150

    def _pages(self, identity: dict) -> list[tuple[str, str, float]]:
        provider_pages = identity.get("provider_pages") or {}
        pages: list[tuple[str, str, float]] = []
        for key in ("apple_tv", "prime_video", "netflix"):
            value = str(provider_pages.get(key) or "").strip()
            if value.startswith("https://"):
                pages.append((key, value, 0.98))

        seen = set()
        unique = []
        for source, url, confidence in pages:
            if url in seen:
                continue
            seen.add(url)
            unique.append((source, url, confidence))
        return unique

    async def _wait_process(self, http: httpx.AsyncClient, process_id: str) -> dict | None:
        deadline = asyncio.get_running_loop().time() + self.max_wait_seconds
        while asyncio.get_running_loop().time() < deadline:
            try:
                response = await http.get(f"{self.api_url}/process/{process_id}")
                if response.status_code != 200:
                    await asyncio.sleep(1.5)
                    continue
                data = response.json()
            except Exception:
                await asyncio.sleep(1.5)
                continue

            status = str(data.get("status") or "").lower()
            if bool(data.get("isCompleted")) or status in {"done", "error", "no_trailers", "cancelled"}:
                return data
            await asyncio.sleep(1.5)
        return None

    def _local_file(self, trailer_url: str) -> Path | None:
        try:
            filename = Path(unquote(urlparse(trailer_url).path)).name
        except Exception:
            return None
        if not filename or not re.fullmatch(r"[A-Za-z0-9._-]+", filename):
            return None
        path = (self.data_dir / "files" / filename).resolve()
        try:
            path.relative_to((self.data_dir / "files").resolve())
        except Exception:
            return None
        if not path.is_file() or path.stat().st_size < 1024:
            return None
        return path

    async def _run_page(self, http: httpx.AsyncClient, identity: dict, source: str, page_url: str, confidence: float) -> list[TrailerCandidate]:
        try:
            response = await http.post(
                f"{self.api_url}/process/by-trailer-page",
                json={
                    "trailerPage": page_url,
                    "lang": "it-IT",
                    "fullAudioTracks": False,
                },
            )
            if response.status_code != 201:
                return []
            process_id = str(response.json().get("processId") or "")
            if not process_id:
                return []
            result = await self._wait_process(http, process_id)
        except Exception:
            return []

        if not result or str(result.get("status") or "").lower() != "done":
            return []

        candidates: list[TrailerCandidate] = []
        for trailer in result.get("trailers") or []:
            remote_url = str(trailer.get("url") or "")
            local_path = self._local_file(remote_url)
            if not local_path:
                continue
            probed = await probe_direct_file(str(local_path), timeout=25.0)
            if not probed:
                continue

            filename = local_path.name
            public_url = f"/api/public/theryston-file/{filename}"
            title = str(trailer.get("title") or "Official Trailer")
            normalized = normalize_title(title)
            if "final trailer" in normalized:
                trailer_type = "Final Trailer"
            elif "official teaser" in normalized:
                trailer_type = "Official Teaser"
            elif "teaser" in normalized:
                trailer_type = "Teaser"
            elif "clip" in normalized:
                trailer_type = "Clip"
            else:
                trailer_type = "Official Trailer"

            persistent_expiry = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
            candidates.append(
                TrailerCandidate(
                    source=f"theryston_{source}",
                    trailer_url=public_url,
                    provider_id=process_id,
                    provider_page=page_url,
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
                    audio_language=probed.get("audio_language"),
                    audio_codec=probed.get("audio_codec"),
                    audio_bitrate=probed.get("audio_bitrate"),
                    subtitles=trailer.get("subtitles") or [],
                    confidence=confidence,
                    verified=True,
                    browser_compatible=True,
                    compatibility="local-mp4",
                    expires_at=persistent_expiry,
                    local_cache_key=hashlib.sha256(filename.encode("utf-8")).hexdigest()[:20],
                    metadata={
                        "persistent_local": True,
                        "theryston_process_id": process_id,
                        "theryston_original_url": remote_url,
                        "theryston_filename": filename,
                    },
                )
            )
        return candidates

    async def discover(self, identity: dict) -> list[TrailerCandidate]:
        pages = self._pages(identity)
        if not pages:
            return []

        timeout = httpx.Timeout(10.0, connect=2.5)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as http:
            try:
                probe = await http.get(f"{self.api_url}/docs/")
                if probe.status_code >= 500:
                    return []
            except Exception:
                return []

            rows = await asyncio.gather(
                *(self._run_page(http, identity, source, url, confidence) for source, url, confidence in pages),
                return_exceptions=True,
            )

        out: list[TrailerCandidate] = []
        for row in rows:
            if isinstance(row, list):
                out.extend(row)
        return out
