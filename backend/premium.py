"""FlixIT premium module: roles, premium status + expiry job, plans, Stripe/PayPal payments,
refunds, premium pages (editable content) and admin-curated "In arrivo"."""
import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import uuid
import base64
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import httpx
import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
ctx = {}

ADMIN_ROLES = ("admin", "superadmin")
ROLES = ("user", "admin", "superadmin")
SUPERADMIN_EMAILS = ("admin@admin.com", "andcolaz@gmail.com")
DEFAULT_SUPERADMIN_PASSWORD = "Admin123!"
PREMIUM_CHECK_SECONDS = 600

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or "sk_test_emergent"
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
PAYPAL_BASE = "https://api-m.sandbox.paypal.com" if os.environ.get("PAYPAL_MODE", "sandbox") == "sandbox" else "https://api-m.paypal.com"

DEFAULT_PLANS = [
    {"id": "mensile", "name": "Mensile", "description": "Accesso completo alle sezioni Premium, rinnovo manuale ogni mese.", "price_cents": 499, "currency": "EUR", "interval": "month", "duration_days": 30, "badge": "", "features": ["Prime Visioni", "Cinema d'Autore", "Nessuna pubblicità"], "active": True, "order": 1},
    {"id": "annuale", "name": "Annuale", "description": "12 mesi di Premium al prezzo di 8.", "price_cents": 3999, "currency": "EUR", "interval": "year", "duration_days": 365, "badge": "Più scelto", "features": ["Tutto il piano Mensile", "Risparmi il 33%", "Accesso anticipato alle novità"], "active": True, "order": 2},
    {"id": "a-vita", "name": "A vita", "description": "Un solo pagamento, Premium per sempre.", "price_cents": 9900, "currency": "EUR", "interval": "lifetime", "duration_days": None, "badge": "Per sempre", "features": ["Tutto il piano Annuale", "Nessuna scadenza", "Badge Fondatore"], "active": True, "order": 3},
]

DEFAULT_PAGES = [
    {"id": "prime-visioni", "title": "Prime Visioni", "slug": "prime-visioni", "description": "Le uscite più attese, selezionate ogni settimana dalla redazione FlixIT.", "access": "premium", "active": True, "order": 1,
     "hero": {"title": "Prime Visioni", "description": "I titoli del momento, in anteprima per gli abbonati Premium.", "image": "", "trailer_key": "", "cta_label": "Scopri la selezione", "cta_link": "#sezioni"},
     "sections": [{"id": "in-evidenza", "title": "In evidenza questa settimana", "items": []}]},
    {"id": "cinema-d-autore", "title": "Cinema d'Autore", "slug": "cinema-d-autore", "description": "Registi, classici e capolavori indipendenti scelti a mano.", "access": "premium", "active": True, "order": 2,
     "hero": {"title": "Cinema d'Autore", "description": "Un percorso curato tra i grandi maestri e le voci indipendenti del cinema.", "image": "", "trailer_key": "", "cta_label": "Inizia il percorso", "cta_link": "#sezioni"},
     "sections": [{"id": "maestri", "title": "I grandi maestri", "items": []}]},
]

DEFAULT_MENU = [
    {"id": "home", "name": "Home", "path": "/browse", "order": 1, "active": True},
    {"id": "cinema", "name": "Cinema", "path": "/cinema", "order": 2, "active": True},
    {"id": "serie", "name": "Serie TV", "path": "/serie", "order": 3, "active": True},
    {"id": "prime-visioni", "name": "Prime Visioni", "path": "/p/prime-visioni", "order": 4, "active": True},
    {"id": "cinema-d-autore", "name": "Cinema d'Autore", "path": "/p/cinema-d-autore", "order": 5, "active": True},
    {"id": "catalogo", "name": "Catalogo", "path": "/archivio", "order": 6, "active": True},
]


def now() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now().isoformat()


def col(name):
    return ctx["db"][name]


# ---------- premium status ----------
def premium_status(user: dict) -> dict:
    p = user.get("premium") or {}
    exp = p.get("expiresAt")
    lifetime = bool(p.get("active")) and exp is None
    active = bool(p.get("active")) and (exp is None or datetime.fromisoformat(exp) > now())
    return {"active": active, "expiresAt": exp, "lifetime": lifetime, "plan_id": p.get("plan_id"), "plan_name": p.get("plan_name"), "source": p.get("source")}


def is_premium(user: dict) -> bool:
    return user.get("role") == "superadmin" or premium_status(user)["active"]


