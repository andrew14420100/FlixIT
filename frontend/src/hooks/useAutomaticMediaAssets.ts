// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MEDIA_TYPE } from "src/types/Common";
import { getCDNImageUrl } from "src/config/cdnMapping";

export const TMDB_IMAGE_BASE = "";
const MEDIA_ASSET_QUALITY_VERSION = "official-artwork-v3b";
const DAILY_REFRESH_MS = 24 * 60 * 60 * 1000;

export function mediaTypeSlug(mediaType: any, item?: any) {
  return mediaType === MEDIA_TYPE.Tv || mediaType === "tv" || item?.type === "tv" || item?.media_type === "tv"
    ? "tv"
    : "movie";
}

function rawArtwork(value: any) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value?.url === "string") return value.url;
  if (typeof value?.artwork?.url === "string") return value.artwork.url;
  return null;
}

export function nonTmdbImageUrl(value: any) {
  const raw = rawArtwork(value);
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith("data:") || text.startsWith("blob:")) return text;
  if (!/^https?:\/\//i.test(text)) return null;
  if (/^https?:\/\/image\.tmdb\.org\//i.test(text)) return null;
  return text;
}

export function tmdbImageUrl(value: any, _size = "original") {
  return nonTmdbImageUrl(value);
}

function firstNonTmdbArtwork(...values: any[]) {
  for (const value of values) {
    const resolved = nonTmdbImageUrl(value);
    if (resolved) return resolved;
  }
  return null;
}

export default function useAutomaticMediaAssets(
  item: any,
  mediaType: any,
  enabled = true
) {
  const typeSlug = mediaTypeSlug(mediaType, item);
  const id = item?.id || item?.tmdbId || item?.tmdb_id;

  const mappedBackdrop = id
    ? getCDNImageUrl(Number(id), "backdrop") || getCDNImageUrl(Number(id), "detail_backdrop")
    : null;
  const mappedPoster = id ? getCDNImageUrl(Number(id), "poster") : null;

  const savedLandscape = firstNonTmdbArtwork(
    item?.netflix_artwork_url,
    item?.netflixArtworkUrl,
    item?.netflix_cover_url,
    item?.contextualArtwork?.artwork,
    item?.backdrop_path,
    item?.backdrop,
    item?.titled_backdrop_path,
    item?.titledBackdropPath,
    item?.artwork,
    item?.image,
    item?.cover_path,
    item?.cover,
    item?.image_url,
    item?.thumbnail_url
  );
  const savedPoster = firstNonTmdbArtwork(
    item?.netflix_ranked_artwork_url,
    item?.netflixRankedArtworkUrl,
    item?.poster_path,
    item?.poster,
    item?.cover_path,
    item?.cover,
    item?.image,
    item?.artwork
  );
  const savedLogo = firstNonTmdbArtwork(
    item?.netflix_logo_url,
    item?.logo_path,
    item?.logo,
    item?.title_logo_path,
    item?.titleLogoPath,
    item?.contextualArtwork?.logo
  );

  // Historical mapping entries are title-bearing merchandising art. A generic
  // saved image is only allowed when it also has a real saved logo to compose;
  // clean legacy artwork is never intentionally promoted to a public card.
  const safeSavedLandscape = savedLogo ? savedLandscape : null;
  const safeSavedPoster = savedLogo ? savedPoster : null;

  const fallback = useMemo(() => ({
    tmdbId: id,
    type: typeSlug,
    title: item?.title || item?.name || "",
    backdrop_path: mappedBackdrop || safeSavedLandscape || null,
    poster_path: mappedPoster || safeSavedPoster || mappedBackdrop || safeSavedLandscape || null,
    titled_backdrop_path: mappedBackdrop || safeSavedLandscape || null,
    logo_path: savedLogo || null,
    backdrop_embedded_title_treatment: !!mappedBackdrop,
    poster_embedded_title_treatment: !!mappedPoster,
    complete: !!(
      (mappedBackdrop || safeSavedLandscape) &&
      (mappedPoster || safeSavedPoster || mappedBackdrop || safeSavedLandscape) &&
      (mappedBackdrop || mappedPoster || savedLogo)
    ),
    runtime: item?.runtime,
    number_of_seasons: item?.number_of_seasons,
    certification: item?.certification,
    image_quality: "max-native",
    image_source_policy: "complete-title-treatment_official-v3b_no-tmdb-images",
  }), [
    id,
    typeSlug,
    item?.title,
    item?.name,
    mappedBackdrop,
    mappedPoster,
    safeSavedLandscape,
    safeSavedPoster,
    savedLogo,
    item?.runtime,
    item?.number_of_seasons,
    item?.certification,
  ]);

  const query = useQuery({
    queryKey: ["media-assets", MEDIA_ASSET_QUALITY_VERSION, typeSlug, id],
    queryFn: async ({ signal }: any) => {
      if (!id) return fallback;
      const response = await fetch(`/api/public/official-artwork/${typeSlug}/${id}`, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const official = response.ok ? await response.json() : {};

      const officialLandscape = firstNonTmdbArtwork(official?.backdrop_url);
      const officialPoster = firstNonTmdbArtwork(official?.poster_url);
      const officialLogo = firstNonTmdbArtwork(official?.logo_url);

      return {
        ...fallback,
        title: official?.title || fallback.title,
        backdrop_path: officialLandscape || fallback.backdrop_path || null,
        titled_backdrop_path: officialLandscape || fallback.titled_backdrop_path || null,
        poster_path: officialPoster || fallback.poster_path || officialLandscape || null,
        logo_path: officialLogo || savedLogo || null,
        netflix_logo_url: official?.logo_source === "netflix" ? officialLogo : null,
        official_artwork_source: official?.backdrop_source || official?.poster_source || null,
        backdrop_source: official?.backdrop_source || (mappedBackdrop ? "existing_mapping" : null),
        poster_source: official?.poster_source || (mappedPoster ? "existing_mapping" : null),
        logo_source: official?.logo_source || (savedLogo ? "saved_non_tmdb" : null),
        logo_locale: official?.logo_locale || null,
        backdrop_embedded_title_treatment: officialLandscape
          ? !!official?.backdrop_embedded_title_treatment
          : !!mappedBackdrop,
        poster_embedded_title_treatment: officialPoster
          ? !!official?.poster_embedded_title_treatment
          : !!mappedPoster,
        embedded_title_treatment: officialLandscape
          ? !!official?.backdrop_embedded_title_treatment
          : !!mappedBackdrop,
        complete: official?.complete ?? fallback.complete,
        image_quality: "max-native",
        image_source_policy: official?.policy || "complete-title-treatment_official-v3b_no-tmdb-images",
        upscaled: false,
      };
    },
    enabled: !!id && !!enabled,
    placeholderData: fallback,
    staleTime: DAILY_REFRESH_MS,
    gcTime: DAILY_REFRESH_MS * 7,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: enabled ? DAILY_REFRESH_MS : false,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  return { ...fallback, ...(query.data || {}) };
}
