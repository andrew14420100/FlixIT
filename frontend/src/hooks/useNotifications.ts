// @ts-nocheck
import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
export const POLL_MS = 20000;
const EMPTY = { items: [], unread: 0, must_reset_password: false, role: "user" };

export function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("user_token") || ""}` };
}

// Ban detection shared by every authenticated fetch: clear the session and surface the reason on the next page load.
export function handleBanned(res) {
  if (res.status !== 403) return false;
  return res.clone().json().then((d) => {
    if (d?.detail?.code === "banned") {
      sessionStorage.setItem("flixit_banned_reason", d.detail.reason || "");
      localStorage.removeItem("user_token");
      window.location.reload();
      return true;
    }
    return false;
  }).catch(() => false);
}

// Polls the user's notifications (and the forced-reset flag) every 20s while a session is active.
export function useNotifications() {
  const [state, setState] = useState(EMPTY);
  const loggedIn = !!localStorage.getItem("user_token");

  const refresh = useCallback(async () => {
    if (!localStorage.getItem("user_token")) return;
    try {
      const res = await fetch(`${API_URL}/api/notifications`, { headers: authHeaders() });
      if (res.status === 403) { await handleBanned(res); return; }
      if (res.status === 401) { localStorage.removeItem("user_token"); window.location.reload(); return; }
      if (res.ok) setState(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    const onFocus = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onFocus); };
  }, [loggedIn, refresh]);

  const markRead = useCallback(async (ids) => {
    setState((s) => ({ ...s, unread: ids ? Math.max(0, s.unread - ids.length) : 0, items: s.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) }));
    await fetch(`${API_URL}/api/notifications/read`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ ids }) }).catch(() => {});
  }, []);

  return { ...state, loggedIn, refresh, markRead };
}
