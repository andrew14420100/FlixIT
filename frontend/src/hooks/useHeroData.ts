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

function hdrSupported() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try { return window.matchMedia('(dynamic-range: high)').matches; } catch { return false; }
}

async function attachResolvedTrailer(base: any) {
  if (!base?.contentId) return base;
  try {
    const mediaType = base.mediaType || 'tv';
    const response = await fetch(
      `/api/public/trailer/${mediaType}/${base.contentId}?hdr=${hdrSupported() ? 'true' : 'false'}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return base;
    const trailer = await response.json();
    // With the new resolver enabled, null really means "no trailer": never fall
    // back to a legacy YouTube key. When disabled, leave rollback data untouched.
    if (!trailer?.enabled) return base;
    const url = trailer?.available
      ? (trailer?.trailer_url || trailer?.trailer_key || trailer?.manifest_url || null)
      : null;
    return {
      ...base,
      assets: {
        ...(base.assets || {}),
        trailer_key: url,
        resolved_trailer: trailer,
      },
    };
  } catch {
    return base;
  }
}

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
        let base: any = { ...data, mediaType };

        try {
          const cfgResponse = await fetch('/api/player/artwork/config', { cache: 'no-store' });
          const cfg = cfgResponse.ok ? await cfgResponse.json() : { enabled: false };
          if (cfg.enabled) {
            const makeParams = (context: string) => new URLSearchParams({ context, viewport, profile_id: profile });
            const artResponse = await fetch(
              `/api/player/artwork/${mediaType}/${data.contentId}?${makeParams('hero').toString()}`,
              { cache: 'no-store' }
            );
            if (artResponse.ok) {
              const resolved = await artResponse.json();
              if (resolved?.active) {
                let manualLogo: any = null;
                try {
                  const logoResponse = await fetch(
                    `/api/player/artwork/${mediaType}/${data.contentId}?${makeParams('logo').toString()}`,
                    { cache: 'no-store' }
                  );
                  if (logoResponse.ok) {
                    const logoResolved = await logoResponse.json();
                    const candidate = logoResolved?.artwork;
                    if (candidate?.source === 'manual' && /logo/i.test(String(candidate?.type || ''))) manualLogo = candidate;
                  }
                } catch {}

                const originalBackdrop = data?.detail?.backdrop_path || data?.assets?.backdrop_path || null;
                const originalLogo = data?.assets?.logo_path || null;
                base = {
                  ...base,
                  detail: { ...(data.detail || {}), backdrop_path: resolved?.artwork?.url || originalBackdrop },
                  assets: {
                    ...(data.assets || {}),
                    backdrop_path: resolved?.artwork?.url || originalBackdrop,
                    logo_path: manualLogo?.url || resolved?.logo?.url || originalLogo,
                    netflix_artwork: resolved,
                    fallback_backdrop_path: originalBackdrop,
                    fallback_logo_path: originalLogo,
                  },
                };
              }
            }
          }
        } catch {}

        return await attachResolvedTrailer(base);
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
