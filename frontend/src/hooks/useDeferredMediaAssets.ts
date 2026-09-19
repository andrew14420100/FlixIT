// @ts-nocheck
import useResolvedTrailer from "./useResolvedTrailer";

/**
 * Hover-only deferred data. Artwork is hydrated separately by the row-level
 * batch pipeline; keeping another artwork hook here doubled React work even when
 * React Query prevented the second network request.
 */
export default function useDeferredMediaAssets(video: any, mediaType: any, enabled = false) {
  const id = video?.id || video?.tmdbId || video?.tmdb_id;
  const trailer = useResolvedTrailer(mediaType, id, enabled);

  return {
    resolved_trailer: trailer.data || {},
    preview_video_url: trailer.url || null,
  };
}
