"""Role/permission gateway for the FlixIT admin panel.

Superadmin always has full access. Admin users receive the default limited
permission set below, with optional per-user overrides stored in
``users.admin_permissions``.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Dict

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


DEFAULT_ADMIN_PERMISSIONS: Dict[str, bool] = {
    "users_view": True,
    "users_create": False,
    "users_edit": False,
    "users_assign_plan": False,
    "users_reset_password": True,
    "users_delete": False,
    "plans_view": True,
    "plans_manage": True,
    "payments_view": True,
    "refunds_manage": False,
    "ads_view": True,
    "ads_create": True,
    "ads_edit": True,
    "ads_delete": False,
    "catalog_view": True,
    "catalog_edit": False,
    "home_view": True,
    "home_edit": False,
    "settings_view": True,
    "settings_edit": False,
    "logs_view": True,
}

PERMISSION_GROUPS = [
    {"id": "users", "label": "Utenti", "items": [
        ("users_view", "Visualizza utenti"),
        ("users_create", "Crea utenti"),
        ("users_edit", "Modifica ruoli e sospensioni"),
        ("users_assign_plan", "Assegna o revoca piani"),
        ("users_reset_password", "Forza reset password"),
        ("users_delete", "Elimina utenti"),
    ]},
    {"id": "premium", "label": "Premium e pagamenti", "items": [
        ("plans_view", "Visualizza piani Premium"),
        ("plans_manage", "Modifica piani Premium"),
        ("payments_view", "Visualizza pagamenti"),
        ("refunds_manage", "Esegui rimborsi"),
    ]},
    {"id": "ads", "label": "Pubblicità", "items": [
        ("ads_view", "Visualizza campagne"),
        ("ads_create", "Crea campagne"),
        ("ads_edit", "Modifica campagne"),
        ("ads_delete", "Elimina campagne"),
    ]},
    {"id": "catalog", "label": "Catalogo e Home", "items": [
        ("catalog_view", "Visualizza catalogo, artwork e trailer"),
        ("catalog_edit", "Modifica catalogo, artwork e trailer"),
        ("home_view", "Visualizza Hero e sezioni Home"),
        ("home_edit", "Modifica Hero e sezioni Home"),
    ]},
    {"id": "system", "label": "Sistema", "items": [
        ("settings_view", "Visualizza impostazioni tecniche"),
        ("settings_edit", "Modifica impostazioni tecniche"),
        ("logs_view", "Visualizza log attività"),
    ]},
]


def effective_permissions(user: dict) -> Dict[str, bool]:
    if (user or {}).get("role") == "superadmin":
        return {key: True for key in DEFAULT_ADMIN_PERMISSIONS}
    merged = dict(DEFAULT_ADMIN_PERMISSIONS)
    overrides = (user or {}).get("admin_permissions") or {}
    for key in merged:
        if key in overrides:
            merged[key] = bool(overrides[key])
    return merged


def _required_permission(path: str, method: str):
    path = str(path or "")
    method = str(method or "GET").upper()

    if path in ("/api/admin/login", "/api/admin/me", "/api/admin/permissions/me"):
        return None
    if path.startswith("/api/admin/admins/") or path == "/api/admin/admins":
        return "__superadmin__"

    if path.startswith("/api/admin/users"):
        if "/payments" in path:
            return "payments_view" if method == "GET" else "refunds_manage"
        if method == "GET":
            return "users_view"
        if "force-reset" in path or "reset-password" in path:
            return "users_reset_password"
        if "/premium" in path:
            return "users_assign_plan"
        if path.endswith("/manual-create"):
            return "users_create"
        if method == "DELETE":
            return "users_delete"
        return "users_edit"

    if path.startswith("/api/admin/plans"):
        return "plans_view" if method == "GET" else "plans_manage"

    if path.startswith("/api/admin/payments"):
        if "/refund" in path:
            return "refunds_manage"
        return "payments_view" if method == "GET" else "refunds_manage"

    if path.startswith("/api/admin/ads"):
        if method == "GET":
            return "ads_view"
        if method == "DELETE":
            return "ads_delete"
        if method == "POST" and path.rstrip("/") == "/api/admin/ads":
            return "ads_create"
        return "ads_edit"

    if path.startswith((
        "/api/admin/contents",
        "/api/admin/import-from-tmdb",
        "/api/admin/verify-all-vixsrc",
        "/api/admin/artwork",
        "/api/admin/trailers",
        "/api/admin/coming-soon",
        "/api/admin/top10",
    )):
        return "catalog_view" if method == "GET" else "catalog_edit"

    if path.startswith(("/api/admin/hero", "/api/admin/sections", "/api/admin/available-sections")):
        return "home_view" if method == "GET" else "home_edit"

    if path.startswith("/api/admin/settings") or path.startswith("/api/admin/mediaflow"):
        return "settings_view" if method == "GET" else "settings_edit"

    if path.startswith("/api/admin/logs"):
        return "logs_view"

    # Routes not covered by the requested restrictions keep their current
    # behaviour (tickets, menu header, premium pages, dashboard, etc.).
    return None


def register_admin_permissions(app, db, get_current_admin, log_admin_action):
    if getattr(app.state, "flixit_admin_permissions_registered", False):
        return
    app.state.flixit_admin_permissions_registered = True
    users = db["users"]
    secret = os.environ.get("JWT_SECRET", "netflix-admin-super-secret-key-2024")

    @app.middleware("http")
    async def admin_permission_gateway(request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/admin/") or path == "/api/admin/login":
            return await call_next(request)

        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return await call_next(request)
        try:
            payload = jwt.decode(header[7:], secret, algorithms=["HS256"])
            query = {"id": payload.get("user_id")} if payload.get("user_id") else {"email": str(payload.get("email") or "").lower()}
            user = users.find_one(query, {"_id": 0, "password": 0})
        except Exception:
            return await call_next(request)
        if not user or user.get("role") not in ("admin", "superadmin"):
            return await call_next(request)
        if user.get("role") == "superadmin":
            return await call_next(request)

        required = _required_permission(path, request.method)
        if required == "__superadmin__":
            return JSONResponse(status_code=403, content={"detail": "Solo Superadmin"})
        if required and not effective_permissions(user).get(required, False):
            return JSONResponse(status_code=403, content={"detail": "Solo Superadmin"})
        return await call_next(request)

    router = APIRouter()

    class PermissionsIn(BaseModel):
        permissions: Dict[str, bool]

    def require_superadmin(admin=Depends(get_current_admin)):
        if admin.get("role") != "superadmin":
            raise HTTPException(status_code=403, detail="Solo Superadmin")
        return admin

    @router.get("/api/admin/permissions/me")
    def my_permissions(admin=Depends(get_current_admin)):
        return {
            "role": admin.get("role"),
            "permissions": effective_permissions(admin),
            "defaults": dict(DEFAULT_ADMIN_PERMISSIONS),
            "groups": [
                {"id": group["id"], "label": group["label"], "items": [{"key": k, "label": label} for k, label in group["items"]]}
                for group in PERMISSION_GROUPS
            ],
        }

    @router.get("/api/admin/admins")
    def list_admins(admin=Depends(require_superadmin)):
        items = []
        for row in users.find({"role": "admin"}, {"_id": 0, "password": 0}).sort("email", 1):
            row = dict(row)
            row["effective_permissions"] = effective_permissions(row)
            items.append(row)
        return {
            "items": items,
            "defaults": dict(DEFAULT_ADMIN_PERMISSIONS),
            "groups": [
                {"id": group["id"], "label": group["label"], "items": [{"key": k, "label": label} for k, label in group["items"]]}
                for group in PERMISSION_GROUPS
            ],
        }

    @router.put("/api/admin/admins/{user_id}/permissions")
    def update_admin_permissions(user_id: str, data: PermissionsIn, admin=Depends(require_superadmin)):
        target = users.find_one({"id": user_id, "role": "admin"}, {"_id": 0, "password": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Admin non trovato")
        cleaned = {key: bool(data.permissions.get(key, DEFAULT_ADMIN_PERMISSIONS[key])) for key in DEFAULT_ADMIN_PERMISSIONS}
        users.update_one(
            {"id": user_id},
            {"$set": {"admin_permissions": cleaned, "updatedAt": datetime.now(timezone.utc).isoformat()}},
        )
        if log_admin_action:
            log_admin_action("ADMIN_PERMISSIONS_UPDATE", user_id, {"email": target.get("email"), "permissions": cleaned})
        return {"ok": True, "permissions": cleaned}

    @router.post("/api/admin/admins/{user_id}/permissions/reset")
    def reset_admin_permissions(user_id: str, admin=Depends(require_superadmin)):
        target = users.find_one({"id": user_id, "role": "admin"}, {"_id": 0, "password": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Admin non trovato")
        users.update_one({"id": user_id}, {"$unset": {"admin_permissions": ""}, "$set": {"updatedAt": datetime.now(timezone.utc).isoformat()}})
        if log_admin_action:
            log_admin_action("ADMIN_PERMISSIONS_RESET", user_id, {"email": target.get("email")})
        return {"ok": True, "permissions": dict(DEFAULT_ADMIN_PERMISSIONS)}

    app.include_router(router)
