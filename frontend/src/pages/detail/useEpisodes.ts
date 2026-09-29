// @ts-nocheck
/**
 * FlixIT Detail Page - persistent seasons/episodes cache.
 *
 * A refresh must render the last verified Italian catalogue immediately. Fresh
 * checks happen after paint and every season is warmed in the background, so
 * switching seasons does not create a loading state after the first visit.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_URL, warmPlayback } from "./detailUtils";

const SEASONS_STALE_MS = 30 * 60 * 1000;
const EPISODES_STALE_MS = 10 * 60 * 1000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BACKGROUND_SEASON_CONCURRENCY = 2;
const EPISODE_CACHE_PREFIX = "flixit:it-episodes-v2:";
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
      if (parsed && typeof parsed === "object") return { data: parsed, savedAt: Date.now() - EPISODES_STALE_MS };
    } catch {}
    return null;
  };

  const persistent = read(window.localStorage);
  if (persistent) return persistent;
  try { return read(window.sessionStorage); } catch { return null; }
}

function hasVerifiedEpisodes(value) {
  return Array.isArray(value?.episodes) && value.episodes.some(
    (episode) => episode?.italian_available === true && String(episode?.italian_audio_status || "unknown") === "italian"
  );
}

function isShortCheckingResponse(value) {
  const pending = Number(value?.pending_recheck_seconds || 0);
  return pending > 0 && pending <= 10 && !hasVerifiedEpisodes(value);
}

function writePersistent(key, value) {
  if (typeof window === "undefined" || !value) return;

  // Never let a temporary cold-backend "checking" response erase a previously
  // verified season. The old verified list stays authoritative until a new
  // verified response is ready, so opening the Episodi tab cannot flash empty.
  const previous = readPersistent(key)?.data;
  if (isShortCheckingResponse(value) && hasVerifiedEpisodes(previous)) return;

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
  const id = window.setTimeout(callback, Math.min(450, timeout));
  return () => window.clearTimeout(id);
}

async function warmSeason(mediaId, seasonNumber) {
  const key = `${mediaId}:${seasonNumber}`;
  if (seasonWarmInflight.has(key)) return seasonWarmInflight.get(key);

  const promise = (async () => {
    const storageKey = `${EPISODE_CACHE_PREFIX}${mediaId}:${seasonNumber}`;
    const cached = readPersistent(storageKey);
    if (cached && Date.now() - cached.savedAt < EPISODES_STALE_MS) return cached.data;

    let data = await getJson(`${API_URL}/api/public/tv/${mediaId}/season/${seasonNumber}`);
    if (isShortCheckingResponse(data) && hasVerifiedEpisodes(cached?.data)) {
      data = cached.data;
    } else if (data) {
      writePersistent(storageKey, data);
    }

    const pending = Number(data?.pending_recheck_seconds || 0);
    if (pending > 0 && pending <= 10) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(900, pending * 1000)));
      const refreshed = await getJson(`${API_URL}/api/public/tv/${mediaId}/season/${seasonNumber}`);
      if (refreshed && !isShortCheckingResponse(refreshed)) {
        data = refreshed;
        writePersistent(storageKey, refreshed);
      }
    }
    return data;
  })().finally(() => seasonWarmInflight.delete(key));

  seasonWarmInflight.set(key, promise);
  return promise;
}

/** Episode stills only exist on TMDB: allowed here as the single exception, with backdrop fallback. */
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
    queryKey: ["dp-seasons-it-v3-persistent", mediaId],
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
    if (seasonsQuery.data?.seasons) writePersistent(seasonsCacheKey, seasonsQuery.data);
  }, [seasonsCacheKey, seasonsQuery.data]);

  useEffect(() => {
    if (!enabled || !seasonsCached?.data) return undefined;
    if (Date.now() - Number(seasonsCached.savedAt || 0) < SEASONS_STALE_MS) return undefined;
    return scheduleIdle(() => seasonsQuery.refetch(), 2200);
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
  const episodeCached = useMemo(() => readPersistent(episodeCacheKey), [episodeCacheKey]);
  const episodesQuery = useQuery({
    queryKey: ["dp-season-episodes-it-v6-strict-language", mediaId, selected],
    queryFn: async ({ signal }) => {
      const fresh = await getJson(`${API_URL}/api/public/tv/${mediaId}/season/${selected}`, signal);
      if (isShortCheckingResponse(fresh) && hasVerifiedEpisodes(episodeCached?.data)) {
        return episodeCached.data;
      }
      return fresh;
    },
    enabled: !!mediaId && !!selected && !!enabled,
    initialData: episodeCached?.data,
    initialDataUpdatedAt: episodeCached?.savedAt || 0,
    placeholderData: (previous) => previous || episodeCached?.data,
    staleTime: EPISODES_STALE_MS,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    refetchInterval: (query) => {
      const data = query?.state?.data || {};
      const pending = Number(data?.pending_recheck_seconds || 0);
      if (pending > 0 && pending <= 10 && !hasVerifiedEpisodes(data)) return 1000;
      return false;
    },
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    const data = episodesQuery.data;
    if (!data || !Array.isArray(data.episodes)) return;
    writePersistent(episodeCacheKey, data);
  }, [episodeCacheKey, episodesQuery.data]);

  useEffect(() => {
    if (!enabled || !episodeCached?.data) return undefined;
    if (Date.now() - Number(episodeCached.savedAt || 0) < EPISODES_STALE_MS) return undefined;
    return scheduleIdle(() => episodesQuery.refetch(), 1800);
  }, [enabled, episodeCached?.savedAt, mediaId, selected]);

  const episodeSource = hasVerifiedEpisodes(episodesQuery.data)
    ? episodesQuery.data
    : hasVerifiedEpisodes(episodeCached?.data)
      ? episodeCached.data
      : episodesQuery.data;

  const episodes = useMemo(
    () => (episodeSource?.episodes || []).filter(
      (episode) =>
        episode?.vixsrc_available !== false &&
        episode?.italian_available === true &&
        String(episode?.italian_audio_status || "unknown") === "italian"
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
      targets.forEach((episodeNumber) => {
        void warmPlayback("tv", Number(mediaId), Number(selected), episodeNumber);
      });
    }, active ? 350 : 900);
  }, [enabled, mediaId, selected, preferred, preferredEpisodeNumber, active, episodes]);

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
    }, 2200);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [enabled, mediaId, selected, seasons.map((season) => season?.season_number).join(",")]);

  const pendingItalianCheck = Number(episodeSource?.pending_recheck_seconds || 0);

  return {
    seasons,
    selected,
    setSelected,
    episodes,
    loadingSeasons: seasonsQuery.isLoading && !seasonsQuery.data,
    loadingEpisodes: episodes.length === 0 && episodesQuery.isLoading && !episodeCached?.data,
    checkingItalian: episodes.length === 0 && pendingItalianCheck > 0 && pendingItalianCheck <= 10,
    seasonsError: seasonsQuery.isError,
  };
}
