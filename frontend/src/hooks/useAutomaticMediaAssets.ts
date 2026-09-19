// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MEDIA_TYPE } from "src/types/Common";
import { getCDNImageUrl } from "src/config/cdnMapping";

// Compatibility export for older components. It is intentionally empty so a
// legacy relative image path can never be expanded into an image.tmdb.org URL.
export const TMDB_IMAGE_BASE = "";
const MEDIA_ASSET_QUALITY_VERSION = "netflix-native-v5";

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

/**
 * Compatibility helper retained under the old name. It now deliberately
 * rejects TMDB/relative paths and returns only already-resolved non-TMDB assets.
 */
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

  const netflixLandscape = firstNonTmdbArtwork(
    item?.netflix_artwork_url,
    item?.netflixArtworkUrl,
    item?.netflix_cover_url,
    item?.contextualArtwork?.artwork
  );
  const netflixPoster = firstNonTmdbArtwork(
    item?.netflix_ranked_artwork_url,
    item?.netflixRankedArtworkUrl,
    item?.netflix_cover_url
  );

  const mappedBackdrop = id
    ? getCDNImageUrl(Number(id), "backdrop") || getCDNImageUrl(Number(id), "detail_backdrop")
    : null;
  const mappedPoster = id ? getCDNImageUrl(Number(id), "poster") : null;

  const savedLandscape = firstNonTmdbArtwork(
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
    item?.poster_path,
    item?.poster,
    item?.cover_path,
    item?.cover,
    item?.image,
    item?.artwork
  );
  const savedLogo = firstNonTmdbArtwork(
    item?.contextualArtwork?.logo,
    item?.logo_path,
    item?.logo,
    item?.title_logo_path,
    item?.titleLogoPath
  );

  const fallback = useMemo(() => ({
    tmdbId: id,
    type: typeSlug,
    title: item?.title || item?.name || "",
    // Required source priority: Netflix -> historical mapping/CDN -> other
    // saved non-TMDB artwork -> nothing. Lower-resolution Netflix artwork is
    // kept when it is the best Netflix variant available.
    backdrop_path: netflixLandscape || mappedBackdrop || savedLandscape || null,
    poster_path: netflixPoster || mappedPoster || savedPoster || null,
    titled_backdrop_path: netflixLandscape || mappedBackdrop || savedLandscape || null,
    logo_path: savedLogo || null,
    runtime: item?.runtime,
    number_of_seasons: item?.number_of_seasons,
    certification: item?.certification,
    image_quality: "max-native",
    image_source_policy: "netflix-cdn-saved-only",
  }), [
    id,
    typeSlug,
    item?.title,
    item?.name,
    netflixLandscape,
    netflixPoster,
    mappedBackdrop,
    mappedPoster,
    savedLandscape,
    savedPoster,
    savedLogo,
    item?.runtime,
    item?.number_of_seasons,
    item?.certification,
  ]);

  const query = useQuery({
    queryKey: ["media-assets", MEDIA_ASSET_QUALITY_VERSION, typeSlug, id],
    queryFn: async ({ signal }: any) => {
      if (!id) return fallback;

      const artworkParams = new URLSearchParams({
        context: "home",
        viewport: typeof window !== "undefined" && window.innerWidth < 700 ? "mobile" : "desktop",
        profile_id: typeof window !== "undefined"
          ? (window.localStorage.getItem("netflix_user_id") || "guest")
          : "guest",
      });

      const [metadataResult, netflixResult] = await Promise.allSettled([
        fetch(`/api/public/media-assets/${typeSlug}/${id}`, {
          signal,
          headers: { Accept: "application/json" },
        }).then(async (response) => response.ok ? response.json() : {}),
        fetch(`/api/player/artwork/${typeSlug}/${id}?${artworkParams.toString()}`, {
          signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        }).then(async (response) => response.ok ? response.json() : {}),
      ]);

      const media = metadataResult.status === "fulfilled" ? (metadataResult.value || {}) : {};
      const netflix = netflixResult.status === "fulfilled" ? (netflixResult.value || {}) : {};

      // Keep metadata/trailer information from /media-assets, but deliberately
      // drop every image field produced by that endpoint so TMDB can never become
      // a visual fallback anywhere that consumes this shared hook.
      const {
        backdrop_path: _dropBackdrop,
        poster_path: _dropPoster,
        titled_backdrop_path: _dropTitled,
        logo_path: _dropLogo,
        fallback_backdrop_path: _dropFallbackBackdrop,
        fallback_logo_path: _dropFallbackLogo,
        ...metadataOnly
      } = media;

      const netflixArtwork = nonTmdbImageUrl(netflix?.artwork?.url);
      const netflixLogo = nonTmdbImageUrl(netflix?.logo?.url);

      return {
        ...fallback,
        ...metadataOnly,
        backdrop_path: netflixArtwork || fallback.backdrop_path,
        titled_backdrop_path: netflixArtwork || fallback.titled_backdrop_path,
        poster_path: fallback.poster_path,
        logo_path: netflixLogo || fallback.logo_path,
        netflix_artwork_url: netflixArtwork || null,
        netflix_logo_url: netflixLogo || null,
        image_quality: netflix?.artwork?.quality_label || "max-native",
        image_source_policy: "netflix-cdn-saved-only",
        upscaled: false,
      };
    },
    enabled: !!id && !!enabled,
    placeholderData: fallback,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  return { ...fallback, ...(query.data || {}) };
}
