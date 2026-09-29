// @ts-nocheck
/**
 * FlixIT Detail Page - pre-indexed Italian episode snapshots (v16).
 *
 * Language/provider verification never happens from this hook. The backend
 * returns a final Italian-only snapshot already built by the background indexer.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_URL, warmPlayback } from "./detailUtils";

const SEASONS_STALE_MS = 30 * 60 * 1000;
const EPISODES_STALE_MS = 5 * 60 * 1000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BACKGROUND_SEASON_CONCURRENCY = 3;
const EPISODE_CACHE_PREFIX = "flixit:it-episodes-v16:";
const seasonWarmInflight = new Map();

async function getJson(path, signal) {
  const response = await fetch(path, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  return response.ok ? response.json() : null;
}

function readPersistent(key) {
  if (typeof window === "undefined") return null;
  const read = (storage) => {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.data && Number(parsed?.savedAt || 0) > 0) {
        if (Date.now() - Number(parsed.savedAt) > CACHE_MAX_AGE_MS) return null;
        return { data: parsed.data, savedAt: Number(parsed.savedAt) };
      }
    } catch {}
    return null;
  };

  const persistent = read(window.localStorage);
  if (persistent) return persistent;
  try { return read(window.sessionStorage); } catch { return null; }
}

function isIndexedSnapshot(value) {
  return !!(
    value &&
    Array.isArray(value?.episodes) &&
    value?.index_ready === true &&
    String(value?.italian_audio_policy_version || "") === "italian-media-index-v16"
  );
}

function writePersistent(key, value) {
  if (typeof window === "undefined" || !isIndexedSnapshot(value)) return;
  const payload = JSON.stringify({ savedAt: Date.now(), data: value });
  try { window.localStorage.setItem(key, payload); } catch {
    try { window.sessionStorage.setItem(key, payload); } catch {}
  }
}

function scheduleIdle(callback, timeout = 1800) {
  if (typeof window === "undefined") return () => {};
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, Math.min(250, timeout));
  return () => window.clearTimeout(id);
}

async function warmSeason(mediaId, seasonNumber) {
  const key = `${mediaId}:${seasonNumber}`;
  if (seasonWarmInflight.has(key)) return seasonWarmInflight.get(key);

  const promise = (async () => {
    const storageKey = `${EPISODE_CACHE_PREFIX}${mediaId}:${seasonNumber}`;
    const cached = readPersistent(storageKey);
    if (
      cached &&
      isIndexedSnapshot(cached.data) &&
      Date.now() - cached.savedAt < EPISODES_STALE_MS
    ) return cached.data;

    const data = await getJson(`${API_URL}/api/public/tv/${mediaId}/season/${seasonNumber}`);
    if (data) writePersistent(storageKey, data);
    return data;
  })().finally(() => seasonWarmInflight.delete(key));

  seasonWarmInflight.set(key, promise);
  return promise;
}

/** Episode stills only exist on TMDB: allowed here as the single exception. */
export function episodeStillUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith("/") ? `https://image.tmdb.org/t/p/w780${raw}` : "";
}

