// @ts-nocheck
import { useEffect, useState, useCallback } from "react";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const QUALITY_CAP_KEY = "flixit_max_quality_height";
const USER_CACHE_KEY = "flixit_current_user_v1";
const USER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ME_MEMO_MS = 15 * 1000;

export const userToken = () => {
  try { return localStorage.getItem("user_token"); } catch { return null; }
};

function tokenMarker(token) {
  const value = String(token || "");
  return value ? value.slice(-16) : "";
}

function readCachedUser(token = userToken()) {
  if (!token || typeof window === "undefined") return null;
  try {
    const cached = JSON.parse(localStorage.getItem(USER_CACHE_KEY) || "null");
    if (!cached?.user || cached?.tokenMarker !== tokenMarker(token)) return null;
    if (Date.now() - Number(cached.savedAt || 0) > USER_CACHE_MAX_AGE_MS) return null;
    return cached.user;
  } catch {
    return null;
  }
}

function writeCachedUser(token, user) {
  if (!token || !user || typeof window === "undefined") return;
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({
      tokenMarker: tokenMarker(token),
      savedAt: Date.now(),
      user,
    }));
  } catch {}
}

function clearCachedUser() {
  try { localStorage.removeItem(USER_CACHE_KEY); } catch {}
}

let meMemo = null;
function fetchCurrentUserShared(token, force = false) {
  const now = Date.now();
  if (!force && meMemo?.token === token && now - meMemo.at < ME_MEMO_MS) {
    return meMemo.promise;
  }

  const promise = fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  }).then(async (res) => ({
    status: res.status,
    ok: res.ok,
    data: res.ok ? await res.json().catch(() => null) : null,
  }));

  meMemo = { token, at: now, promise };
  return promise;
}

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
  if (user?.role === "superadmin") return 0;
  const name = String(user?.premium?.plan_name || "").toLowerCase();
  if (user?.is_premium && (name.includes("pro") || name.includes("unlimited") || name.includes("illimit"))) return 1080;
  return 720;
}

function publishQualityCap(user) {
  try {
    const maxHeight = playbackQualityCap(user);
    localStorage.setItem(QUALITY_CAP_KEY, String(maxHeight));
    window.dispatchEvent(new CustomEvent("flixit-quality-cap-changed", { detail: { maxHeight } }));
  } catch {}
}

// Profile data is restored synchronously from the last verified response so an
// F5 never starts with an anonymous/blank header. /api/auth/me only revalidates
// that snapshot; transient network failures must not log the UI out.
export function useCurrentUser() {
  const [user, setUser] = useState(() => {
    const token = userToken();
    if (!token) return null;
    return readCachedUser(token) || undefined;
  });

  const refresh = useCallback(async (force = false) => {
    const token = userToken();
    if (!token) {
      meMemo = null;
      clearCachedUser();
      setUser(null);
      publishQualityCap(null);
      return null;
    }

    const cached = readCachedUser(token);
    if (cached) {
      setUser((current) => current || cached);
      publishQualityCap(cached);
    }

    try {
      const result = await fetchCurrentUserShared(token, force);
      if (result.status === 401) {
        try { localStorage.removeItem("user_token"); } catch {}
        meMemo = null;
        clearCachedUser();
        setUser(null);
        publishQualityCap(null);
        return null;
      }
      if (!result.ok || !result.data) return cached || null;

      writeCachedUser(token, result.data);
      setUser(result.data);
      publishQualityCap(result.data);
      return result.data;
    } catch {
      // Keep the last verified profile on temporary network/backend errors.
      return cached || null;
    }
  }, []);

  useEffect(() => {
    const cached = readCachedUser();
    if (cached) publishQualityCap(cached);
    refresh(false);
  }, [refresh]);

  return { user, refresh, isLoggedIn: Boolean(userToken()) };
}
