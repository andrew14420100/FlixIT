"""Admin-created FlixIT users and first-access password claiming.

An administrator can create a user with only name/email and optionally assign a
Premium plan. The account receives an unusable random password and is marked for
mandatory password setup. On first access the user claims the account by email,
receives a normal authenticated session, and the existing blocking
ForcedPasswordModal requires a real password before continuing.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


class ManualUserIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    plan_id: Optional[str] = None


class FirstAccessIn(BaseModel):
    email: EmailStr


def register_manual_user_service(app, db, get_current_user, get_current_admin, log_admin_action):
    if getattr(app.state, "flixit_manual_users_registered", False):
        return
    app.state.flixit_manual_users_registered = True

    users = db["users"]
    plans = db["premium_plans"]
    router = APIRouter()

    def public_user(user: dict) -> dict:
        from premium import attach_status

        data = {
            "id": user.get("id"),
            "email": user.get("email"),
            "name": user.get("name"),
            "profileImage": user.get("profileImage"),
            "role": user.get("role", "user"),
            "banned": bool(user.get("banned")),
            "must_reset_password": bool(user.get("must_reset_password")),
            "premium": user.get("premium"),
        }
        return attach_status(data)

    @router.post("/api/admin/users/manual-create")
    def manual_create(data: ManualUserIn, admin=Depends(get_current_admin)):
        email = str(data.email).strip().lower()
        name = str(data.name or "").strip()
        if users.find_one({"email": email}):
            raise HTTPException(status_code=409, detail="Esiste già un utente con questa email")

        plan = None
        if data.plan_id:
            plan = plans.find_one({"id": data.plan_id, "active": True}, {"_id": 0})
            if not plan:
                raise HTTPException(status_code=404, detail="Piano Premium non trovato o non attivo")

        # The generated secret is never returned or shown. It exists only so the
        # normal login route cannot be used before the owner creates a password.
        unusable_secret = secrets.token_urlsafe(48)
        password_hash = bcrypt.hashpw(unusable_secret.encode(), bcrypt.gensalt()).decode()
        ts = _now_iso()
        user_id = str(uuid.uuid4())
        doc = {
            "id": user_id,
            "email": email,
            "password": password_hash,
            "name": name,
            "profileImage": None,
            "role": "user",
            "banned": False,
            "must_reset_password": True,
            "created_by_admin": True,
            "first_access_pending": True,
            "premium": {"active": False, "expiresAt": None, "source": "admin_manual"},
            "createdAt": ts,
            "updatedAt": ts,
        }

        if plan:
            duration_days = plan.get("duration_days")
            expires_at = None
            if duration_days is not None:
                expires_at = (_now() + timedelta(days=max(1, int(duration_days)))).isoformat()
            doc["premium"] = {
                "active": True,
                "expiresAt": expires_at,
                "plan_id": plan.get("id"),
                "plan_name": plan.get("name"),
                "source": "admin_manual",
                "activated_at": ts,
            }

        users.insert_one(doc)
        try:
            log_admin_action(
                "user_manual_create",
                user_id,
                {"email": email, "name": name, "plan_id": data.plan_id},
            )
        except Exception:
            pass
        return {"ok": True, "user": public_user(doc), "first_access_pending": True}

    @router.post("/api/auth/first-access")
    def first_access(data: FirstAccessIn):
        email = str(data.email).strip().lower()
        user = users.find_one({"email": email})
        eligible = bool(
            user
            and user.get("created_by_admin")
            and user.get("first_access_pending")
            and user.get("must_reset_password")
        )
        if not eligible:
            return {"eligible": False}
        if user.get("banned"):
            raise HTTPException(
                status_code=403,
                detail={"code": "banned", "reason": user.get("ban_reason") or ""},
            )

        # Reuse the normal user session + the existing mandatory password modal.
        import server_core as core

        token = core.issue_user_token(user)
        users.update_one(
            {"id": user["id"]},
            {"$set": {"last_login_at": _now_iso(), "updatedAt": _now_iso()}},
        )
        return {"eligible": True, "token": token, "user": public_user(user)}

    @router.post("/api/auth/first-access-complete")
    def first_access_complete(user=Depends(get_current_user)):
        if user.get("created_by_admin"):
            users.update_one(
                {"id": user["id"]},
                {"$set": {"first_access_pending": False, "updatedAt": _now_iso()}},
            )
        return {"ok": True}

    app.include_router(router)
