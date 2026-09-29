// @ts-nocheck
import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
export const POLL_MS = 60000;
const EMPTY = { items: [], unread: 0, must_reset_password: false, role: "user" };
const SHARED_NOTIFICATION_TTL_MS = 15 * 1000;
const NOTIFICATION_CACHE_KEY = "flixit_notifications_v1";

let notificationsMemo = null;
const notificationSubscribers = new Set<() => void>();
let notificationRuntimeCleanup: (() => void) | null = null;

function tokenMarker(token) {
  const value = String(token || "");
  return value ? value.slice(-16) : "";
}

function readNotificationCache() {
  try {
    const token = localStorage.getItem("user_token") || "";
    if (!token) return EMPTY;
    const cached = JSON.parse(localStorage.getItem(NOTIFICATION_CACHE_KEY) || "null");
    if (!cached?.data || cached?.tokenMarker !== tokenMarker(token)) return EMPTY;
    return { ...EMPTY, ...cached.data };
  } catch {
    return EMPTY;
  }
}

function persistNotificationCache(token, data) {
  if (!token || !data) return;
  try {
    localStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify({
      tokenMarker: tokenMarker(token),
      savedAt: Date.now(),
      data,
    }));
  } catch {}
}

export function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("user_token") || ""}` };
}

export function handleBanned(res) {
  if (res.status !== 403) return false;
  return res.clone().json().then((d) => {
    if (d?.detail?.code === "banned") {
      sessionStorage.setItem("flixit_banned_reason", d.detail.reason || "");
      localStorage.removeItem("user_token");
      localStorage.removeItem(NOTIFICATION_CACHE_KEY);
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
      cache: "no-store",
    });
    if (res.status === 403) {
      await handleBanned(res);
      return null;
    }
    if (res.status === 401) {
      localStorage.removeItem("user_token");
      localStorage.removeItem(NOTIFICATION_CACHE_KEY);
      window.location.reload();
      return null;
    }
    const data = res.ok ? await res.json() : null;
    if (data) persistNotificationCache(token, data);
    return data;
  } catch {
    return null;
  }
}

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

function notifySubscribers() {
  notificationSubscribers.forEach((callback) => {
    try { callback(); } catch {}
  });
}

function ensureNotificationRuntime() {
  if (notificationRuntimeCleanup || typeof window === "undefined") return;

  const tick = () => {
    if (document.visibilityState === "visible") notifySubscribers();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") notifySubscribers();
  };

  const interval = window.setInterval(tick, POLL_MS);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", tick, { passive: true });

  notificationRuntimeCleanup = () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", tick);
    notificationRuntimeCleanup = null;
  };
}

export function subscribeNotificationRefresh(callback: () => void) {
  notificationSubscribers.add(callback);
  ensureNotificationRuntime();
  return () => {
    notificationSubscribers.delete(callback);
    if (notificationSubscribers.size === 0) notificationRuntimeCleanup?.();
  };
}

export function useNotifications() {
  const [state, setState] = useState(() => readNotificationCache());
  const loggedIn = !!localStorage.getItem("user_token");

  const refresh = useCallback(async () => {
    if (!localStorage.getItem("user_token") || document.visibilityState === "hidden") return;
    const data = await fetchNotificationsShared(false);
    if (data) setState(data);
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    refresh();
    return subscribeNotificationRefresh(refresh);
  }, [loggedIn, refresh]);

  const markRead = useCallback(async (ids) => {
    setState((s) => {
      const next = {
        ...s,
        unread: ids ? Math.max(0, s.unread - ids.length) : 0,
        items: s.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)),
      };
      persistNotificationCache(localStorage.getItem("user_token") || "", next);
      return next;
    });
    invalidateNotificationsMemo();
    await fetch(`${API_URL}/api/notifications/read`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ ids }) }).catch(() => {});
    notifySubscribers();
  }, []);

  return { ...state, loggedIn, refresh, markRead };
}
