// @ts-nocheck
/**
 * FlixIT Detail Page v2 - pure helpers (no React, no DOM layout logic).
 */
import { nonTmdbImageUrl } from "src/hooks/useAutomaticMediaAssets";

export const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const STREAM_CACHE_PREFIX = "watch_stream_cache:";

export const MOVIE_TABS = [
  { id: "overview", label: "Panoramica" },
  { id: "trailers", label: "Trailer & altro" },
  { id: "download", label: "Scarica" },
  { id: "similar", label: "Titoli simili" },
];

export const TV_TABS = [
  { id: "overview", label: "Panoramica" },
  { id: "episodes", label: "Episodi" },
  { id: "trailers", label: "Trailer & altro" },
  { id: "similar", label: "Titoli simili" },
];

export function detailTabsFor(isTV: boolean) {
  return isTV ? TV_TABS : MOVIE_TABS;
}

export const MOVIE_GENRES: Record<number, string> = {
  28: "Azione",
  12: "Avventura",
  16: "Animazione",
  35: "Commedia",
  80: "Crime",
  99: "Documentario",
  18: "Dramma",
  10751: "Famiglia",
  14: "Fantasy",
  36: "Storia",
  27: "Horror",
  10402: "Musica",
  9648: "Mistero",
  10749: "Romance",
  878: "Fantascienza",
  10770: "Film TV",
  53: "Thriller",
  10752: "Guerra",
  37: "Western",
};

export const TV_GENRES: Record<number, string> = {
  10759: "Azione e avventura",
  16: "Animazione",
  35: "Commedia",
  80: "Crime",
  99: "Documentario",
  18: "Dramma",
  10751: "Famiglia",
  10762: "Kids",
  9648: "Mistero",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi e Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "Guerra e politica",
  37: "Western",
};

export function genreNameFromIds(ids: any, typeSlug: string) {
  if (!Array.isArray(ids)) return "";
  const table = typeSlug === "tv" ? TV_GENRES : MOVIE_GENRES;
  for (const id of ids) {
    const name = table[Number(id)];
    if (name) return name;
  }
  return "";
}

/** First usable non-TMDB artwork URL (project policy: only CDN/official artwork). */
export function artUrl(...values: any[]) {
  for (const value of values) {
    const resolved = nonTmdbImageUrl(value);
    if (resolved) return resolved;
  }
  return null;
}

export function yearFrom(detail: any) {
  const raw = detail?.release_date || detail?.first_air_date || "";
  return raw ? String(raw).slice(0, 4) : "";
}

export function seasonsText(count: number) {
  const safe = Number(count || 0);
  if (!safe) return "";
  return `${safe} ${safe === 1 ? "stagione" : "stagioni"}`;
}

export function runtimeText(minutes: number) {
  const safe = Math.round(Number(minutes || 0));
  if (!safe) return "";
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${safe} min`;
}

/** "52 min" / "1 h 12 min" for a remaining-time label. */
export function remainingText(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  if (safe >= 3600) {
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    return `${hours} h${minutes ? ` ${minutes} min` : ""}`;
  }
  return `${Math.max(1, Math.ceil(safe / 60))} min`;
}

/** "2:24" style clock text for trailer durations. */
export function clockText(seconds: number) {
  const safe = Math.max(0, Math.round(Number(seconds || 0)));
  if (!safe) return "";
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  const mm = hours ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours ? `${hours}:` : ""}${mm}:${String(rest).padStart(2, "0")}`;
}

export function formatCertification(value: any) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^\d{1,2}$/.test(text) ? `${text}+` : text;
}

function isYouTubeUrl(text: string) {
  try {
    const host = new URL(text, "https://flixit.local").hostname.toLowerCase();
    return /(^|\.)youtube(-nocookie)?\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host);
  } catch {
    return false;
  }
}

/** Only direct http(s)/root-relative media URLs are playable by TrailerPlayer. */
export function directTrailerUrl(value: any) {
  const raw = typeof value === "string"
    ? value
    : value?.url || value?.trailer_url || value?.manifest_url || value?.stream_url;
  const text = String(raw || "").trim();
  if (!text) return null;
  if (!(/^https?:\/\//i.test(text) || text.startsWith("/"))) return null;
  if (isYouTubeUrl(text)) return null;
  return text;
}

export function isHlsUrl(url: string) {
  return /\.m3u8(\?|$)/i.test(String(url || ""));
}

function cacheResolvedStream(typeSlug: string, id: number, season: number, episode: number, payload: any) {
  if (!payload?.success || !payload?.stream) return;
  const isTV = typeSlug === "tv";
  const key = `${STREAM_CACHE_PREFIX}${isTV ? "tv" : "movie"}:${id}:${isTV ? season || 1 : 0}:${isTV ? episode || 1 : 0}`;
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ stream: payload.stream, type: payload.type || "hls", source: payload.source, savedAt: Date.now() })
    );
  } catch { /* storage unavailable */ }
}

/** Pre-resolve the stream on hover/click so WatchPage can start immediately. */
export async function warmPlayback(typeSlug: string, id: number, season = 1, episode = 1) {
  if (!id) return;
  const path = typeSlug === "tv"
    ? `${API_URL}/api/player/tv/${id}/${season || 1}/${episode || 1}`
    : `${API_URL}/api/player/movie/${id}`;
  try {
    const response = await fetch(path, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return;
    cacheResolvedStream(typeSlug, id, season, episode, await response.json());
  } catch { /* network warm-up is best effort */ }
}
