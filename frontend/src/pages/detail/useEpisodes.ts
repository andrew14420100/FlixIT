// @ts-nocheck
/**
 * FlixIT Detail Page v2 - seasons/episodes data for TV titles.
 * Strict Italian policy: only explicitly confirmed Italian-dubbed episodes are
 * shown. The active season keeps rechecking so newly dubbed episodes appear
 * automatically without a deploy or a manual refresh.
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
  const seasonsQuery = useQuery({
    queryKey: ["dp-seasons", mediaId],
    queryFn: ({ signal }) => getJson(`${API_URL}/api/public/tv/${mediaId}/seasons`, signal),
    enabled: !!mediaId && !!enabled,
    staleTime: 15 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const seasons = useMemo(
    () => (seasonsQuery.data?.seasons || []).filter(
      (season) => Number(season?.season_number) > 0 && season?.vixsrc_available !== false && season?.is_aired !== false
    ),
    [seasonsQuery.data]
  );

  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (!seasons.length) return;
    const wanted = Number(preferredSeason || 0);
    setSelected((current) => {
      if (current && seasons.some((season) => Number(season.season_number) === current)) return current;
      if (wanted && seasons.some((season) => Number(season.season_number) === wanted)) return wanted;
      return Number(seasons[0].season_number);
    });
  }, [seasons, preferredSeason]);

  const episodesQuery = useQuery({
    queryKey: ["dp-season-episodes", mediaId, selected],
    queryFn: ({ signal }) => getJson(`${API_URL}/api/public/tv/${mediaId}/season/${selected}`, signal),
    enabled: !!mediaId && !!selected && !!active,
    staleTime: 0,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
    refetchInterval: (query) => {
      const seconds = Number(query?.state?.data?.pending_recheck_seconds || 90);
      return Math.max(4000, Math.min(90 * 1000, seconds * 1000));
    },
  });

  const episodes = useMemo(
    () => (episodesQuery.data?.episodes || []).filter(
      (episode) => episode?.vixsrc_available !== false && episode?.italian_available === true
    ),
    [episodesQuery.data]
  );

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
