// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeSlug } from "./useAutomaticMediaAssets";

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
    queryKey: ["resolved-trailer", typeSlug, id, hdr],
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
      const data = query?.state?.data;
      if (!enabled || !data?.enabled || data?.available) return false;
      // A cold title may need a few seconds for the backend worker, but a title
      // with no trailer must never leave the Hero polling once per second all
      // day. Eight cache checks are enough for the foreground; the backend queue
      // continues independently and a later page visit can pick up the result.
      const updates = Number(query?.state?.dataUpdateCount || 0);
      return updates < 8 ? 1000 : false;
    },
  });

  const data: any = query.data || {};
  const url = data?.enabled && data?.available
    ? (data?.trailer_url || data?.trailer_key || data?.manifest_url || null)
    : null;

  return {
    ...query,
    data,
    url,
    available: !!url,
    enabled: !!data?.enabled,
    hdr,
    typeSlug,
  };
}
