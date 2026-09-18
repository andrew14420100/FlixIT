// @ts-nocheck
import useAutomaticMediaAssets from "./useAutomaticMediaAssets";
import useResolvedTrailer from "./useResolvedTrailer";

/**
 * Rich hover data starts loading on hover intent, before the mini-modal opens.
 * Artwork and trailer are both backed by shared React Query keys, so the same
 * title is never fetched twice just because it appears in multiple rows.
 */
export default function useDeferredMediaAssets(video: any, mediaType: any, enabled = false) {
  const id = video?.id || video?.tmdbId || video?.tmdb_id;
  const assets = useAutomaticMediaAssets(video, mediaType, enabled);
  const trailer = useResolvedTrailer(mediaType, id, enabled);

  return {
    ...(assets || {}),
    resolved_trailer: trailer.data || {},
    preview_video_url: trailer.url || null,
  };
}
