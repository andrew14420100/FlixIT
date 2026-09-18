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
 * Rich card data is loaded only after the expanded hover is really open.
 * Provider discovery never runs in the browser: /api/public/trailer reads the
 * already-resolved Mongo cache and may only enqueue an asynchronous refresh.
 */
export default function useDeferredMediaAssets(video: any, mediaType: any, enabled = false) {
  const typeSlug = mediaType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const id = video?.id || video?.tmdbId || video?.tmdb_id;

  const { data } = useQuery({
    queryKey: ["media-assets-with-trailer", typeSlug, id, supportsHdr()],
    queryFn: async () => {
      if (!id) return {};
      const hdr = supportsHdr();
      const [assetsResponse, trailerResponse] = await Promise.all([
        fetch(`/api/public/media-assets/${typeSlug}/${id}`),
        fetch(`/api/public/trailer/${typeSlug}/${id}?hdr=${hdr ? "true" : "false"}`, { cache: "no-store" }),
      ]);
      const assets = assetsResponse.ok ? await assetsResponse.json() : {};
      const trailer = trailerResponse.ok ? await trailerResponse.json() : {};
      const resolvedUrl = trailer?.enabled && trailer?.available
        ? (trailer?.trailer_url || trailer?.trailer_key || trailer?.manifest_url)
        : null;
      return {
        ...assets,
        resolved_trailer: trailer,
        // ExpandedCard already understands preview_video_url as a direct video.
        // Do not inject legacy YouTube keys into the native preview path.
        preview_video_url: resolvedUrl || assets?.preview_video_url || null,
      };
    },
    enabled: !!id && !!enabled,
    staleTime: 15 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  return data || {};
}
