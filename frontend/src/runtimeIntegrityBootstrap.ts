// @ts-nocheck
/**
 * Runtime integrity guard installed before React/router code.
 *
 * v14 keeps guest/account cleanup and rejects cacheable player failures, but the
 * backend is now authoritative for TV-season visibility.  The browser must not
 * filter a season down to only already-verified positives: unknown episodes are
 * intentionally visible while Italian-audio validation runs in the background.
 */

const FLAG = "__flixitRuntimeIntegrityV14";
const EPISODE_SCHEMA_KEY = "flixit-episode-audio-schema";
const EPISODE_SCHEMA = "14";
const COMPLETION_SCHEMA_KEY = "flixit-episode-completion-schema";
const COMPLETION_SCHEMA = "2";
const LEGACY_HOME_CACHE_KEY = "flix-home-bootstrap-v8-sc-logo-home-fixes";
const OLD_EPISODE_PREFIXES = [
  "flixit:it-episodes-v2:",
  "flixit:it-episodes-v3-audio-evidence:",
  "flixit:it-episodes-v12:",
  "flixit:it-episodes-v13:",
  "flixit:it-episodes-v14:",
];
const PLAYER_RE = /^\/api\/player\/(?:movie\/\d+|tv\/\d+\/\d+\/\d+)\/?$/;

function purgeLegacyAndGuestState() {
  if (typeof window === "undefined") return;

  try {
    if (window.localStorage.getItem(EPISODE_SCHEMA_KEY) !== EPISODE_SCHEMA) {
      for (const storage of [window.localStorage, window.sessionStorage]) {
        try {
          const remove: string[] = [];
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index) || "";
            if (OLD_EPISODE_PREFIXES.some((prefix) => key.startsWith(prefix))) remove.push(key);
          }
          remove.forEach((key) => storage.removeItem(key));
        } catch {}
      }
      window.localStorage.setItem(EPISODE_SCHEMA_KEY, EPISODE_SCHEMA);
    }

    window.localStorage.removeItem(LEGACY_HOME_CACHE_KEY);

    if (window.localStorage.getItem(COMPLETION_SCHEMA_KEY) !== COMPLETION_SCHEMA) {
      const removeCompletion: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index) || "";
        if (key.startsWith("flixit-completed-episodes:")) removeCompletion.push(key);
      }
      removeCompletion.forEach((key) => window.localStorage.removeItem(key));
      window.localStorage.setItem(COMPLETION_SCHEMA_KEY, COMPLETION_SCHEMA);
    }

    if (!window.localStorage.getItem("user_token")) {
      window.localStorage.removeItem("netflix_continue_watching");
      window.localStorage.removeItem("netflix_username");
      const removeSession: string[] = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index) || "";
        if (
          key.startsWith("watch_stream_cache:") ||
          key.startsWith("stream:") ||
          key.startsWith("stream_") ||
          key.startsWith("stream-")
        ) removeSession.push(key);
      }
      removeSession.forEach((key) => window.sessionStorage.removeItem(key));
    }
  } catch {}
}

function jsonResponse(payload: any, source: Response, status = source.status) {
  const headers = new Headers(source.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  return new Response(JSON.stringify(payload), {
    status,
    statusText: status === source.status ? source.statusText : "Temporary player failure",
    headers,
  });
}

if (typeof window !== "undefined" && !(window as any)[FLAG]) {
  (window as any)[FLAG] = true;
  purgeLegacyAndGuestState();

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: any, init?: RequestInit) => {
    const response = await nativeFetch(input, init);

    let url: URL;
    try {
      const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      url = new URL(raw, window.location.origin);
    } catch {
      return response;
    }

    const method = String(init?.method || (typeof input === "object" ? input?.method : "GET") || "GET").toUpperCase();
    if (method !== "GET" || url.origin !== window.location.origin) return response;

    if (PLAYER_RE.test(url.pathname) && response.ok) {
      try {
        const payload = await response.clone().json();
        if (payload?.success !== true || !String(payload?.stream || "").trim()) {
          return jsonResponse({
            ...payload,
            detail: payload?.detail || payload?.message || "Stream temporaneamente non disponibile",
          }, response, 503);
        }
      } catch {
        return jsonResponse({ detail: "Risposta player non valida" }, response, 502);
      }
    }

    // TV-season responses pass through unchanged.  The v14 backend route already
    // hides definitive negatives and deliberately keeps validation-pending rows
    // visible so the episode panel is never empty just because VixSrc is slow.
    return response;
  };
}

export {};
