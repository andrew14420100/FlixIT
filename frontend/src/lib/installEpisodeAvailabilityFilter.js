const FILTER_VERSION = "v1";
const POSITIVE_TTL = 2 * 60 * 60 * 1000;
const NEGATIVE_TTL = 15 * 60 * 1000;
const UNKNOWN_TTL = 2 * 60 * 1000;
const MAX_CONCURRENCY = 6;
const PLAYER_TIMEOUT_MS = 8000;

const SEASON_PATH = /^\/api\/public\/tv\/(\d+)\/season\/(\d+)\/?$/;

function nowMs() {
  return Date.now();
}

function cacheKey(tmdbId, season, episode) {
  return `flixit:episode-availability:${FILTER_VERSION}:${tmdbId}:${season}:${episode}`;
}

function readCache(tmdbId, season, episode) {
  try {
    const raw = sessionStorage.getItem(cacheKey(tmdbId, season, episode));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const age = nowMs() - Number(parsed?.ts || 0);
    const ttl = parsed?.state === "available"
      ? POSITIVE_TTL
      : parsed?.state === "unavailable"
        ? NEGATIVE_TTL
        : UNKNOWN_TTL;
    if (age > ttl) {
      sessionStorage.removeItem(cacheKey(tmdbId, season, episode));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(tmdbId, season, episode, state) {
  try {
    sessionStorage.setItem(
      cacheKey(tmdbId, season, episode),
      JSON.stringify({ state, ts: nowMs() })
    );
  } catch {}
}

function streamMetadata(payload) {
  return [
    payload?.stream_name,
    payload?.stream_title,
    payload?.language,
    payload?.audio_language,
    payload?.audio,
    payload?.provider,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isExplicitEnglishOnly(payload) {
  const text = streamMetadata(payload);
  if (!text) return false;
  const italian = /(^|[^a-z])(ita|italian|italiano|it-it)([^a-z]|$)/i.test(text);
  const english = /(^|[^a-z])(eng|english|inglese|en-us|en-gb)([^a-z]|$)/i.test(text);
  return english && !italian;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs = PLAYER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function checkEpisode(fetchImpl, apiBase, tmdbId, season, episode) {
  const cached = readCache(tmdbId, season, episode);
  if (cached?.state) return cached.state;

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      `${apiBase}/api/player/tv/${tmdbId}/${season}/${episode}`,
      { cache: "no-store", headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      const state = response.status === 404 ? "unavailable" : "unknown";
      writeCache(tmdbId, season, episode, state);
      return state;
    }

    const payload = await response.json();
    if (payload?.success && payload?.stream && !isExplicitEnglishOnly(payload)) {
      writeCache(tmdbId, season, episode, "available");
      return "available";
    }

    if (payload?.reason === "temporary") {
      writeCache(tmdbId, season, episode, "unknown");
      return "unknown";
    }

    writeCache(tmdbId, season, episode, "unavailable");
    return "unavailable";
  } catch {
    writeCache(tmdbId, season, episode, "unknown");
    return "unknown";
  }
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return output;
}

function airedEpisodesOnly(episodes) {
  const today = new Date().toISOString().slice(0, 10);
  return episodes.filter((episode) => {
    const airDate = String(episode?.air_date || "").slice(0, 10);
    return !!airDate && airDate <= today;
  });
}

function rebuiltJsonResponse(response, payload) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function installEpisodeAvailabilityFilter() {
  if (typeof window === "undefined" || window.__FLIXIT_EPISODE_FILTER_INSTALLED__) return;
  window.__FLIXIT_EPISODE_FILTER_INSTALLED__ = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const response = await nativeFetch(input, init);

    try {
      const requestMethod = String(
        init?.method || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (requestMethod !== "GET" || !response.ok) return response;

      const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      if (!rawUrl) return response;
      const url = new URL(rawUrl, window.location.origin);
      const match = url.pathname.match(SEASON_PATH);
      if (!match) return response;

      const tmdbId = Number(match[1]);
      const season = Number(match[2]);
      const apiBase = url.origin === window.location.origin ? "" : url.origin;
      const data = await response.clone().json();
      if (!Array.isArray(data?.episodes) || data.episodes.length === 0) return response;

      const aired = airedEpisodesOnly(data.episodes);
      const states = await mapLimit(aired, MAX_CONCURRENCY, (episode) => {
        const episodeNumber = Number(episode?.episode_number || 0);
        if (!episodeNumber) return Promise.resolve("unavailable");
        return checkEpisode(nativeFetch, apiBase, tmdbId, season, episodeNumber);
      });

      // Definitive misses / ENG-only streams are hidden. Temporary resolver/network
      // errors are kept so a short outage never empties an otherwise valid season.
      const filtered = aired.filter((_, index) => states[index] !== "unavailable");

      return rebuiltJsonResponse(response, {
        ...data,
        episodes: filtered,
        total_episodes: filtered.length,
        availability_filtered: true,
      });
    } catch {
      return response;
    }
  };
}
