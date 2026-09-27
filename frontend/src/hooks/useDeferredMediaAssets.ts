// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import useResolvedTrailer from "./useResolvedTrailer";
import { browserSafeArtworkUrl, mediaTypeSlug } from "./useAutomaticMediaAssets";

function scLogo(value: any) {
  const raw = typeof value === "string" ? value : value?.url;
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/image\.tmdb\.org/i.test(text)) return null;
  return browserSafeArtworkUrl(text);
}

function isScSource(value: any) {
  const source = String(value || "").trim().toLowerCase();
  return source === "streamingcommunity" || source.startsWith("streamingcommunity_");
}

/**
 * Hover-only deferred data. The Home bootstrap already carries the fast static
 * SC artwork. Some catalogue/search rows do not expose their title-logo even
 * though the exact SC detail page does. In that case resolve the official-artwork
 * endpoint only after hover intent: the backend's exact SC detail-page resolver
 * can recover the logo without slowing the initial Home render.
 */
export default function useDeferredMediaAssets(video: any, mediaType: any, enabled = false) {
  const id = video?.id || video?.tmdbId || video?.tmdb_id;
  const typeSlug = mediaTypeSlug(mediaType, video);
  const trailer = useResolvedTrailer(mediaType, id, enabled);
  const embeddedLogo = scLogo(video?.__artwork?.logo_url);

  const logoQuery = useQuery({
    queryKey: ["deferred-sc-logo-v3", typeSlug, id],
    queryFn: async ({ signal }: any) => {
      const response = await fetch(`/api/public/official-artwork/${typeSlug}/${id}`, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return {};
      return response.json();
    },
    enabled: !!enabled && !!id && !embeddedLogo,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const resolvedLogo = isScSource(logoQuery.data?.logo_source)
    ? scLogo(logoQuery.data?.logo_url)
    : null;
  const logo = embeddedLogo || resolvedLogo || null;

  return {
    resolved_trailer: trailer.data || {},
    preview_video_url: trailer.url || null,
    logo_path: logo,
    fallback_logo_path: logo,
    logo_source: logo ? "streamingcommunity" : null,
    type: typeSlug,
  };
}
