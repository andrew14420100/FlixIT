// @ts-nocheck
import { useEffect, useState, useCallback } from "react";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const QUALITY_CAP_KEY = "flixit_max_quality_height";

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

export function playbackQualityCap(user) {
  if (user?.role === "superadmin") return 0; // unrestricted
  const name = String(user?.premium?.plan_name || "").toLowerCase();
  if (user?.is_premium && (name.includes("pro") || name.includes("unlimited") || name.includes("illimit"))) return 1080;
  // Free and Base are capped at 720p.
  return 720;
}

function publishQualityCap(user) {
  try {
    localStorage.setItem(QUALITY_CAP_KEY, String(playbackQualityCap(user)));
    window.dispatchEvent(new CustomEvent("flixit-quality-cap-changed", { detail: { maxHeight: playbackQualityCap(user) } }));
  } catch {}
}

// Current logged-in user (role + premium status) from /api/auth/me. `user === undefined` while loading, `null` when logged out.
export function useCurrentUser() {
  const [user, setUser] = useState(undefined);
  const refresh = useCallback(async () => {
    const token = userToken();
    if (!token) { setUser(null); publishQualityCap(null); return null; }
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { localStorage.removeItem("user_token"); setUser(null); publishQualityCap(null); return null; }
      const data = res.ok ? await res.json() : null;
      setUser(data);
      publishQualityCap(data);
      return data;
    } catch { setUser(null); publishQualityCap(null); return null; }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { user, refresh, isLoggedIn: Boolean(userToken()) };
}
