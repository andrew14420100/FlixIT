// @ts-nocheck
import { useMemo } from 'react';
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

function nonTmdbRemote(value: string | null | undefined) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  if (!/^https?:\/\//i.test(raw)) return null;
  if (/^https?:\/\/image\.tmdb\.org\//i.test(raw)) return null;
  return raw;
}

function imageUrl(
  tmdbId: number,
  type: 'poster' | 'backdrop' | 'detail_backdrop',
  existingPath: string | null | undefined
) {
  // Historical FlixIT mapping is the first fallback after Netflix artwork.
  const mapped = getCDNImageUrl(tmdbId, type);
  if (mapped) return mapped;

  // Only already-resolved non-TMDB remote assets are accepted. Relative TMDB
  // paths and image.tmdb.org URLs are deliberately ignored site-wide.
  return nonTmdbRemote(existingPath) || '/placeholder.jpg';
}

export function useCDNImage({
  tmdbId,
  posterPath,
  backdropPath,
  useDetailBackdrop = false,
}: UseCDNImageOptions): UseCDNImageReturn {
  const hasCDN = useMemo(() => hasCDNMapping(tmdbId), [tmdbId]);

  const getPosterUrl = useMemo(() => {
    return (_size: string = 'original') => imageUrl(tmdbId, 'poster', posterPath);
  }, [tmdbId, posterPath]);

  const getBackdropUrl = useMemo(() => {
    return (_size: string = 'original') => {
      const backdropType = useDetailBackdrop ? 'detail_backdrop' : 'backdrop';
      return imageUrl(tmdbId, backdropType, backdropPath);
    };
  }, [tmdbId, backdropPath, useDetailBackdrop]);

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
  existingPath: string | null,
  _tmdbBaseUrl: string = '',
  _size: string = 'original'
): string {
  return imageUrl(tmdbId, type, existingPath);
}

export default useCDNImage;
