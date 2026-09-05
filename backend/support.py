"""FlixIT support module: admin user management, forced password reset, tickets with screenshot
attachments (Emergent Object Storage), and bell notifications for users and admins."""
import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, List

import bcrypt
import jwt
import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)
# Wired by server.py via register() (avoid circular imports)
ctx = {}

TICKET_CATEGORIES = [
    {"key": "proposta", "label": "Proposta di modifica"},
    {"key": "bug", "label": "Segnalazione bug"},
    {"key": "assistenza", "label": "Assistenza generale"},
    {"key": "titolo", "label": "Richiesta titolo"},
    {"key": "riproduzione", "label": "Problema di riproduzione"},
    {"key": "account", "label": "Account"},
]
TICKET_STATUSES = ("open", "in_progress", "closed")
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "flixit"
_storage_key = {"value": None}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- storage ----------
def init_storage(force: bool = False):
    if _storage_key["value"] and not force:
        return _storage_key["value"]
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY missing")
    resp = httpx.post(f"{STORAGE_URL}/init", json={"emergent_key": key}, timeout=30)
    resp.raise_for_status()
    _storage_key["value"] = resp.json()["storage_key"]
    return _storage_key["value"]


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = httpx.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, content=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = httpx.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, content=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = httpx.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = httpx.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------- helpers ----------
def col(name):
    return ctx["db"][name]


def user_dep():
    return ctx["get_current_user"]


def admin_dep():
    return ctx["get_current_admin"]


def notify(recipient: str, ntype: str, title: str, body: str, link: str, user_id: Optional[str] = None):
    col("notifications").insert_one({
        "id": str(uuid.uuid4()), "recipient": recipient, "user_id": user_id, "type": ntype,
        "title": title, "body": body, "link": link, "read": False, "created_at": now_iso(),
    })


def ticket_public(t: dict, viewer: str) -> dict:
    t = {k: v for k, v in t.items() if k != "_id"}
    t["unread"] = t.pop("unread_admin", 0) if viewer == "admin" else t.pop("unread_user", 0)
    t.pop("unread_admin", None)
    t.pop("unread_user", None)
    return t


def file_public(f: dict) -> dict:
    return {"id": f["id"], "name": f.get("original_filename"), "content_type": f.get("content_type"), "size": f.get("size")}


def attach_files(ids: List[str], owner_id: str, ticket_id: str) -> list:
    if not ids:
        return []
    files = list(col("files").find({"id": {"$in": ids}, "owner_id": owner_id, "is_deleted": False}, {"_id": 0}))
    col("files").update_many({"id": {"$in": [f["id"] for f in files]}}, {"$set": {"ticket_id": ticket_id}})
    return [file_public(f) for f in files]


