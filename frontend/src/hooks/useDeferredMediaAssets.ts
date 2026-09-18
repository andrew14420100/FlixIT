// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { MEDIA_TYPE } from "src/types/Common";

function supportsHdr() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(dynamic-range: high)").matches;
  } catch {
    return false;
  }
}

/**
 * Load rich card metadata only when the pointer has shown hover intent.
 *
 * Artwork uses the same React Query key as the automatic artwork hook, so a
 * near-viewport preload is reused here without a second HTTP request. Trailer
 * resolution is a separate lightweight cache read and begins on hover intent,
 * before the mini-modal has finished opening. The media file itself is still
 * mounted only by HoverTrailerOverlay, avoiding unnecessary video downloads.
 */
export default function useDeferredMediaAssets(video: any, mediaType: any, enabled = false) {
  const typeSlug = mediaType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const id = video?.id || video?.tmdbId || video?.tmdb_id;
  const hdr = supportsHdr();

  const { data: assets } = useQuery({
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
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const { data: trailer } = useQuery({
    queryKey: ["resolved-trailer", typeSlug, id, hdr],
    queryFn: async ({ signal }: any) => {
      if (!id) return {};
      const response = await fetch(
        `/api/public/trailer/${typeSlug}/${id}?hdr=${hdr ? "true" : "false"}`,
        {
          signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        }
      );
      return response.ok ? response.json() : {};
    },
    enabled: !!id && !!enabled,
    staleTime: 12 * 60 * 1000,
    gcTime: 3 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    refetchInterval: (query: any) => {
      const value = query?.state?.data;
      if (!enabled || !value?.enabled || value?.available) return false;
      return 1200;
    },
  });

  const resolvedUrl = trailer?.enabled && trailer?.available
    ? (trailer?.trailer_url || trailer?.trailer_key || trailer?.manifest_url)
    : null;

  return {
    ...(assets || {}),
    resolved_trailer: trailer || {},
    preview_video_url: resolvedUrl || null,
  };
}
