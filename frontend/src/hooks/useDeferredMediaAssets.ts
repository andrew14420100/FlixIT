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
 * Hover-only deferred data. Expensive trailer/media lookups stay disabled until
 * actual pointer intent. If the Home snapshot already embedded a title logo,
 * reuse it directly instead of opening an extra media-assets request.
 */
export default function useDeferredMediaAssets(video: any, mediaType: any, enabled = false) {
  const id = video?.id || video?.tmdbId || video?.tmdb_id;
  const typeSlug = mediaTypeSlug(mediaType, video);
  const trailer = useResolvedTrailer(mediaType, id, enabled);
  const embeddedLogo = absoluteLogo(
    video?.__artwork?.logo_url ||
    video?.logo_path ||
    video?.logo ||
    video?.netflix_logo_url ||
    video?.title_logo_path
  );

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
    enabled: !!id && !!enabled && !embeddedLogo,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const fallbackLogo = embeddedLogo || absoluteLogo(mediaAssets.data?.logo_path);

  return {
    resolved_trailer: trailer.data || {},
    preview_video_url: trailer.url || null,
    logo_path: fallbackLogo || null,
    fallback_logo_path: fallbackLogo || null,
  };
}
