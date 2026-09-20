// @ts-nocheck
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MEDIA_TYPE } from "src/types/Common";
import { getCDNImageUrl } from "src/config/cdnMapping";

export const TMDB_IMAGE_BASE = "";
export const MEDIA_ASSET_QUALITY_VERSION = "official-artwork-v11-sc-exhaustive";
export const DAILY_ARTWORK_REFRESH_MS = 24 * 60 * 60 * 1000;

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

export function isEmbeddedCardArtwork(value: any) {
  const url = firstNonTmdbArtwork(value);
  if (!url) return false;
  return (
    /cdn\.streamingcommunityz\.ninja\/images\//i.test(url) ||
    /raw\.githubusercontent\.com\//i.test(url) ||
    /(?:^|\.)githubusercontent\.com\//i.test(url) ||
    /github\.com\/[^/]+\/[^/]+\/(?:raw|blob)\//i.test(url) ||
    /cdn\.jsdelivr\.net\/gh\//i.test(url)
  );
}

function fallbackSource(url: any, mapped: boolean) {
  if (mapped) return "streamingcommunity_mapping";
  const text = String(url || "");
  if (
    /raw\.githubusercontent\.com\//i.test(text) ||
    /(?:^|\.)githubusercontent\.com\//i.test(text) ||
    /github\.com\/[^/]+\/[^/]+\/(?:raw|blob)\//i.test(text) ||
    /cdn\.jsdelivr\.net\/gh\//i.test(text)
  ) {
    return "github_embedded";
  }
  return "saved_embedded";
}

