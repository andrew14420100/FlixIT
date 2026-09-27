// @ts-nocheck
/**
 * FlixIT Detail Page v2 - seasons/episodes data for TV titles.
 * Only explicitly confirmed Italian episodes are exposed. Data and thumbnails
 * are warmed before the Episodi tab opens and mirrored in sessionStorage so tab
 * switches/back navigation do not flash a fresh loading state.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_URL } from "./detailUtils";

async function getJson(path, signal) {
  const response = await fetch(path, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  return response.ok ? response.json() : null;
}

function readSession(key) {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeSession(key, value) {
  if (typeof window === "undefined" || !value) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** Episode stills only exist on TMDB: allowed here as the single exception, with backdrop fallback. */
export function episodeStillUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith("/") ? `https://image.tmdb.org/t/p/w780${raw}` : "";
}

export default function useEpisodes(mediaId, enabled, preferredSeason, active) {
  const preferred = Math.max(1, Number(preferredSeason || 1));
  const seasonsCacheKey = `flixit:it-seasons:${mediaId}`;

  const seasonsQuery = useQuery({
    queryKey: ["dp-seasons-it-v2", mediaId],
    queryFn: ({ signal }) => getJson(`${API_URL}/api/public/tv/${mediaId}/seasons`, signal),
    enabled: !!mediaId && !!enabled,
    initialData: () => readSession(seasonsCacheKey),
    initialDataUpdatedAt: 0,
    staleTime: 30 * 60 * 1000,
    gcTime: 12 * 60 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  useEffect(() => {
    if (seasonsQuery.data?.seasons) writeSession(seasonsCacheKey, seasonsQuery.data);
  }, [seasonsCacheKey, seasonsQuery.data]);

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

  const episodeCacheKey = `flixit:it-episodes:${mediaId}:${selected}`;
  const episodesQuery = useQuery({
    queryKey: ["dp-season-episodes-it-v3", mediaId, selected],
    queryFn: ({ signal }) => getJson(`${API_URL}/api/public/tv/${mediaId}/season/${selected}`, signal),
    enabled: !!mediaId && !!selected && !!enabled,
    initialData: () => readSession(episodeCacheKey),
    initialDataUpdatedAt: 0,
    placeholderData: (previous) => previous,
    staleTime: 15 * 60 * 1000,
    gcTime: 12 * 60 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    refetchInterval: (query) => {
      const data = query?.state?.data || {};
      const pending = Number(data?.pending_recheck_seconds || 0);
      // The backend returns 4s only while language checks are actually pending.
      // A 90s value is merely the normal future-refresh hint and must not cause
      // the tab to reload continuously.
      if (pending > 0 && pending <= 10) return 4000;
      return false;
    },
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    const data = episodesQuery.data;
    if (!data || !Array.isArray(data.episodes)) return;
    writeSession(episodeCacheKey, data);
  }, [episodeCacheKey, episodesQuery.data]);

  const episodes = useMemo(
    () => (episodesQuery.data?.episodes || []).filter(
      (episode) =>
        episode?.vixsrc_available !== false &&
        episode?.italian_available === true &&
        String(episode?.italian_audio_status || "italian") === "italian"
    ),
    [episodesQuery.data]
  );

  useEffect(() => {
    if (typeof Image === "undefined" || !episodes.length) return;
    episodes.slice(0, 40).forEach((episode) => {
      const src = episodeStillUrl(episode?.still_path);
      if (!src) return;
      const image = new Image();
      image.decoding = "async";
      image.src = src;
    });
  }, [episodes]);

  const pendingItalianCheck = Number(episodesQuery.data?.pending_recheck_seconds || 0);

  return {
    seasons,
    selected,
    setSelected,
    episodes,
    loadingSeasons: seasonsQuery.isLoading && !seasonsQuery.data,
    loadingEpisodes: episodesQuery.isLoading && !episodesQuery.data,
    checkingItalian: pendingItalianCheck > 0 && pendingItalianCheck <= 10,
    seasonsError: seasonsQuery.isError,
  };
}
