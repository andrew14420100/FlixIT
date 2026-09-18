// @ts-nocheck
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
 * One automatic artwork source for the public UI.
 *
 * It reads FLIX-IT's cached /api/public/media-assets endpoint only: no admin
 * setting, manual match or browser-side provider lookup is required. React Query
 * deduplicates the same title across cards, hover, Hero, Detail and player warmup.
 */
export default function useAutomaticMediaAssets(
  item: any,
  mediaType: any,
  enabled = true
) {
  const typeSlug = mediaTypeSlug(mediaType, item);
  const id = item?.id || item?.tmdbId || item?.tmdb_id;

  const query = useQuery({
    queryKey: ["media-assets", typeSlug, id],
    queryFn: async ({ signal }: any) => {
      if (!id) return {};
      const response = await fetch(`/api/public/media-assets/${typeSlug}/${id}`, {
        signal,
        headers: { Accept: "application/json" },
      });
      return response.ok ? response.json() : {};
    },
    enabled: !!id && !!enabled,
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  return query.data || {};
}
