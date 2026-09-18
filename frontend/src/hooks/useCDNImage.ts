// @ts-nocheck
import { useMemo } from 'react';
import { useGetConfigurationQuery } from 'src/store/slices/configuration';
import { getImageUrl, getCDNImageUrl, hasCDNMapping } from 'src/config/cdnMapping';

interface UseCDNImageOptions {
  tmdbId: number;
  posterPath?: string | null;
  backdropPath?: string | null;
  useDetailBackdrop?: boolean;
}

interface UseCDNImageReturn {
  posterUrl: string;
  backdropUrl: string;
  hasCDN: boolean;
  getPosterUrl: (size?: string) => string;
  getBackdropUrl: (size?: string) => string;
}

/**
 * Shared high-quality image URL helper. Existing CDN mappings remain the fast
 * first choice; TMDB fallbacks now keep enough native resolution for retina
 * cards and use the original source for Hero/Detail backdrops.
 */
export function useCDNImage({
  tmdbId,
  posterPath,
  backdropPath,
  useDetailBackdrop = false,
}: UseCDNImageOptions): UseCDNImageReturn {
  const { data: configuration } = useGetConfigurationQuery(undefined);
  const tmdbBaseUrl = configuration?.images.base_url || 'https://image.tmdb.org/t/p/';

  const hasCDN = useMemo(() => hasCDNMapping(tmdbId), [tmdbId]);

  const getPosterUrl = useMemo(() => {
    return (size: string = 'w780') => {
      return getImageUrl(tmdbId, 'poster', posterPath || null, tmdbBaseUrl, size);
    };
  }, [tmdbId, posterPath, tmdbBaseUrl]);

  const getBackdropUrl = useMemo(() => {
    return (size: string = 'original') => {
      const backdropType = useDetailBackdrop ? 'detail_backdrop' : 'backdrop';
      return getImageUrl(tmdbId, backdropType, backdropPath || null, tmdbBaseUrl, size);
    };
  }, [tmdbId, backdropPath, tmdbBaseUrl, useDetailBackdrop]);

  const posterUrl = useMemo(() => getPosterUrl('w780'), [getPosterUrl]);
  const backdropUrl = useMemo(() => getBackdropUrl('original'), [getBackdropUrl]);

  return {
    posterUrl,
    backdropUrl,
    hasCDN,
    getPosterUrl,
    getBackdropUrl,
  };
}

/** Helper for components that cannot use hooks. */
export function getMediaImageUrl(
  tmdbId: number,
  type: 'poster' | 'backdrop' | 'detail_backdrop',
  tmdbPath: string | null,
  tmdbBaseUrl: string = 'https://image.tmdb.org/t/p/',
  size: string = 'w500'
): string {
  const cdnUrl = getCDNImageUrl(tmdbId, type);
  if (cdnUrl) {
    return cdnUrl;
  }

  if (tmdbPath) {
    const effectiveSize = type === 'detail_backdrop' ? 'original' : size;
    return `${tmdbBaseUrl}${effectiveSize}${tmdbPath}`;
  }

  return '/placeholder.jpg';
}

export default useCDNImage;
