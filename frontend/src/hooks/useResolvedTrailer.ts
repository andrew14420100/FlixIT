// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeSlug } from "./useAutomaticMediaAssets";

const TRAILER_QUERY_VERSION = "direct-nonyoutube-web-italian-only-v29";

function isYouTubeHost(value: string) {
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
    return false;
  }
}

function directTrailerUrl(data: any) {
  const selected = data?.selected && typeof data.selected === "object"
    ? data.selected
    : data?.candidate && typeof data.candidate === "object"
    ? data.candidate
    : data;

  for (const value of [
    selected?.trailer_url,
    selected?.manifest_url,
    selected?.stream_url,
    selected?.url,
    selected?.trailer_key,
    data?.trailer_url,
    data?.manifest_url,
    data?.stream_url,
    data?.trailer_key,
  ]) {
    const text = String(value || "").trim();
    if (!text) continue;
    if (!(/^https?:\/\//i.test(text) || text.startsWith("/"))) continue;
    if (/^\/__sc-youtube\//i.test(text)) continue;
    if (isYouTubeHost(text)) continue;
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
 * Shared direct-media trailer resolver for Hero, Detail and hover cards.
 * Automatic playback is Italian-only and YouTube is always rejected.
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
    staleTime: 10 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    refetchInterval: (query: any) => {
      const data = query?.state?.data || {};
      const candidate = directTrailerUrl(data);
      if (!enabled || data?.enabled === false) return false;
      if (
        candidate &&
        data?.available !== false &&
        data?.language_verified === true &&
        data?.refresh_pending !== true
      ) {
        return false;
      }
      if (data?.refresh_pending !== true) return false;
      const updates = Number(query?.state?.dataUpdateCount || 0);
      return updates < 6 ? 6000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const data: any = query.data || {};
  const candidateUrl = directTrailerUrl(data);
  const resolverEnabled = data?.enabled !== false;
  const resolverAvailable = data?.available !== false;
  const selected = data?.selected || data?.candidate || {};
  const source = String(selected?.source || data?.source || "").trim().toLowerCase() || null;
  const italianVerified = data?.language_verified === true && data?.italian_only === true;
  const url = resolverEnabled && resolverAvailable && italianVerified ? candidateUrl : null;

  return {
    ...query,
    data,
    url,
    source,
    available: !!url,
    enabled: !!enabled && resolverEnabled,
    hdr,
    typeSlug,
  };
}
