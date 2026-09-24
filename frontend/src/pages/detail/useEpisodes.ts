// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

async function getJson(path, signal) {
  const response = await fetch(path, { signal, headers: { Accept: "application/json" } });
  return response.ok ? response.json() : null;
}

export function episodeStillUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith("/") ? `https://image.tmdb.org/t/p/w780${raw}` : "";
}

export default function useEpisodes(mediaId, enabled, preferredSeason) {
  const seasonsQuery = useQuery({
    queryKey: ["detail-seasons", mediaId],
    queryFn: ({ signal }) => getJson(`/api/public/tv/${mediaId}/seasons`, signal),
    enabled: !!mediaId && !!enabled,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const seasons = useMemo(
    () => (seasonsQuery.data?.seasons || []).filter((season) => Number(season?.season_number) > 0 && season?.vixsrc_available !== false && season?.is_aired !== false),
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
    queryKey: ["detail-season-episodes", mediaId, selected],
    queryFn: ({ signal }) => getJson(`/api/public/tv/${mediaId}/season/${selected}`, signal),
    enabled: !!mediaId && !!selected,
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const seconds = Number(query?.state?.data?.pending_recheck_seconds || 0);
      return seconds > 0 ? Math.max(4000, seconds * 1000) : false;
    },
  });

  const episodes = useMemo(
    () => (episodesQuery.data?.episodes || []).filter((episode) => episode?.vixsrc_available !== false),
    [episodesQuery.data]
  );

  return {
    seasons,
    selected,
    setSelected,
    episodes,
    loadingSeasons: seasonsQuery.isLoading,
    loadingEpisodes: episodesQuery.isLoading,
  };
}
