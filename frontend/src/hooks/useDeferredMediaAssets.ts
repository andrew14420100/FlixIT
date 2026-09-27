// @ts-nocheck
import useResolvedTrailer from "./useResolvedTrailer";
import { browserSafeArtworkUrl, mediaTypeSlug } from "./useAutomaticMediaAssets";

function scLogo(value: any) {
  const raw = typeof value === "string" ? value : value?.url;
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/image\.tmdb\.org/i.test(text)) return null;
  return browserSafeArtworkUrl(text);
}

/**
 * Hover-only deferred data. Trailer resolution stays hover-only. Title logos are
 * deliberately SC-only: if the Home/bootstrap item does not contain an SC logo,
 * the card falls back to textual title instead of requesting TMDB/Netflix/etc.
 */
export default function useDeferredMediaAssets(video: any, mediaType: any, enabled = false) {
  const id = video?.id || video?.tmdbId || video?.tmdb_id;
  const typeSlug = mediaTypeSlug(mediaType, video);
  const trailer = useResolvedTrailer(mediaType, id, enabled);
  const embeddedLogo = scLogo(video?.__artwork?.logo_url);

  return {
    resolved_trailer: trailer.data || {},
    preview_video_url: trailer.url || null,
    logo_path: embeddedLogo || null,
    fallback_logo_path: embeddedLogo || null,
    logo_source: embeddedLogo ? "streamingcommunity" : null,
    type: typeSlug,
  };
}
