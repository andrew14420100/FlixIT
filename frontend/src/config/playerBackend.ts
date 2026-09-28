// Backend Node.js pubblico usato esclusivamente per risolvere gli stream del player.
// In Create React App REACT_APP_* viene letto al build; il fallback permette di
// usare subito il tunnel ngrok corrente senza dipendere dal backend Python FlixIT.
const DEFAULT_PLAYER_BACKEND_URL = "https://district-caddy-nibble.ngrok-free.dev";
const PLAYER_PATH_RE = /^\/api\/player\/(movie|tv)\//i;
const BRIDGE_FLAG = "__flixitNgrokPlayerBridgeInstalled";

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

function isLocalPlayerRequest(url: URL) {
  if (typeof window === "undefined") return false;
  return url.origin === window.location.origin && PLAYER_PATH_RE.test(url.pathname);
}

function mergedHeaders(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  Object.entries(PLAYER_BACKEND_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return headers;
}

async function normalizePlayerResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return response;

  let data: any;
  try {
    data = await response.clone().json();
  } catch {
    return response;
  }

  const streamUrl = data?.streamUrl || data?.stream_url || data?.stream;
  if (!streamUrl) return response;

  const normalized = {
    ...data,
    success: data?.success !== false,
    streamUrl,
    stream: streamUrl,
    type: inferPlayerStreamType(streamUrl, data?.type || data?.streamType),
    source: data?.source || "node-ngrok",
  };

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(normalized), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Compatibilità trasparente con il frontend FlixIT esistente.
 * Tutte le fetch locali a /api/player/... vengono inviate al backend Node ngrok,
 * con l'header che salta la warning page di ngrok. La risposta { streamUrl }
 * viene normalizzata anche come { stream } così WatchPage e il player HLS
 * continuano a funzionare senza cambiare la UI, il resume o Continue Watching.
 */
export function installNgrokPlayerBridge() {
  if (typeof window === "undefined" || (window as any)[BRIDGE_FLAG]) return;
  (window as any)[BRIDGE_FLAG] = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let originalUrl: URL;
    try {
      const raw = input instanceof Request ? input.url : String(input);
      originalUrl = new URL(raw, window.location.origin);
    } catch {
      return nativeFetch(input as any, init);
    }

    if (!isLocalPlayerRequest(originalUrl)) {
      return nativeFetch(input as any, init);
    }

    const targetUrl = `${PLAYER_BACKEND_URL}${originalUrl.pathname}${originalUrl.search}`;
    const requestInit: RequestInit = {
      ...(input instanceof Request
        ? {
            method: input.method,
            mode: input.mode,
            credentials: input.credentials,
            cache: input.cache,
            redirect: input.redirect,
            referrer: input.referrer,
            referrerPolicy: input.referrerPolicy,
            integrity: input.integrity,
            keepalive: input.keepalive,
            signal: input.signal,
          }
        : {}),
      ...(init || {}),
      headers: mergedHeaders(input, init),
    };

    const response = await nativeFetch(targetUrl, requestInit);
    return normalizePlayerResponse(response);
  };
}

installNgrokPlayerBridge();
