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

    if (
      raw.startsWith('/api/') ||
      raw.startsWith('/assets/') ||
      raw.startsWith('/static/')
    ) {
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

function normalizeHero(value: any, extraArtwork: any = null, mediaAssets: any = null) {
  if (!value?.contentId) return value || null;

  const assets = value?.assets || {};
  const detail = value?.detail || {};
  const official = extraArtwork || {};
  const media = mediaAssets || {};

  return {
    ...value,
    mediaType: value.mediaType || 'tv',
    assets: {
      ...media,
      ...assets,
    },
    customBackdrop: heroArtworkUrl(
      value?.customBackdrop,
      official?.hero_backdrop_url,
      official?.detail_backdrop_url,
      official?.backdrop_url,
      assets?.hero_backdrop_path,
      assets?.detail_backdrop_path,
      assets?.backdrop_path,
      assets?.titled_backdrop_path,
      media?.hero_backdrop_path,
      media?.detail_backdrop_path,
      media?.backdrop_path,
      media?.titled_backdrop_path,
      detail?.backdrop_path,
      official?.poster_url,
      assets?.poster_path,
      media?.poster_path,
      detail?.poster_path
    ),
  };
}

async function enrichHero(value: any, signal?: AbortSignal) {
  const normalized = normalizeHero(value);
  if (!normalized?.contentId || normalized?.customBackdrop) return normalized;

  const mediaType = normalized.mediaType === 'movie' ? 'movie' : 'tv';
  const id = Number(normalized.contentId);
  if (!id) return normalized;

  try {
    const [officialResponse, mediaResponse] = await Promise.all([
      fetch(`/api/public/official-artwork/${mediaType}/${id}`, {
        signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }).catch(() => null),
      fetch(`/api/public/media-assets/${mediaType}/${id}`, {
        signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }).catch(() => null),
    ]);

    const official = officialResponse?.ok ? await officialResponse.json() : {};
    const media = mediaResponse?.ok ? await mediaResponse.json() : {};
    return normalizeHero(normalized, official, media);
  } catch {
    return normalized;
  }
}

function bootstrappedHero() {
  if (typeof window === 'undefined') return null;
  const value = (window as any).__flixitHomeHero;
  return value?.contentId ? normalizeHero(value) : null;
}

/**
 * Shared Home Hero query. The public Hero payload is enriched with the same
 * official-artwork/media-assets sources used elsewhere in the app, so a missing
 * admin backdrop can never leave the billboard without a cover when TMDB or the
 * saved artwork pipeline has a usable backdrop/poster.
 */
export function useHeroData(initialHero: HeroSettings | null = null) {
  const profile = heroProfile();
  const viewport = heroViewport();
  const hydrated = initialHero?.contentId ? normalizeHero(initialHero) : bootstrappedHero();

  return useQuery<HeroSettings | null>({
    queryKey: ['hero-settings-v7-guaranteed-backdrop', profile, viewport],
    queryFn: async ({ signal }: any) => {
      try {
        const response = await fetch('/api/public/hero', {
          signal,
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return enrichHero(hydrated, signal);

        const data = await response.json();
        if (!data?.contentId) return enrichHero(hydrated, signal);

        const normalized = await enrichHero(data, signal);
        if (typeof window !== 'undefined') {
          (window as any).__flixitHomeHero = normalized;
        }
        return normalized;
      } catch {
        return enrichHero(hydrated, signal);
      }
    },
    initialData: hydrated?.contentId ? normalizeHero(hydrated) : undefined,
    initialDataUpdatedAt: hydrated?.contentId ? Date.now() : undefined,
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Always revalidate on mount: bootstrap snapshots can legitimately contain
    // the Hero identity before the artwork enrichment has completed.
    refetchOnMount: 'always',
    retry: 1,
  });
}
