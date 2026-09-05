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

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function apiFetch(path: string, options?: RequestInit) {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_URL}${path}`, {
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

export function useContinueWatching() {
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);
  const [username, setUsername] = useState<string>('Utente');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(!!getToken());

  // Check login state and load data
  useEffect(() => {
    const token = getToken();

    if (token) {
      setIsLoggedIn(true);
      // Fetch from backend API
      apiFetch('/api/auth/watch-progress').then((data) => {
        if (data?.items) {
          setItems(data.items);
          // Also sync to localStorage for faster next load
          saveToLocalStorage(data.items);
        }
        if (data?.username) {
          setUsername(data.username);
          localStorage.setItem(USERNAME_KEY, data.username);
        }
      });
    } else {
      setIsLoggedIn(false);
      setItems([]);
      setUsername('Utente');
    }
  }, []);

  // Listen for storage changes (login/logout from other tabs or same page)
  useEffect(() => {
    const handleStorageChange = () => {
      const token = getToken();
      const wasLoggedIn = isLoggedIn;

      if (token && !wasLoggedIn) {
        // User just logged in — fetch from backend
        setIsLoggedIn(true);
        apiFetch('/api/auth/watch-progress').then((data) => {
          if (data?.items) {
            setItems(data.items);
            saveToLocalStorage(data.items);
          }
          if (data?.username) {
            setUsername(data.username);
            localStorage.setItem(USERNAME_KEY, data.username);
          }
        });
      } else if (!token && wasLoggedIn) {
        // User logged out — clear
        setIsLoggedIn(false);
        setItems([]);
        setUsername('Utente');
      }
    };

    // Check periodically for token changes (covers same-tab login/logout)
    const interval = setInterval(handleStorageChange, 2000);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [isLoggedIn]);

  const saveProgress = useCallback(
    async (item: Omit<ContinueWatchingItem, 'updated_at'>) => {
      const now = new Date().toISOString();
      const fullItem: ContinueWatchingItem = { ...item, updated_at: now };

      setItems((prev) => {
        const filtered = prev.filter((i) => i.tmdb_id !== item.tmdb_id);

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
        await apiFetch('/api/auth/watch-progress', {
          method: 'POST',
          body: JSON.stringify(item),
        });
      }
    },
    []
  );

  const getProgress = useCallback(
    (tmdbId: number): ContinueWatchingItem | undefined => {
      return items.find((i) => i.tmdb_id === tmdbId);
    },
    [items]
  );

  const removeItem = useCallback(
    async (tmdbId: number) => {
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
    },
    []
  );

  const updateUsername = useCallback((name: string) => {
    setUsername(name);
    localStorage.setItem(USERNAME_KEY, name);
  }, []);

  // Manual refresh function (call after login)
  const refresh = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setIsLoggedIn(false);
      setItems([]);
      return;
    }
    setIsLoggedIn(true);
    const data = await apiFetch('/api/auth/watch-progress');
    if (data?.items) {
      setItems(data.items);
      saveToLocalStorage(data.items);
    }
    if (data?.username) {
      setUsername(data.username);
      localStorage.setItem(USERNAME_KEY, data.username);
    }
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

function saveToLocalStorage(items: ContinueWatchingItem[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}
