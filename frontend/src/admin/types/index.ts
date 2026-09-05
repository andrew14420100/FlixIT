// @ts-nocheck
// Admin Types

export interface AdminUser {
  email: string;
  role: 'superadmin';
}

export interface Content {
  _id?: string;
  tmdbId: number;
  type: 'movie' | 'tv';
  available: boolean;
  availableSeason: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentWithTMDB extends Content {
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
}

export interface HeroSettings {
  contentId: string;
  mediaType?: 'movie' | 'tv';
  customTitle: string | null;
  customDescription: string | null;
  customBackdrop: string | null;
  seasonLabel: string | null;
  updatedAt?: string;
}

export interface Section {
  name: string;
  apiString: string;
  mediaType: 'movie' | 'tv';
  active: boolean;
  order: number;
  createdAt?: string;
}

export interface AdminLog {
  action: string;
  contentId?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardStats {
  total: number;
  movies: number;
  tvShows: number;
  visible: number;
  hidden: number;
  lastAdded: Content | null;
  currentHero: HeroSettings | null;
}

export interface TMDBSearchResult {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ApiError {
  detail: string;
  status?: number;
}
