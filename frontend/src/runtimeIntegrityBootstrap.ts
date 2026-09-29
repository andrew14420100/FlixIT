// @ts-nocheck
/**
 * Runtime integrity guard installed before React/router code.
 *
 * 1) Invalidates browser season payloads produced by older permissive language
 *    policies.
 * 2) Fails closed on the public season endpoint as a final client-side defence:
 *    only v9 rows carrying explicit Italian-audio evidence reach any consumer.
 * 3) Removes account playback residue when the browser has no authenticated
 *    token, so guest sessions cannot resume another user's local state.
 */

const FLAG = "__flixitRuntimeIntegrityV9";
const POLICY = "strict-explicit-it-v9-confirmed-audio-track-only";
const OLD_EPISODE_PREFIXES = [
  "flixit:it-episodes-v2:",
  "flixit:it-episodes-v3-audio-evidence:",
];
const SEASON_RE = /^\/api\/public\/tv\/\d+\/season\/\d+\/?$/;

function purgeLegacyAndGuestState() {
  if (typeof window === "undefined") return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const remove: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) || "";
        if (OLD_EPISODE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          remove.push(key);
        }
      }
      remove.forEach((key) => storage.removeItem(key));
    } catch {}
  }

  try {
    if (!window.localStorage.getItem("user_token")) {
      window.localStorage.removeItem("netflix_continue_watching");
      window.localStorage.removeItem("netflix_username");
      // Stream URLs may have been resolved under a previous signed-in session.
      // They are cheap to warm again and should not leak into a guest session.
      const removeSession: string[] = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index) || "";
        if (
          key.startsWith("watch_stream_cache:") ||
          key.startsWith("stream:") ||
          key.startsWith("stream_") ||
          key.startsWith("stream-")
        ) {
          removeSession.push(key);
        }
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
    if (
      method !== "GET" ||
      !response.ok ||
      url.origin !== window.location.origin ||
      !SEASON_RE.test(url.pathname)
    ) {
      return response;
    }

    try {
      const payload = await response.clone().json();
      if (!Array.isArray(payload?.episodes)) return response;
      const normalized = {
        ...payload,
        episodes: payload.episodes.filter(confirmedItalianEpisode),
        italian_audio_policy: "strict_confirmed_italian_only",
        italian_audio_policy_version: POLICY,
      };
      const headers = new Headers(response.headers);
      headers.set("Content-Type", "application/json");
      headers.delete("Content-Length");
      return new Response(JSON.stringify(normalized), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return new Response(JSON.stringify({
        episodes: [],
        italian_audio_policy: "strict_confirmed_italian_only",
        italian_audio_policy_version: POLICY,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}

export {};
