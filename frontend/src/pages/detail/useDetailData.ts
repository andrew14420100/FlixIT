// @ts-nocheck
/**
 * FlixIT Detail Page v2 - data layer.
 * Priority: Italian detail -> SC title logo -> artwork/media assets ->
 * direct image fallback -> progress -> verified Italian non-YouTube trailer.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetAppendedVideosQuery, useGetTVSeasonDetailsQuery } from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import { API_ENDPOINT_URL, TMDB_V3_API_KEY } from "src/constant";
import useAutomaticMediaAssets from "src/hooks/useAutomaticMediaAssets";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { API_URL, artUrl, directTrailerUrl, formatCertification, yearFrom } from "./detailUtils";

const EMPTY = [];
const TMDB_ORIGINAL_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
const TMDB_EPISODE_IMAGE_BASE = "https://image.tmdb.org/t/p/w780";

function tmdbOriginalArtUrl(value: any) {
  const raw = typeof value === "string" ? value : value?.url;
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/^https?:\/\/image\.tmdb\.org\//i.test(text)) return text;
  if (text.startsWith("/")) return `${TMDB_ORIGINAL_IMAGE_BASE}${text}`;
  return null;
}

function tmdbEpisodeStillUrl(value: any) {
  const raw = typeof value === "string" ? value : value?.url;
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("/")) return `${TMDB_EPISODE_IMAGE_BASE}${text}`;
  return null;
}

function uniqueUrls(values: any[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });
  return result;
}

function isStreamingCommunityLogo(source: any) {
  const value = String(source || "").trim().toLowerCase();
  return value === "streamingcommunity" || value.startsWith("streamingcommunity_");
}

export default function useDetailData(typeSlug: string, mediaId: number) {
  const isTV = typeSlug === "tv";
  const type = isTV ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;

  const detailQuery = useGetAppendedVideosQuery({ mediaType: type, id: mediaId }, { skip: !mediaId });
  const detail = detailQuery.data || null;
  const detailError = !!detailQuery.isError;

  const englishFallback = useQuery({
    queryKey: ["dp-detail-en-fallback", typeSlug, mediaId],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `${API_ENDPOINT_URL}/${typeSlug}/${mediaId}?api_key=${TMDB_V3_API_KEY}&language=en-US`,
        { signal, headers: { Accept: "application/json" } }
      );
      return response.ok ? response.json() : {};
    },
    enabled: !!mediaId && !!detail && !String(detail?.overview || "").trim(),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const assetItem = useMemo(
    () => ({ id: mediaId, type: typeSlug, title: detail?.title || detail?.name || "" }),
    [mediaId, typeSlug, detail?.title, detail?.name]
  );
  const assets = useAutomaticMediaAssets(assetItem, type, !!mediaId);

  // Logos are intentionally SC-only. The backend resolver may still use other
  // providers for covers/backdrops, but its logo policy returns a logo only when
  // StreamingCommunity supplied a strict identity match.
  const officialArtwork = useQuery({
    queryKey: ["dp-sc-logo-only-v3", typeSlug, mediaId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`${API_URL}/api/public/official-artwork/${typeSlug}/${mediaId}`, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      return response.ok ? response.json() : {};
    },
    enabled: !!mediaId,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const mediaAssets = useQuery({
    queryKey: ["dp-media-assets-v3-logo", typeSlug, mediaId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`${API_URL}/api/public/media-assets/${typeSlug}/${mediaId}`, {
        signal,
        cache: "no-store",
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

  const officialScLogo = isStreamingCommunityLogo(officialArtwork.data?.logo_source)
    ? artUrl(officialArtwork.data?.logo_url)
    : null;
  const automaticScLogo = isStreamingCommunityLogo(assets?.logo_source)
    ? artUrl(assets?.logo_path)
    : null;
  const existingLogoUrl = officialScLogo || automaticScLogo || null;

  const backdropUrls = useMemo(
    () => uniqueUrls([
      artUrl(officialArtwork.data?.detail_backdrop_url),
      artUrl(officialArtwork.data?.hero_backdrop_url),
      artUrl(officialArtwork.data?.backdrop_url),
      artUrl(assets?.detail_backdrop_path),
      artUrl(assets?.hero_backdrop_path),
      artUrl(assets?.backdrop_path),
      artUrl(mediaAssets.data?.detail_backdrop_url, mediaAssets.data?.detail_backdrop_path),
      artUrl(mediaAssets.data?.hero_backdrop_url, mediaAssets.data?.hero_backdrop_path),
      artUrl(mediaAssets.data?.backdrop_url, mediaAssets.data?.backdrop_path),
      tmdbOriginalArtUrl(detail?.backdrop_path),
      tmdbOriginalArtUrl(englishFallback.data?.backdrop_path),
      tmdbOriginalArtUrl(detail?.poster_path),
      tmdbOriginalArtUrl(englishFallback.data?.poster_path),
    ]),
    [
      officialArtwork.data?.detail_backdrop_url,
      officialArtwork.data?.hero_backdrop_url,
      officialArtwork.data?.backdrop_url,
      assets?.detail_backdrop_path,
      assets?.hero_backdrop_path,
      assets?.backdrop_path,
      mediaAssets.data?.detail_backdrop_url,
      mediaAssets.data?.detail_backdrop_path,
      mediaAssets.data?.hero_backdrop_url,
      mediaAssets.data?.hero_backdrop_path,
      mediaAssets.data?.backdrop_url,
      mediaAssets.data?.backdrop_path,
      detail?.backdrop_path,
      detail?.poster_path,
      englishFallback.data?.backdrop_path,
      englishFallback.data?.poster_path,
    ]
  );

  const { items: continueWatchingItems } = useContinueWatching();
  const progressItem = useMemo(
    () =>
      (continueWatchingItems || []).find(
        (item) => Number(item?.tmdb_id) === mediaId && (item?.media_type || "movie") === typeSlug
      ) || null,
    [continueWatchingItems, mediaId, typeSlug]
  );
  const hasRealProgress = !!progressItem
    && Number(progressItem?.progress || 0) > 0
    && Number(progressItem?.duration || 0) > 0;

  // Keep the TV cursor even when the selected episode starts at 0/10 seconds.
  // This lets a deliberate jump to E05 immediately mark E01-E04 as previous
  // episodes without forcing WatchPage to resume at an artificial position.
  const season = isTV && progressItem ? Math.max(1, Number(progressItem?.season || 1)) : 1;
  const episode = isTV && progressItem ? Math.max(1, Number(progressItem?.episode || 1)) : 1;

  const seasonDetails = useGetTVSeasonDetailsQuery(
    { seriesId: mediaId, seasonNumber: season },
    { skip: !isTV || !mediaId }
  );
  const episodeInfo = useMemo(
    () => (seasonDetails.data?.episodes || EMPTY).find((item) => Number(item?.episode_number) === episode) || null,
    [seasonDetails.data, episode]
  );

  const duration = hasRealProgress ? Number(progressItem?.duration || 0) : 0;
  const progressSeconds = hasRealProgress ? Number(progressItem?.progress || 0) : 0;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (progressSeconds / duration) * 100)) : 0;
  const remainingSeconds = duration > 0 ? Math.max(0, duration - progressSeconds) : 0;

  const trailer = useResolvedTrailer(type, mediaId, !!mediaId);

  const trailerItems = useMemo(() => {
    const url = directTrailerUrl(trailer.url);
    if (!url) return [];
    const source = String(
      trailer.data?.selected?.source ||
      trailer.data?.candidate?.source ||
      trailer.data?.source ||
      trailer.source ||
      "direct"
    ).toLowerCase();
    return [{ url, label: "Trailer ufficiale in italiano", source }];
  }, [trailer.data, trailer.url, trailer.source]);

  const genres = useMemo(() => (detail?.genres || EMPTY).map((genre) => genre?.name).filter(Boolean), [detail?.genres]);
  const primaryGenreId = Number(detail?.genres?.[0]?.id || 0);
  const certification = formatCertification(mediaAssets.data?.certification || detail?.certification);
  const seasonsCount = Number(detail?.number_of_seasons || mediaAssets.data?.number_of_seasons || 0);
  const runtimeMinutes = Number(
    detail?.runtime || mediaAssets.data?.runtime || (Array.isArray(detail?.episode_run_time) ? detail.episode_run_time[0] : 0) || 0
  );

  const overview = String(detail?.overview || englishFallback.data?.overview || "").trim();
  const episodeStillUrl = isTV && progressItem
    ? tmdbEpisodeStillUrl(
        progressItem?.episode_still_path ||
        progressItem?.still_path ||
        episodeInfo?.still_path
      )
    : null;

  return {
    isTV,
    type,
    detail,
    detailError,
    title: detail?.title || detail?.name || englishFallback.data?.title || englishFallback.data?.name || assets?.title || "",
    overview,
    overviewLocale: String(detail?.overview || "").trim() ? "it" : overview ? "en" : null,
    year: yearFrom(detail) || String(mediaAssets.data?.release_date || "").slice(0, 4),
    genres,
    primaryGenreId,
    certification,
    seasonsCount,
    runtimeMinutes,
    logoUrl: existingLogoUrl,
    backdropUrl: backdropUrls[0] || null,
    backdropUrls,
    trailerUrl: trailer.url || null,
    trailerItems,
    progressItem,
    hasRealProgress,
    progressPercent,
    remainingSeconds,
    season,
    episode,
    episodeTitle: String(episodeInfo?.name || "").trim(),
    episodeRuntime: Number(episodeInfo?.runtime || 0),
    episodeStillUrl,
  };
}
