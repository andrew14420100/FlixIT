// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';

export interface ContinueWatchingItem {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  backdrop_path: string;
  poster_path: string;
  progress: number;
  duration: number;
  updated_at?: string;
  season?: number;
  episode?: number;
}

export type { ContinueWatchingItem as WatchProgressItem };

const API_URL = '';
const LOCAL_STORAGE_PREFIX = 'netflix_continue_watching';
const USERNAME_PREFIX = 'netflix_username';
const USER_ID_KEY = 'netflix_user_id';
const TOKEN_KEY = 'user_token';
const LIVE_REFRESH_MS = 2 * 60 * 1000;
const TOKEN_CHECK_MS = 2_000;
const PROGRESS_EVENT = 'flix-watch-progress-changed';

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function getProfileId(): string | null {
  if (!getToken()) return null;
  try {
    const value = String(localStorage.getItem(USER_ID_KEY) || '').trim();
    return value || null;
  } catch {
    return null;
  }
}

function profileStorageKey(prefix: string, profileId = getProfileId()) {
  return profileId ? `${prefix}:${profileId}` : null;
}

function sessionIdentity(token = getToken()) {
  if (!token) return '';
  const profile = getProfileId();
  // The token is used only as an in-memory discriminator when a profile id has
  // not been populated yet. It is never persisted in a storage key.
  return profile ? `profile:${profile}` : `token:${token}`;
}