def resolve_viewer(request: Request, auth: Optional[str]):
    """Return ('admin', None) / ('user', user_id) from bearer header or ?auth= (for <img>)."""
    token = auth
    if not token:
        header = request.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Non autenticato")
    try:
        payload = jwt.decode(token, ctx["jwt_secret"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token non valido")
    if payload.get("user_id"):
        return "user", payload["user_id"]
    if payload.get("email") and col("admin_users").find_one({"email": payload["email"]}):
        return "admin", None
    raise HTTPException(status_code=401, detail="Token non valido")


# ---------- models ----------
class UserPatch(BaseModel):
    role: Optional[str] = None
    banned: Optional[bool] = None
    ban_reason: Optional[str] = None
    name: Optional[str] = None


class ForcedPassword(BaseModel):
    new_password: str


class TicketCreate(BaseModel):
    category: str
    subject: str
    message: str
    attachment_ids: List[str] = []


class MessageCreate(BaseModel):
    text: str = ""
    attachment_ids: List[str] = []


class TicketPatch(BaseModel):
    status: str


class NoticeSend(BaseModel):
    user_id: Optional[str] = None
    title: str
    body: str


class ReadRequest(BaseModel):
    ids: Optional[List[str]] = None


def register(app, db, get_current_user, get_current_admin, jwt_secret, log_admin_action, issue_user_token):
    ctx.update({"db": db, "get_current_user": get_current_user, "get_current_admin": get_current_admin, "jwt_secret": jwt_secret, "issue_user_token": issue_user_token})
    users, tickets, messages, notifications, files = db["users"], db["tickets"], db["ticket_messages"], db["notifications"], db["files"]
    tickets.create_index([("user_id", 1), ("updated_at", -1)])
    tickets.create_index([("status", 1), ("updated_at", -1)])
    messages.create_index([("ticket_id", 1), ("created_at", 1)])
    notifications.create_index([("recipient", 1), ("user_id", 1), ("read", 1), ("created_at", -1)])
    files.create_index("id", unique=True)

    r = APIRouter()

    def user_summary(u: dict) -> dict:
        return {
            "id": u["id"], "email": u.get("email"), "name": u.get("name"), "profileImage": u.get("profileImage"),
            "role": u.get("role", "user"), "banned": bool(u.get("banned")), "ban_reason": u.get("ban_reason") or "",
            "must_reset_password": bool(u.get("must_reset_password")), "createdAt": u.get("createdAt"),
            "last_seen_at": u.get("last_seen_at"), "last_login_at": u.get("last_login_at"),
            "open_tickets": tickets.count_documents({"user_id": u["id"], "status": {"$ne": "closed"}}),
        }

    # ---- admin: users ----
    @r.get("/api/admin/users")
    def list_users(q: Optional[str] = None, page: int = 1, limit: int = 25, admin=Depends(get_current_admin)):
        flt = {}
        if q:
            flt = {"$or": [{"email": {"$regex": q, "$options": "i"}}, {"name": {"$regex": q, "$options": "i"}}]}
        total = users.count_documents(flt)
        docs = users.find(flt, {"_id": 0, "password": 0}).sort("createdAt", -1).skip((max(1, page) - 1) * limit).limit(limit)
        return {"items": [user_summary(u) for u in docs], "total": total, "page": page,
                "stats": {"total": users.count_documents({}), "banned": users.count_documents({"banned": True}),
                          "premium": users.count_documents({"role": "premium"}), "pending_reset": users.count_documents({"must_reset_password": True})}}

    @r.patch("/api/admin/users/{user_id}")
    def patch_user(user_id: str, data: UserPatch, admin=Depends(get_current_admin)):
        u = users.find_one({"id": user_id})
        if not u:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        upd = {"updatedAt": now_iso()}
        if data.role is not None:
            if data.role not in ("user", "premium"):
                raise HTTPException(status_code=400, detail="Ruolo non valido")
            upd["role"] = data.role
        if data.banned is not None:
            upd["banned"] = data.banned
            upd["ban_reason"] = (data.ban_reason or "").strip()[:300] if data.banned else ""
            upd["banned_at"] = now_iso() if data.banned else None
        if data.name is not None:
            upd["name"] = data.name.strip()[:60]
        users.update_one({"id": user_id}, {"$set": upd})
        log_admin_action("user_update", user_id, {k: v for k, v in upd.items() if k != "updatedAt"})
        return user_summary(users.find_one({"id": user_id}, {"_id": 0, "password": 0}))

    @r.post("/api/admin/users/{user_id}/force-reset")
    def force_reset(user_id: str, admin=Depends(get_current_admin)):
        u = users.find_one({"id": user_id})
        if not u:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        users.update_one({"id": user_id}, {"$set": {"must_reset_password": True, "reset_requested_at": now_iso()}})
        notify("user", "password_reset", "Reimposta la password", "L'amministratore ha richiesto il cambio della tua password.", "/account", user_id)
        log_admin_action("user_force_reset", user_id)
        return {"ok": True}

    @r.delete("/api/admin/users/{user_id}")
    def delete_user(user_id: str, admin=Depends(get_current_admin)):
        res = users.delete_one({"id": user_id})
        if not res.deleted_count:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        for name in ("user_lists", "watch_progress", "user_favorites"):
            db[name].delete_many({"user_id": user_id})
        notifications.delete_many({"user_id": user_id})
        log_admin_action("user_delete", user_id)
        return {"ok": True}

    # ---- user: forced password ----
    @r.post("/api/auth/forced-password")
    def set_forced_password(data: ForcedPassword, user=Depends(get_current_user)):
        fresh = users.find_one({"id": user["id"]})
        if not fresh or not fresh.get("must_reset_password"):
            raise HTTPException(status_code=400, detail="Nessun reset richiesto")
        if len(data.new_password) < 8 or data.new_password.lower() == data.new_password or not any(c.isdigit() for c in data.new_password):
            raise HTTPException(status_code=400, detail="La password deve avere almeno 8 caratteri, una maiuscola e un numero")
        if bcrypt.checkpw(data.new_password.encode(), fresh["password"].encode()):
            raise HTTPException(status_code=400, detail="La nuova password deve essere diversa da quella attuale")
        users.update_one({"id": user["id"]}, {"$set": {
            "password": bcrypt.hashpw(data.new_password.encode(), bcrypt.gensalt()).decode(),
            "must_reset_password": False, "password_changed_at": now_iso(), "updatedAt": now_iso()}})
        updated = users.find_one({"id": user["id"]}, {"_id": 0, "password": 0})
        return {"token": ctx["issue_user_token"](updated), "user": updated}

    # ---- files ----
    @r.post("/api/tickets/upload")
    async def upload_attachment(file: UploadFile = File(...), user=Depends(get_current_user)):
        ctype = file.content_type or "application/octet-stream"
        if ctype not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail="Sono ammesse solo immagini (png, jpg, webp, gif)")
        data = await file.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="Immagine troppo grande (max 5 MB)")
        ext = (file.filename or "img").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "png"
        path = f"{APP_NAME}/tickets/{user['id']}/{uuid.uuid4()}.{ext}"
        try:
            result = put_object(path, data, ctype)
        except Exception as e:
            logger.error(f"upload failed: {e}")
            raise HTTPException(status_code=502, detail="Caricamento non riuscito, riprova")
        doc = {"id": str(uuid.uuid4()), "storage_path": result["path"], "original_filename": file.filename, "content_type": ctype,
               "size": result.get("size", len(data)), "owner_id": user["id"], "ticket_id": None, "is_deleted": False, "created_at": now_iso()}
        files.insert_one(doc)
        return file_public(doc)

    @r.get("/api/files/{file_id}")
    def download_file(file_id: str, request: Request, auth: Optional[str] = Query(None)):
        viewer, uid = resolve_viewer(request, auth)
        f = files.find_one({"id": file_id, "is_deleted": False})
        if not f:
            raise HTTPException(status_code=404, detail="File non trovato")
        if viewer == "user" and f.get("owner_id") != uid:
            t = tickets.find_one({"id": f.get("ticket_id"), "user_id": uid})
            if not t:
                raise HTTPException(status_code=403, detail="Accesso negato")
        try:
            data, ctype = get_object(f["storage_path"])
        except Exception as e:
            logger.error(f"download failed: {e}")
            raise HTTPException(status_code=502, detail="File non disponibile")
        return Response(content=data, media_type=f.get("content_type") or ctype, headers={"Cache-Control": "private, max-age=3600"})

    # ---- tickets: shared ----
    def add_message(ticket: dict, sender: str, sender_name: str, text: str, attachment_ids: list, owner_id: str):
        if ticket["status"] == "closed":
            raise HTTPException(status_code=400, detail="Il ticket è chiuso: aprine uno nuovo")
        text = (text or "").strip()
        attachments = attach_files(attachment_ids, owner_id, ticket["id"]) if attachment_ids else []
        if not text and not attachments:
            raise HTTPException(status_code=400, detail="Messaggio vuoto")
        msg = {"id": str(uuid.uuid4()), "ticket_id": ticket["id"], "sender": sender, "sender_name": sender_name, "text": text[:4000],
               "attachments": attachments, "created_at": now_iso()}
        messages.insert_one(msg)
        upd = {"updated_at": msg["created_at"], "last_message_at": msg["created_at"], "last_sender": sender, "last_preview": (text or "📎 Allegato")[:120]}
        inc = {"unread_admin": 1} if sender == "user" else {"unread_user": 1}
        if sender == "admin" and ticket["status"] == "open":
            upd["status"] = "in_progress"
        tickets.update_one({"id": ticket["id"]}, {"$set": upd, "$inc": inc})
        msg.pop("_id", None)
        return msg

    # ---- tickets: user ----
    @r.get("/api/tickets/categories")
    def ticket_categories():
        return {"categories": TICKET_CATEGORIES}

    @r.get("/api/tickets")
    def my_tickets(user=Depends(get_current_user)):
        docs = tickets.find({"user_id": user["id"]}).sort("updated_at", -1)
        return {"items": [ticket_public(t, "user") for t in docs]}

    @r.post("/api/tickets")
    def create_ticket(data: TicketCreate, user=Depends(get_current_user)):
        if data.category not in {c["key"] for c in TICKET_CATEGORIES}:
            raise HTTPException(status_code=400, detail="Categoria non valida")
        subject = data.subject.strip()[:120]
        if len(subject) < 3:
            raise HTTPException(status_code=400, detail="Inserisci un oggetto (almeno 3 caratteri)")
        if len(data.message.strip()) < 5 and not data.attachment_ids:
            raise HTTPException(status_code=400, detail="Descrivi la richiesta (almeno 5 caratteri)")
        ts = now_iso()
        ticket = {"id": str(uuid.uuid4()), "user_id": user["id"], "user_email": user.get("email"), "user_name": user.get("name"),
                  "category": data.category, "subject": subject, "status": "open", "created_at": ts, "updated_at": ts,
                  "last_message_at": ts, "last_sender": "user", "unread_admin": 0, "unread_user": 0, "closed_by": None}
        tickets.insert_one(ticket)
        add_message(ticket, "user", user.get("name") or "Utente", data.message, data.attachment_ids, user["id"])
        cat = next((c["label"] for c in TICKET_CATEGORIES if c["key"] == data.category), data.category)
        notify("admin", "ticket_new", f"Nuovo ticket: {subject}", f"{user.get('name') or user.get('email')} · {cat}", f"/admin/tickets?id={ticket['id']}")
        return ticket_public(tickets.find_one({"id": ticket["id"]}), "user")

    @r.get("/api/tickets/{ticket_id}")
    def get_ticket(ticket_id: str, user=Depends(get_current_user)):
        t = tickets.find_one({"id": ticket_id, "user_id": user["id"]})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket non trovato")
        tickets.update_one({"id": ticket_id}, {"$set": {"unread_user": 0}})
        msgs = list(messages.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", 1))
        return {"ticket": ticket_public(t, "user"), "messages": msgs}

    @r.post("/api/tickets/{ticket_id}/messages")
    def user_reply(ticket_id: str, data: MessageCreate, user=Depends(get_current_user)):
        t = tickets.find_one({"id": ticket_id, "user_id": user["id"]})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket non trovato")
        msg = add_message(t, "user", user.get("name") or "Utente", data.text, data.attachment_ids, user["id"])
        notify("admin", "ticket_message", f"Nuovo messaggio: {t['subject']}", (data.text or "📎 Allegato")[:120], f"/admin/tickets?id={ticket_id}")
        return msg

    @r.post("/api/tickets/{ticket_id}/close")
    def user_close(ticket_id: str, user=Depends(get_current_user)):
        t = tickets.find_one({"id": ticket_id, "user_id": user["id"]})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket non trovato")
        tickets.update_one({"id": ticket_id}, {"$set": {"status": "closed", "closed_by": "user", "closed_at": now_iso(), "updated_at": now_iso()}})
        notify("admin", "ticket_status", f"Ticket chiuso dall'utente: {t['subject']}", t.get("user_email") or "", f"/admin/tickets?id={ticket_id}")
        return ticket_public(tickets.find_one({"id": ticket_id}), "user")

    # ---- tickets: admin ----
    @r.get("/api/admin/tickets")
    def admin_tickets(status: Optional[str] = None, q: Optional[str] = None, admin=Depends(get_current_admin)):
        flt = {}
        if status in TICKET_STATUSES:
            flt["status"] = status
        if q:
            flt["$or"] = [{"subject": {"$regex": q, "$options": "i"}}, {"user_email": {"$regex": q, "$options": "i"}}]
        docs = tickets.find(flt).sort("updated_at", -1).limit(200)
        counts = {s: tickets.count_documents({"status": s}) for s in TICKET_STATUSES}
        return {"items": [ticket_public(t, "admin") for t in docs], "counts": counts, "categories": TICKET_CATEGORIES}

    @r.get("/api/admin/tickets/{ticket_id}")
    def admin_ticket(ticket_id: str, admin=Depends(get_current_admin)):
        t = tickets.find_one({"id": ticket_id})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket non trovato")
        tickets.update_one({"id": ticket_id}, {"$set": {"unread_admin": 0}})
        msgs = list(messages.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", 1))
        return {"ticket": ticket_public(t, "admin"), "messages": msgs, "user": user_summary(users.find_one({"id": t["user_id"]}) or {"id": t["user_id"]})}

    @r.post("/api/admin/tickets/{ticket_id}/messages")
    def admin_reply(ticket_id: str, data: MessageCreate, admin=Depends(get_current_admin)):
        t = tickets.find_one({"id": ticket_id})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket non trovato")
        msg = add_message(t, "admin", "Assistenza FlixIT", data.text, [], t["user_id"])
        notify("user", "ticket_reply", f"Risposta al tuo ticket: {t['subject']}", (data.text or "")[:120], f"/account?ticket={ticket_id}", t["user_id"])
        return msg

    @r.patch("/api/admin/tickets/{ticket_id}")
    def admin_ticket_status(ticket_id: str, data: TicketPatch, admin=Depends(get_current_admin)):
        if data.status not in TICKET_STATUSES:
            raise HTTPException(status_code=400, detail="Stato non valido")
        t = tickets.find_one({"id": ticket_id})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket non trovato")
        upd = {"status": data.status, "updated_at": now_iso()}
        if data.status == "closed":
            upd.update({"closed_by": "admin", "closed_at": now_iso()})
        tickets.update_one({"id": ticket_id}, {"$set": upd})
        labels = {"open": "Aperto", "in_progress": "In lavorazione", "closed": "Chiuso"}
        notify("user", "ticket_status", f"Ticket «{t['subject']}»: {labels[data.status]}", "Lo stato del tuo ticket è cambiato.", f"/account?ticket={ticket_id}", t["user_id"])
        log_admin_action("ticket_status", ticket_id, {"status": data.status})
        return ticket_public(tickets.find_one({"id": ticket_id}), "admin")

    # ---- notifications ----
    @r.get("/api/notifications")
    def my_notifications(user=Depends(get_current_user)):
        fresh = users.find_one({"id": user["id"]}, {"_id": 0, "must_reset_password": 1, "role": 1})
        docs = list(notifications.find({"recipient": "user", "user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(30))
        return {"items": docs, "unread": notifications.count_documents({"recipient": "user", "user_id": user["id"], "read": False}),
                "must_reset_password": bool((fresh or {}).get("must_reset_password")), "role": (fresh or {}).get("role", "user")}

    @r.post("/api/notifications/read")
    def read_notifications(data: ReadRequest, user=Depends(get_current_user)):
        flt = {"recipient": "user", "user_id": user["id"]}
        if data.ids:
            flt["id"] = {"$in": data.ids}
        notifications.update_many(flt, {"$set": {"read": True}})
        return {"ok": True}

    @r.get("/api/admin/notifications")
    def admin_notifications(admin=Depends(get_current_admin)):
        docs = list(notifications.find({"recipient": "admin"}, {"_id": 0}).sort("created_at", -1).limit(40))
        return {"items": docs, "unread": notifications.count_documents({"recipient": "admin", "read": False})}

    @r.post("/api/admin/notifications/read")
    def admin_read(data: ReadRequest, admin=Depends(get_current_admin)):
        flt = {"recipient": "admin"}
        if data.ids:
            flt["id"] = {"$in": data.ids}
        notifications.update_many(flt, {"$set": {"read": True}})
        return {"ok": True}

    @r.post("/api/admin/notifications/send")
    def admin_send_notice(data: NoticeSend, admin=Depends(get_current_admin)):
        title, body = data.title.strip()[:120], data.body.strip()[:1000]
        if not title or not body:
            raise HTTPException(status_code=400, detail="Titolo e testo sono obbligatori")
        targets = [data.user_id] if data.user_id else [u["id"] for u in users.find({"banned": {"$ne": True}}, {"id": 1})]
        if data.user_id and not users.find_one({"id": data.user_id}):
            raise HTTPException(status_code=404, detail="Utente non trovato")
        for uid in targets:
            notify("user", "notice", title, body, "/account", uid)
        log_admin_action("notice_send", data.user_id, {"title": title, "recipients": len(targets)})
        return {"ok": True, "recipients": len(targets)}

    app.include_router(r)
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.warning(f"Object storage init failed (uploads will retry lazily): {e}")