def attach_status(user: dict) -> dict:
    user["role"] = user.get("role", "user")
    user["premium"] = premium_status(user)
    user["is_premium"] = is_premium(user)
    user["is_admin"] = user["role"] in ADMIN_ROLES
    return user


def grant_premium(user_id: str, duration_days: Optional[int], plan: Optional[dict], source: str, transaction_id: Optional[str] = None, expires_at: Optional[str] = None):
    u = col("users").find_one({"id": user_id})
    if not u:
        return None
    if expires_at is not None:
        new_exp = expires_at
    elif duration_days is None:
        new_exp = None
    else:
        cur = premium_status(u)
        base = datetime.fromisoformat(cur["expiresAt"]) if cur["active"] and cur["expiresAt"] else now()
        new_exp = (max(base, now()) + timedelta(days=duration_days)).isoformat()
    doc = {"active": True, "expiresAt": new_exp, "plan_id": (plan or {}).get("id"), "plan_name": (plan or {}).get("name"),
           "source": source, "transaction_id": transaction_id, "activated_at": now_iso()}
    col("users").update_one({"id": user_id}, {"$set": {"premium": doc, "updatedAt": now_iso()}})
    return doc


def revoke_premium(user_id: str):
    col("users").update_one({"id": user_id}, {"$set": {"premium.active": False, "premium.revoked_at": now_iso(), "updatedAt": now_iso()}})


def expire_premium_job():
    q = {"premium.active": True, "premium.expiresAt": {"$ne": None, "$lt": now_iso()}}
    expired = list(col("users").find(q, {"id": 1, "premium": 1}))
    for u in expired:
        col("users").update_one({"id": u["id"]}, {"$set": {"premium.active": False, "premium.expired_at": now_iso()}})
        ctx["notify"]("user", "premium_expired", "Il tuo Premium è scaduto", "Rinnova l'abbonamento per continuare ad accedere alle sezioni esclusive.", "/premium", u["id"])
    if expired:
        logger.info(f"premium expiry job: {len(expired)} users downgraded to free")
    return len(expired)


# ---------- seed / migration ----------
def migrate(users, admin_users, menu_items, bcrypt_mod):
    ts = now_iso()
    for a in admin_users.find({}):
        email = (a.get("email") or "").lower()
        if not email:
            continue
        u = users.find_one({"email": email})
        if not u:
            users.insert_one({"id": str(uuid.uuid4()), "email": email, "password": a["password"], "name": email.split("@")[0], "profileImage": None,
                              "role": "admin", "banned": False, "must_reset_password": False, "createdAt": a.get("createdAt") or ts, "updatedAt": ts})
        elif u.get("role", "user") not in ADMIN_ROLES:
            users.update_one({"id": u["id"]}, {"$set": {"role": "admin", "updatedAt": ts}})
    for email in SUPERADMIN_EMAILS:
        u = users.find_one({"email": email})
        if u:
            if u.get("role") != "superadmin":
                users.update_one({"id": u["id"]}, {"$set": {"role": "superadmin", "updatedAt": ts}})
        else:
            hashed = bcrypt_mod.hashpw(DEFAULT_SUPERADMIN_PASSWORD.encode(), bcrypt_mod.gensalt()).decode()
            users.insert_one({"id": str(uuid.uuid4()), "email": email, "password": hashed, "name": email.split("@")[0], "profileImage": None,
                              "role": "superadmin", "banned": False, "must_reset_password": True, "createdAt": ts, "updatedAt": ts})
            logger.info(f"superadmin seeded: {email} (forced password reset)")
    for u in users.find({"role": "premium"}, {"id": 1}):
        users.update_one({"id": u["id"]}, {"$set": {"role": "user", "premium": {"active": True, "expiresAt": None, "source": "migration", "activated_at": ts}}})
    users.update_many({"role": {"$exists": False}}, {"$set": {"role": "user"}})
    plans = col("premium_plans")
    if plans.count_documents({}) == 0:
        plans.insert_many([{**p, "createdAt": ts, "updatedAt": ts} for p in DEFAULT_PLANS])
    pages = col("premium_pages")
    if pages.count_documents({}) == 0:
        pages.insert_many([{**p, "createdAt": ts, "updatedAt": ts} for p in DEFAULT_PAGES])
    if menu_items.count_documents({}) == 0:
        menu_items.insert_many([{**m, "createdAt": ts, "updatedAt": ts} for m in DEFAULT_MENU])


