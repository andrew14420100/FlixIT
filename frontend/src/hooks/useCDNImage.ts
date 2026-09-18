// @ts-nocheck
import { useMemo } from 'react';
import { useGetConfigurationQuery } from 'src/store/slices/configuration';
import { getCDNImageUrl, hasCDNMapping } from 'src/config/cdnMapping';

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

function directImageUrl(
  tmdbId: number,
  type: 'poster' | 'backdrop' | 'detail_backdrop',
  tmdbPath: string | null | undefined,
  tmdbBaseUrl: string,
  size: string
) {
  // Automatic TMDB metadata is the normal source of truth. This path needs no
  // admin match/session and supports original-resolution artwork.
  if (tmdbPath) {
    if (/^https?:\/\//i.test(tmdbPath)) return tmdbPath;
    return `${tmdbBaseUrl}${size}${tmdbPath}`;
  }

  // Old static CDN mappings remain only as a compatibility fallback when TMDB
  // has no image path at all. They never replace a valid automatic asset.
  return getCDNImageUrl(tmdbId, type) || '/placeholder.jpg';
}

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
    return (size: string = 'w780') =>
      directImageUrl(tmdbId, 'poster', posterPath, tmdbBaseUrl, size);
  }, [tmdbId, posterPath, tmdbBaseUrl]);

  const getBackdropUrl = useMemo(() => {
    return (size: string = 'original') => {
      const backdropType = useDetailBackdrop ? 'detail_backdrop' : 'backdrop';
      return directImageUrl(tmdbId, backdropType, backdropPath, tmdbBaseUrl, size);
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

export function getMediaImageUrl(
  tmdbId: number,
  type: 'poster' | 'backdrop' | 'detail_backdrop',
  tmdbPath: string | null,
  tmdbBaseUrl: string = 'https://image.tmdb.org/t/p/',
  size: string = 'w780'
): string {
  const effectiveSize = type === 'poster' ? size : 'original';
  return directImageUrl(tmdbId, type, tmdbPath, tmdbBaseUrl, effectiveSize);
}

export default useCDNImage;