export default function useEpisodes(mediaId, enabled, preferredSeason, active, preferredEpisode = 1) {
  const preferred = Math.max(1, Number(preferredSeason || 1));
  const preferredEpisodeNumber = Math.max(1, Number(preferredEpisode || 1));
  const seasonsCacheKey = `flixit:it-seasons:${mediaId}`;
  const seasonsCached = useMemo(() => readPersistent(seasonsCacheKey), [seasonsCacheKey]);

  const seasonsQuery = useQuery({
    queryKey: ["dp-seasons-it-v16", mediaId],
    queryFn: ({ signal }) => getJson(`${API_URL}/api/public/tv/${mediaId}/seasons`, signal),
    enabled: !!mediaId && !!enabled,
    initialData: seasonsCached?.data,
    initialDataUpdatedAt: seasonsCached?.savedAt || 0,
    staleTime: SEASONS_STALE_MS,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  useEffect(() => {
    if (seasonsQuery.data?.seasons) {
      const payload = JSON.stringify({ savedAt: Date.now(), data: seasonsQuery.data });
      try { window.localStorage.setItem(seasonsCacheKey, payload); } catch {}
    }
  }, [seasonsCacheKey, seasonsQuery.data]);

  useEffect(() => {
    if (!enabled || !seasonsCached?.data) return undefined;
    if (Date.now() - Number(seasonsCached.savedAt || 0) < SEASONS_STALE_MS) return undefined;
    return scheduleIdle(() => seasonsQuery.refetch(), 1200);
  }, [enabled, seasonsCached?.savedAt, mediaId]);

  const seasons = useMemo(
    () => (seasonsQuery.data?.seasons || []).filter(
      (season) => Number(season?.season_number) > 0 && season?.vixsrc_available !== false && season?.is_aired !== false
    ),
    [seasonsQuery.data]
  );

  const [selected, setSelected] = useState(preferred);

  useEffect(() => {
    setSelected((current) => current || preferred);
  }, [preferred]);

  useEffect(() => {
    if (!seasons.length) return;
    const wanted = Math.max(1, Number(preferredSeason || 1));
    setSelected((current) => {
      if (current && seasons.some((season) => Number(season.season_number) === current)) return current;
      if (seasons.some((season) => Number(season.season_number) === wanted)) return wanted;
      return Number(seasons[0].season_number);
    });
  }, [seasons, preferredSeason]);

  const episodeCacheKey = `${EPISODE_CACHE_PREFIX}${mediaId}:${selected}`;
  const rawEpisodeCached = useMemo(() => readPersistent(episodeCacheKey), [episodeCacheKey]);
  const episodeCached = isIndexedSnapshot(rawEpisodeCached?.data) ? rawEpisodeCached : null;

  const episodesQuery = useQuery({
    queryKey: ["dp-season-episodes-it-v16", mediaId, selected],
    queryFn: ({ signal }) => getJson(`${API_URL}/api/public/tv/${mediaId}/season/${selected}`, signal),
    enabled: !!mediaId && !!selected && !!enabled,
    initialData: episodeCached?.data,
    initialDataUpdatedAt: episodeCached?.savedAt || 0,
    placeholderData: episodeCached?.data,
    staleTime: EPISODES_STALE_MS,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: !episodeCached,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
  });

  useEffect(() => {
    const data = episodesQuery.data;
    if (!isIndexedSnapshot(data)) return;
    writePersistent(episodeCacheKey, data);
  }, [episodeCacheKey, episodesQuery.data]);

  const episodeSource = isIndexedSnapshot(episodesQuery.data)
    ? episodesQuery.data
    : episodeCached?.data;

  // v16 only returns entries already present in the persistent Italian index.
  const episodes = useMemo(
    () => (episodeSource?.episodes || []).filter(
      (episode) =>
        episode?.vixsrc_available !== false &&
        episode?.italian_available === true &&
        String(episode?.italian_audio_policy_version || "") === "italian-media-index-v16"
    ),
    [episodeSource]
  );

  useEffect(() => {
    if (typeof Image === "undefined" || !episodes.length) return;
    episodes.slice(0, 40).forEach((episode) => {
      const src = episodeStillUrl(episode?.still_path);
      if (!src) return;
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "auto";
      image.src = src;
    });
  }, [episodes]);

  useEffect(() => {
    if (!enabled || !mediaId || !selected || !episodes.length) return undefined;
    const wanted = Number(selected) === preferred
      ? preferredEpisodeNumber
      : Number(episodes[0]?.episode_number || 1);
    let index = episodes.findIndex((episode) => Number(episode?.episode_number) === wanted);
    if (index < 0) index = 0;
    const targets = episodes.slice(index, index + 2)
      .map((episode) => Number(episode?.episode_number || 0))
      .filter(Boolean);
    return scheduleIdle(() => {
      targets.forEach((episodeNumber) => void warmPlayback("tv", Number(mediaId), Number(selected), episodeNumber));
    }, active ? 120 : 350);
  }, [enabled, mediaId, selected, preferred, preferredEpisodeNumber, active, episodes]);

  // Preload every other season from the local/index-only API as soon as season
  // metadata is known. Clicking another season should therefore hit browser cache.
  useEffect(() => {
    if (!enabled || !mediaId || seasons.length < 2) return undefined;
    let cancelled = false;
    const pending = seasons
      .map((season) => Number(season?.season_number || 0))
      .filter((number) => number > 0 && number !== Number(selected));

    const cancelIdle = scheduleIdle(async () => {
      for (let index = 0; index < pending.length && !cancelled; index += BACKGROUND_SEASON_CONCURRENCY) {
        const batch = pending.slice(index, index + BACKGROUND_SEASON_CONCURRENCY);
        await Promise.allSettled(batch.map((number) => warmSeason(mediaId, number)));
      }
    }, 250);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [enabled, mediaId, selected, seasons.map((season) => season?.season_number).join(",")]);

  return {
    seasons,
    selected,
    setSelected,
    episodes,
    loadingSeasons: seasonsQuery.isLoading && !seasonsQuery.data,
    loadingEpisodes: episodesQuery.isLoading && !episodeCached?.data,
    checkingItalian: false,
    seasonsError: seasonsQuery.isError,
  };
}
