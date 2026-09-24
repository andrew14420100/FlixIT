// @ts-nocheck
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLazyGetAppendedVideosQuery, useGetTVSeasonDetailsQuery } from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import useAutomaticMediaAssets from "src/hooks/useAutomaticMediaAssets";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { artUrl, directTrailerUrl, formatCertification, yearFrom } from "./detailUtils";

export default function useDetailData(typeSlug: string, mediaId: number) {
  const isTV = typeSlug === "tv";
  const type = isTV ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;

  const [getDetail, { data: detail, isError: detailError }] = useLazyGetAppendedVideosQuery();
  useEffect(() => {
    if (mediaId) getDetail({ mediaType: type, id: mediaId }, true);
  }, [getDetail, mediaId, type]);

  const assets = useAutomaticMediaAssets({ ...(detail || {}), id: mediaId, type: typeSlug }, type, !!mediaId);
  const trailer = useResolvedTrailer(type, mediaId, !!mediaId);
  const { items: continueWatchingItems } = useContinueWatching();

  const mediaAssets = useQuery({
    queryKey: ["detail-media-assets", typeSlug, mediaId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/public/media-assets/${typeSlug}/${mediaId}`, { signal, headers: { Accept: "application/json" } });
      return response.ok ? response.json() : {};
    },
    enabled: !!mediaId,
    staleTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const progressItem = useMemo(
    () => continueWatchingItems.find((item) => Number(item?.tmdb_id) === mediaId && item?.media_type === typeSlug) || null,
    [continueWatchingItems, mediaId, typeSlug]
  );
  const season = isTV ? Number(progressItem?.season || 1) : 1;
  const episode = isTV ? Number(progressItem?.episode || 1) : 1;

  const seasonDetails = useGetTVSeasonDetailsQuery(
    { seriesId: mediaId, seasonNumber: season },
    { skip: !isTV || !mediaId }
  );
  const episodeInfo = useMemo(
    () => (seasonDetails.data?.episodes || []).find((item) => Number(item?.episode_number) === episode) || null,
    [seasonDetails.data, episode]
  );

  const duration = Number(progressItem?.duration || 0);
  const progressPercent = duration > 0
    ? Math.min(100, Math.max(0, (Number(progressItem.progress || 0) / duration) * 100))
    : 0;
  const remainingSeconds = duration > 0 ? Math.max(0, duration - Number(progressItem.progress || 0)) : 0;

  const genres = (detail?.genres || []).map((genre) => genre?.name).filter(Boolean);
  const certification = formatCertification(mediaAssets.data?.certification || detail?.certification);
  const seasonsCount = Number(detail?.number_of_seasons || mediaAssets.data?.number_of_seasons || 0);
  const runtimeMinutes = Number(detail?.runtime || mediaAssets.data?.runtime || 0);

  const trailerItems = useMemo(() => {
    const result = [];
    const seen = new Set();
    const add = (value, label, source) => {
      const url = directTrailerUrl(value);
      if (!url || seen.has(url)) return;
      seen.add(url);
      result.push({ url, label, source: source || "" });
    };
    add(trailer.url, "Trailer ufficiale", trailer.data?.source);
    [detail?.trailers, detail?.trailer_alternatives, trailer.data?.alternatives, assets?.trailers].forEach((items) => {
      if (!Array.isArray(items)) return;
      items.forEach((item, index) => add(item, String(item?.label || item?.title || item?.name || `Video ${index + 1}`), item?.source));
    });
    return result.slice(0, 8);
  }, [assets?.trailers, detail?.trailer_alternatives, detail?.trailers, trailer.data, trailer.url]);

  return {
    isTV,
    type,
    detail,
    detailError,
    title: detail?.title || detail?.name || assets?.title || "",
    overview: String(detail?.overview || "").trim(),
    year: yearFrom(detail) || String(mediaAssets.data?.release_date || "").slice(0, 4),
    genres,
    certification,
    seasonsCount,
    runtimeMinutes,
    logoUrl: artUrl(assets?.logo_path, assets?.logo, detail?.netflix_logo_url),
    backdropUrl: artUrl(assets?.detail_backdrop_path, assets?.hero_backdrop_path, assets?.backdrop_path, detail?.netflix_artwork_url),
    trailerUrl: trailer.url,
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
