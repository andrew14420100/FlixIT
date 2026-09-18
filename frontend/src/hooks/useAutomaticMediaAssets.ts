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

/**
 * Single automatic source for artwork used by the public UI.
 *
 * /api/public/media-assets is authoritative and requires no admin artwork
 * configuration.  The list item itself is kept only as an instant visual
 * fallback while the shared media-assets request is in flight or temporarily
 * unavailable, so cards never become blank during the hand-off.
 */
export default function useAutomaticMediaAssets(
  item: any,
  mediaType: any,
  enabled = true
) {
  const typeSlug = mediaTypeSlug(mediaType, item);
  const id = item?.id || item?.tmdbId || item?.tmdb_id;

  const fallback = useMemo(() => ({
    tmdbId: id,
    type: typeSlug,
    title: item?.title || item?.name || "",
    backdrop_path: item?.backdrop_path || item?.backdrop || null,
    poster_path: item?.poster_path || item?.poster || null,
    titled_backdrop_path: item?.titled_backdrop_path || item?.titledBackdropPath || null,
    logo_path: item?.logo_path || item?.logo || item?.title_logo_path || null,
    runtime: item?.runtime,
    number_of_seasons: item?.number_of_seasons,
    certification: item?.certification,
  }), [
    id,
    typeSlug,
    item?.title,
    item?.name,
    item?.backdrop_path,
    item?.backdrop,
    item?.poster_path,
    item?.poster,
    item?.titled_backdrop_path,
    item?.titledBackdropPath,
    item?.logo_path,
    item?.logo,
    item?.title_logo_path,
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
      return { ...fallback, ...(data || {}) };
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
