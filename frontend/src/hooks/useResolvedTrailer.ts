// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeSlug } from "./useAutomaticMediaAssets";

const TRAILER_QUERY_VERSION = "streamingcommunity-trailers-v21-recovery";
const SC_SOURCE = "streamingcommunity";

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
  const selected = data?.selected && typeof data.selected === "object" ? data.selected : data;
  const source = String(selected?.source || data?.source || "").trim().toLowerCase();

  if (source !== SC_SOURCE) return null;

  for (const value of [
    selected?.trailer_url,
    selected?.manifest_url,
    selected?.trailer_key,
    data?.trailer_url,
    data?.manifest_url,
    data?.trailer_key,
  ]) {
    const text = String(value || "").trim();
    if (!text) continue;
    if (!(/^https?:\/\//i.test(text) || text.startsWith("/"))) continue;

    // YouTube stays blocked. SC Vixcloud embeds and direct SC trailer media are
    // both accepted and TrailerPlayer decides whether to use iframe or <video>.
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

/** Shared public trailer cache for Hero, hover cards and Detail.
 * Automatic trailer policy: StreamingCommunity Vixcloud embed or direct media. */
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
      if (candidate && data?.available !== false && data?.refresh_pending !== true) return false;

      const updates = Number(query?.state?.dataUpdateCount || 0);
      // Give background SC resolution enough time to recover a stale/empty cache
      // without hammering the API. Once a trailer is available polling stops.
      if (!candidate) return updates < 12 ? 4000 : false;
      return data?.refresh_pending === true && updates < 8 ? 5000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const data: any = query.data || {};
  const candidateUrl = directTrailerUrl(data);
  const resolverEnabled = data?.enabled !== false;
  const resolverAvailable = data?.available !== false;
  const sourceIsSc = String(data?.selected?.source || data?.source || "").toLowerCase() === SC_SOURCE;
  const url = resolverEnabled && resolverAvailable && sourceIsSc ? candidateUrl : null;

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
