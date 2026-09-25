// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeSlug } from "./useAutomaticMediaAssets";

const TRAILER_QUERY_VERSION = "streamingcommunity-trailers-v25-catalog-first";
const SC_SOURCE = "streamingcommunity";
const SC_YOUTUBE_PREFIX = "/__sc-youtube/";

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

function youtubeId(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    let id = "";
    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      id = url.pathname.split("/").filter(Boolean)[0] || "";
    } else {
      id = url.searchParams.get("v") || "";
      if (!id) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (["embed", "shorts", "live"].includes(String(parts[0] || "").toLowerCase())) {
          id = parts[1] || "";
        }
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function directTrailerUrl(data: any) {
  const selected = data?.selected && typeof data.selected === "object" ? data.selected : data;
  const source = String(selected?.source || data?.source || "").trim().toLowerCase();

  if (source !== SC_SOURCE) return null;

  const scYoutubeMetadata = selected?.metadata?.sc_youtube_metadata === true;

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

    if (isYouTubeHost(text)) {
      if (!scYoutubeMetadata) continue;
      const id = youtubeId(text);
      if (!id) continue;
      // Never expose a generic YouTube URL to the rest of the UI. The sentinel
      // is created only after the backend proves it came from SC youtube_id
      // metadata, and TrailerPlayer turns it into a privacy-enhanced embed.
      return `${SC_YOUTUBE_PREFIX}${id}.m3u8`;
    }
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
 * Automatic trailer policy: SC Vixcloud/direct media, plus YouTube only when SC
 * explicitly publishes youtube_id for the exact matched title. */
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
