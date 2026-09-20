// @ts-nocheck
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import { Movie } from "src/types/Movie";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import useDeferredMediaAssets from "src/hooks/useDeferredMediaAssets";
import useAutomaticMediaAssets, { isEmbeddedCardArtwork } from "src/hooks/useAutomaticMediaAssets";
import { getCDNImageUrl } from "src/config/cdnMapping";
import ExpandedCard from "./ExpandedCard";
import NetflixStandardCard from "./NetflixStandardCard";
import HoverTrailerOverlay from "./HoverTrailerOverlay";

interface Props {
  video: Movie;
  mediaType?: any;
  watch?: any;
  suppressHover?: boolean;
  artworkContext?: string;
}

function firstArtwork(...values: any[]) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string") return value;
    if (typeof value?.url === "string") return value.url;
  }
  return null;
}

function nonTmdbArtwork(value: any) {
  const raw = firstArtwork(value);
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith("data:") || text.startsWith("blob:")) return text;
  if (!/^https?:\/\//i.test(text)) return null;
  if (/^https?:\/\/image\.tmdb\.org\//i.test(text)) return null;
  return text;
}

function firstNonTmdbArtwork(...values: any[]) {
  for (const value of values) {
    const resolved = nonTmdbArtwork(value);
    if (resolved) return resolved;
  }
  return null;
}

function unique(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export default function VideoItemWithHover({ video, mediaType, watch, suppressHover = false }: Props) {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width:899px)");
  const ref = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  const mType = mediaType || MEDIA_TYPE.Movie;
  const typeSlug = mType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const id = video?.id || video?.tmdbId || video?.tmdb_id;

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") { setNearViewport(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNearViewport(true); observer.disconnect(); }
    }, { rootMargin: "220px 360px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { open, intent, closing, position, onEnter, onLeave, onOverlayLeave } = useHoverExpand(ref);

  const automaticAssets = useAutomaticMediaAssets({ ...video, id }, mType, nearViewport || intent || open || isMobile);
  const deferredAssets = useDeferredMediaAssets({ ...video, id }, mType, intent || open);
  const assets = useMemo(() => ({ ...(automaticAssets || {}), ...(deferredAssets || {}) }), [automaticAssets, deferredAssets]);

  const mappedBackdrop = id ? getCDNImageUrl(Number(id), "backdrop") : null;
  const mappedPoster = id ? getCDNImageUrl(Number(id), "poster") : null;

  const legacyLandscape = firstNonTmdbArtwork(
    video?.netflix_artwork_url, video?.netflixArtworkUrl, video?.netflix_cover_url,
    video?.contextualArtwork?.artwork, video?.titled_backdrop_path, video?.titledBackdropPath,
    video?.backdrop_path, video?.artwork, video?.image, video?.cover_path, video?.cover,
    video?.image_url, video?.thumbnail_url
  );
  const legacyLandscapeEmbedded = !!(
    video?.backdrop_embedded_title_treatment || video?.embedded_title_treatment ||
    video?.has_embedded_title_treatment || isEmbeddedCardArtwork(legacyLandscape)
  );

  const automaticLandscape = firstNonTmdbArtwork(automaticAssets?.backdrop_path, automaticAssets?.titled_backdrop_path);
  const automaticLandscapeEmbedded = !!automaticAssets?.backdrop_embedded_title_treatment;
  const heroLandscape = firstNonTmdbArtwork(automaticAssets?.hero_backdrop_path, automaticAssets?.detail_backdrop_path, automaticLandscape);
  const automaticPoster = firstNonTmdbArtwork(automaticAssets?.poster_path, automaticAssets?.poster);
  const explicitScPoster = firstNonTmdbArtwork(video?.mobile_sc_poster_url);

  const landscapeCandidates = useMemo(() => unique([
    automaticLandscapeEmbedded ? automaticLandscape : null,
    mappedBackdrop,
    legacyLandscapeEmbedded ? legacyLandscape : null,
  ]), [automaticLandscape, automaticLandscapeEmbedded, mappedBackdrop, legacyLandscape, legacyLandscapeEmbedded]);

  // Mobile Home accepts only verified SC vertical posters. Continue Watching
  // supplies an explicit catalogue match so its historical cover can never win.
  const exactScPoster = explicitScPoster || (
    automaticAssets?.poster_source === "streamingcommunity" ? automaticPoster : null
  );
  const posterCandidates = useMemo(() => unique([
    exactScPoster,
  ]), [exactScPoster]);

  const usePosterCard = isMobile;
  const imageCandidates = usePosterCard ? posterCandidates : landscapeCandidates;

  const title = automaticAssets?.title || video?.title || video?.name || "";
  const detailHref = `/${MAIN_PATH.browse}/${typeSlug}/${id}`;

  const goPlay = useCallback((event?: any) => {
    event?.preventDefault?.(); event?.stopPropagation?.(); window.scrollTo(0, 0);
    const ep = watch && typeSlug === "tv" ? `?s=${watch.season || 1}&e=${watch.episode || 1}` : "";
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${id}${ep}`);
  }, [navigate, typeSlug, id, watch]);

  const goDetail = useCallback((event?: any) => {
    event?.preventDefault?.(); event?.stopPropagation?.(); window.scrollTo(0, 0); navigate(detailHref);
  }, [navigate, detailHref]);

  const handleEnter = useCallback((event?: any) => {
    if (!suppressHover && !isMobile) onEnter(event);
  }, [suppressHover, isMobile, onEnter]);

  const trailerUrl = assets?.resolved_trailer?.enabled && assets?.resolved_trailer?.available
    ? (assets?.resolved_trailer?.trailer_url || assets?.resolved_trailer?.trailer_key || assets?.resolved_trailer?.manifest_url || assets?.preview_video_url)
    : null;

  useEffect(() => {
    if (!intent || open || !trailerUrl || !/\.m3u8(?:$|\?)/i.test(String(trailerUrl))) return;
    const controller = new AbortController();
    fetch(String(trailerUrl), { signal: controller.signal, cache: "no-store", headers: { Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*" } }).catch(() => {});
    return () => controller.abort();
  }, [intent, open, trailerUrl]);

  const hoverLogoUrl = firstNonTmdbArtwork(automaticAssets?.logo_path, assets?.logo_path, video?.netflix_logo_url, video?.logo_path, video?.logo);
  const hoverArtwork = heroLandscape || automaticLandscape || mappedBackdrop || legacyLandscape;
  const hoverPoster = automaticPoster || mappedPoster || hoverArtwork;
  const staticReady = usePosterCard
    ? !!exactScPoster
    : imageCandidates.length > 0 && !!automaticAssets?.card_ready;

  if (!staticReady) return null;

  return (
    <>
      <NetflixStandardCard
        ref={ref}
        imageUrl={imageCandidates[0] || null}
        imageCandidates={imageCandidates.slice(1)}
        fallbackImageUrl={null}
        embeddedTitleTreatment={true}
        title={title}
        href={detailHref}
        onClick={goDetail}
        onMouseEnter={handleEnter}
        onMouseLeave={isMobile ? undefined : onLeave}
        watch={watch}
        testId={`video-card-${id}`}
      />

      {open && !suppressHover && !isMobile ? (
        <ExpandOverlay position={position} closing={closing} onMouseLeave={onOverlayLeave} onClick={goDetail} testId={`hover-overlay-${id}`}>
          <ExpandedCard
            item={{
              ...video, ...assets, id, preview_video_url: "",
              netflix_artwork_url: hoverArtwork || undefined,
              netflixArtworkUrl: undefined, netflix_cover_url: undefined, contextualArtwork: undefined,
              artwork: undefined, image: undefined, image_url: undefined, thumbnail_url: undefined,
              backdrop_path: hoverArtwork || null, titled_backdrop_path: null, cover_path: null, cover: null,
              poster_path: hoverPoster || null, poster: null, logo_path: hoverLogoUrl || null, logo: null, title_logo_path: null,
            }}
            mediaType={mType}
            onPlay={goPlay}
            onDetail={goDetail}
            watch={watch}
          />
          <HoverTrailerOverlay url={trailerUrl} logoUrl={hoverLogoUrl} onOpen={goDetail} />
        </ExpandOverlay>
      ) : null}
    </>
  );
}