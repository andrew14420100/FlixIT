// @ts-nocheck
/**
 * FlixIT Detail Page v2 - data layer.
 * Priority: detail -> artwork/logo -> progress -> trailer. Everything is
 * cached (RTK Query / react-query) so navigating between titles never
 * refetches the same resource twice.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetAppendedVideosQuery, useGetTVSeasonDetailsQuery } from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import useAutomaticMediaAssets from "src/hooks/useAutomaticMediaAssets";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { API_URL, artUrl, directTrailerUrl, formatCertification, yearFrom } from "./detailUtils";

const EMPTY = [];

export default function useDetailData(typeSlug: string, mediaId: number) {
  const isTV = typeSlug === "tv";
  const type = isTV ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;

  // 1. Detail (TMDB it-IT: title, overview, genres, seasons, runtime, dates)
  const detailQuery = useGetAppendedVideosQuery({ mediaType: type, id: mediaId }, { skip: !mediaId });
  const detail = detailQuery.data || null;
  const detailError = !!detailQuery.isError;

  // 2. Artwork + logo (official artwork pipeline, non-TMDB only)
  const assetItem = useMemo(
    () => ({ id: mediaId, type: typeSlug, title: detail?.title || detail?.name || "" }),
    [mediaId, typeSlug, detail?.title, detail?.name]
  );
  const assets = useAutomaticMediaAssets(assetItem, type, !!mediaId);

  // Certification / seasons / runtime enrichment (cached 14 days server-side)
  const mediaAssets = useQuery({
    queryKey: ["dp-media-assets", typeSlug, mediaId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`${API_URL}/api/public/media-assets/${typeSlug}/${mediaId}`, {
        signal,
        headers: { Accept: "application/json" },
      });
      return response.ok ? response.json() : {};
    },
    enabled: !!mediaId,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // 3. Progress (local + backend, shared hook)
  const { items: continueWatchingItems } = useContinueWatching();
  const progressItem = useMemo(
    () =>
      (continueWatchingItems || []).find(
        (item) => Number(item?.tmdb_id) === mediaId && (item?.media_type || "movie") === typeSlug
      ) || null,
    [continueWatchingItems, mediaId, typeSlug]
  );
  const season = isTV ? Math.max(1, Number(progressItem?.season || 1)) : 1;
  const episode = isTV ? Math.max(1, Number(progressItem?.episode || 1)) : 1;

  const seasonDetails = useGetTVSeasonDetailsQuery(
    { seriesId: mediaId, seasonNumber: season },
    { skip: !isTV || !mediaId }
  );
  const episodeInfo = useMemo(
    () => (seasonDetails.data?.episodes || EMPTY).find((item) => Number(item?.episode_number) === episode) || null,
    [seasonDetails.data, episode]
  );

  const duration = Number(progressItem?.duration || 0);
  const progressSeconds = Number(progressItem?.progress || 0);
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (progressSeconds / duration) * 100)) : 0;
  const remainingSeconds = duration > 0 ? Math.max(0, duration - progressSeconds) : 0;

  // 4. Trailer (real resolver, shared cache with Home/hover)
  const trailer = useResolvedTrailer(type, mediaId, !!mediaId);

  const trailerItems = useMemo(() => {
    const result = [];
    const seen = new Set();
    const add = (value, label, source) => {
      const url = directTrailerUrl(value);
      if (!url || seen.has(url)) return;
      seen.add(url);
      result.push({ url, label, source: String(source || "") });
    };
    add(trailer.url, "Trailer ufficiale", trailer.data?.source);
    [trailer.data?.alternatives, trailer.data?.candidates, detail?.trailers, detail?.trailer_alternatives].forEach((items) => {
      if (!Array.isArray(items)) return;
      items.forEach((item, index) => {
        const lang = String(item?.language || item?.lang || "").toLowerCase();
        const fallbackLabel = lang.startsWith("it") ? "Trailer italiano" : `Video ${index + 1}`;
        add(item, String(item?.label || item?.title || item?.name || fallbackLabel), item?.source);
      });
    });
    return result.slice(0, 8);
  }, [detail?.trailer_alternatives, detail?.trailers, trailer.data, trailer.url]);

  const genres = useMemo(() => (detail?.genres || EMPTY).map((genre) => genre?.name).filter(Boolean), [detail?.genres]);
  const primaryGenreId = Number(detail?.genres?.[0]?.id || 0);
  const certification = formatCertification(mediaAssets.data?.certification || detail?.certification);
  const seasonsCount = Number(detail?.number_of_seasons || mediaAssets.data?.number_of_seasons || 0);
  const runtimeMinutes = Number(
    detail?.runtime || mediaAssets.data?.runtime || (Array.isArray(detail?.episode_run_time) ? detail.episode_run_time[0] : 0) || 0
  );

  return {
    isTV,
    type,
    detail,
    detailError,
    title: detail?.title || detail?.name || assets?.title || "",
    overview: String(detail?.overview || "").trim(),
    year: yearFrom(detail) || String(mediaAssets.data?.release_date || "").slice(0, 4),
    genres,
    primaryGenreId,
    certification,
    seasonsCount,
    runtimeMinutes,
    logoUrl: artUrl(assets?.logo_path, assets?.netflix_logo_url),
    backdropUrl: artUrl(assets?.detail_backdrop_path, assets?.hero_backdrop_path, assets?.backdrop_path),
    trailerUrl: trailer.url || null,
    trailerItems,
    progressItem,
    progressPercent,
    remainingSeconds,
    season,
    episode,
    episodeTitle: String(episodeInfo?.name || "").trim(),
    episodeRuntime: Number(episodeInfo?.runtime || 0),
  };
}
