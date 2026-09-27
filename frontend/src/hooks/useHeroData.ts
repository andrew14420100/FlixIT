// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { browserSafeArtworkUrl, tmdbImageUrl } from './useAutomaticMediaAssets';

interface HeroSettings {
  contentId: string;
  customTitle: string | null;
  customDescription: string | null;
  customBackdrop: string | null;
  seasonLabel: string | null;
  mediaType: 'movie' | 'tv';
  updatedAt?: string | null;
  detail?: any;
  assets?: any;
}

function heroProfile() {
  if (typeof window === 'undefined') return 'guest';
  try {
    return localStorage.getItem('netflix_user_id') || 'guest';
  } catch {
    return 'guest';
  }
}

function heroViewport() {
  if (typeof window === 'undefined') return 'desktop';
  return window.innerWidth < 700 ? 'mobile' : 'desktop';
}

function rawArtwork(value: any) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value?.url === 'string') return value.url.trim();
  if (typeof value?.artwork?.url === 'string') return value.artwork.url.trim();
  return '';
}

function heroArtworkUrl(...values: any[]) {
  for (const value of values) {
    const raw = rawArtwork(value);
    if (!raw) continue;

    if (raw.startsWith('/api/') || raw.startsWith('/assets/') || raw.startsWith('/static/')) {
      return raw;
    }

    if (raw.startsWith('/')) {
      const tmdb = tmdbImageUrl(raw, 'original');
      if (tmdb) return tmdb;
    }

    const safe = browserSafeArtworkUrl(raw);
    if (safe) return safe;
  }
  return null;
}

function normalizeHero(value: any) {
  if (!value?.contentId) return value || null;
  const assets = value?.assets || {};
  const detail = value?.detail || {};
  return {
    ...value,
    mediaType: value.mediaType || 'tv',
    // HeroSection treats customBackdrop as already browser-ready. Supplying the
    // best saved artwork here prevents an external/proxied artwork URL from
    // being incorrectly reinterpreted as a TMDB-only path later in the Hero.
    customBackdrop: heroArtworkUrl(
      value?.customBackdrop,
      assets?.hero_backdrop_path,
      assets?.detail_backdrop_path,
      assets?.backdrop_path,
      assets?.titled_backdrop_path,
      detail?.backdrop_path,
      assets?.poster_path,
      detail?.poster_path
    ),
  };
}

function bootstrappedHero() {
  if (typeof window === 'undefined') return null;
  const value = (window as any).__flixitHomeHero;
  return value?.contentId ? normalizeHero(value) : null;
}

/** Shared Home Hero query. Hero artwork is normalized before it reaches the
 * billboard so saved StreamingCommunity/GitHub/custom artwork and TMDB fallback
 * paths all remain visible instead of producing an empty Hero background. */
export function useHeroData(initialHero: HeroSettings | null = null) {
  const profile = heroProfile();
  const viewport = heroViewport();
  const hydrated = initialHero?.contentId ? normalizeHero(initialHero) : bootstrappedHero();

  return useQuery<HeroSettings | null>({
    queryKey: ['hero-settings-v6-artwork-recovery', profile, viewport],
    queryFn: async ({ signal }: any) => {
      try {
        const response = await fetch('/api/public/hero', {
          signal,
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return hydrated || null;
        const data = await response.json();
        if (!data?.contentId) return hydrated || null;
        const normalized = normalizeHero(data);
        if (typeof window !== 'undefined') (window as any).__flixitHomeHero = normalized;
        return normalized;
      } catch {
        return hydrated || null;
      }
    },
    initialData: hydrated?.contentId ? normalizeHero(hydrated) : undefined,
    initialDataUpdatedAt: hydrated?.contentId ? Date.now() : undefined,
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: hydrated?.contentId ? false : 'always',
    retry: 1,
  });
}
