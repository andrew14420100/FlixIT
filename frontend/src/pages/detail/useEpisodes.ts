// @ts-nocheck
/**
 * FlixIT Detail Page v2 - seasons/episodes data for TV titles.
 * Strict Italian policy: only explicitly confirmed Italian-dubbed episodes are
 * shown. Episode data is prefetched while the user is still on Panoramica so
 * opening the Episodi tab is effectively instant.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_URL } from "./detailUtils";

async function getJson(path, signal) {
  const response = await fetch(path, { signal, headers: { Accept: "application/json" } });
  return response.ok ? response.json() : null;
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

  const seasonsQuery = useQuery({
    queryKey: ["dp-seasons", mediaId],
    queryFn: ({ signal }) => getJson(`${API_URL}/api/public/tv/${mediaId}/seasons`, signal),
    enabled: !!mediaId && !!enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 12 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const seasons = useMemo(
    () => (seasonsQuery.data?.seasons || []).filter(
      (season) => Number(season?.season_number) > 0 && season?.vixsrc_available !== false && season?.is_aired !== false
    ),
    [seasonsQuery.data]
  );

  // Start with the user's current season (or season 1) immediately instead of
  // waiting for the seasons endpoint. This lets the season request run in
  // parallel with the seasons metadata request.
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

  const episodesQuery = useQuery({
    queryKey: ["dp-season-episodes", mediaId, selected],
    queryFn: ({ signal }) => getJson(`${API_URL}/api/public/tv/${mediaId}/season/${selected}`, signal),
    // Important: preload even while the Episodi tab is closed.
    enabled: !!mediaId && !!selected && !!enabled,
    staleTime: 15 * 60 * 1000,
    gcTime: 12 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    // Only keep the Italian availability recheck alive while the user is
    // actually looking at the episodes tab. Hidden preloading does one request.
    refetchInterval: (query) => {
      if (!active) return false;
      const seconds = Number(query?.state?.data?.pending_recheck_seconds || 90);
      return Math.max(10000, Math.min(90 * 1000, seconds * 1000));
    },
  });

  const episodes = useMemo(
    () => (episodesQuery.data?.episodes || []).filter(
      (episode) => episode?.vixsrc_available !== false && episode?.italian_available === true
    ),
    [episodesQuery.data]
  );

  // Warm the episode thumbnails before the tab is opened so cards do not pop
  // in one-by-one after the user clicks Episodi.
  useEffect(() => {
    if (typeof Image === "undefined" || !episodes.length) return;
    episodes.slice(0, 30).forEach((episode) => {
      const src = episodeStillUrl(episode?.still_path);
      if (!src) return;
      const image = new Image();
      image.decoding = "async";
      image.src = src;
    });
  }, [episodes]);

  return {
    seasons,
    selected,
    setSelected,
    episodes,
    loadingSeasons: seasonsQuery.isLoading,
    loadingEpisodes: episodesQuery.isLoading || (episodesQuery.isFetching && !episodesQuery.data),
    checkingItalian: !!episodesQuery.data?.pending_recheck_seconds,
    seasonsError: seasonsQuery.isError,
  };
}
