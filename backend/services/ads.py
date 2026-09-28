"""Managed video advertising for FlixIT playback.

Policy:
- free / unauthenticated viewers: 2 ads per content (pre-roll + mid-roll)
- Base: 1 ad per content (pre-roll)
- Pro / Unlimited: no ads

Advertising videos can be supplied as direct browser-playable URLs or uploaded
from Admin. Uploaded media is stored in MongoDB GridFS so it survives ephemeral
Emergent environments and is streamed with HTTP Range support to the native
HTML5 player.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlparse

import jwt
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from gridfs import GridFS
from pydantic import BaseModel, Field, field_validator


AD_KIND = "flixit_video_ad"
UPLOADED_MEDIA_PREFIX = "/api/public/ads/media/"
ALLOWED_UPLOADS = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".m4v": "video/x-m4v",
    ".mov": "video/quicktime",
}
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _public(doc: dict) -> dict:
    return {k: v for k, v in (doc or {}).items() if k != "_id"}


def _uploaded_object_id(value: str):
    value = str(value or "").strip()
    if not value.startswith(UPLOADED_MEDIA_PREFIX):
        return None
    raw = value[len(UPLOADED_MEDIA_PREFIX):].split("?", 1)[0].split("/", 1)[0]
    try:
        return ObjectId(raw)
    except Exception:
        return None


class AdCampaignIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    video_url: str
    click_url: str = ""
    active: bool = True
    order: int = 0
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None

    @field_validator("video_url")
    @classmethod
    def validate_video_url(cls, value: str) -> str:
        value = str(value or "").strip()
        if value.startswith(UPLOADED_MEDIA_PREFIX):
            if not _uploaded_object_id(value):
                raise ValueError("Video pubblicitario caricato non valido")
            return value
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("Inserisci un URL video HTTPS valido oppure carica un file video")
        host = str(parsed.hostname or "").lower()
        if host in YOUTUBE_HOSTS or host.endswith(".youtube.com"):
            raise ValueError("I link YouTube richiedono il player YouTube. Per il player FlixIT carica direttamente il file MP4/WebM della pubblicità.")
        return value

    @field_validator("click_url")
    @classmethod
    def validate_click_url(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            return ""
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("Il link della campagna deve essere un URL HTTP/HTTPS valido")
        return value


def register_ad_service(app, db, get_current_admin, log_admin_action):
    if getattr(app.state, "flixit_ads_registered", False):
        return
    app.state.flixit_ads_registered = True

    campaigns = db["ads"]
    plans = db["premium_plans"]
    users = db["users"]
    media_fs = GridFS(db, collection="ad_media")
    try:
        campaigns.create_index([("kind", 1), ("active", 1), ("order", 1)])
    except Exception:
        pass

    router = APIRouter()

    def optional_user(request: Request):
        header = str(request.headers.get("Authorization") or "")
        if not header.startswith("Bearer "):
            return None
        token = header[7:].strip()
        if not token:
            return None
        try:
            payload = jwt.decode(
                token,
                os.environ.get("JWT_SECRET", "netflix-admin-super-secret-key-2024"),
                algorithms=["HS256"],
            )
        except Exception:
            return None
        query = None
        if payload.get("user_id"):
            query = {"id": payload.get("user_id")}
        elif payload.get("email"):
            query = {"email": str(payload.get("email") or "").lower()}
        if not query:
            return None
        return users.find_one(query, {"_id": 0, "password": 0})

    def premium_active(user: Optional[dict]) -> bool:
        if not user:
            return False
        if user.get("role") == "superadmin":
            return True
        premium = user.get("premium") or {}
        if not premium.get("active"):
            return False
        expires_at = _parse_dt(premium.get("expiresAt"))
        return expires_at is None or expires_at > datetime.now(timezone.utc)

    def ad_policy(user: Optional[dict]):
        if not user or not premium_active(user):
            return 2, "free"
        if user.get("role") == "superadmin":
            return 0, "superadmin"

        premium = user.get("premium") or {}
        plan = plans.find_one({"id": premium.get("plan_id")}, {"_id": 0}) if premium.get("plan_id") else None
        plan_name = str((plan or {}).get("name") or premium.get("plan_name") or "").strip()
        features = [str(value or "").lower() for value in ((plan or {}).get("features") or [])]
        feature_text = " | ".join(features)

        if "senza pubblic" in feature_text:
            return 0, plan_name or "premium"
        if "2 pubblic" in feature_text:
            return 2, plan_name or "premium"
        if "1 pubblic" in feature_text:
            return 1, plan_name or "premium"

        normalized = plan_name.lower()
        if "base" in normalized or "basic" in normalized:
            return 1, "base"
        if "pro" in normalized:
            return 0, "pro"
        if "unlimited" in normalized or "illimit" in normalized:
            return 0, "unlimited"
        return 0, plan_name or "premium"

    def currently_active(doc: dict) -> bool:
        if not doc.get("active", True):
            return False
        now = datetime.now(timezone.utc)
        starts = _parse_dt(doc.get("starts_at"))
        ends = _parse_dt(doc.get("ends_at"))
        if starts and now < starts:
            return False
        if ends and now > ends:
            return False
        return True

    def delete_uploaded_media(video_url: str):
        media_id = _uploaded_object_id(video_url)
        if not media_id:
            return
        try:
            if media_fs.exists(media_id):
                media_fs.delete(media_id)
        except Exception:
            pass

    @router.post("/api/admin/ads/upload")
    async def admin_upload_ad_video(request: Request, admin=Depends(get_current_admin)):
        raw_name = unquote(str(request.headers.get("x-file-name") or "pubblicita.mp4"))
        safe_name = Path(raw_name).name or "pubblicita.mp4"
        ext = Path(safe_name).suffix.lower()
        if ext not in ALLOWED_UPLOADS:
            raise HTTPException(status_code=400, detail="Formato non supportato. Carica MP4, WebM, M4V o MOV.")

        content_type = str(request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        if content_type and content_type != "application/octet-stream" and not content_type.startswith("video/"):
            raise HTTPException(status_code=400, detail="Il file selezionato non risulta essere un video")

        body = await request.body()
        if not body:
            raise HTTPException(status_code=400, detail="Il file video è vuoto")
        max_mb = max(10, min(int(os.environ.get("FLIXIT_AD_MAX_UPLOAD_MB", "150")), 500))
        if len(body) > max_mb * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"Video troppo grande. Limite attuale: {max_mb} MB")

        mime = content_type if content_type.startswith("video/") else ALLOWED_UPLOADS[ext]
        media_id = media_fs.put(
            body,
            filename=safe_name,
            contentType=mime,
            uploadedAt=_now_iso(),
            uploadedBy=str((admin or {}).get("email") or (admin or {}).get("id") or "admin"),
        )
        try:
            log_admin_action("ad_video_upload", str(media_id), {"filename": safe_name, "bytes": len(body)})
        except Exception:
            pass
        return {
            "ok": True,
            "media_id": str(media_id),
            "filename": safe_name,
            "size": len(body),
            "content_type": mime,
            "url": f"{UPLOADED_MEDIA_PREFIX}{media_id}",
        }

    @router.get("/api/public/ads/media/{media_id}")
    def public_ad_media(media_id: str, request: Request):
        try:
            oid = ObjectId(media_id)
        except Exception:
            raise HTTPException(status_code=404, detail="Video pubblicitario non trovato")
        if not media_fs.exists(oid):
            raise HTTPException(status_code=404, detail="Video pubblicitario non trovato")

        grid = media_fs.get(oid)
        total = int(grid.length or 0)
        media_type = str(getattr(grid, "content_type", None) or getattr(grid, "contentType", None) or "video/mp4")
        headers = {
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": f'inline; filename="{Path(str(grid.filename or "ad.mp4")).name}"',
        }

        range_header = str(request.headers.get("range") or "").strip()
        if range_header:
            match = re.match(r"bytes=(\d*)-(\d*)$", range_header)
            if not match:
                raise HTTPException(status_code=416, detail="Intervallo video non valido")
            raw_start, raw_end = match.groups()
            if raw_start:
                start = int(raw_start)
                end = int(raw_end) if raw_end else total - 1
            elif raw_end:
                suffix = int(raw_end)
                start = max(0, total - suffix)
                end = total - 1
            else:
                raise HTTPException(status_code=416, detail="Intervallo video non valido")
            if start < 0 or end < start or start >= total:
                raise HTTPException(status_code=416, detail="Intervallo video non disponibile")
            end = min(end, total - 1)
            length = end - start + 1
            grid.seek(start)

            def partial_stream():
                remaining = length
                while remaining > 0:
                    chunk = grid.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

            headers.update({
                "Content-Range": f"bytes {start}-{end}/{total}",
                "Content-Length": str(length),
            })
            return StreamingResponse(partial_stream(), status_code=206, media_type=media_type, headers=headers)

        def full_stream():
            while True:
                chunk = grid.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk

        headers["Content-Length"] = str(total)
        return StreamingResponse(full_stream(), media_type=media_type, headers=headers)

    @router.get("/api/public/ads/playback-policy")
    def playback_policy(request: Request):
        user = optional_user(request)
        count, tier = ad_policy(user)
        docs = [
            _public(doc)
            for doc in campaigns.find({"kind": AD_KIND}).sort([("order", 1), ("createdAt", 1)])
            if currently_active(doc)
        ]
        public_campaigns = [
            {
                "id": doc.get("id"),
                "name": doc.get("name"),
                "video_url": doc.get("video_url"),
                "click_url": doc.get("click_url") or "",
            }
            for doc in docs[:12]
            if doc.get("video_url")
        ]
        effective_count = count if public_campaigns else 0
        return {
            "tier": tier,
            "ad_count": effective_count,
            "configured_ad_count": count,
            "breaks": (["preroll", "midroll"] if effective_count >= 2 else (["preroll"] if effective_count == 1 else [])),
            "campaigns": public_campaigns,
        }

    @router.get("/api/admin/ads")
    def admin_list_ads(admin=Depends(get_current_admin)):
        items = [_public(doc) for doc in campaigns.find({"kind": AD_KIND}).sort([("order", 1), ("createdAt", -1)])]
        return {"items": items}

    @router.post("/api/admin/ads")
    def admin_create_ad(data: AdCampaignIn, admin=Depends(get_current_admin)):
        doc = {
            "id": str(uuid.uuid4())[:10],
            "kind": AD_KIND,
            **data.model_dump(),
            "createdAt": _now_iso(),
            "updatedAt": _now_iso(),
        }
        campaigns.insert_one(doc)
        try:
            log_admin_action("ad_create", doc["id"], {"name": doc["name"]})
        except Exception:
            pass
        return _public(doc)

    @router.put("/api/admin/ads/{ad_id}")
    def admin_update_ad(ad_id: str, data: AdCampaignIn, admin=Depends(get_current_admin)):
        previous = campaigns.find_one({"kind": AD_KIND, "id": ad_id})
        if not previous:
            raise HTTPException(status_code=404, detail="Campagna non trovata")
        update = {**data.model_dump(), "kind": AD_KIND, "updatedAt": _now_iso()}
        campaigns.update_one({"kind": AD_KIND, "id": ad_id}, {"$set": update})
        old_url = str(previous.get("video_url") or "")
        if old_url and old_url != data.video_url:
            delete_uploaded_media(old_url)
        try:
            log_admin_action("ad_update", ad_id, {"name": data.name})
        except Exception:
            pass
        return _public(campaigns.find_one({"kind": AD_KIND, "id": ad_id}))

    @router.delete("/api/admin/ads/{ad_id}")
    def admin_delete_ad(ad_id: str, admin=Depends(get_current_admin)):
        previous = campaigns.find_one({"kind": AD_KIND, "id": ad_id})
        if not previous:
            raise HTTPException(status_code=404, detail="Campagna non trovata")
        campaigns.delete_one({"kind": AD_KIND, "id": ad_id})
        delete_uploaded_media(str(previous.get("video_url") or ""))
        try:
            log_admin_action("ad_delete", ad_id)
        except Exception:
            pass
        return {"ok": True}

    app.include_router(router)


__all__ = ["register_ad_service"]
