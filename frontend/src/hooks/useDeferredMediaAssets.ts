// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import useResolvedTrailer from "./useResolvedTrailer";
import { mediaTypeSlug } from "./useAutomaticMediaAssets";

const TMDB_ORIGINAL = "https://image.tmdb.org/t/p/original";

function absoluteLogo(value: any) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
  if (raw.startsWith("/")) return `${TMDB_ORIGINAL}${raw}`;
  return null;
}

/**
 * Hover-only deferred data.
 * Trailer + fallback logo are prefetched as cards approach the viewport, so
 * every hover can respect the same 2-second start window instead of waiting on
 * cold resolver/network work after the pointer is already over the card.
 */
export default function useDeferredMediaAssets(video: any, mediaType: any, enabled = false) {
  const id = video?.id || video?.tmdbId || video?.tmdb_id;
  const typeSlug = mediaTypeSlug(mediaType, video);
  const trailer = useResolvedTrailer(mediaType, id, enabled);

  const mediaAssets = useQuery({
    queryKey: ["hover-media-assets", typeSlug, id],
    queryFn: async ({ signal }: any) => {
      if (!id) return {};
      const response = await fetch(`/api/public/media-assets/${typeSlug}/${id}`, {
        signal,
        headers: { Accept: "application/json" },
      });
      return response.ok ? response.json() : {};
    },
    enabled: !!id && !!enabled,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const fallbackLogo = absoluteLogo(mediaAssets.data?.logo_path);

  return {
    resolved_trailer: trailer.data || {},
    preview_video_url: trailer.url || null,
    logo_path: fallbackLogo || null,
    fallback_logo_path: fallbackLogo || null,
  };
}