async function apiFetch(path: string, options?: RequestInit, tokenOverride?: string | null) {
  const token = tokenOverride === undefined ? getToken() : tokenOverride;
  if (!token) return null;
  try {
    const isGet = !options?.method || options.method.toUpperCase() === 'GET';
    const res = await fetch(`${API_URL}${path}`, {
      cache: isGet ? 'no-store' : options?.cache,
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options?.headers || {}),
      },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

let progressMemo: { at: number; identity: string; promise: Promise<any> } | null = null;
const PROGRESS_MEMO_MS = 20 * 1000;
function fetchProgressShared(force = false, token = getToken()) {
  if (!token) return Promise.resolve(null);
  const identity = sessionIdentity(token);
  const now = Date.now();
  if (
    !force &&
    progressMemo &&
    progressMemo.identity === identity &&
    now - progressMemo.at < PROGRESS_MEMO_MS
  ) {
    return progressMemo.promise;
  }
  const promise = apiFetch('/api/auth/watch-progress', undefined, token);
  progressMemo = { at: now, identity, promise };
  return promise;
}

export function invalidateProgressMemo() {
  progressMemo = null;
}

function broadcastProgressChanged() {
  try { window.dispatchEvent(new CustomEvent(PROGRESS_EVENT)); } catch {}
}

function readLocalStorage(profileId = getProfileId()): ContinueWatchingItem[] {
  const key = profileStorageKey(LOCAL_STORAGE_PREFIX, profileId);
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToLocalStorage(items: ContinueWatchingItem[], profileId = getProfileId()) {
  const key = profileStorageKey(LOCAL_STORAGE_PREFIX, profileId);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(items)); } catch {}
}

function readUsername(profileId = getProfileId()) {
  const key = profileStorageKey(USERNAME_PREFIX, profileId);
  if (!key) return '';
  try { return localStorage.getItem(key) || 'Utente'; } catch { return 'Utente'; }
}

function saveUsername(name: string, profileId = getProfileId()) {
  const key = profileStorageKey(USERNAME_PREFIX, profileId);
  if (!key) return;
  try { localStorage.setItem(key, name); } catch {}
}

type ProgressWriteState = { latest: any; running: Promise<any> | null; token: string };
const progressWrites = new Map<string, ProgressWriteState>();

function progressWriteKey(item: any, identity: string) {
  return `${identity}:${item?.media_type || 'movie'}:${item?.tmdb_id || 0}:${item?.season || 0}:${item?.episode || 0}`;
}

function enqueueProgressWrite(item: any, token: string) {
  if (!token) return Promise.resolve(null);
  const identity = sessionIdentity(token);
  const key = progressWriteKey(item, identity);
  let state = progressWrites.get(key);
  if (!state) {
    state = { latest: null, running: null, token };
    progressWrites.set(key, state);
  }
  state.latest = item;
  if (state.running) return state.running;

  state.running = (async () => {
    while (state?.latest) {
      const next = state.latest;
      state.latest = null;
      // Keep the token captured for the account that generated this write. A
      // logout/login while a keepalive write is queued must never send A's
      // progress using B's new bearer token.
      await apiFetch('/api/auth/watch-progress', {
        method: 'POST',
        body: JSON.stringify(next),
        keepalive: true,
      }, state.token);
    }
  })().finally(() => {
    const current = progressWrites.get(key);
    if (current === state) progressWrites.delete(key);
  });

  return state.running;
}

const passiveSubscribers = new Set<() => void>();
let passiveCleanup: (() => void) | null = null;
let lastObservedIdentity = '';

function notifyPassiveSubscribers() {
  passiveSubscribers.forEach((callback) => {
    try { callback(); } catch {}
  });
}

function ensurePassiveRuntime() {
  if (passiveCleanup || typeof window === 'undefined') return;
  lastObservedIdentity = sessionIdentity();

  const sync = () => notifyPassiveSubscribers();
  const onVisibility = () => {
    if (document.visibilityState === 'visible') sync();
  };
  const onStorage = (event: StorageEvent) => {
    const key = String(event.key || '');
    if (
      !key ||
      key === TOKEN_KEY ||
      key === USER_ID_KEY ||
      key.startsWith(`${LOCAL_STORAGE_PREFIX}:`) ||
      key.startsWith(`${USERNAME_PREFIX}:`)
    ) {
      if (key === TOKEN_KEY || key === USER_ID_KEY) invalidateProgressMemo();
      sync();
    }
  };

  const refreshInterval = window.setInterval(sync, LIVE_REFRESH_MS);
  const identityInterval = window.setInterval(() => {
    const nextIdentity = sessionIdentity();
    if (nextIdentity !== lastObservedIdentity) {
      lastObservedIdentity = nextIdentity;
      invalidateProgressMemo();
      sync();
    }
  }, TOKEN_CHECK_MS);

  window.addEventListener('focus', sync, { passive: true });
  window.addEventListener('online', sync, { passive: true });
  window.addEventListener('storage', onStorage);
  window.addEventListener(PROGRESS_EVENT, sync as EventListener);
  document.addEventListener('visibilitychange', onVisibility);

  passiveCleanup = () => {
    window.clearInterval(refreshInterval);
    window.clearInterval(identityInterval);
    window.removeEventListener('focus', sync);
    window.removeEventListener('online', sync);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(PROGRESS_EVENT, sync as EventListener);
    document.removeEventListener('visibilitychange', onVisibility);
    passiveCleanup = null;
  };
}

function subscribePassiveSync(callback: () => void) {
  passiveSubscribers.add(callback);
  ensurePassiveRuntime();
  return () => {
    passiveSubscribers.delete(callback);
    if (passiveSubscribers.size === 0) passiveCleanup?.();
  };
}

export function useContinueWatching() {
  const [items, setItems] = useState<ContinueWatchingItem[]>(() => readLocalStorage());
  const [username, setUsername] = useState<string>(() => readUsername());
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(!!getToken());

  const applyPayload = useCallback((data: any, expectedToken: string, expectedProfile: string | null) => {
    if (!expectedToken || getToken() !== expectedToken || getProfileId() !== expectedProfile) return;
    if (data?.items) {
      setItems(data.items);
      saveToLocalStorage(data.items, expectedProfile);
    }
    if (data?.username) {
      setUsername(data.username);
      saveUsername(data.username, expectedProfile);
    }
  }, []);

  const refresh = useCallback(async (force = true) => {
    const token = getToken();
    const profileId = getProfileId();
    if (!token) {
      setIsLoggedIn(false);
      setItems([]);
      setUsername('');
      invalidateProgressMemo();
      return null;
    }

    setIsLoggedIn(true);
    // Switch visible state to the current profile's own local snapshot before
    // any network response. This prevents cross-account first-paint leakage.
    setItems(readLocalStorage(profileId));
    setUsername(readUsername(profileId));

    if (force) invalidateProgressMemo();
    const data = await fetchProgressShared(force, token);
    applyPayload(data, token, profileId);
    return data;
  }, [applyPayload]);

  useEffect(() => {
    if (!getToken()) {
      setItems([]);
      setUsername('');
      return;
    }
    let cancelled = false;
    let timer = 0;
    let idleId: any = null;
    const run = () => { if (!cancelled) refresh(false); };
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = (window as any).requestIdleCallback(run, { timeout: 900 });
    } else if (typeof window !== 'undefined') {
      timer = window.setTimeout(run, 250);
    }
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (idleId != null && 'cancelIdleCallback' in window) (window as any).cancelIdleCallback(idleId);
    };
  }, [refresh]);

  useEffect(() => subscribePassiveSync(() => { refresh(false); }), [refresh]);

  const saveProgress = useCallback(
    async (item: Omit<ContinueWatchingItem, 'updated_at'>) => {
      const token = getToken();
      const profileId = getProfileId();
      if (!token || !profileId) {
        setItems([]);
        return;
      }

      const now = new Date().toISOString();
      const fullItem: ContinueWatchingItem = { ...item, updated_at: now };

      setItems((prev) => {
        if (getToken() !== token || getProfileId() !== profileId) return prev;
        const base = prev.length ? prev : readLocalStorage(profileId);
        const filtered = base.filter((i) => i.tmdb_id !== item.tmdb_id);

        if (item.duration > 0 && item.progress / item.duration >= 0.95) {
          saveToLocalStorage(filtered, profileId);
          return filtered;
        }
        if (item.progress < 10) return prev;

        const updated = [fullItem, ...filtered].slice(0, 20);
        saveToLocalStorage(updated, profileId);
        return updated;
      });

      await enqueueProgressWrite(item, token);
      invalidateProgressMemo();
    },
    []
  );

  const getProgress = useCallback(
    (tmdbId: number): ContinueWatchingItem | undefined => {
      if (!getToken() || !getProfileId()) return undefined;
      return items.find((i) => i.tmdb_id === tmdbId);
    },
    [items]
  );

  const removeItem = useCallback(async (tmdbId: number) => {
    const token = getToken();
    const profileId = getProfileId();
    if (!token || !profileId) {
      setItems([]);
      return;
    }

    setItems((prev) => {
      if (getToken() !== token || getProfileId() !== profileId) return prev;
      const updated = prev.filter((i) => i.tmdb_id !== tmdbId);
      saveToLocalStorage(updated, profileId);
      return updated;
    });

    await apiFetch(`/api/auth/watch-progress/${tmdbId}`, { method: 'DELETE' }, token);
    invalidateProgressMemo();
    broadcastProgressChanged();
  }, []);

  const updateUsername = useCallback((name: string) => {
    const profileId = getProfileId();
    if (!getToken() || !profileId) {
      setUsername('');
      return;
    }
    setUsername(name);
    saveUsername(name, profileId);
  }, []);

  return {
    items,
    username,
    isLoggedIn,
    saveProgress,
    getProgress,
    removeItem,
    updateUsername,
    refresh,
  };
}
