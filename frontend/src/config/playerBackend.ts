// Backend Node.js pubblico usato esclusivamente per risolvere gli stream del player.
// In Create React App REACT_APP_* viene letto al build; il fallback permette di
// usare subito il tunnel ngrok corrente senza dipendere dal backend Python FlixIT.
const DEFAULT_PLAYER_BACKEND_URL = "https://district-caddy-nibble.ngrok-free.dev";

export const PLAYER_BACKEND_URL = String(
  process.env.REACT_APP_PLAYER_BACKEND_URL || DEFAULT_PLAYER_BACKEND_URL
).replace(/\/+$/, "");

export const PLAYER_BACKEND_HEADERS = {
  Accept: "application/json",
  "ngrok-skip-browser-warning": "true",
};

export function playerResolveUrl(
  mediaType: string,
  tmdbId: number | string,
  season?: number | string,
  episode?: number | string
) {
  if (mediaType === "tv") {
    return `${PLAYER_BACKEND_URL}/api/player/tv/${encodeURIComponent(String(tmdbId))}/${encodeURIComponent(String(season || 1))}/${encodeURIComponent(String(episode || 1))}`;
  }
  return `${PLAYER_BACKEND_URL}/api/player/movie/${encodeURIComponent(String(tmdbId))}`;
}

export function inferPlayerStreamType(streamUrl: string, backendType?: string) {
  const explicit = String(backendType || "").toLowerCase();
  if (explicit.includes("hls") || explicit.includes("m3u8")) return "hls";
  if (/\.m3u8(?:[?#]|$)/i.test(String(streamUrl || ""))) return "hls";
  return explicit || "video";
}
