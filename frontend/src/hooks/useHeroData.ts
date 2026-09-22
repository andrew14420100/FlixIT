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

function heroRevision(hero: HeroSettings | null | undefined) {
  if (!hero?.contentId) return 'standalone';
  return [
    hero.updatedAt || '',
    hero.contentId || '',
    hero.mediaType || '',
    hero.customTitle || '',
    hero.customDescription || '',
    hero.customBackdrop || '',
    hero.seasonLabel || '',
  ].join('|');
}

/**
 * Home supplies the current Hero inline through the bootstrap payload. The
 * revision is part of the query key so an admin change can never be masked by
 * the previous React Query entry. Assets returned by the backend are preserved:
 * this is important for the SC logo/backdrop selected for the Hero.
 */
export function useHeroData(initialHero: HeroSettings | null = null) {
  const profile = heroProfile();
  const viewport = heroViewport();
  const hydrated = initialHero?.contentId ? initialHero : bootstrappedHero();
  const revision = heroRevision(hydrated);

  return useQuery<HeroSettings | null>({
    queryKey: ['hero-settings-v3', profile, viewport, revision],
    queryFn: async ({ signal }: any) => {
      try {
        const response = await fetch('/api/public/hero', {
          signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!data?.contentId) return null;
        return {
          ...data,
          mediaType: data.mediaType || 'tv',
        };
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
    staleTime: hydrated?.contentId ? 10 * 60 * 1000 : 0,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: !hydrated,
    refetchOnReconnect: !hydrated,
    refetchOnMount: hydrated ? false : 'always',
    retry: 1,
  });
}
