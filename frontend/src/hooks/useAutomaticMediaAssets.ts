// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MEDIA_TYPE } from "src/types/Common";

export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/";

export function mediaTypeSlug(mediaType: any, item?: any) {
  return mediaType === MEDIA_TYPE.Tv || mediaType === "tv" || item?.type === "tv" || item?.media_type === "tv"
    ? "tv"
    : "movie";
}

export function tmdbImageUrl(value: any, size = "original") {
  if (!value) return null;
  const raw = String(value);
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) {
    return raw;
  }
  return `${TMDB_IMAGE_BASE}${size}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function firstArtworkValue(...values: any[]) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string") return value;
    if (typeof value?.url === "string") return value.url;
  }
  return null;
}

/**
 * Single automatic source for artwork used by the public UI.
 *
 * /api/public/media-assets is the authoritative source and requires no admin
 * artwork configuration. Existing artwork carried by a row item is preserved
 * only as an instant visual fallback while the automatic endpoint loads (or if
 * that endpoint is temporarily unavailable). This prevents blank cards during
 * migration without making normal artwork depend on the admin panel.
 */
export default function useAutomaticMediaAssets(
  item: any,
  mediaType: any,
  enabled = true
) {
  const typeSlug = mediaTypeSlug(mediaType, item);
  const id = item?.id || item?.tmdbId || item?.tmdb_id;

  const legacyLandscape = firstArtworkValue(
    item?.backdrop_path,
    item?.backdrop,
    item?.titled_backdrop_path,
    item?.titledBackdropPath,
    item?.netflix_artwork_url,
    item?.netflixArtworkUrl,
    item?.netflix_cover_url,
    item?.contextualArtwork?.artwork,
    item?.artwork,
    item?.image,
    item?.cover_path,
    item?.cover,
    item?.image_url,
    item?.thumbnail_url
  );

  const legacyPoster = firstArtworkValue(
    item?.poster_path,
    item?.poster,
    item?.netflix_ranked_artwork_url,
    item?.netflixRankedArtworkUrl,
    item?.netflix_cover_url,
    item?.cover_path,
    item?.cover,
    item?.image,
    item?.artwork
  );

  const legacyLogo = firstArtworkValue(
    item?.logo_path,
    item?.logo,
    item?.title_logo_path,
    item?.titleLogoPath,
    item?.contextualArtwork?.logo
  );

  const fallback = useMemo(() => ({
    tmdbId: id,
    type: typeSlug,
    title: item?.title || item?.name || "",
    backdrop_path: legacyLandscape || legacyPoster || null,
    poster_path: legacyPoster || legacyLandscape || null,
    titled_backdrop_path:
      item?.titled_backdrop_path || item?.titledBackdropPath || null,
    logo_path: legacyLogo || null,
    runtime: item?.runtime,
    number_of_seasons: item?.number_of_seasons,
    certification: item?.certification,
  }), [
    id,
    typeSlug,
    item?.title,
    item?.name,
    legacyLandscape,
    legacyPoster,
    legacyLogo,
    item?.titled_backdrop_path,
    item?.titledBackdropPath,
    item?.runtime,
    item?.number_of_seasons,
    item?.certification,
  ]);

  const query = useQuery({
    queryKey: ["media-assets", typeSlug, id],
    queryFn: async ({ signal }: any) => {
      if (!id) return fallback;
      const response = await fetch(`/api/public/media-assets/${typeSlug}/${id}`, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return fallback;
      const data = await response.json();

      // Never let null/empty values returned by the automatic endpoint erase a
      // cover that the row already has. Valid automatic values still win.
      return {
        ...fallback,
        ...(data || {}),
        backdrop_path:
          data?.backdrop_path || data?.titled_backdrop_path || fallback.backdrop_path,
        poster_path: data?.poster_path || fallback.poster_path,
        titled_backdrop_path:
          data?.titled_backdrop_path || fallback.titled_backdrop_path,
        logo_path: data?.logo_path || fallback.logo_path,
      };
    },
    enabled: !!id && !!enabled,
    placeholderData: fallback,
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  return { ...fallback, ...(query.data || {}) };
}
