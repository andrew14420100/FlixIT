"""Managed video advertising for FlixIT playback.

Policy:
- free / unauthenticated viewers: 2 ads per content (pre-roll + mid-roll)
- Base: 1 ad per content (pre-roll)
- Pro / Unlimited: no ads

Paid-plan feature labels remain authoritative when present, so Admin plan
configuration can still explicitly select 0/1/2 ads without changing player
code. Campaigns are stored in MongoDB and managed from the Admin panel.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator


AD_KIND = "flixit_video_ad"


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
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("Inserisci un URL video HTTPS valido")
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
        # Free is the only tier with two interruptions by default.
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
        # A paid plan with no recognizable ad feature is kept interruption-free.
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

    @router.get("/api/public/ads/playback-policy")
    def playback_policy(request: Request):
        user = optional_user(request)
        count, tier = ad_policy(user)
        docs = [
            _public(doc)
            for doc in campaigns.find({"kind": AD_KIND}).sort([("order", 1), ("createdAt", 1)])
            if currently_active(doc)
        ]
        # The client only needs enough campaigns for pre-roll/mid-roll. Returning
        # a few extras allows deterministic rotation between contents.
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
        update = {**data.model_dump(), "kind": AD_KIND, "updatedAt": _now_iso()}
        result = campaigns.update_one({"kind": AD_KIND, "id": ad_id}, {"$set": update})
        if not result.matched_count:
            raise HTTPException(status_code=404, detail="Campagna non trovata")
        try:
            log_admin_action("ad_update", ad_id, {"name": data.name})
        except Exception:
            pass
        return _public(campaigns.find_one({"kind": AD_KIND, "id": ad_id}))

    @router.delete("/api/admin/ads/{ad_id}")
    def admin_delete_ad(ad_id: str, admin=Depends(get_current_admin)):
        if not campaigns.delete_one({"kind": AD_KIND, "id": ad_id}).deleted_count:
            raise HTTPException(status_code=404, detail="Campagna non trovata")
        try:
            log_admin_action("ad_delete", ad_id)
        except Exception:
            pass
        return {"ok": True}

    app.include_router(router)


__all__ = ["register_ad_service"]
