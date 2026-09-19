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

function imageUrl(
  tmdbId: number,
  type: 'poster' | 'backdrop' | 'detail_backdrop',
  tmdbPath: string | null | undefined,
  tmdbBaseUrl: string,
  _size: string
) {
  // Restore the cover system used before the TMDB-primary migration: whenever
  // FLIX-IT already has a curated/mapped cover, that image wins.
  const mapped = getCDNImageUrl(tmdbId, type);
  if (mapped) return mapped;

  // TMDB is only the final compatibility fallback for titles that have no
  // curated/Netflix-style cover at all. Keep the fallback at native quality.
  if (tmdbPath) {
    const raw = String(tmdbPath);
    const absoluteTmdb = raw.match(
      /^https:\/\/image\.tmdb\.org\/t\/p\/(?:original|w\d+)(\/.*)$/i
    );
    if (absoluteTmdb) {
      return `https://image.tmdb.org/t/p/original${absoluteTmdb[1]}`;
    }
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${tmdbBaseUrl}original${raw.startsWith('/') ? raw : `/${raw}`}`;
  }

  return '/placeholder.jpg';
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
    return (_size: string = 'original') =>
      imageUrl(tmdbId, 'poster', posterPath, tmdbBaseUrl, 'original');
  }, [tmdbId, posterPath, tmdbBaseUrl]);

  const getBackdropUrl = useMemo(() => {
    return (_size: string = 'original') => {
      const backdropType = useDetailBackdrop ? 'detail_backdrop' : 'backdrop';
      return imageUrl(tmdbId, backdropType, backdropPath, tmdbBaseUrl, 'original');
    };
  }, [tmdbId, backdropPath, tmdbBaseUrl, useDetailBackdrop]);

  const posterUrl = useMemo(() => getPosterUrl('original'), [getPosterUrl]);
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
  _size: string = 'original'
): string {
  return imageUrl(tmdbId, type, tmdbPath, tmdbBaseUrl, 'original');
}

export default useCDNImage;
