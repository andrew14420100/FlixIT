// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeSlug } from "./useAutomaticMediaAssets";

const TRAILER_QUERY_VERSION = "direct-it-official-second-pass-v7";

function directTrailerUrl(data: any) {
  for (const value of [data?.trailer_url, data?.manifest_url, data?.trailer_key]) {
    const text = String(value || "").trim();
    if (/^https?:\/\//i.test(text) || text.startsWith("/")) return text;
  }
  return null;
}

function isItalianLanguage(value: any) {
  const lang = String(value || "").trim().toLowerCase().replace("_", "-");
  return lang === "it" || lang.startsWith("it-") || lang === "ita" || lang.includes("italian");
}

export function browserSupportsHdr() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(dynamic-range: high)").matches;
  } catch {
    return false;
  }
}

/** Shared public trailer cache for Hero, hover cards and DetailPage. */
export default function useResolvedTrailer(
  mediaType: any,
  id: any,
  enabled = true
) {
  const typeSlug = mediaTypeSlug(mediaType);
  const hdr = useMemo(() => browserSupportsHdr(), []);

  const query = useQuery({
    queryKey: [TRAILER_QUERY_VERSION, "resolved-trailer", typeSlug, id, hdr],
    queryFn: async ({ signal }: any) => {
      if (!id) return {};
      const response = await fetch(
        `/api/public/trailer/${typeSlug}/${id}?hdr=${hdr ? "true" : "false"}`,
        {
          signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        }
      );
      return response.ok ? response.json() : {};
    },
    enabled: !!id && !!enabled,
    staleTime: 15 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    refetchInterval: (query: any) => {
      const data = query?.state?.data || {};
      const candidate = directTrailerUrl(data);
      if (!enabled || data?.enabled === false) return false;

      // An English trailer remains playable immediately, but the backend is
      // allowed a short second-pass window to replace it with an official
      // Italian trailer/teaser. Italian candidates stop polling at once.
      if (candidate && isItalianLanguage(data?.language || data?.candidate?.audio_language)) return false;

      const updates = Number(query?.state?.dataUpdateCount || 0);
      const backendRefreshing = data?.refresh_pending === true;
      if (!candidate) return updates < 10 ? 2000 : false;
      if (backendRefreshing || !isItalianLanguage(data?.language || data?.candidate?.audio_language)) {
        return updates < 8 ? 2500 : false;
      }
      return false;
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
