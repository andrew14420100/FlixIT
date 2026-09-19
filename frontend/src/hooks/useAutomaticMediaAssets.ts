// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MEDIA_TYPE } from "src/types/Common";
import { getCDNImageUrl } from "src/config/cdnMapping";

export const TMDB_IMAGE_BASE = "";
const MEDIA_ASSET_QUALITY_VERSION = "official-artwork-v1";

export function mediaTypeSlug(mediaType: any, item?: any) {
  return mediaType === MEDIA_TYPE.Tv || mediaType === "tv" || item?.type === "tv" || item?.media_type === "tv"
    ? "tv"
    : "movie";
}

function rawArtwork(value: any) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value?.url === "string") return value.url;
  if (typeof value?.artwork?.url === "string") return value.artwork.url;
  return null;
}

export function nonTmdbImageUrl(value: any) {
  const raw = rawArtwork(value);
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith("data:") || text.startsWith("blob:")) return text;
  if (!/^https?:\/\//i.test(text)) return null;
  if (/^https?:\/\/image\.tmdb\.org\//i.test(text)) return null;
  return text;
}

// Compatibility helper retained for older callers. It deliberately accepts only
// already-resolved non-TMDB URLs.
export function tmdbImageUrl(value: any, _size = "original") {
  return nonTmdbImageUrl(value);
}

function firstNonTmdbArtwork(...values: any[]) {
  for (const value of values) {
    const resolved = nonTmdbImageUrl(value);
    if (resolved) return resolved;
  }
  return null;
}

export default function useAutomaticMediaAssets(
  item: any,
  mediaType: any,
  enabled = true
) {
  const typeSlug = mediaTypeSlug(mediaType, item);
  const id = item?.id || item?.tmdbId || item?.tmdb_id;

  const itemNetflixLandscape = firstNonTmdbArtwork(
    item?.netflix_artwork_url,
    item?.netflixArtworkUrl,
    item?.netflix_cover_url,
    item?.contextualArtwork?.artwork
  );
  const itemNetflixPoster = firstNonTmdbArtwork(
    item?.netflix_ranked_artwork_url,
    item?.netflixRankedArtworkUrl,
    item?.netflix_cover_url
  );

  // Preserve the existing project mapping as the historical fallback requested
  // by the site, but never extend/scrape it here.
  const mappedBackdrop = id
    ? getCDNImageUrl(Number(id), "backdrop") || getCDNImageUrl(Number(id), "detail_backdrop")
    : null;
  const mappedPoster = id ? getCDNImageUrl(Number(id), "poster") : null;

  const savedLandscape = firstNonTmdbArtwork(
    item?.backdrop_path,
    item?.backdrop,
    item?.titled_backdrop_path,
    item?.titledBackdropPath,
    item?.artwork,
    item?.image,
    item?.cover_path,
    item?.cover,
    item?.image_url,
    item?.thumbnail_url
  );
  const savedPoster = firstNonTmdbArtwork(
    item?.poster_path,
    item?.poster,
    item?.cover_path,
    item?.cover,
    item?.image,
    item?.artwork
  );
  const savedLogo = firstNonTmdbArtwork(
    item?.netflix_logo_url,
    item?.logo_path,
    item?.logo,
    item?.title_logo_path,
    item?.titleLogoPath,
    item?.contextualArtwork?.logo
  );

  const fallback = useMemo(() => ({
    tmdbId: id,
    type: typeSlug,
    title: item?.title || item?.name || "",
    backdrop_path: itemNetflixLandscape || mappedBackdrop || savedLandscape || null,
    poster_path: itemNetflixPoster || mappedPoster || savedPoster || itemNetflixLandscape || null,
    titled_backdrop_path: itemNetflixLandscape || mappedBackdrop || savedLandscape || null,
    logo_path: savedLogo || null,
    runtime: item?.runtime,
    number_of_seasons: item?.number_of_seasons,
    certification: item?.certification,
    image_quality: "max-native",
    image_source_policy: "netflix-existing-apple-imdb-no-tmdb-images",
  }), [
    id,
    typeSlug,
    item?.title,
    item?.name,
    itemNetflixLandscape,
    itemNetflixPoster,
    mappedBackdrop,
    mappedPoster,
    savedLandscape,
    savedPoster,
    savedLogo,
    item?.runtime,
    item?.number_of_seasons,
    item?.certification,
  ]);

  const query = useQuery({
    queryKey: ["media-assets", MEDIA_ASSET_QUALITY_VERSION, typeSlug, id],
    queryFn: async ({ signal }: any) => {
      if (!id) return fallback;

      const [metadataResult, officialResult] = await Promise.allSettled([
        fetch(`/api/public/media-assets/${typeSlug}/${id}`, {
          signal,
          headers: { Accept: "application/json" },
        }).then(async (response) => response.ok ? response.json() : {}),
        fetch(`/api/public/official-artwork/${typeSlug}/${id}`, {
          signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        }).then(async (response) => response.ok ? response.json() : {}),
      ]);

      const media = metadataResult.status === "fulfilled" ? (metadataResult.value || {}) : {};
      const official = officialResult.status === "fulfilled" ? (officialResult.value || {}) : {};

      // /api/public/media-assets still contains legacy TMDB image paths internally.
      // Keep only non-visual metadata from it. All visuals below come from the
      // unified official resolver or the pre-existing project mapping/saved URLs.
      const {
        backdrop_path: _dropBackdrop,
        poster_path: _dropPoster,
        titled_backdrop_path: _dropTitled,
        logo_path: _dropLogo,
        fallback_backdrop_path: _dropFallbackBackdrop,
        fallback_logo_path: _dropFallbackLogo,
        ...metadataOnly
      } = media;

      const netflixLandscape = firstNonTmdbArtwork(
        official?.netflix?.landscape_url,
        official?.netflix?.artwork_url
      );
      const netflixPoster = firstNonTmdbArtwork(
        official?.netflix?.poster_url,
        official?.netflix?.landscape_url
      );
      const netflixLogo = firstNonTmdbArtwork(official?.netflix?.logo_url);

      const officialFallbackLandscape = firstNonTmdbArtwork(
        official?.fallback?.landscape_url,
        official?.fallback?.poster_url
      );
      const officialFallbackPoster = firstNonTmdbArtwork(
        official?.fallback?.poster_url,
        official?.fallback?.landscape_url
      );
      const officialFallbackLogo = firstNonTmdbArtwork(official?.fallback?.logo_url);

      // Required order for visuals:
      // Netflix -> existing historical mapping -> Apple/iTunes -> IMDb -> saved
      // non-TMDB asset. No TMDB image is ever promoted into the UI.
      const landscape =
        netflixLandscape ||
        itemNetflixLandscape ||
        mappedBackdrop ||
        officialFallbackLandscape ||
        savedLandscape ||
        null;
      const poster =
        netflixPoster ||
        itemNetflixPoster ||
        mappedPoster ||
        officialFallbackPoster ||
        savedPoster ||
        landscape ||
        null;
      const logo =
        netflixLogo ||
        officialFallbackLogo ||
        savedLogo ||
        null;

      return {
        ...fallback,
        ...metadataOnly,
        title: official?.title || metadataOnly?.title || fallback.title,
        backdrop_path: landscape,
        titled_backdrop_path: landscape,
        poster_path: poster,
        logo_path: logo,
        netflix_artwork_url: netflixLandscape || null,
        netflix_ranked_artwork_url: netflixPoster || null,
        netflix_logo_url: netflixLogo || null,
        official_artwork_source: official?.source || official?.fallback?.source || null,
        embedded_title_treatment: !!official?.embedded_title_treatment,
        image_quality: "max-native",
        image_source_policy: "netflix-existing-apple-imdb-no-tmdb-images",
        upscaled: false,
      };
    },
    enabled: !!id && !!enabled,
    placeholderData: fallback,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  return { ...fallback, ...(query.data || {}) };
}
