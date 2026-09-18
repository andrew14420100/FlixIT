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
const LIVE_REFRESH_MS = 60 * 1000;
const PROGRESS_EVENT = 'flix-watch-progress-changed';

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
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
        ...(isGet ? { 'Cache-Control': 'no-cache' } : {}),
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

// Shared request across every mounted hook (home row, hero, detail, hover cards).
let progressMemo: { at: number; promise: Promise<any> } | null = null;
const PROGRESS_MEMO_MS = 15 * 1000;
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

export function useContinueWatching() {
  const [items, setItems] = useState<ContinueWatchingItem[]>(() => readLocalStorage());
  const [username, setUsername] = useState<string>('Utente');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(!!getToken());

  const applyPayload = useCallback((data: any) => {
    if (data?.items) {
      setItems(data.items);
      saveToLocalStorage(data.items);
    }
    if (data?.username) {
      setUsername(data.username);
      localStorage.setItem(USERNAME_KEY, data.username);
    }
  }, []);

  const refresh = useCallback(async (force = true) => {
    const token = getToken();
    if (!token) {
      setIsLoggedIn(false);
      setItems(readLocalStorage());
      setUsername(localStorage.getItem(USERNAME_KEY) || 'Utente');
      return null;
    }

    setIsLoggedIn(true);
    if (force) invalidateProgressMemo();
    const data = await fetchProgressShared(force);
    applyPayload(data);
    return data;
  }, [applyPayload]);

  // Initial load.
  useEffect(() => {
    refresh(false);
  }, [refresh]);

  // Keep every mounted card/row instance current. This is intentionally a
  // shared live refresh rather than a one-shot mount fetch.
  useEffect(() => {
    const sync = () => refresh(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    const onStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key === TOKEN_KEY ||
        event.key === LOCAL_STORAGE_KEY ||
        event.key === USERNAME_KEY
      ) {
        sync();
      }
    };

    const interval = window.setInterval(sync, LIVE_REFRESH_MS);
    window.addEventListener('focus', sync);
    window.addEventListener('online', sync);
    window.addEventListener('storage', onStorage);
    window.addEventListener(PROGRESS_EVENT, sync as EventListener);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', sync);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(PROGRESS_EVENT, sync as EventListener);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  // Lightweight same-tab login/logout detector. The event listeners above
  // cover all normal refreshes; this catches code that mutates localStorage
  // without dispatching an event.
  useEffect(() => {
    let lastToken = getToken();
    const interval = window.setInterval(() => {
      const nextToken = getToken();
      if (nextToken !== lastToken) {
        lastToken = nextToken;
        refresh(true);
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [refresh]);

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

      if (getToken()) {
        invalidateProgressMemo();
        await apiFetch('/api/auth/watch-progress', {
          method: 'POST',
          body: JSON.stringify(item),
          keepalive: true,
        });
      }

      invalidateProgressMemo();
      broadcastProgressChanged();
    },
    []
  );

  const getProgress = useCallback(
    (tmdbId: number): ContinueWatchingItem | undefined => {
      return items.find((i) => i.tmdb_id === tmdbId);
    },
    [items]
  );

  const removeItem = useCallback(async (tmdbId: number) => {
    setItems((prev) => {
      const updated = prev.filter((i) => i.tmdb_id !== tmdbId);
      saveToLocalStorage(updated);
      return updated;
    });

    if (getToken()) {
      await apiFetch(`/api/auth/watch-progress/${tmdbId}`, {
        method: 'DELETE',
      });
    }

    invalidateProgressMemo();
    broadcastProgressChanged();
  }, []);

  const updateUsername = useCallback((name: string) => {
    setUsername(name);
    localStorage.setItem(USERNAME_KEY, name);
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
