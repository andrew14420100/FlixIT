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

function bootstrappedHero() {
  if (typeof window === 'undefined') return null;
  const value = (window as any).__flixitHomeHero;
  return value?.contentId ? value : null;
}

/**
 * The Home bootstrap hydrates the hero inline so opening Home does not start a
 * second request. Detail/navigation pages can still use this hook standalone.
 */
export function useHeroData(initialHero: HeroSettings | null = null) {
  const profile = heroProfile();
  const viewport = heroViewport();
  const hydrated = initialHero?.contentId ? initialHero : bootstrappedHero();

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
    initialData: hydrated?.contentId
      ? {
          ...hydrated,
          mediaType: hydrated.mediaType || 'tv',
        }
      : undefined,
    initialDataUpdatedAt: hydrated?.contentId ? Date.now() : undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: 1,
  });
}