# ---------- models ----------
class PlanIn(BaseModel):
    name: str
    description: str = ""
    price_cents: int = Field(ge=50)
    currency: str = "EUR"
    interval: str = "month"  # month | year | lifetime | custom
    duration_days: Optional[int] = None
    badge: str = ""
    features: List[str] = []
    active: bool = True
    order: int = 0


class PremiumGrant(BaseModel):
    plan_id: Optional[str] = None
    duration_days: Optional[int] = None
    expires_at: Optional[str] = None
    lifetime: bool = False


class CheckoutIn(BaseModel):
    plan_id: str
    origin_url: str


class PageItemRef(BaseModel):
    tmdbId: int
    type: str = "movie"


class HeroIn(BaseModel):
    title: str = ""
    description: str = ""
    badge: str = ""
    image: str = ""
    trailer_key: str = ""
    autoplay_trailer: bool = True
    featured: Optional[PageItemRef] = None
    cta_label: str = ""
    cta_link: str = ""
    cta_secondary_label: str = ""
    cta_secondary_link: str = ""


class PageBlock(BaseModel):
    id: Optional[str] = None
    type: str = "carousel_backdrop"  # carousel_poster | carousel_backdrop | grid | collection | top_row | spotlight | editorial
    title: str = ""
    subtitle: str = ""
    text: str = ""
    cover_image: str = ""
    trailer_key: str = ""
    cta_label: str = ""
    cta_link: str = ""
    items: List[PageItemRef] = []


class PageIn(BaseModel):
    title: str
    slug: str
    description: str = ""
    access: str = "premium"  # premium | public
    active: bool = True
    order: int = 0
    hero: HeroIn = HeroIn()
    sections: List[PageBlock] = []


BLOCK_TYPES = ("carousel_poster", "carousel_backdrop", "grid", "collection", "top_row", "spotlight", "editorial")


class RefundIn(BaseModel):
    amount_cents: Optional[int] = None


def public_plan(p: dict) -> dict:
    return {k: v for k, v in p.items() if k != "_id"}


def tx_public(t: dict) -> dict:
    return {k: v for k, v in t.items() if k != "_id"}


# ---------- PayPal REST ----------
async def paypal_token() -> str:
    cid, sec = os.environ.get("PAYPAL_CLIENT_ID"), os.environ.get("PAYPAL_SECRET")
    if not cid or not sec:
        raise HTTPException(status_code=503, detail="PayPal non configurato")
    auth = base64.b64encode(f"{cid}:{sec}".encode()).decode()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{PAYPAL_BASE}/v1/oauth2/token", data={"grant_type": "client_credentials"}, headers={"Authorization": f"Basic {auth}"})
    if r.status_code != 200:
        logger.error(f"paypal token error {r.status_code}: {r.text}")
        raise HTTPException(status_code=502, detail="PayPal non raggiungibile")
    return r.json()["access_token"]


