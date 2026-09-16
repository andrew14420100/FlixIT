// @ts-nocheck
import { useQuery } from '@tanstack/react-query';

interface HeroSettings {
  contentId: string;
  customTitle: string | null;
  customDescription: string | null;
  customBackdrop: string | null;
  seasonLabel: string | null;
  mediaType: 'movie' | 'tv';
}

/**
 * ✅ OPTIMIZED: Custom hook for Hero data with persistent caching
 * - Caches hero data for 5 minutes
 * - Prevents duplicate fetches
 * - Returns cached data instantly on navigation back
 */
export function useHeroData() {
  return useQuery<HeroSettings | null>({
    queryKey: ['hero-settings'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/public/hero');
        if (!response.ok) return null;
        const data = await response.json();
        
        if (data && data.contentId) {
          return {
            ...data,
            mediaType: data.mediaType || 'tv',
          };
        }
        return null;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - data stays fresh
    gcTime: 10 * 60 * 1000, // 10 minutes - cache persists
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnMount: false, // Don't refetch on component remount
  });
}
