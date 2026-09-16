"""Backend tests for FlixIT premium+admin extension (iteration 7)."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://flix-catalogo.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@admin.com"
ADMIN_PASSWORD = "admin123"
FREE_EMAIL = "test.free@flixit.dev"
FREE_PASSWORD = "Test1234!"


@pytest.fixture(scope="session")
def s():
    return requests.Session()


@pytest.fixture(scope="session")
def admin_token(s):
    r = s.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    role = data.get("role") or data.get("user", {}).get("role")
    assert role == "superadmin", data
    return data["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def free_user(s):
    # Ensure free user exists
    r = s.post(f"{API}/auth/login", json={"email": FREE_EMAIL, "password": FREE_PASSWORD}, timeout=30)
    if r.status_code != 200:
        r2 = s.post(f"{API}/auth/register", json={"email": FREE_EMAIL, "password": FREE_PASSWORD, "name": "Free Tester"}, timeout=30)
        assert r2.status_code in (200, 201), r2.text
        token = r2.json()["token"]
    else:
        token = r.json()["token"]
    me = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert me.status_code == 200
    uid = me.json()["id"]
    return {"token": token, "id": uid, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture(scope="session")
def fresh_user(s):
    email = f"TEST_qa_{uuid.uuid4().hex[:8]}@flixit.dev"
    pwd = "Passw0rd!"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": pwd, "name": "QA"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    token = r.json()["token"]
    me = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert me.status_code == 200
    return {"email": email, "password": pwd, "token": token, "id": me.json()["id"],
            "headers": {"Authorization": f"Bearer {token}"}}


# ------------------ Auth / Admin identity ------------------

class TestAdminAuth:
    def test_admin_login(self, admin_token):
        assert admin_token

    def test_admin_me(self, s, admin_headers):
        r = s.get(f"{API}/admin/me", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("role") == "superadmin"
        assert d.get("is_admin") is True
        assert d.get("is_premium") is True

    def test_non_admin_login_forbidden(self, s, free_user):
        r = s.post(f"{API}/admin/login", json={"email": FREE_EMAIL, "password": FREE_PASSWORD}, timeout=30)
        assert r.status_code == 403, r.text


class TestUserAuth:
    def test_register_and_me(self, fresh_user, s):
        r = s.get(f"{API}/auth/me", headers=fresh_user["headers"], timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("role") == "user"
        assert d.get("is_premium") in (False, None)
        assert (d.get("premium") or {}).get("active") in (False, None)
        assert d.get("must_reset_password") in (False, None)


# ------------------ Plans / menu / premium pages ------------------

class TestPublicCatalog:
    def test_public_plans(self, s):
        r = s.get(f"{API}/public/plans", timeout=30)
        assert r.status_code == 200
        d = r.json()
        items = d.get("items") or d.get("plans") or d
        # Normalize to list
        if isinstance(d, dict) and "items" not in d and "plans" not in d and isinstance(d.get("data"), list):
            items = d["data"]
        assert isinstance(items, list), f"Unexpected shape: {d}"
        by_id = {p["id"]: p for p in items}
        for pid, price in [("mensile", 499), ("annuale", 3999), ("a-vita", 9900)]:
            assert pid in by_id, f"{pid} missing"
            assert by_id[pid]["price_cents"] == price
            assert by_id[pid].get("currency") == "EUR"
        assert d.get("stripe_enabled") is True if isinstance(d, dict) else True
        assert d.get("paypal_enabled") is True if isinstance(d, dict) else True

    def test_public_menu(self, s):
        r = s.get(f"{API}/public/menu", timeout=30)
        assert r.status_code == 200
        items = r.json()
        if isinstance(items, dict):
            items = items.get("items", items)
        paths = {i.get("path") or i.get("href") or i.get("url") for i in items}
        expected = {"/browse", "/cinema", "/serie", "/p/prime-visioni", "/p/cinema-d-autore", "/archivio"}
        missing = expected - paths
        assert not missing, f"Menu missing: {missing}. Got: {paths}"

    def test_public_premium_pages_list(self, s):
        r = s.get(f"{API}/public/premium-pages", timeout=30)
        assert r.status_code == 200
        items = r.json()
        if isinstance(items, dict):
            items = items.get("items", items)
        slugs = {p.get("slug") for p in items}
        assert {"prime-visioni", "cinema-d-autore"} <= slugs

    def test_premium_page_locked_no_token(self, s):
        r = s.get(f"{API}/public/premium-pages/prime-visioni", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("locked") is True
        assert d.get("reason") == "login_required"
        assert d.get("sections") == []

    def test_premium_page_locked_free_user(self, s, free_user):
        r = s.get(f"{API}/public/premium-pages/prime-visioni", headers=free_user["headers"], timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("locked") is True
        assert d.get("reason") == "premium_required"

    def test_premium_page_unlocked_superadmin(self, s, admin_headers):
        r = s.get(f"{API}/public/premium-pages/prime-visioni", headers=admin_headers, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d.get("locked") is False
        assert isinstance(d.get("sections"), list)
        # At least one section w/ items resolved with title/poster
        found = False
        for sec in d["sections"]:
            for it in sec.get("items", []):
                if it.get("title") and it.get("tmdbId") and it.get("type") in ("movie", "tv"):
                    found = True
                    break
        assert found, "No resolved items in prime-visioni sections"


# ------------------ Payments ------------------

class TestPayments:
    def test_stripe_checkout(self, s, fresh_user):
        r = s.post(f"{API}/payments/stripe/checkout",
                   headers=fresh_user["headers"],
                   json={"plan_id": "mensile", "origin_url": BASE_URL}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "checkout.stripe.com" in d.get("checkout_url", "")
        assert d.get("session_id")
        # Status endpoint
        st = s.get(f"{API}/payments/stripe/status/{d['session_id']}",
                   headers=fresh_user["headers"], timeout=30)
        assert st.status_code == 200
        assert st.json().get("status") in ("pending", "open")

    def test_paypal_create_order(self, s, fresh_user):
        r = s.post(f"{API}/payments/paypal/create-order",
                   headers=fresh_user["headers"],
                   json={"plan_id": "annuale", "origin_url": BASE_URL}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("order_id")
        assert "paypal.com" in d.get("approve_url", "")

    def test_premium_payments_self(self, s, fresh_user):
        r = s.get(f"{API}/premium/payments", headers=fresh_user["headers"], timeout=30)
        assert r.status_code == 200
        items = r.json()
        if isinstance(items, dict):
            items = items.get("items", items)
        assert isinstance(items, list)
        assert len(items) >= 2  # stripe + paypal from prior tests


# ------------------ Admin users / premium mgmt ------------------

class TestAdminUsers:
    def test_list_users_with_stats(self, s, admin_headers):
        r = s.get(f"{API}/admin/users", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("items"), list)
        st = d.get("stats") or {}
        for k in ["total", "premium", "admins", "banned", "pending_reset"]:
            assert k in st, f"stats missing {k}"
        it = d["items"][0]
        for k in ["role", "is_premium", "banned", "must_reset_password"]:
            assert k in it, f"user field missing {k}"

    def test_filter_role_superadmin(self, s, admin_headers):
        r = s.get(f"{API}/admin/users?role=superadmin", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        for u in r.json().get("items", []):
            assert u["role"] == "superadmin"

    def test_patch_invalid_role(self, s, admin_headers, fresh_user):
        r = s.patch(f"{API}/admin/users/{fresh_user['id']}",
                    headers=admin_headers, json={"role": "premium"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_patch_own_role_forbidden(self, s, admin_headers):
        me = s.get(f"{API}/admin/me", headers=admin_headers, timeout=30).json()
        r = s.patch(f"{API}/admin/users/{me['id']}",
                    headers=admin_headers, json={"role": "admin"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_grant_and_revoke_premium_days(self, s, admin_headers, fresh_user):
        # Grant 30 days
        r = s.post(f"{API}/admin/users/{fresh_user['id']}/premium",
                   headers=admin_headers, json={"duration_days": 30}, timeout=30)
        assert r.status_code == 200, r.text
        me = s.get(f"{API}/auth/me", headers=fresh_user["headers"], timeout=30).json()
        assert me.get("is_premium") is True
        # Premium page unlock
        pg = s.get(f"{API}/public/premium-pages/prime-visioni", headers=fresh_user["headers"], timeout=60).json()
        assert pg.get("locked") is False

        # Lifetime
        r = s.post(f"{API}/admin/users/{fresh_user['id']}/premium",
                   headers=admin_headers, json={"lifetime": True}, timeout=30)
        assert r.status_code == 200
        me = s.get(f"{API}/auth/me", headers=fresh_user["headers"], timeout=30).json()
        prem = me.get("premium") or {}
        assert prem.get("active") is True
        assert prem.get("expiresAt") in (None, "")

        # Expires in past (immediate expiry)
        r = s.post(f"{API}/admin/users/{fresh_user['id']}/premium",
                   headers=admin_headers, json={"expires_at": "2020-01-01T00:00:00+00:00"}, timeout=30)
        assert r.status_code == 200
        me = s.get(f"{API}/auth/me", headers=fresh_user["headers"], timeout=30).json()
        assert me.get("is_premium") is False

        # Grant again then revoke
        s.post(f"{API}/admin/users/{fresh_user['id']}/premium",
               headers=admin_headers, json={"duration_days": 30}, timeout=30)
        r = s.delete(f"{API}/admin/users/{fresh_user['id']}/premium", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        me = s.get(f"{API}/auth/me", headers=fresh_user["headers"], timeout=30).json()
        assert me.get("is_premium") is False

    def test_ban_unban(self, s, admin_headers, fresh_user):
        r = s.patch(f"{API}/admin/users/{fresh_user['id']}", headers=admin_headers,
                    json={"banned": True, "ban_reason": "test"}, timeout=30)
        assert r.status_code == 200
        me = s.get(f"{API}/auth/me", headers=fresh_user["headers"], timeout=30)
        assert me.status_code == 403
        r = s.patch(f"{API}/admin/users/{fresh_user['id']}", headers=admin_headers,
                    json={"banned": False}, timeout=30)
        assert r.status_code == 200
        me = s.get(f"{API}/auth/me", headers=fresh_user["headers"], timeout=30)
        assert me.status_code == 200

    def test_force_reset_flow(self, s, admin_headers, fresh_user):
        r = s.post(f"{API}/admin/users/{fresh_user['id']}/force-reset",
                   headers=admin_headers, timeout=30)
        assert r.status_code == 200
        me = s.get(f"{API}/auth/me", headers=fresh_user["headers"], timeout=30).json()
        assert me.get("must_reset_password") is True
        # user changes password to clear flag
        r = s.put(f"{API}/auth/profile", headers=fresh_user["headers"],
                  json={"password": "NewPass123!"}, timeout=30)
        assert r.status_code == 200, r.text
        me = s.get(f"{API}/auth/me", headers=fresh_user["headers"], timeout=30).json()
        assert me.get("must_reset_password") in (False, None)
        # Restore password so credentials stay valid
        s.put(f"{API}/auth/profile", headers=fresh_user["headers"],
              json={"password": fresh_user["password"]}, timeout=30)


# ------------------ Admin plans CRUD ------------------

class TestAdminPlans:
    def test_crud(self, s, admin_headers):
        payload = {"name": "TEST plan", "price_cents": 100,
                   "currency": "EUR", "interval": "custom", "duration_days": 90, "active": True}
        r = s.post(f"{API}/admin/plans", headers=admin_headers, json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        created = r.json()
        pid = created["id"]
        # Update price (full body)
        upd = {**payload, "price_cents": 200}
        r = s.put(f"{API}/admin/plans/{pid}", headers=admin_headers, json=upd, timeout=30)
        assert r.status_code == 200, r.text
        # Appears in public
        pub = s.get(f"{API}/public/plans", timeout=30).json()
        items = pub.get("items") if isinstance(pub, dict) else pub
        assert any(p["id"] == pid for p in items)
        # Delete
        r = s.delete(f"{API}/admin/plans/{pid}", headers=admin_headers, timeout=30)
        assert r.status_code == 200


# ------------------ Admin premium pages CRUD ------------------

class TestAdminPremiumPages:
    def test_crud(self, s, admin_headers):
        slug = f"test-page-{uuid.uuid4().hex[:6]}"
        payload = {"slug": slug, "title": "TEST page", "access": "public",
                   "hero": {"title": "Hero", "subtitle": "Sub"},
                   "sections": [{"title": "Sec1", "items": [{"tmdbId": 438631, "type": "movie"}]}]}
        r = s.post(f"{API}/admin/premium-pages", headers=admin_headers, json=payload, timeout=60)
        assert r.status_code in (200, 201), r.text
        page = r.json()
        pid = page.get("id")
        assert pid
        # public GET no token -> public access, unlocked with resolved items
        pub = s.get(f"{API}/public/premium-pages/{slug}", timeout=60).json()
        assert pub.get("locked") is False
        assert pub["sections"][0]["items"][0].get("title")
        # duplicate slug (full body required)
        dup_body = {**payload, "slug": "prime-visioni"}
        r = s.put(f"{API}/admin/premium-pages/{pid}",
                  headers=admin_headers, json=dup_body, timeout=30)
        assert r.status_code == 400, r.text
        # delete
        r = s.delete(f"{API}/admin/premium-pages/{pid}", headers=admin_headers, timeout=30)
        assert r.status_code == 200


# ------------------ Coming soon ------------------

class TestComingSoon:
    def test_crud_and_upcoming_override(self, s, admin_headers):
        # Clear existing to guarantee clean state
        r = s.get(f"{API}/admin/coming-soon", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        for it in items:
            s.delete(f"{API}/admin/coming-soon/{it['id']}", headers=admin_headers, timeout=30)

        r = s.post(f"{API}/admin/coming-soon", headers=admin_headers,
                   json={"tmdbId": 438631, "type": "movie", "note": "test"}, timeout=60)
        assert r.status_code in (200, 201), r.text
        item_id = r.json().get("id")
        # duplicate
        dup = s.post(f"{API}/admin/coming-soon", headers=admin_headers,
                     json={"tmdbId": 438631, "type": "movie"}, timeout=30)
        assert dup.status_code == 400
        # public list has it
        pub = s.get(f"{API}/public/coming-soon", timeout=30).json()
        pub_items = pub if isinstance(pub, list) else pub.get("items", [])
        assert any(p["tmdbId"] == 438631 for p in pub_items)
        # upcoming curated flag
        up = s.get(f"{API}/public/tmdb/upcoming", timeout=30).json()
        assert up.get("curated") is True
        # remove
        r = s.delete(f"{API}/admin/coming-soon/{item_id}", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        up = s.get(f"{API}/public/tmdb/upcoming", timeout=30).json()
        assert up.get("curated") in (False, None) or (isinstance(up, dict) and not up.get("curated"))


# ------------------ Admin payments ------------------

class TestAdminPayments:
    def test_admin_payments_and_refund_pending(self, s, admin_headers, fresh_user):
        r = s.get(f"{API}/admin/payments", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d or isinstance(d, list)
        items = d.get("items") if isinstance(d, dict) else d
        assert "stats" in d if isinstance(d, dict) else True

        # User payments
        up = s.get(f"{API}/admin/users/{fresh_user['id']}/payments", headers=admin_headers, timeout=30)
        assert up.status_code == 200
        u_items = up.json() if isinstance(up.json(), list) else up.json().get("items", [])
        assert len(u_items) >= 1
        pending_tx = next((t for t in u_items if t["status"] == "pending"), None)
        assert pending_tx, "No pending tx to refund-test"
        rf = s.post(f"{API}/admin/payments/{pending_tx['id']}/refund",
                    headers=admin_headers, json={}, timeout=30)
        assert rf.status_code == 400
        assert "riusciti" in rf.text.lower() or "solo" in rf.text.lower()
