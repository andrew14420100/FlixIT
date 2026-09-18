// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { MEDIA_TYPE } from "src/types/Common";

/**
 * Card rows can contain dozens of titles. Fetching /media-assets for every
 * off-screen card makes the homepage compete with the slider animation.
 * Netflix-style previews only need the richer assets when the preview is about
 * to be shown, so defer the request until hover opens and keep it cached.
 */
export default function useDeferredMediaAssets(video: any, mediaType: any, enabled = false) {
  const typeSlug = mediaType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const id = video?.id || video?.tmdbId || video?.tmdb_id;

  const { data } = useQuery({
    queryKey: ["media-assets", typeSlug, id],
    queryFn: async () => {
      if (!id) return {};
      const response = await fetch(`/api/public/media-assets/${typeSlug}/${id}`);
      return response.ok ? response.json() : {};
    },
    enabled: !!id && !!enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  return data || {};
}
