// @ts-nocheck
/**
 * Runtime integrity guard installed before React/router code.
 *
 * - invalidates season payloads produced by old language policies;
 * - accepts only v10 VixSrc Italian-episode-catalog verdicts;
 * - removes account playback residue for guest sessions;
 * - invalidates fabricated legacy episode-completion history;
 * - removes the old truncated Home-v8 cache after the first upgraded bundle;
 * - converts HTTP-200 player failures into non-cacheable errors so the global
 *   player coalescer cannot pin a temporary source failure for two minutes.
 */

const FLAG = "__flixitRuntimeIntegrityV10";
const POLICY = "strict-it-v10-vixsrc-episode-catalog";
const COMPLETION_SCHEMA_KEY = "flixit-episode-completion-schema";
const COMPLETION_SCHEMA = "2";
const LEGACY_HOME_CACHE_KEY = "flix-home-bootstrap-v8-sc-logo-home-fixes";
const OLD_EPISODE_PREFIXES = [
  "flixit:it-episodes-v2:",
  "flixit:it-episodes-v3-audio-evidence:",
];
const SEASON_RE = /^\/api\/public\/tv\/\d+\/season\/\d+\/?$/;
const PLAYER_RE = /^\/api\/player\/(?:movie\/\d+|tv\/\d+\/\d+\/\d+)\/?$/;

function purgeLegacyAndGuestState() {
  if (typeof window === "undefined") return;
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

  try {
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

function confirmedItalianEpisode(episode: any) {
  return !!(
    episode &&
    episode.italian_available === true &&
    String(episode.italian_audio_status || "") === "italian" &&
    episode.italian_audio_evidence_explicit === true &&
    String(episode.italian_audio_policy_version || "") === POLICY
  );
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
      return response;
    }

    if (!response.ok || !SEASON_RE.test(url.pathname)) return response;

    try {
      const payload = await response.clone().json();
      if (!Array.isArray(payload?.episodes)) return response;
      return jsonResponse({
        ...payload,
        episodes: payload.episodes.filter(confirmedItalianEpisode),
        italian_audio_policy: "vixsrc_italian_episode_catalog",
        italian_audio_policy_version: POLICY,
      }, response);
    } catch {
      return new Response(JSON.stringify({
        episodes: [],
        italian_audio_policy: "vixsrc_italian_episode_catalog",
        italian_audio_policy_version: POLICY,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}

export {};
