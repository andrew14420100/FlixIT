// @ts-nocheck
import { useQuery } from '@tanstack/react-query';

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

function bootstrappedHero() {
  if (typeof window === 'undefined') return null;
  const value = (window as any).__flixitHomeHero;
  return value?.contentId ? value : null;
}

/**
 * All Home Hero consumers share one React Query key. Previously the cache key
 * included the current Hero revision, so MainLayout helpers and HeroSection could
 * issue parallel /api/public/hero requests during the same refresh. A stable key
 * lets React Query coalesce them into one request while focus/reconnect still
 * revalidate Admin changes immediately.
 */
export function useHeroData(initialHero: HeroSettings | null = null) {
  const profile = heroProfile();
  const viewport = heroViewport();
  const hydrated = initialHero?.contentId ? initialHero : bootstrappedHero();

  return useQuery<HeroSettings | null>({
    queryKey: ['hero-settings-v5', profile, viewport],
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
        const normalized = {
          ...data,
          mediaType: data.mediaType || 'tv',
        };
        if (typeof window !== 'undefined') (window as any).__flixitHomeHero = normalized;
        return normalized;
      } catch {
        return hydrated || null;
      }
    },
    initialData: hydrated?.contentId
      ? {
          ...hydrated,
          mediaType: hydrated.mediaType || 'tv',
        }
      : undefined,
    initialDataUpdatedAt: hydrated?.contentId ? Date.now() : undefined,
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // If the Home bootstrap already supplied the Hero there is no reason to
    // duplicate that network request during the same mount. Returning to the
    // tab still revalidates because staleTime stays at zero.
    refetchOnMount: hydrated?.contentId ? false : 'always',
    retry: 1,
  });
}
