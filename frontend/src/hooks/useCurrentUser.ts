// @ts-nocheck
import { useEffect, useState, useCallback } from "react";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

export const userToken = () => localStorage.getItem("user_token");

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function premiumLabel(user) {
  if (!user) return "";
  if (user.role === "superadmin") return "Premium illimitato (superadmin)";
  if (!user.is_premium) return "Piano gratuito";
  if (user.premium?.lifetime) return "Premium attivo a vita";
  return `Premium attivo fino al ${fmtDate(user.premium?.expiresAt)}`;
}

// Current logged-in user (role + premium status) from /api/auth/me. `user === undefined` while loading, `null` when logged out.
export function useCurrentUser() {
  const [user, setUser] = useState(undefined);
  const refresh = useCallback(async () => {
    const token = userToken();
    if (!token) { setUser(null); return null; }
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { localStorage.removeItem("user_token"); setUser(null); return null; }
      const data = res.ok ? await res.json() : null;
      setUser(data);
      return data;
    } catch { setUser(null); return null; }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { user, refresh, isLoggedIn: Boolean(userToken()) };
}
