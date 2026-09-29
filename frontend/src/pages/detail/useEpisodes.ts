// @ts-nocheck
/**
 * FlixIT Detail Page - strict Italian episode cache (v15).
 *
 * The backend is authoritative for episode visibility. A season is persisted in
 * the browser only after the backend has an authoritative Italian catalogue for
 * that exact season; provisional metadata must never become a long-lived cache
 * that can keep English/original episodes visible after validation completes.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_URL, warmPlayback } from "./detailUtils";

const SEASONS_STALE_MS = 30 * 60 * 1000;
const EPISODES_STALE_MS = 10 * 60 * 1000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BACKGROUND_SEASON_CONCURRENCY = 2;
const EPISODE_CACHE_PREFIX = "flixit:it-episodes-v15:";
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
      if (parsed && typeof parsed === "object") {
        return { data: parsed, savedAt: Date.now() - EPISODES_STALE_MS };
      }
    } catch {}
    return null;
  };

  const persistent = read(window.localStorage);
  if (persistent) return persistent;
  try { return read(window.sessionStorage); } catch { return null; }
}

function hasEpisodes(value) {
  return Array.isArray(value?.episodes) && value.episodes.length > 0;
}

function isAuthoritativeSeason(value) {
  return !!(
    value &&
    value.catalog_authoritative_for_season === true &&
    String(value?.italian_audio_policy_version || "").includes("v15")
  );
}

function clearPersistent(key) {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(key); } catch {}
  try { window.sessionStorage.removeItem(key); } catch {}
}

function writePersistent(key, value) {
  if (typeof window === "undefined" || !value) return;

  // v15 never stores provisional/unfiltered metadata as a fresh episode cache.
  // This prevents an English/original row from surviving after the backend has
  // refreshed the Italian catalogue.
  if (!hasEpisodes(value) || !isAuthoritativeSeason(value)) {
    clearPersistent(key);
    return;
  }

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
    if (
      cached &&
      isAuthoritativeSeason(cached.data) &&
      hasEpisodes(cached.data) &&
      Date.now() - cached.savedAt < EPISODES_STALE_MS
    ) {
      return cached.data;
    }

    const data = await getJson(`${API_URL}/api/public/tv/${mediaId}/season/${seasonNumber}`);
    if (data) writePersistent(storageKey, data);
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
    queryKey: ["dp-seasons-it-v15", mediaId],
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
  const rawEpisodeCached = useMemo(() => readPersistent(episodeCacheKey), [episodeCacheKey]);
  const episodeCached = isAuthoritativeSeason(rawEpisodeCached?.data) && hasEpisodes(rawEpisodeCached?.data)
    ? rawEpisodeCached
    : null;

  const episodesQuery = useQuery({
    queryKey: ["dp-season-episodes-it-v15", mediaId, selected],
    queryFn: ({ signal }) => getJson(`${API_URL}/api/public/tv/${mediaId}/season/${selected}`, signal),
    enabled: !!mediaId && !!selected && !!enabled,
    initialData: episodeCached?.data,
    initialDataUpdatedAt: episodeCached?.savedAt || 0,
    placeholderData: (previous) => hasEpisodes(previous) ? previous : episodeCached?.data,
    staleTime: EPISODES_STALE_MS,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: !episodeCached,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
    refetchInterval: (query) => {
      const data = query?.state?.data || {};
      if (data?.catalog_pending === true) return 1000;
      if (Number(data?.validation_pending_count || 0) > 0) return 1500;
      return false;
    },
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    const data = episodesQuery.data;
    if (!data || !Array.isArray(data.episodes)) return;
    writePersistent(episodeCacheKey, data);
  }, [episodeCacheKey, episodesQuery.data]);

  const episodeSource = hasEpisodes(episodesQuery.data)
    ? episodesQuery.data
    : hasEpisodes(episodeCached?.data)
      ? episodeCached.data
      : episodesQuery.data;

  // Backend v15 has already removed episodes absent from an authoritative
  // Italian season catalogue. Keep only explicit negatives out as an extra guard.
  const episodes = useMemo(
    () => (episodeSource?.episodes || []).filter(
      (episode) => episode?.vixsrc_available !== false && episode?.italian_available !== false
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
    }, active ? 250 : 700);
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
    }, 1400);

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
    loadingEpisodes: episodes.length === 0 && episodesQuery.isLoading && !episodeCached?.data,
    checkingItalian: episodes.length === 0 && episodesQuery.data?.catalog_pending === true,
    seasonsError: seasonsQuery.isError,
  };
}