async def paypal_call(method: str, path: str, body: Optional[dict] = None) -> dict:
    token = await paypal_token()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.request(method, f"{PAYPAL_BASE}{path}", json=body, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Prefer": "return=representation"})
    if r.status_code >= 400:
        logger.error(f"paypal {method} {path} -> {r.status_code}: {r.text}")
        raise HTTPException(status_code=502, detail="Errore PayPal, riprova")
    return r.json() if r.content else {}


def register(app, db, get_current_user, get_current_admin, log_admin_action, fetch_tmdb_data, enrich_items, notify):
    ctx.update({"db": db, "notify": notify})
    users, plans, pages, txs = db["users"], db["premium_plans"], db["premium_pages"], db["payment_transactions"]
    txs.create_index("id", unique=True)
    txs.create_index([("user_id", 1), ("created_at", -1)])
    pages.create_index("slug", unique=True)
    r = APIRouter()

    def require_superadmin(admin=Depends(get_current_admin)):
        if admin.get("role") != "superadmin":
            raise HTTPException(status_code=403, detail="Solo il superadmin può eseguire questa azione")
        return admin

    def get_plan(plan_id: str) -> dict:
        p = plans.find_one({"id": plan_id, "active": True})
        if not p:
            raise HTTPException(status_code=404, detail="Piano non trovato")
        return p

    def fulfill(tx: dict):
        """Idempotent: mark paid + activate premium once."""
        res = txs.update_one({"id": tx["id"], "status": {"$ne": "paid"}}, {"$set": {"status": "paid", "paid_at": now_iso(), "updated_at": now_iso()}})
        if not res.modified_count:
            return
        plan = plans.find_one({"id": tx["plan_id"]}) or {"id": tx["plan_id"], "name": tx.get("plan_name"), "duration_days": tx.get("duration_days")}
        grant_premium(tx["user_id"], plan.get("duration_days"), plan, tx["provider"], tx["id"])
        notify("user", "premium_active", "Benvenuto in Premium!", f"Il piano {plan.get('name')} è attivo. Buona visione.", "/account", tx["user_id"])

    def new_tx(user: dict, plan: dict, provider: str, **extra) -> dict:
        tx = {"id": str(uuid.uuid4()), "user_id": user["id"], "user_email": user.get("email"), "plan_id": plan["id"], "plan_name": plan["name"],
              "duration_days": plan.get("duration_days"), "amount_cents": plan["price_cents"], "currency": plan.get("currency", "EUR"),
              "provider": provider, "status": "pending", "created_at": now_iso(), "updated_at": now_iso(), **extra}
        txs.insert_one(tx)
        return tx

    # ---- public: plans ----
    @r.get("/api/public/plans")
    def list_plans():
        return {"items": [public_plan(p) for p in plans.find({"active": True}).sort("order", 1)],
                "paypal_enabled": bool(os.environ.get("PAYPAL_CLIENT_ID")), "stripe_enabled": True}

    # ---- me ----
    @r.get("/api/premium/me")
    def my_premium(user=Depends(get_current_user)):
        u = attach_status(dict(user))
        return {"role": u["role"], "premium": u["premium"], "is_premium": u["is_premium"]}

    @r.get("/api/premium/payments")
    def my_payments(user=Depends(get_current_user)):
        return {"items": [tx_public(t) for t in txs.find({"user_id": user["id"]}).sort("created_at", -1).limit(50)]}

    # ---- Stripe ----
    @r.post("/api/payments/stripe/checkout")
    def stripe_checkout(data: CheckoutIn, user=Depends(get_current_user)):
        plan = get_plan(data.plan_id)
        origin = data.origin_url.rstrip("/")
        tx = new_tx(user, plan, "stripe")
        kwargs = dict(
            mode="payment",
            line_items=[{"quantity": 1, "price_data": {"currency": plan.get("currency", "EUR").lower(), "unit_amount": int(plan["price_cents"]),
                         "product_data": {"name": f"FlixIT Premium · {plan['name']}", "tax_code": "txcd_10302000"}}}],
            success_url=f"{origin}/premium/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{origin}/premium/cancel",
            customer_email=user.get("email"),
            metadata={"tx_id": tx["id"], "user_id": user["id"], "plan_id": plan["id"]},
        )
        try:
            try:
                session = stripe.checkout.Session.create(**kwargs, managed_payments={"enabled": True})
            except stripe.error.InvalidRequestError as e:
                msg = (e.user_message or str(e)).lower()
                if "managed payments" in msg or "ineligible" in msg or "managed_payments" in msg:
                    try:
                        session = stripe.checkout.Session.create(**kwargs, automatic_tax={"enabled": True}, billing_address_collection="required")
                    except stripe.error.InvalidRequestError:
                        session = stripe.checkout.Session.create(**kwargs)
                else:
                    raise
        except stripe.error.StripeError as e:
            txs.update_one({"id": tx["id"]}, {"$set": {"status": "failed", "error": str(e)}})
            logger.error(f"stripe checkout error: {e}")
            raise HTTPException(status_code=502, detail="Impossibile avviare il pagamento Stripe")
        txs.update_one({"id": tx["id"]}, {"$set": {"session_id": session.id, "updated_at": now_iso()}})
        return {"checkout_url": session.url, "session_id": session.id, "tx_id": tx["id"]}

    @r.get("/api/payments/stripe/status/{session_id}")
    def stripe_status(session_id: str):
        tx = txs.find_one({"session_id": session_id})
        if not tx:
            raise HTTPException(status_code=404, detail="Transazione non trovata")
        if tx["status"] != "paid":
            try:
                s = stripe.checkout.Session.retrieve(session_id)
                if s.payment_status == "paid" or s.status == "complete":
                    txs.update_one({"id": tx["id"]}, {"$set": {"provider_payment_id": s.payment_intent}})
                    fulfill(tx)
                elif s.status == "expired":
                    txs.update_one({"id": tx["id"], "status": "pending"}, {"$set": {"status": "expired", "updated_at": now_iso()}})
            except stripe.error.StripeError as e:
                logger.warning(f"stripe status error: {e}")
            tx = txs.find_one({"session_id": session_id})
        return {"session_id": session_id, "status": tx["status"], "plan_name": tx.get("plan_name")}

    @r.post("/api/stripe/webhook")
    async def stripe_webhook(request: Request):
        payload = await request.body()
        sig = request.headers.get("stripe-signature", "")
        try:
            event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
        except (stripe.error.SignatureVerificationError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid signature")
        obj, t = event["data"]["object"], event["type"]
        if t in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
            tx = txs.find_one({"session_id": obj["id"]})
            if tx and obj.get("payment_status", "paid") == "paid":
                txs.update_one({"id": tx["id"]}, {"$set": {"provider_payment_id": obj.get("payment_intent")}})
                fulfill(tx)
        elif t in ("checkout.session.async_payment_failed", "checkout.session.expired"):
            txs.update_one({"session_id": obj["id"], "status": "pending"}, {"$set": {"status": "failed" if "failed" in t else "expired", "updated_at": now_iso()}})
        elif t == "charge.refunded":
            txs.update_one({"provider_payment_id": obj.get("payment_intent")}, {"$set": {"status": "refunded", "refunded_at": now_iso(), "updated_at": now_iso()}})
        return {"status": "ok"}

    # ---- PayPal ----
    @r.post("/api/payments/paypal/create-order")
    async def paypal_create(data: CheckoutIn, user=Depends(get_current_user)):
        plan = get_plan(data.plan_id)
        origin = data.origin_url.rstrip("/")
        tx = new_tx(user, plan, "paypal")
        body = {"intent": "CAPTURE",
                "purchase_units": [{"reference_id": tx["id"], "custom_id": tx["id"], "description": f"FlixIT Premium · {plan['name']}",
                                    "amount": {"currency_code": plan.get("currency", "EUR"), "value": f"{plan['price_cents'] / 100:.2f}"}}],
                "payment_source": {"paypal": {"experience_context": {"user_action": "PAY_NOW", "brand_name": "FlixIT", "locale": "it-IT",
                                   "return_url": f"{origin}/premium/paypal-return?tx={tx['id']}", "cancel_url": f"{origin}/premium/cancel"}}}}
        try:
            order = await paypal_call("POST", "/v2/checkout/orders", body)
        except HTTPException:
            txs.update_one({"id": tx["id"]}, {"$set": {"status": "failed"}})
            raise
        approve = next((l["href"] for l in order.get("links", []) if l.get("rel") in ("payer-action", "approve")), None)
        txs.update_one({"id": tx["id"]}, {"$set": {"order_id": order["id"], "updated_at": now_iso()}})
        return {"order_id": order["id"], "approve_url": approve, "tx_id": tx["id"]}

    @r.post("/api/payments/paypal/capture/{order_id}")
    async def paypal_capture(order_id: str):
        tx = txs.find_one({"order_id": order_id})
        if not tx:
            raise HTTPException(status_code=404, detail="Transazione non trovata")
        if tx["status"] == "paid":
            return {"status": "paid", "plan_name": tx.get("plan_name")}
        result = await paypal_call("POST", f"/v2/checkout/orders/{order_id}/capture", {})
        status = result.get("status")
        if status == "COMPLETED":
            captures = ((result.get("purchase_units") or [{}])[0].get("payments") or {}).get("captures") or []
            cap_id = captures[0]["id"] if captures else None
            txs.update_one({"id": tx["id"]}, {"$set": {"provider_payment_id": cap_id, "payer_email": ((result.get("payer") or {}).get("email_address"))}})
            fulfill(tx)
            return {"status": "paid", "plan_name": tx.get("plan_name")}
        txs.update_one({"id": tx["id"]}, {"$set": {"status": "failed", "paypal_status": status, "updated_at": now_iso()}})
        return {"status": "failed", "paypal_status": status}

    # ---- admin: plans ----
    @r.get("/api/admin/plans")
    def admin_plans(admin=Depends(get_current_admin)):
        return {"items": [public_plan(p) for p in plans.find({}).sort("order", 1)]}

    @r.post("/api/admin/plans")
    def admin_create_plan(data: PlanIn, admin=Depends(get_current_admin)):
        doc = {"id": str(uuid.uuid4())[:8], **data.model_dump(), "createdAt": now_iso(), "updatedAt": now_iso()}
        if doc["interval"] == "lifetime":
            doc["duration_days"] = None
        plans.insert_one(doc)
        log_admin_action("plan_create", doc["id"], {"name": doc["name"]})
        return public_plan(doc)

    @r.put("/api/admin/plans/{plan_id}")
    def admin_update_plan(plan_id: str, data: PlanIn, admin=Depends(get_current_admin)):
        upd = {**data.model_dump(), "updatedAt": now_iso()}
        if upd["interval"] == "lifetime":
            upd["duration_days"] = None
        if not plans.update_one({"id": plan_id}, {"$set": upd}).matched_count:
            raise HTTPException(status_code=404, detail="Piano non trovato")
        log_admin_action("plan_update", plan_id, {"name": data.name})
        return public_plan(plans.find_one({"id": plan_id}))

    @r.delete("/api/admin/plans/{plan_id}")
    def admin_delete_plan(plan_id: str, admin=Depends(get_current_admin)):
        if not plans.delete_one({"id": plan_id}).deleted_count:
            raise HTTPException(status_code=404, detail="Piano non trovato")
        log_admin_action("plan_delete", plan_id)
        return {"ok": True}

    # ---- admin: premium on users ----
    @r.post("/api/admin/users/{user_id}/premium")
    def admin_grant(user_id: str, data: PremiumGrant, admin=Depends(get_current_admin)):
        if not users.find_one({"id": user_id}):
            raise HTTPException(status_code=404, detail="Utente non trovato")
        plan = plans.find_one({"id": data.plan_id}) if data.plan_id else None
        if data.lifetime:
            doc = grant_premium(user_id, None, plan, "admin")
        elif data.expires_at:
            try:
                exp = datetime.fromisoformat(data.expires_at.replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(status_code=400, detail="Data non valida")
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            doc = grant_premium(user_id, None, plan, "admin", expires_at=exp.isoformat())
        else:
            days = data.duration_days or (plan or {}).get("duration_days")
            if days is None and plan is None:
                raise HTTPException(status_code=400, detail="Indica durata, scadenza o piano")
            doc = grant_premium(user_id, days, plan, "admin")
        notify("user", "premium_active", "Premium attivato", "L'amministratore ha attivato il tuo accesso Premium.", "/account", user_id)
        log_admin_action("premium_grant", user_id, {"expiresAt": doc.get("expiresAt")})
        return {"ok": True, "premium": premium_status(users.find_one({"id": user_id}))}

    @r.delete("/api/admin/users/{user_id}/premium")
    def admin_revoke(user_id: str, admin=Depends(get_current_admin)):
        if not users.find_one({"id": user_id}):
            raise HTTPException(status_code=404, detail="Utente non trovato")
        revoke_premium(user_id)
        notify("user", "premium_revoked", "Premium disattivato", "Il tuo accesso Premium è stato disattivato.", "/premium", user_id)
        log_admin_action("premium_revoke", user_id)
        return {"ok": True}

    @r.get("/api/admin/users/{user_id}/payments")
    def admin_user_payments(user_id: str, admin=Depends(get_current_admin)):
        return {"items": [tx_public(t) for t in txs.find({"user_id": user_id}).sort("created_at", -1)]}

    # ---- admin: payments + refunds ----
    @r.get("/api/admin/payments")
    def admin_payments(status: Optional[str] = None, q: Optional[str] = None, admin=Depends(get_current_admin)):
        flt = {}
        if status:
            flt["status"] = status
        if q:
            flt["$or"] = [{"user_email": {"$regex": q, "$options": "i"}}, {"id": {"$regex": q, "$options": "i"}}]
        items = [tx_public(t) for t in txs.find(flt).sort("created_at", -1).limit(300)]
        paid = list(txs.aggregate([{"$match": {"status": "paid"}}, {"$group": {"_id": None, "total": {"$sum": "$amount_cents"}, "n": {"$sum": 1}}}]))
        stats = {"revenue_cents": paid[0]["total"] if paid else 0, "paid": paid[0]["n"] if paid else 0,
                 "refunded": txs.count_documents({"status": "refunded"}), "pending": txs.count_documents({"status": "pending"})}
        return {"items": items, "stats": stats}

    @r.post("/api/admin/payments/{tx_id}/refund")
    async def admin_refund(tx_id: str, data: RefundIn, admin=Depends(get_current_admin)):
        tx = txs.find_one({"id": tx_id})
        if not tx:
            raise HTTPException(status_code=404, detail="Transazione non trovata")
        if tx["status"] != "paid":
            raise HTTPException(status_code=400, detail="Solo i pagamenti riusciti possono essere rimborsati")
        if not tx.get("provider_payment_id"):
            raise HTTPException(status_code=400, detail="Riferimento pagamento del provider mancante")
        if tx["provider"] == "stripe":
            try:
                kw = {"payment_intent": tx["provider_payment_id"]}
                if data.amount_cents:
                    kw["amount"] = int(data.amount_cents)
                ref = stripe.Refund.create(**kw)
                refund_id = ref.id
            except stripe.error.StripeError as e:
                raise HTTPException(status_code=502, detail=f"Stripe: {e.user_message or str(e)}")
        else:
            body = {}
            if data.amount_cents:
                body = {"amount": {"currency_code": tx.get("currency", "EUR"), "value": f"{data.amount_cents / 100:.2f}"}}
            ref = await paypal_call("POST", f"/v2/payments/captures/{tx['provider_payment_id']}/refund", body)
            refund_id = ref.get("id")
        txs.update_one({"id": tx_id}, {"$set": {"status": "refunded", "refund_id": refund_id, "refund_amount_cents": data.amount_cents or tx["amount_cents"],
                                                "refunded_at": now_iso(), "refunded_by": admin.get("email"), "updated_at": now_iso()}})
        u = users.find_one({"id": tx["user_id"]})
        if u and (u.get("premium") or {}).get("transaction_id") == tx_id:
            revoke_premium(tx["user_id"])
        notify("user", "payment_refunded", "Rimborso emesso", f"Il pagamento del piano {tx.get('plan_name')} è stato rimborsato.", "/account", tx["user_id"])
        log_admin_action("payment_refund", tx_id, {"provider": tx["provider"], "refund_id": refund_id})
        return {"ok": True, "refund_id": refund_id}

    # ---- premium pages ----
    def page_public(p: dict) -> dict:
        return {k: v for k, v in p.items() if k != "_id"}

    GENRE_CACHE = {}

    async def genre_names(mt: str) -> dict:
        if mt not in GENRE_CACHE:
            d = await fetch_tmdb_data(f"/genre/{mt}/list")
            GENRE_CACHE[mt] = {g["id"]: g["name"] for g in (d or {}).get("genres", [])}
        return GENRE_CACHE[mt]

    async def trailer_key(mt: str, tmdb_id: int) -> Optional[str]:
        for params in ({}, {"language": "en-US"}):
            d = await fetch_tmdb_data(f"/{mt}/{tmdb_id}/videos", dict(params))
            vids = [v for v in (d or {}).get("results", []) if v.get("site") == "YouTube"]
            for kind in ("Trailer", "Teaser"):
                pick = next((v for v in vids if v.get("type") == kind and v.get("official")), None) or next((v for v in vids if v.get("type") == kind), None)
                if pick:
                    return pick["key"]
        return None

    async def resolve_one(it: dict, rich: bool = False) -> Optional[dict]:
        mt = "tv" if it.get("type") == "tv" else "movie"
        d = await fetch_tmdb_data(f"/{mt}/{it['tmdbId']}")
        if not d or d.get("success") is False:
            return None
        rel = d.get("release_date") or d.get("first_air_date") or ""
        out = {"tmdbId": it["tmdbId"], "type": mt, "title": d.get("title") or d.get("name"), "overview": d.get("overview"), "tagline": d.get("tagline"),
               "poster_path": d.get("poster_path"), "backdrop_path": d.get("backdrop_path"), "release_date": rel, "year": rel[:4],
               "vote_average": round(d.get("vote_average", 0) or 0, 1), "popularity": d.get("popularity", 0), "genre_ids": [g["id"] for g in d.get("genres") or []],
               "genres": [g["name"] for g in (d.get("genres") or [])][:3], "runtime": d.get("runtime"), "number_of_seasons": d.get("number_of_seasons")}
        if rich:
            out["trailer_key"] = await trailer_key(mt, it["tmdbId"])
        return out

    async def resolve_items(items: list) -> list:
        out = [x for x in await asyncio.gather(*(resolve_one(i) for i in items)) if x]
        return await enrich_items(out)

    async def resolve_block(s: dict) -> dict:
        b = {k: s.get(k, "") for k in ("id", "type", "title", "subtitle", "text", "cover_image", "trailer_key", "cta_label", "cta_link")}
        b["type"] = b["type"] or "carousel_backdrop"
        b["items"] = await resolve_items(s.get("items", []))
        if b["type"] == "spotlight" and b["items"] and not b["trailer_key"]:
            b["trailer_key"] = await trailer_key(b["items"][0]["type"], b["items"][0]["tmdbId"])
        return b

    async def resolve_hero(p: dict) -> dict:
        hero = dict(p.get("hero") or {})
        feat = hero.get("featured")
        first = next((it for s in p.get("sections", []) for it in s.get("items", [])), None)
        target = feat or first
        if target:
            info = await resolve_one(target, rich=not hero.get("trailer_key"))
            if info:
                hero["featured_info"] = info
                if not hero.get("image") and info.get("backdrop_path"):
                    hero["image"] = f"https://image.tmdb.org/t/p/original{info['backdrop_path']}"
                if not hero.get("trailer_key") and info.get("trailer_key"):
                    hero["trailer_key"] = info["trailer_key"]
                if not hero.get("title"):
                    hero["title"] = p.get("title")
        return hero

    def optional_user(request: Request) -> Optional[dict]:
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return None
        try:
            import jwt as _jwt
            payload = _jwt.decode(header[7:], os.environ.get("JWT_SECRET", "netflix-admin-super-secret-key-2024"), algorithms=["HS256"])
        except Exception:
            return None
        return users.find_one({"id": payload.get("user_id")}, {"_id": 0, "password": 0})

    @r.get("/api/public/premium-pages")
    def public_pages():
        docs = pages.find({"active": True}, {"_id": 0, "sections": 0}).sort("order", 1)
        return {"items": [page_public(p) for p in docs]}

    @r.get("/api/public/premium-pages/{slug}")
    async def public_page(slug: str, request: Request):
        p = pages.find_one({"slug": slug, "active": True})
        if not p:
            raise HTTPException(status_code=404, detail="Pagina non trovata")
        user = optional_user(request)
        allowed = p.get("access") == "public" or (user is not None and is_premium(user))
        meta = {k: page_public(p).get(k) for k in ("id", "title", "slug", "description", "access")}
        meta["hero"] = await resolve_hero(p)
        if not allowed:
            return {**meta, "locked": True, "reason": "login_required" if user is None else "premium_required", "sections": []}
        sections = [await resolve_block(s) for s in p.get("sections", [])]
        return {**meta, "locked": False, "sections": sections}

    @r.get("/api/admin/premium-pages")
    async def admin_pages(admin=Depends(get_current_admin)):
        out = []
        for p in pages.find({}).sort("order", 1):
            p = page_public(p)
            for s in p.get("sections", []):
                s["type"] = s.get("type") or "carousel_backdrop"
                s["items"] = await resolve_items(s.get("items", []))
            feat = (p.get("hero") or {}).get("featured")
            if feat:
                p["hero"]["featured_info"] = await resolve_one(feat)
            out.append(p)
        return {"items": out, "block_types": BLOCK_TYPES}

    def normalize_page(data: PageIn) -> dict:
        doc = data.model_dump()
        for s in doc["sections"]:
            if s["type"] not in BLOCK_TYPES:
                raise HTTPException(status_code=400, detail=f"Tipo blocco non valido: {s['type']}")
            s["id"] = s.get("id") or str(uuid.uuid4())[:8]
        return doc

    @r.post("/api/admin/premium-pages")
    def admin_create_page(data: PageIn, admin=Depends(get_current_admin)):
        if pages.find_one({"slug": data.slug}):
            raise HTTPException(status_code=400, detail="Slug già in uso")
        doc = {"id": str(uuid.uuid4())[:8], **normalize_page(data), "createdAt": now_iso(), "updatedAt": now_iso()}
        pages.insert_one(doc)
        log_admin_action("premium_page_create", doc["id"], {"slug": doc["slug"]})
        return page_public(doc)

    @r.put("/api/admin/premium-pages/{page_id}")
    def admin_update_page(page_id: str, data: PageIn, admin=Depends(get_current_admin)):
        if pages.find_one({"slug": data.slug, "id": {"$ne": page_id}}):
            raise HTTPException(status_code=400, detail="Slug già in uso")
        upd = {**normalize_page(data), "updatedAt": now_iso()}
        if not pages.update_one({"id": page_id}, {"$set": upd}).matched_count:
            raise HTTPException(status_code=404, detail="Pagina non trovata")
        log_admin_action("premium_page_update", page_id, {"slug": data.slug})
        return page_public(pages.find_one({"id": page_id}))

    @r.delete("/api/admin/premium-pages/{page_id}")
    def admin_delete_page(page_id: str, admin=Depends(get_current_admin)):
        if not pages.delete_one({"id": page_id}).deleted_count:
            raise HTTPException(status_code=404, detail="Pagina non trovata")
        log_admin_action("premium_page_delete", page_id)
        return {"ok": True}

    app.include_router(r)

    @app.on_event("startup")
    async def _premium_expiry_loop():
        async def loop():
            while True:
                try:
                    await asyncio.to_thread(expire_premium_job)
                except Exception as e:
                    logger.warning(f"premium expiry job error: {e}")
                await asyncio.sleep(PREMIUM_CHECK_SECONDS)
        asyncio.create_task(loop())
