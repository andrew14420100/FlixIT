// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MEDIA_TYPE } from "src/types/Common";

const TMDB_ORIGINAL = "https://image.tmdb.org/t/p/original";

function originalUrl(value: any) {
  if (!value) return null;
  const raw = String(value);
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) {
    return raw;
  }
  return `${TMDB_ORIGINAL}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

/**
 * Automatic, public artwork resolver used by every card surface.
 *
 * It deliberately does not depend on an admin toggle, Netflix cookies or a
 * browser-side provider search.  The backend media-assets pipeline resolves
 * and caches TMDB identity/images once; this hook only reads that cache and
 * asks the TMDB image CDN for the original source rendition.  React Query's
 * shared `media-assets` key means Hero/cards that ask for the same title reuse
 * one response instead of issuing duplicate requests.
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

  const { data, isFetching } = useQuery({
    queryKey: ["media-assets", type, id],
    queryFn: async ({ signal }: any) => {
      if (!id) return {};
      const response = await fetch(`/api/public/media-assets/${type}/${id}`, {
        signal,
        headers: { Accept: "application/json" },
      });
      return response.ok ? response.json() : {};
    },
    enabled: !!id && !!shouldLoad,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const resolved = useMemo(() => {
    const assets = data || {};
    const isTop10 = String(context || "").toLowerCase() === "top10";

    // Top 10 needs a portrait source.  Standard/home/detail cards use the
    // clean horizontal backdrop first; titled artwork remains a fallback.
    const visualPath = isTop10
      ? assets.poster_path || assets.backdrop_path || assets.titled_backdrop_path
      : assets.backdrop_path || assets.titled_backdrop_path || assets.poster_path;

    const artworkUrl = originalUrl(visualPath);
    const logoUrl = originalUrl(assets.logo_path);

    return {
      enabled: true,
      active: !!(artworkUrl || logoUrl),
      artwork: artworkUrl
        ? {
            url: artworkUrl,
            path: visualPath,
            source: "tmdb-auto",
            type: isTop10 ? "poster" : "backdrop",
          }
        : null,
      logo: logoUrl
        ? {
            url: logoUrl,
            path: assets.logo_path,
            source: "tmdb-auto",
            type: "logo",
          }
        : null,
      netflixId: null,
      status: artworkUrl || logoUrl ? "resolved" : "missing",
      region: "IT",
      assets,
    };
  }, [data, context]);

  return {
    ...resolved,
    isFetching,
  };
}
