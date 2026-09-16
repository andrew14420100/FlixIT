// @ts-nocheck
import { useMemo } from 'react';
import { useGetConfigurationQuery } from 'src/store/slices/configuration';
import { getImageUrl, getCDNImageUrl, hasCDNMapping } from 'src/config/cdnMapping';

interface UseCDNImageOptions {
  tmdbId: number;
  posterPath?: string | null;
  backdropPath?: string | null;
  useDetailBackdrop?: boolean;  // Usa detail_backdrop invece di backdrop
}

interface UseCDNImageReturn {
  posterUrl: string;
  backdropUrl: string;
  hasCDN: boolean;
  getPosterUrl: (size?: string) => string;
  getBackdropUrl: (size?: string) => string;
}

/**
 * Hook per ottenere le URL delle immagini con priorità CDN
 * Se l'immagine è disponibile sulla CDN di Streaming Community, usa quella
 * Altrimenti fa fallback a TMDB
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
    return (size: string = 'w500') => {
      return getImageUrl(tmdbId, 'poster', posterPath || null, tmdbBaseUrl, size);
    };
  }, [tmdbId, posterPath, tmdbBaseUrl]);

  const getBackdropUrl = useMemo(() => {
    return (size: string = 'w780') => {
      const backdropType = useDetailBackdrop ? 'detail_backdrop' : 'backdrop';
      return getImageUrl(tmdbId, backdropType, backdropPath || null, tmdbBaseUrl, size);
    };
  }, [tmdbId, backdropPath, tmdbBaseUrl, useDetailBackdrop]);

  const posterUrl = useMemo(() => getPosterUrl('w500'), [getPosterUrl]);
  const backdropUrl = useMemo(() => getBackdropUrl('w780'), [getBackdropUrl]);

  return {
    posterUrl,
    backdropUrl,
    hasCDN,
    getPosterUrl,
    getBackdropUrl,
  };
}

/**
 * Funzione helper per ottenere l'URL dell'immagine senza hook
 * Utile per componenti che non possono usare hooks
 */
export function getMediaImageUrl(
  tmdbId: number,
  type: 'poster' | 'backdrop' | 'detail_backdrop',
  tmdbPath: string | null,
  tmdbBaseUrl: string = 'https://image.tmdb.org/t/p/',
  size: string = 'w500'
): string {
  // Prima controlla se c'è un mapping CDN
  const cdnUrl = getCDNImageUrl(tmdbId, type);
  if (cdnUrl) {
    return cdnUrl;
  }
  
  // Fallback a TMDB
  if (tmdbPath) {
    return `${tmdbBaseUrl}${size}${tmdbPath}`;
  }
  
  return '/placeholder.jpg';
}

export default useCDNImage;