export function buildMediaAssetFallback(item: any, mediaType: any) {
  const typeSlug = mediaTypeSlug(mediaType, item);
  const id = item?.id || item?.tmdbId || item?.tmdb_id;

  const mappedBackdrop = id ? getCDNImageUrl(Number(id), "backdrop") : null;
  const mappedPoster = id ? getCDNImageUrl(Number(id), "poster") : null;
  const mappedDetailBackdrop = id ? getCDNImageUrl(Number(id), "detail_backdrop") : null;

  const savedLandscape = firstNonTmdbArtwork(
    item?.netflix_artwork_url,
    item?.netflixArtworkUrl,
    item?.netflix_cover_url,
    item?.contextualArtwork?.artwork,
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
    item?.netflix_ranked_artwork_url,
    item?.netflixRankedArtworkUrl,
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

  const savedLandscapeEmbedded = !!(
    item?.backdrop_embedded_title_treatment ||
    item?.embedded_title_treatment ||
    item?.has_embedded_title_treatment ||
    isEmbeddedCardArtwork(savedLandscape)
  );

  const cardBackdrop = mappedBackdrop || null;
  const cardPoster = mappedPoster || null;
  const cardBackdropEmbedded = !!cardBackdrop;
  const cardPosterEmbedded = !!cardPoster;
  const cardReady = !!cardBackdrop;
  const posterReady = !!cardPoster;

  return {
    tmdbId: id,
    type: typeSlug,
    title: item?.title || item?.name || "",
    backdrop_path: cardBackdrop,
    poster_path: cardPoster,
    titled_backdrop_path: cardBackdropEmbedded ? cardBackdrop : null,
    hero_backdrop_path: savedLandscape || mappedDetailBackdrop || mappedBackdrop || null,
    detail_backdrop_path: mappedDetailBackdrop || savedLandscape || mappedBackdrop || null,
    logo_path: savedLogo || null,
    backdrop_embedded_title_treatment: cardBackdropEmbedded,
    poster_embedded_title_treatment: cardPosterEmbedded,
    hero_embedded_title_treatment: !!(
      savedLandscape && (savedLandscapeEmbedded || isEmbeddedCardArtwork(savedLandscape))
    ),
    card_ready: cardReady,
    top10_ready: posterReady,
    landscape_card_ready: cardReady,
    poster_card_ready: posterReady,
    complete: !!(cardReady && posterReady),
    runtime: item?.runtime,
    number_of_seasons: item?.number_of_seasons,
    certification: item?.certification,
    image_quality: "max-native",
    image_source_policy: "streamingcommunity-exhaustive_v11_no-detail-background-as-card",
    backdrop_source: cardBackdrop
      ? fallbackSource(cardBackdrop, !!mappedBackdrop && cardBackdrop === mappedBackdrop)
      : null,
    poster_source: cardPoster
      ? fallbackSource(cardPoster, !!mappedPoster && cardPoster === mappedPoster)
      : null,
    mapped_backdrop: mappedBackdrop,
    mapped_poster: mappedPoster,
    mapped_detail_backdrop: mappedDetailBackdrop,
  };
}

export function mergeOfficialArtwork(fallback: any, official: any) {
  const officialLandscape = firstNonTmdbArtwork(official?.backdrop_url);
  const officialPoster = firstNonTmdbArtwork(official?.poster_url);
  const officialHero = firstNonTmdbArtwork(
    official?.hero_backdrop_url,
    official?.detail_backdrop_url,
    official?.backdrop_url
  );
  const officialLogo = firstNonTmdbArtwork(official?.logo_url);

  const officialLandscapeEmbedded = !!(
    officialLandscape && official?.backdrop_embedded_title_treatment
  );
  const officialPosterEmbedded = !!(
    officialPoster && official?.poster_embedded_title_treatment
  );
  const officialIsStreamingCommunity = !!(
    official?.backdrop_source === "streamingcommunity" ||
    official?.poster_source === "streamingcommunity"
  );

  const fallbackLandscape = fallback?.backdrop_embedded_title_treatment
    ? firstNonTmdbArtwork(fallback?.backdrop_path)
    : null;
  const fallbackPoster = fallback?.poster_embedded_title_treatment
    ? firstNonTmdbArtwork(fallback?.poster_path)
    : null;

  const backdrop = officialIsStreamingCommunity && officialLandscapeEmbedded
    ? officialLandscape
    : (fallbackLandscape || (officialLandscapeEmbedded ? officialLandscape : null));
  const poster = officialIsStreamingCommunity && officialPosterEmbedded
    ? officialPoster
    : (fallbackPoster || (officialPosterEmbedded ? officialPoster : null));
  const hero = officialHero || fallback?.hero_backdrop_path || backdrop || null;
  const logo = officialLogo || fallback?.logo_path || null;

  const usingFallbackBackdrop = !!fallbackLandscape && backdrop === fallbackLandscape;
  const usingFallbackPoster = !!fallbackPoster && poster === fallbackPoster;
  const backdropEmbedded = !!backdrop;
  const posterEmbedded = !!poster;
  const cardReady = !!backdrop;
  const top10Ready = !!poster;

  return {
    ...fallback,
    title: official?.title || fallback?.title || "",
    backdrop_path: backdrop,
    titled_backdrop_path: backdropEmbedded ? backdrop : null,
    poster_path: poster,
    hero_backdrop_path: hero,
    detail_backdrop_path: firstNonTmdbArtwork(official?.detail_backdrop_url) || fallback?.detail_backdrop_path || hero,
    logo_path: logo,
    netflix_logo_url: official?.logo_source === "netflix" ? officialLogo : null,
    official_artwork_source:
      official?.backdrop_source || official?.poster_source || official?.hero_backdrop_source || null,
    backdrop_source: usingFallbackBackdrop
      ? (fallback?.backdrop_source || "streamingcommunity_mapping")
      : (official?.backdrop_source || null),
    poster_source: usingFallbackPoster
      ? (fallback?.poster_source || "streamingcommunity_mapping")
      : (official?.poster_source || null),
    hero_backdrop_source: official?.hero_backdrop_source || null,
    logo_source: official?.logo_source || (fallback?.logo_path ? "saved_non_tmdb" : null),
    logo_locale: official?.logo_locale || null,
    backdrop_locale: usingFallbackBackdrop ? null : (official?.backdrop_locale || null),
    poster_locale: usingFallbackPoster ? null : (official?.poster_locale || null),
    hero_backdrop_locale: official?.hero_backdrop_locale || null,
    backdrop_embedded_title_treatment: backdropEmbedded,
    poster_embedded_title_treatment: posterEmbedded,
    hero_embedded_title_treatment: officialHero
      ? !!official?.hero_embedded_title_treatment
      : !!fallback?.hero_embedded_title_treatment,
    embedded_title_treatment: backdropEmbedded,
    card_ready: cardReady,
    top10_ready: top10Ready,
    landscape_card_ready: cardReady,
    poster_card_ready: top10Ready,
    complete: !!(cardReady && top10Ready),
    image_quality: "max-native",
    image_source_policy: "streamingcommunity-exhaustive_v11_no-detail-background-as-card",
    upscaled: false,
    sc_cover_imported: !!official?.sc_cover_imported,
    sc_provider_id: official?.sc_provider_id || null,
    sc_provider_name: official?.sc_provider_name || null,
    official_version: official?.version || MEDIA_ASSET_QUALITY_VERSION,
  };
}

export default function useAutomaticMediaAssets(
  item: any,
  mediaType: any,
  enabled = true
) {
  const typeSlug = mediaTypeSlug(mediaType, item);
  const id = item?.id || item?.tmdbId || item?.tmdb_id;
  const fallback = useMemo(
    () => buildMediaAssetFallback(item, mediaType),
    [item, mediaType]
  );

  const query = useQuery({
    queryKey: ["media-assets", MEDIA_ASSET_QUALITY_VERSION, typeSlug, id],
    queryFn: async ({ signal }: any) => {
      if (!id) return fallback;
      const response = await fetch(`/api/public/official-artwork/${typeSlug}/${id}`, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const official = response.ok ? await response.json() : {};
      return mergeOfficialArtwork(fallback, official);
    },
    enabled: !!id && !!enabled,
    placeholderData: fallback,
    staleTime: DAILY_ARTWORK_REFRESH_MS,
    gcTime: DAILY_ARTWORK_REFRESH_MS * 7,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: 2,
  });

  return { ...fallback, ...(query.data || {}) };
}
