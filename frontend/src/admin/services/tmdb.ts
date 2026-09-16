// @ts-nocheck
import type { TMDBSearchResult } from '../types';

const TMDB_API_KEY = process.env.REACT_APP_TMDB_V3_API_KEY || "4f153630f8d7e92d542dde3a38fbddf2";
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export interface TMDBLogo {
  aspect_ratio: number;
  file_path: string;
  height: number;
  width: number;
}

export interface TMDBImages {
  logos: TMDBLogo[];
  backdrops: Array<{ file_path: string; aspect_ratio: number }>;
  posters: Array<{ file_path: string; aspect_ratio: number }>;
}

export const tmdbService = {
  async getDetails(tmdbId: number, type: 'movie' | 'tv'): Promise<TMDBSearchResult | null> {
    try {
      const response = await fetch(
        `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=it-IT`
      );
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  },

  async getImages(tmdbId: number, type: 'movie' | 'tv'): Promise<TMDBImages | null> {
    try {
      const response = await fetch(
        `${TMDB_BASE_URL}/${type}/${tmdbId}/images?api_key=${TMDB_API_KEY}&include_image_language=it,en,null`
      );
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  },

  async search(query: string, type: 'movie' | 'tv'): Promise<TMDBSearchResult[]> {
    try {
      const response = await fetch(
        `${TMDB_BASE_URL}/search/${type}?api_key=${TMDB_API_KEY}&language=it-IT&query=${encodeURIComponent(query)}&page=1`
      );
      if (!response.ok) return [];
      const data = await response.json();
      return data.results || [];
    } catch {
      return [];
    }
  },

  async getPopular(type: 'movie' | 'tv', page = 1): Promise<TMDBSearchResult[]> {
    try {
      const response = await fetch(
        `${TMDB_BASE_URL}/${type}/popular?api_key=${TMDB_API_KEY}&language=it-IT&page=${page}`
      );
      if (!response.ok) return [];
      const data = await response.json();
      return data.results || [];
    } catch {
      return [];
    }
  },

  async getTrending(type: 'movie' | 'tv' | 'all' = 'all', timeWindow: 'day' | 'week' = 'week'): Promise<TMDBSearchResult[]> {
    try {
      const response = await fetch(
        `${TMDB_BASE_URL}/trending/${type}/${timeWindow}?api_key=${TMDB_API_KEY}&language=it-IT`
      );
      if (!response.ok) return [];
      const data = await response.json();
      return data.results || [];
    } catch {
      return [];
    }
  },

  getImageUrl(path: string | null | undefined, size: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w500'): string {
    if (!path) return 'https://via.placeholder.com/200x300/1a1a1a/666666?text=No+Image';
    return `https://image.tmdb.org/t/p/${size}${path}`;
  },

  getBackdropUrl(path: string | null | undefined, size: 'w300' | 'w780' | 'w1280' | 'original' = 'w1280'): string {
    if (!path) return 'https://via.placeholder.com/1280x720/1a1a1a/666666?text=No+Image';
    return `https://image.tmdb.org/t/p/${size}${path}`;
  },

  getLogoUrl(path: string | null | undefined, size: 'w92' | 'w154' | 'w185' | 'w300' | 'w500' | 'original' = 'w500'): string {
    if (!path) return '';
    return `https://image.tmdb.org/t/p/${size}${path}`;
  },
};

export default tmdbService;
