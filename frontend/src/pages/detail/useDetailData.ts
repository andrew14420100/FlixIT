// @ts-nocheck
/**
 * FlixIT Detail Page v2 - data layer.
 * Priority: Italian detail -> official artwork/logo -> media assets ->
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

function firstDetailLogo(...values: any[]) {
  const direct = artUrl(...values);
  if (direct) return direct;
  for (const value of values) {
    const tmdb = tmdbOriginalArtUrl(value);
    if (tmdb) return tmdb;
  }
  return null;
}

function pickTmdbLogoPath(payload: any) {
  const logos = Array.isArray(payload?.logos) ? payload.logos.filter((row) => row?.file_path) : [];
  if (!logos.length) return null;
  const languageRank = (lang: any) => {
    const value = String(lang || "").toLowerCase();
    if (value === "it") return 0;
    if (value === "en") return 1;
    if (!value || value === "null") return 2;
    return 3;
  };
  logos.sort((a, b) => {
    const lang = languageRank(a?.iso_639_1) - languageRank(b?.iso_639_1);
    if (lang) return lang;
    const aPng = String(a?.file_path || "").toLowerCase().endsWith(".png") ? 0 : 1;
    const bPng = String(b?.file_path || "").toLowerCase().endsWith(".png") ? 0 : 1;
    if (aPng !== bPng) return aPng - bPng;
    return Number(b?.vote_average || 0) - Number(a?.vote_average || 0);
  });
  return logos[0]?.file_path || null;
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

  // This endpoint aggregates the project's strongest genuine artwork sources
  // (Netflix when available, StreamingCommunity title treatment, Apple/Prime,
  // etc.). Detail previously never asked it for the logo, so titles with a real
  // logo there still fell back to plain text.
  const officialArtwork = useQuery({
    queryKey: ["dp-official-artwork-logo-v2", typeSlug, mediaId],
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

  const existingLogoUrl = firstDetailLogo(
    officialArtwork.data?.logo_url,
    officialArtwork.data?.title_logo_url,
    assets?.logo_path,
    assets?.netflix_logo_url,
    mediaAssets.data?.logo_url,
    mediaAssets.data?.logo_path,
    mediaAssets.data?.fallback_logo_path,
    detail?.netflix_logo_url,
    detail?.logo_path
  );

  // Last-resort genuine title treatment. If none of the provider artwork
  // sources has a logo, query TMDB images directly rather than trusting an old
  // media_assets cache row with logo_path=null.
  const tmdbLogoImages = useQuery({
    queryKey: ["dp-tmdb-logo-images-v2", typeSlug, mediaId],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        api_key: TMDB_V3_API_KEY,
        include_image_language: "it,en,null",
      });
      const response = await fetch(
        `${API_ENDPOINT_URL}/${typeSlug}/${mediaId}/images?${params.toString()}`,
        { signal, cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!response.ok) return null;
      return pickTmdbLogoPath(await response.json());
    },
    enabled: !!mediaId && officialArtwork.isFetched && mediaAssets.isFetched && !existingLogoUrl,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    retry: 1,
  });

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

  const season = isTV && hasRealProgress ? Math.max(1, Number(progressItem?.season || 1)) : 1;
  const episode = isTV && hasRealProgress ? Math.max(1, Number(progressItem?.episode || 1)) : 1;

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
  const episodeStillUrl = isTV && hasRealProgress
    ? tmdbEpisodeStillUrl(
        progressItem?.episode_still_path ||
        progressItem?.still_path ||
        episodeInfo?.still_path
      )
    : null;

  const tmdbLogoUrl = tmdbOriginalArtUrl(tmdbLogoImages.data);

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
    logoUrl: existingLogoUrl || tmdbLogoUrl || null,
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
