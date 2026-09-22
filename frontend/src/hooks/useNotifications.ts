// @ts-nocheck
import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
export const POLL_MS = 60000;
const EMPTY = { items: [], unread: 0, must_reset_password: false, role: "user" };
const SHARED_NOTIFICATION_TTL_MS = 15 * 1000;

let notificationsMemo = null;

export function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("user_token") || ""}` };
}

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

export function invalidateNotificationsMemo() {
  notificationsMemo = null;
}

async function requestNotifications(token) {
  try {
    const res = await fetch(`${API_URL}/api/notifications`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    if (res.status === 403) {
      await handleBanned(res);
      return null;
    }
    if (res.status === 401) {
      localStorage.removeItem("user_token");
      window.location.reload();
      return null;
    }
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Header and SessionGuards need the same payload. Coalesce them so mounting the
 * shell does not issue two identical authenticated requests, and keep a very
 * short memo window so security/session changes are still observed promptly.
 */
export function fetchNotificationsShared(force = false) {
  const token = localStorage.getItem("user_token") || "";
  if (!token) return Promise.resolve(null);

  const now = Date.now();
  if (
    !force &&
    notificationsMemo?.token === token &&
    now - notificationsMemo.at < SHARED_NOTIFICATION_TTL_MS
  ) {
    return notificationsMemo.promise;
  }

  const promise = requestNotifications(token);
  notificationsMemo = { token, at: now, promise };
  return promise;
}

// Notifications are low urgency. Poll once a minute only while the document is
// visible; focus/visibility immediately refreshes after the user comes back.
export function useNotifications() {
  const [state, setState] = useState(EMPTY);
  const loggedIn = !!localStorage.getItem("user_token");

  const refresh = useCallback(async () => {
    if (!localStorage.getItem("user_token") || document.visibilityState === "hidden") return;
    const data = await fetchNotificationsShared(false);
    if (data) setState(data);
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    const onVisibility = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh, { passive: true });
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [loggedIn, refresh]);

  const markRead = useCallback(async (ids) => {
    setState((s) => ({ ...s, unread: ids ? Math.max(0, s.unread - ids.length) : 0, items: s.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) }));
    invalidateNotificationsMemo();
    await fetch(`${API_URL}/api/notifications/read`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ ids }) }).catch(() => {});
  }, []);

  return { ...state, loggedIn, refresh, markRead };
}
