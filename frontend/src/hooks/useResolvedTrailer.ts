// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeSlug } from "./useAutomaticMediaAssets";

const TRAILER_QUERY_VERSION = "it-trailer-v2";

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
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    refetchInterval: (query: any) => {
      const data = query?.state?.data || {};
      const candidate = data?.trailer_url || data?.trailer_key || data?.manifest_url || null;
      if (!enabled || data?.enabled === false || candidate) {
        return false;
      }
      const updates = Number(query?.state?.dataUpdateCount || 0);
      return updates < 8 ? 1000 : false;
    },
  });

  const data: any = query.data || {};
  const candidateUrl = data?.trailer_url || data?.trailer_key || data?.manifest_url || null;
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
