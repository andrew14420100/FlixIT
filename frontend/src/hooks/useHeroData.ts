// @ts-nocheck
import { useQuery } from '@tanstack/react-query';

interface HeroSettings {
  contentId: string;
  customTitle: string | null;
  customDescription: string | null;
  customBackdrop: string | null;
  seasonLabel: string | null;
  mediaType: 'movie' | 'tv';
  detail?: any;
  assets?: any;
}

function heroProfile() {
  if (typeof window === 'undefined') return 'guest';
  return localStorage.getItem('netflix_user_id') || 'guest';
}

function heroViewport() {
  if (typeof window === 'undefined') return 'desktop';
  return window.innerWidth < 700 ? 'mobile' : 'desktop';
}

/**
 * Hero identity/detail/assets come from the public automatic backend cache.
 * Trailer playback has its own shared React Query key inside HeroSection, so
 * this hook deliberately does not issue duplicate trailer/artwork/admin calls.
 */
export function useHeroData() {
  const profile = heroProfile();
  const viewport = heroViewport();

  return useQuery<HeroSettings | null>({
    queryKey: ['hero-settings', profile, viewport],
    queryFn: async ({ signal }: any) => {
      try {
        const response = await fetch('/api/public/hero', {
          signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!data?.contentId) return null;
        return { ...data, mediaType: data.mediaType || 'tv' };
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: 1,
  });
}
