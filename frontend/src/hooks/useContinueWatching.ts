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
const LOCAL_STORAGE_KEY = 'netflix_continue_watching';
const USERNAME_KEY = 'netflix_username';
const TOKEN_KEY = 'user_token';
const LIVE_REFRESH_MS = 2 * 60 * 1000;
const TOKEN_CHECK_MS = 10_000;
const PROGRESS_EVENT = 'flix-watch-progress-changed';

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function apiFetch(path: string, options?: RequestInit) {
  const token = getToken();
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

let progressMemo: { at: number; promise: Promise<any> } | null = null;
const PROGRESS_MEMO_MS = 20 * 1000;
function fetchProgressShared(force = false) {
  const now = Date.now();
  if (!force && progressMemo && now - progressMemo.at < PROGRESS_MEMO_MS) {
    return progressMemo.promise;
  }
  const promise = apiFetch('/api/auth/watch-progress');
  progressMemo = { at: now, promise };
  return promise;
}
export function invalidateProgressMemo() {
  progressMemo = null;
}

function broadcastProgressChanged() {
  try {
    window.dispatchEvent(new CustomEvent(PROGRESS_EVENT));
  } catch {}
}

function readLocalStorage(): ContinueWatchingItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToLocalStorage(items: ContinueWatchingItem[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

// Serialize/coalesce writes per logical title/episode. WatchPage persists every
// 15 seconds and can also persist on hide/unmount; a slow network must not turn
// those calls into overlapping POSTs. While one request is running we keep only
// the newest payload, which is the only progress value that matters.
type ProgressWriteState = { latest: any; running: Promise<any> | null };
const progressWrites = new Map<string, ProgressWriteState>();

function progressWriteKey(item: any) {
  return `${item?.media_type || 'movie'}:${item?.tmdb_id || 0}:${item?.season || 0}:${item?.episode || 0}`;
}

function enqueueProgressWrite(item: any) {
  const key = progressWriteKey(item);
  let state = progressWrites.get(key);
  if (!state) {
    state = { latest: null, running: null };
    progressWrites.set(key, state);
  }
  state.latest = item;
  if (state.running) return state.running;

  state.running = (async () => {
    while (state?.latest) {
      const next = state.latest;
      state.latest = null;
      await apiFetch('/api/auth/watch-progress', {
        method: 'POST',
        body: JSON.stringify(next),
        keepalive: true,
      });
    }
  })().finally(() => {
    const current = progressWrites.get(key);
    if (current === state) progressWrites.delete(key);
  });

  return state.running;
}

const passiveSubscribers = new Set<() => void>();
let passiveCleanup: (() => void) | null = null;
let lastObservedToken: string | null = null;

function notifyPassiveSubscribers() {
  passiveSubscribers.forEach((callback) => {
    try { callback(); } catch {}
  });
}

function ensurePassiveRuntime() {
  if (passiveCleanup || typeof window === 'undefined') return;
  lastObservedToken = getToken();

  const sync = () => notifyPassiveSubscribers();
  const onVisibility = () => {
    if (document.visibilityState === 'visible') sync();
  };
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === TOKEN_KEY || event.key === LOCAL_STORAGE_KEY || event.key === USERNAME_KEY) {
      if (event.key === TOKEN_KEY) invalidateProgressMemo();
      sync();
    }
  };

  const refreshInterval = window.setInterval(sync, LIVE_REFRESH_MS);
  const tokenInterval = window.setInterval(() => {
    const nextToken = getToken();
    if (nextToken !== lastObservedToken) {
      lastObservedToken = nextToken;
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
    window.clearInterval(tokenInterval);
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
  const [username, setUsername] = useState<string>(() => {
    try { return localStorage.getItem(USERNAME_KEY) || 'Utente'; } catch { return 'Utente'; }
  });
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(!!getToken());

  const applyPayload = useCallback((data: any) => {
    if (data?.items) {
      setItems(data.items);
      saveToLocalStorage(data.items);
    }
    if (data?.username) {
      setUsername(data.username);
      try { localStorage.setItem(USERNAME_KEY, data.username); } catch {}
    }
  }, []);

  const refresh = useCallback(async (force = true) => {
    const token = getToken();
    if (!token) {
      setIsLoggedIn(false);
      setItems(readLocalStorage());
      try { setUsername(localStorage.getItem(USERNAME_KEY) || 'Utente'); } catch { setUsername('Utente'); }
      return null;
    }

    setIsLoggedIn(true);
    if (force) invalidateProgressMemo();
    const data = await fetchProgressShared(force);
    applyPayload(data);
    return data;
  }, [applyPayload]);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  useEffect(() => subscribePassiveSync(() => { refresh(false); }), [refresh]);

  const saveProgress = useCallback(
    async (item: Omit<ContinueWatchingItem, 'updated_at'>) => {
      const now = new Date().toISOString();
      const fullItem: ContinueWatchingItem = { ...item, updated_at: now };

      setItems((prev) => {
        const base = prev.length ? prev : readLocalStorage();
        const filtered = base.filter((i) => i.tmdb_id !== item.tmdb_id);

        if (item.duration > 0 && item.progress / item.duration >= 0.95) {
          saveToLocalStorage(filtered);
          return filtered;
        }
        if (item.progress < 10) return prev;

        const updated = [fullItem, ...filtered].slice(0, 20);
        saveToLocalStorage(updated);
        return updated;
      });

      if (getToken()) await enqueueProgressWrite(item);

      // Local state/localStorage already contain the newest position. Invalidating
      // the memo is enough for the next page/focus refresh. Broadcasting here used
      // to force an immediate GET after every 15-second POST during playback.
      invalidateProgressMemo();
    },
    []
  );

  const getProgress = useCallback(
    (tmdbId: number): ContinueWatchingItem | undefined => items.find((i) => i.tmdb_id === tmdbId),
    [items]
  );

  const removeItem = useCallback(async (tmdbId: number) => {
    setItems((prev) => {
      const updated = prev.filter((i) => i.tmdb_id !== tmdbId);
      saveToLocalStorage(updated);
      return updated;
    });

    if (getToken()) {
      await apiFetch(`/api/auth/watch-progress/${tmdbId}`, { method: 'DELETE' });
    }

    invalidateProgressMemo();
    broadcastProgressChanged();
  }, []);

  const updateUsername = useCallback((name: string) => {
    setUsername(name);
    try { localStorage.setItem(USERNAME_KEY, name); } catch {}
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
