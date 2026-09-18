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
 * Hero data keeps the admin override contract intact. When the Netflix artwork
 * feature is enabled and the title is a safe Netflix-IT match, the resolver may
 * supply story art / title logo. customBackdrop still has absolute priority in
 * HeroSection because it is applied after this hook returns.
 */
export function useHeroData() {
  const profile = heroProfile();
  const viewport = heroViewport();

  return useQuery<HeroSettings | null>({
    queryKey: ['hero-settings', profile, viewport],
    queryFn: async () => {
      try {
        const response = await fetch('/api/public/hero');
        if (!response.ok) return null;
        const data = await response.json();

        if (!data?.contentId) return null;
        const mediaType = data.mediaType || 'tv';
        const base = { ...data, mediaType };

        try {
          const cfgResponse = await fetch('/api/player/artwork/config', { cache: 'no-store' });
          const cfg = cfgResponse.ok ? await cfgResponse.json() : { enabled: false };
          if (!cfg.enabled) return base;

          const params = new URLSearchParams({
            context: 'hero',
            viewport,
            profile_id: profile,
          });
          const artResponse = await fetch(
            `/api/player/artwork/${mediaType}/${data.contentId}?${params.toString()}`,
            { cache: 'no-store' }
          );
          if (!artResponse.ok) return base;
          const resolved = await artResponse.json();
          if (!resolved?.active) return base;

          const originalBackdrop = data?.detail?.backdrop_path || data?.assets?.backdrop_path || null;
          const originalLogo = data?.assets?.logo_path || null;
          return {
            ...base,
            detail: {
              ...(data.detail || {}),
              backdrop_path: resolved?.artwork?.url || originalBackdrop,
            },
            assets: {
              ...(data.assets || {}),
              backdrop_path: resolved?.artwork?.url || originalBackdrop,
              logo_path: resolved?.logo?.url || originalLogo,
              netflix_artwork: resolved,
              fallback_backdrop_path: originalBackdrop,
              fallback_logo_path: originalLogo,
            },
          };
        } catch {
          return base;
        }
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}
