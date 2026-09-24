// @ts-nocheck
import { nonTmdbImageUrl } from "src/hooks/useAutomaticMediaAssets";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const WATCH_STREAM_CACHE_PREFIX = "watch_stream_cache:";

export const DETAIL_TABS = [
  { id: "overview", label: "Panoramica" },
  { id: "episodes", label: "Episodi", tvOnly: true },
  { id: "trailers", label: "Trailer & altro" },
  { id: "download", label: "Scarica" },
  { id: "similar", label: "Titoli simili" },
];

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
  const safe = Number(minutes || 0);
  if (!safe) return "";
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${safe} min`;
}

export function secondsText(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  if (safe >= 3600) {
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    return `${hours} h${minutes ? ` ${minutes} min` : ""}`;
  }
  return `${Math.max(1, Math.ceil(safe / 60))} min`;
}

export function formatCertification(value: any) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^\d{1,2}$/.test(text) ? `${text}+` : text;
}

export function directTrailerUrl(value: any) {
  const raw = typeof value === "string"
    ? value
    : value?.url || value?.trailer_url || value?.manifest_url || value?.stream_url;
  const text = String(raw || "").trim();
  return /^https?:\/\//i.test(text) || text.startsWith("/") ? text : null;
}

function cacheResolvedStream(typeSlug: string, id: number, season: number, episode: number, payload: any) {
  if (!payload?.success || !payload?.stream) return;
  try {
    sessionStorage.setItem(
      `${WATCH_STREAM_CACHE_PREFIX}${typeSlug}:${id}:${typeSlug === "tv" ? season || 1 : 0}:${typeSlug === "tv" ? episode || 1 : 0}`,
      JSON.stringify({ stream: payload.stream, type: payload.type || "hls", source: payload.source, savedAt: Date.now() })
    );
  } catch {}
}

export async function warmPlayback(typeSlug: string, id: number, season = 1, episode = 1) {
  if (!id) return;
  const path = typeSlug === "tv"
    ? `${API_URL}/api/player/tv/${id}/${season}/${episode}`
    : `${API_URL}/api/player/movie/${id}`;
  try {
    const response = await fetch(path, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return;
    cacheResolvedStream(typeSlug, id, season, episode, await response.json());
  } catch {}
}
