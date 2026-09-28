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

function forcedHeroMediaType() {
  if (typeof window === 'undefined') return null;
  const raw = String(window.location.pathname || '/');
  const path = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;

  if (path === '/film' || path === '/browse/genre/movie') return 'movie';
  if (path === '/serie-tv' || path === '/browse/genre/tv') return 'tv';
  return null;
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

function isScSource(value: any) {
  const source = String(value || '').trim().toLowerCase();
  return source === 'streamingcommunity' || source.startsWith('streamingcommunity_');
}

function normalizeHero(value: any, extraArtwork: any = null, mediaAssets: any = null) {
  if (!value?.contentId) return value || null;

  const assets = value?.assets || {};
  const detail = value?.detail || {};
  const official = extraArtwork || {};
  const media = mediaAssets || {};

  const officialScLogo = isScSource(official?.logo_source)
    ? heroArtworkUrl(official?.logo_url)
    : null;
  const embeddedScLogo = isScSource(assets?.logo_source)
    ? heroArtworkUrl(assets?.logo_path, assets?.logo_url)
    : null;
  const scLogo = officialScLogo || embeddedScLogo || null;

  // Keep media/backdrop metadata, but make every Hero logo-bearing field SC-only
  // so the later HeroSection cannot resurrect TMDB/Netflix/legacy title logos.
  const normalizedAssets = {
    ...media,
    ...assets,
    logo_path: scLogo,
    logo_url: scLogo,
    fallback_logo_path: null,
    logo_source: scLogo ? 'streamingcommunity' : null,
  };
  const normalizedDetail = {
    ...detail,
    logo_path: null,
    netflix_logo_url: null,
  };

  return {
    ...value,
    logo_path: scLogo,
    logoUrl: scLogo,
    detail: normalizedDetail,
    mediaType: value.mediaType || 'tv',
    assets: normalizedAssets,
    customBackdrop: heroArtworkUrl(
      value?.customBackdrop,
      official?.hero_backdrop_url,
      official?.detail_backdrop_url,
      official?.backdrop_url,
      normalizedAssets?.hero_backdrop_path,
      normalizedAssets?.detail_backdrop_path,
      normalizedAssets?.backdrop_path,
      normalizedAssets?.titled_backdrop_path,
      detail?.backdrop_path,
      official?.poster_url,
      normalizedAssets?.poster_path,
      detail?.poster_path
    ),
  };
}

function heroMatchesMediaType(value: any, mediaType: 'movie' | 'tv' | null) {
  if (!mediaType) return true;
  if (!value?.contentId) return false;
  const valueType = value?.mediaType === 'movie' ? 'movie' : 'tv';
  return valueType === mediaType;
}

function itemMediaType(item: any) {
  return item?.type === 'tv' || item?.media_type === 'tv' ? 'tv' : 'movie';
}

function heroFromItem(item: any, mediaType: 'movie' | 'tv') {
  const id = Number(item?.tmdbId || item?.tmdb_id || item?.id || 0);
  if (!id) return null;

  const itemAssets = item?.assets || item?.media_assets || {};
  const assets = {
    ...itemAssets,
    backdrop_path:
      itemAssets?.backdrop_path ||
      item?.backdrop_path ||
      item?.backdrop ||
      null,
    poster_path:
      itemAssets?.poster_path ||
      item?.poster_path ||
      item?.poster ||
      null,
    hero_backdrop_path:
      itemAssets?.hero_backdrop_path ||
      item?.hero_backdrop_path ||
      null,
  };

  return normalizeHero({
    contentId: String(id),
    mediaType,
    customTitle: item?.title || item?.name || item?.original_title || item?.original_name || null,
    customDescription: item?.overview || item?.description || null,
    customBackdrop: heroArtworkUrl(
      item?.customBackdrop,
      item?.hero_backdrop_path,
      assets?.hero_backdrop_path,
      item?.backdrop_path,
      assets?.backdrop_path,
      item?.poster_path,
      assets?.poster_path
    ),
    seasonLabel: null,
    detail: item,
    assets,
  });
}

function pickHeroFromRows(data: any, mediaType: 'movie' | 'tv') {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  for (const row of rows) {
    const items = Array.isArray(row?.items) ? row.items : [];
    const item = items.find((entry: any) => entry && itemMediaType(entry) === mediaType);
    if (item) {
      const hero = heroFromItem(item, mediaType);
      if (hero?.contentId) return hero;
    }
  }
  return null;
}

async function filteredHeroFromHome(mediaType: 'movie' | 'tv', signal?: AbortSignal) {
  const urls = ['/api/public/home-bootstrap-fast', '/api/public/home-bootstrap'];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) continue;
      const data = await response.json();
      const hero = pickHeroFromRows(data, mediaType);
      if (hero?.contentId) return hero;
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error;
    }
  }

  return null;
}

async function enrichHero(value: any, signal?: AbortSignal) {
  const normalized = normalizeHero(value);
  if (!normalized?.contentId) return normalized;

  const mediaType = normalized.mediaType === 'movie' ? 'movie' : 'tv';
  const id = Number(normalized.contentId);
  if (!id) return normalized;

  // Even when the bootstrap already supplied a usable backdrop, resolve the
  // official artwork once so an SC title logo can be recovered. Previously the
  // early return on customBackdrop meant the logo lookup was skipped entirely.
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

/** Shared Home Hero query with SC-only title-logo policy. */
export function useHeroData(initialHero: HeroSettings | null = null) {
  const profile = heroProfile();
  const viewport = heroViewport();
  const mediaFilter = forcedHeroMediaType();
  const candidate = initialHero?.contentId ? normalizeHero(initialHero) : bootstrappedHero();
  const hydrated = heroMatchesMediaType(candidate, mediaFilter) ? candidate : null;

  return useQuery<HeroSettings | null>({
    queryKey: ['hero-settings-v9-media-filter', profile, viewport, mediaFilter || 'all'],
    queryFn: async ({ signal }: any) => {
      try {
        const response = await fetch('/api/public/hero', {
          signal,
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });

        const data = response.ok ? await response.json() : null;
        if (data?.contentId && heroMatchesMediaType(data, mediaFilter)) {
          const normalized = await enrichHero(data, signal);
          if (typeof window !== 'undefined' && !mediaFilter) {
            (window as any).__flixitHomeHero = normalized;
          }
          return normalized;
        }

        if (mediaFilter) {
          const filtered = await filteredHeroFromHome(mediaFilter, signal);
          if (filtered?.contentId) return enrichHero(filtered, signal);
        }

        return enrichHero(hydrated, signal);
      } catch (error: any) {
        if (error?.name === 'AbortError') throw error;

        if (mediaFilter) {
          try {
            const filtered = await filteredHeroFromHome(mediaFilter, signal);
            if (filtered?.contentId) return enrichHero(filtered, signal);
          } catch {}
        }

        return enrichHero(hydrated, signal);
      }
    },
    initialData: hydrated?.contentId ? normalizeHero(hydrated) : undefined,
    initialDataUpdatedAt: hydrated?.contentId ? Date.now() : undefined,
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    retry: 1,
  });
}
