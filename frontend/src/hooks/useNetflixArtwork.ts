// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { MEDIA_TYPE } from "src/types/Common";

const ARTWORK_QUERY_VERSION = "netflix-native-v5";

function profileId() {
  if (typeof window === "undefined") return "guest";
  return window.localStorage.getItem("netflix_user_id") || "guest";
}

function viewport() {
  if (typeof window === "undefined") return "desktop";
  return window.innerWidth < 700 ? "mobile" : "desktop";
}

/**
 * Resolve the existing Netflix artwork provider directly. The config endpoint
 * remains useful for status/region, but an old cached `enabled:false` value must
 * never prevent a title from asking the backend for artwork: the backend now
 * knows whether a live session or a previously cached Netflix match is usable.
 */
export default function useNetflixArtwork(
  item: any,
  mediaType: any,
  context = "home",
  shouldLoad = true
) {
  const type =
    mediaType === MEDIA_TYPE.Tv || item?.type === "tv" || item?.media_type === "tv"
      ? "tv"
      : "movie";
  const id = item?.id || item?.tmdbId || item?.tmdb_id;

  const { data: config } = useQuery({
    queryKey: ["netflix-artwork-config", ARTWORK_QUERY_VERSION],
    queryFn: async () => {
      const response = await fetch("/api/player/artwork/config", { cache: "no-store" });
      return response.ok ? response.json() : { enabled: false, region: "IT" };
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const profile = profileId();
  const device = viewport();
  const enabled = !!id && !!shouldLoad;

  const { data, isFetching } = useQuery({
    queryKey: [ARTWORK_QUERY_VERSION, "netflix-artwork", type, id, context, device, profile],
    queryFn: async () => {
      const params = new URLSearchParams({
        context,
        viewport: device,
        profile_id: profile,
      });
      const response = await fetch(
        `/api/player/artwork/${type}/${id}?${params.toString()}`,
        { cache: "no-store" }
      );
      return response.ok ? response.json() : { active: false };
    },
    enabled,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  return {
    enabled: !!(data?.enabled ?? config?.enabled),
    active: !!data?.active,
    artwork: data?.artwork || null,
    logo: data?.logo || null,
    netflixId: data?.netflix_id || null,
    status: data?.status || null,
    region: data?.region || config?.region || "IT",
    isFetching,
  };
}
