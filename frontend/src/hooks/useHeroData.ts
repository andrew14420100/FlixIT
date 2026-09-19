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
 * Hero identity/detail/custom editorial fields come from /api/public/hero.
 * Visual assets deliberately do not: HeroSection must use the exact same unified
 * non-TMDB resolver as cards, Top 10 and Detail so provider choice/logo quality
 * never diverges between surfaces.
 */
export function useHeroData() {
  const profile = heroProfile();
  const viewport = heroViewport();

  return useQuery<HeroSettings | null>({
    queryKey: ['hero-settings-v2', profile, viewport],
    queryFn: async ({ signal }: any) => {
      try {
        const response = await fetch('/api/public/hero', {
          signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!data?.contentId) return null;
        const { assets: _legacyVisualAssets, ...editorial } = data;
        return {
          ...editorial,
          assets: null,
          mediaType: data.mediaType || 'tv',
        };
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
