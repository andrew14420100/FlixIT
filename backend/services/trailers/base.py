"""Shared trailer types, matching and ranking rules.

The multi-provider trailer pipeline is intentionally independent from the main
movie/episode player. It rejects YouTube in the native resolver, never upscales,
and prefers real trailer-length media before comparing native resolution up to
2160p/4K UHD. Lower native resolutions remain valid fallbacks instead of making
the trailer disappear completely.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

BLOCKED_HOST_SUFFIXES = (
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
)
MIN_TRAILER_HEIGHT = 720
PREFERRED_TRAILER_HEIGHT = 2160
MAX_TRAILER_HEIGHT = 2160
MIN_KNOWN_TRAILER_DURATION_SECONDS = 20.0


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_title(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("&", " e ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def extract_year(value: Any) -> Optional[int]:
    match = re.search(r"(?:19|20)\d{2}", str(value or ""))
    return int(match.group(0)) if match else None


def is_blocked_url(value: Optional[str]) -> bool:
    if not value:
        return False
    try:
        host = (urlparse(value).hostname or "").lower().strip(".")
    except Exception:
        return True
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in BLOCKED_HOST_SUFFIXES)


def type_rank(value: str) -> int:
    text = normalize_title(value)
    if "official trailer" in text and "final" not in text:
        return 5
    if "final trailer" in text:
        return 4
    if "official teaser" in text:
        return 3
    if "teaser" in text:
        return 2
    if "clip" in text or "preview" in text or "promo" in text or "featurette" in text:
        return 1
    if "trailer" in text:
        return 4
    return 0


def language_rank(value: Optional[str]) -> int:
    lang = str(value or "").lower().replace("_", "-")
    if lang == "it" or lang.startswith("it-"):
        return 3
    if lang == "en" or lang.startswith("en-"):
        return 2
    if lang:
        return 1
    return 0


def codec_rank(value: Optional[str]) -> int:
    codec = str(value or "").lower()
    if any(x in codec for x in ("av01", "av1")):
        return 4
    if any(x in codec for x in ("hvc1", "hev1", "hevc", "h265")):
        return 3
    if any(x in codec for x in ("avc1", "h264", "avc")):
        return 2
    if any(x in codec for x in ("vp9", "vp09")):
        return 2
    return 1 if codec else 0


def confidence_for_identity(identity: dict, title: Any, year: Any, media_type: Optional[str]) -> float:
    """Conservative title/year/type confidence.

    External IDs are handled by individual providers before this fallback. A
    title alone is never considered an automatic high-confidence match.
    """
    expected_type = "tv" if identity.get("type") == "tv" else "movie"
    if media_type and media_type not in (expected_type, "video", "title"):
        return 0.0
    expected_titles = {
        normalize_title(identity.get("title")),
        normalize_title(identity.get("original_title")),
    }
    expected_titles.discard("")
    got = normalize_title(title)
    if not got or got not in expected_titles:
        return 0.0
    expected_year = extract_year(identity.get("year"))
    got_year = extract_year(year)
    if not expected_year or not got_year:
        return 0.82
    if expected_year == got_year:
        return 0.98
    if abs(expected_year - got_year) == 1:
        return 0.88
    return 0.45


@dataclass
class TrailerCandidate:
    source: str
    trailer_url: Optional[str] = None
    manifest_url: Optional[str] = None
    provider_id: Optional[str] = None
    provider_page: Optional[str] = None
    matched_title: Optional[str] = None
    matched_year: Optional[int] = None
    media_type: Optional[str] = None
    title: Optional[str] = None
    trailer_type: str = "Trailer"
    official: bool = False
    width: Optional[int] = None
    height: Optional[int] = None
    bitrate: Optional[int] = None
    codec: Optional[str] = None
    fps: Optional[float] = None
    duration_seconds: Optional[float] = None
    hdr: bool = False
    dolby_vision: bool = False
    audio_language: Optional[str] = None
    audio_codec: Optional[str] = None
    audio_bitrate: Optional[int] = None
    subtitles: list[dict] = field(default_factory=list)
    confidence: float = 0.0
    verified: bool = False
    browser_compatible: bool = True
    compatibility: str = "broad"
    expires_at: Optional[str] = None
    requires_remux: bool = False
    local_cache_key: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    @property
    def candidate_id(self) -> str:
        raw = "|".join(
            [
                self.source,
                str(self.provider_id or ""),
                str(self.trailer_url or self.manifest_url or ""),
                str(self.width or ""),
                str(self.height or ""),
                str(self.audio_language or ""),
                str(self.trailer_type or ""),
            ]
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]

    def to_dict(self) -> dict:
        out = asdict(self)
        out["candidate_id"] = self.candidate_id
        out["resolution"] = self.height
        return out

    @classmethod
    def from_dict(cls, data: dict) -> "TrailerCandidate":
        allowed = set(cls.__dataclass_fields__)
        return cls(**{k: v for k, v in (data or {}).items() if k in allowed})


def _known_duration(candidate: TrailerCandidate) -> Optional[float]:
    try:
        value = float(candidate.duration_seconds) if candidate.duration_seconds is not None else None
    except Exception:
        return None
    return value if value and value > 0 else None


def duration_rank(candidate: TrailerCandidate) -> int:
    duration = _known_duration(candidate)
    if duration is None:
        return 1
    if duration >= 45:
        return 3
    if duration >= MIN_KNOWN_TRAILER_DURATION_SECONDS:
        return 2
    return 0


def candidate_is_usable(candidate: TrailerCandidate, *, allow_manual: bool = False) -> bool:
    url = candidate.trailer_url or candidate.manifest_url
    if not url or is_blocked_url(url):
        return False
    height = int(candidate.height or 0)
    if height > MAX_TRAILER_HEIGHT:
        return False
    if allow_manual:
        return True
    duration = _known_duration(candidate)
    if duration is not None and duration < MIN_KNOWN_TRAILER_DURATION_SECONDS:
        return False
    if candidate.confidence < 0.90:
        return False
    if not candidate.verified:
        return False
    if height < MIN_TRAILER_HEIGHT:
        return False
    if not candidate.browser_compatible and not candidate.requires_remux:
        return False
    return True


def candidate_sort_key(candidate: TrailerCandidate, *, hdr_supported: bool = False) -> tuple:
    """Quality ordering inside the already-selected language/type tier."""
    height = int(candidate.height or 0)
    bitrate = int(candidate.bitrate or 0)
    is_hdr = bool(candidate.hdr or candidate.dolby_vision)
    hdr_score = 1 if (hdr_supported and is_hdr) else 0
    if not hdr_supported and is_hdr:
        hdr_score = -1
    return (
        duration_rank(candidate),
        1 if candidate.official else 0,
        height,
        hdr_score,
        bitrate,
        codec_rank(candidate.codec),
        round(float(candidate.confidence or 0), 4),
        int(candidate.audio_bitrate or 0),
        float(candidate.fps or 0),
    )


def _selection_tier(candidate: TrailerCandidate) -> int:
    """Explicit product policy: Trailer IT > Teaser IT > Trailer EN > everything else."""
    lang = language_rank(candidate.audio_language)
    kind = type_rank(candidate.trailer_type)
    is_it = lang == 3
    is_en = lang == 2
    is_trailer = kind >= 4
    is_teaser = kind in (2, 3)

    if is_it and is_trailer:
        return 400
    if is_it and is_teaser:
        return 300
    if is_en and is_trailer:
        return 200
    if is_en and is_teaser:
        return 150
    if is_it:
        return 120
    if is_en:
        return 100
    return 50 + lang * 10 + kind


def pick_best(candidates: list[TrailerCandidate], *, hdr_supported: bool = False) -> Optional[TrailerCandidate]:
    """Pick by the explicit FLIXIT policy, then by native quality inside that tier."""
    usable = [c for c in candidates if candidate_is_usable(c)]
    if not usable:
        return None
    return max(
        usable,
        key=lambda c: (
            _selection_tier(c),
            candidate_sort_key(c, hdr_supported=hdr_supported),
        ),
    )


def perfect_candidate(candidate: TrailerCandidate) -> bool:
    height = int(candidate.height or 0)
    duration = _known_duration(candidate)
    return bool(
        candidate.verified
        and candidate.browser_compatible
        and PREFERRED_TRAILER_HEIGHT <= height <= MAX_TRAILER_HEIGHT
        and (duration is None or duration >= MIN_KNOWN_TRAILER_DURATION_SECONDS)
        and language_rank(candidate.audio_language) == 3
        and candidate.official
        and type_rank(candidate.trailer_type) >= 5
        and float(candidate.confidence or 0) >= 0.97
        and int(candidate.bitrate or 0) > 0
        and not is_blocked_url(candidate.trailer_url or candidate.manifest_url)
    )
