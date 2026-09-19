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
  _size: string
) {
  // Always request the native/original TMDB file. Legacy absolute TMDB URLs can
  // already contain w342/w500/w780/w1280, so normalize those URLs as well.
  // Non-TMDB remote URLs are left untouched: no artificial upscaling is done.
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
    return (_size: string = 'original') =>
      directImageUrl(tmdbId, 'poster', posterPath, tmdbBaseUrl, 'original');
  }, [tmdbId, posterPath, tmdbBaseUrl]);

  const getBackdropUrl = useMemo(() => {
    return (_size: string = 'original') => {
      const backdropType = useDetailBackdrop ? 'detail_backdrop' : 'backdrop';
      return directImageUrl(tmdbId, backdropType, backdropPath, tmdbBaseUrl, 'original');
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
  return directImageUrl(tmdbId, type, tmdbPath, tmdbBaseUrl, 'original');
}

export default useCDNImage;
