// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeSlug } from "./useAutomaticMediaAssets";

const TRAILER_QUERY_VERSION = "auto-italian-4k-v11";

function isBlockedVideoHost(value: string) {
  try {
    const host = new URL(
      value,
      typeof window !== "undefined" ? window.location.origin : "https://flixit.local"
    ).hostname.toLowerCase();
    return (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host.endsWith(".youtu.be") ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    );
  } catch {
    return true;
  }
}

function directTrailerUrl(data: any) {
  for (const value of [data?.trailer_url, data?.manifest_url, data?.trailer_key]) {
    const text = String(value || "").trim();
    if (!text) continue;
    if (!( /^https?:\/\//i.test(text) || text.startsWith("/") )) continue;
    if (isBlockedVideoHost(text)) continue;
    return text;
  }
  return null;
}

export function browserSupportsHdr() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(dynamic-range: high)").matches;
  } catch {
    return false;
  }
}

/**
 * Shared public trailer cache for Hero, hover cards and Detail.
 * The backend automatically ranks Italian first and native quality up to 4K,
 * while the frontend only consumes the selected direct result.
 */
export default function useResolvedTrailer(mediaType: any, id: any, enabled = true) {
  const typeSlug = mediaTypeSlug(mediaType);
  const hdr = useMemo(() => browserSupportsHdr(), []);

  const query = useQuery({
    queryKey: [TRAILER_QUERY_VERSION, "resolved-trailer", typeSlug, id, hdr],
    queryFn: async ({ signal }: any) => {
      if (!id) return {};
      const response = await fetch(
        `/api/public/trailer/${typeSlug}/${id}?hdr=${hdr ? "true" : "false"}`,
        { signal, cache: "no-store", headers: { Accept: "application/json" } }
      );
      return response.ok ? response.json() : {};
    },
    enabled: !!id && !!enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    refetchInterval: (query: any) => {
      const data = query?.state?.data || {};
      const candidate = directTrailerUrl(data);
      if (!enabled || data?.enabled === false) return false;
      if (candidate && data?.available !== false && data?.refresh_pending !== true) return false;

      const updates = Number(query?.state?.dataUpdateCount || 0);
      if (!candidate) return updates < 4 ? 3500 : false;
      return data?.refresh_pending === true && updates < 3 ? 5000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const data: any = query.data || {};
  const candidateUrl = directTrailerUrl(data);
  const resolverEnabled = data?.enabled !== false;
  const resolverAvailable = data?.available !== false;
  const url = resolverEnabled && resolverAvailable ? candidateUrl : null;

  return {
    ...query,
    data,
    url,
    available: !!url,
    enabled: !!enabled && resolverEnabled,
    hdr,
    typeSlug,
  };
}
