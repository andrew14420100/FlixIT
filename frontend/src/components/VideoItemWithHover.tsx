// @ts-nocheck
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Movie } from "src/types/Movie";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import useDeferredMediaAssets from "src/hooks/useDeferredMediaAssets";
import useAutomaticMediaAssets from "src/hooks/useAutomaticMediaAssets";
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

export default function VideoItemWithHover({
  video,
  mediaType,
  watch,
  suppressHover = false,
}: Props) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  const mType = mediaType || MEDIA_TYPE.Movie;
  const typeSlug = mType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const id = video?.id || video?.tmdbId || video?.tmdb_id;

  // Warm only cards close to the viewport. The previous 800/1200px margin could
  // start artwork work for many rows at once. This tighter window still gives
  // enough time to have the trailer ready before the 300ms hover expansion.
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "280px 480px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const {
    open,
    intent,
    closing,
    position,
    onEnter,
    onLeave,
    onOverlayLeave,
  } = useHoverExpand(ref);

  // One artwork request per title. The unified backend resolver already checks
  // Netflix/Apple/Prime/IMDb and a supplemental genuine logo source, so the
  // separate Netflix hook was duplicate network work and could contradict the
  // chosen complete artwork.
  const automaticAssets = useAutomaticMediaAssets(
    { ...video, id },
    mType,
    nearViewport || intent || open
  );

  // Prefetch the direct trailer while the card is close to the viewport, not
  // after the mini-modal is already visible.
  const deferredAssets = useDeferredMediaAssets(
    { ...video, id },
    mType,
    nearViewport || intent || open
  );
  const assets = useMemo(
    () => ({ ...(automaticAssets || {}), ...(deferredAssets || {}) }),
    [automaticAssets, deferredAssets]
  );

  const mappedBackdrop = id ? getCDNImageUrl(Number(id), "backdrop") : null;
  const mappedPoster = id ? getCDNImageUrl(Number(id), "poster") : null;

  const legacyLandscape = firstNonTmdbArtwork(
    video?.netflix_artwork_url,
    video?.netflixArtworkUrl,
    video?.netflix_cover_url,
    video?.contextualArtwork?.artwork,
    video?.titled_backdrop_path,
    video?.titledBackdropPath,
    video?.backdrop_path,
    video?.artwork,
    video?.image,
    video?.cover_path,
    video?.cover,
    video?.image_url,
    video?.thumbnail_url
  );
  const legacyPoster = firstNonTmdbArtwork(
    video?.netflix_ranked_artwork_url,
    video?.netflixRankedArtworkUrl,
    video?.poster_path,
    video?.poster,
    video?.cover_path,
    video?.cover
  );

  const automaticLandscape = firstNonTmdbArtwork(
    automaticAssets?.backdrop_path,
    automaticAssets?.titled_backdrop_path
  );
  const automaticPoster = firstNonTmdbArtwork(automaticAssets?.poster_path);

  const imageCandidates = useMemo(
    () => unique([
      automaticLandscape,
      mappedBackdrop,
      legacyLandscape,
      automaticPoster,
      mappedPoster,
      legacyPoster,
    ]),
    [automaticLandscape, mappedBackdrop, legacyLandscape, automaticPoster, mappedPoster, legacyPoster]
  );

  const title = automaticAssets?.title || video?.title || video?.name || "";
  const detailHref = `/${MAIN_PATH.browse}/${typeSlug}/${id}`;

  const goPlay = useCallback(
    (event?: any) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      window.scrollTo(0, 0);
      const ep = watch && typeSlug === "tv" ? `?s=${watch.season || 1}&e=${watch.episode || 1}` : "";
      navigate(`/${MAIN_PATH.watch}/${typeSlug}/${id}${ep}`);
    },
    [navigate, typeSlug, id, watch]
  );

  const goDetail = useCallback(
    (event?: any) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      window.scrollTo(0, 0);
      navigate(detailHref);
    },
    [navigate, detailHref]
  );

  const handleEnter = useCallback(
    (event?: any) => {
      if (!suppressHover) onEnter(event);
    },
    [suppressHover, onEnter]
  );

  const trailerUrl = assets?.resolved_trailer?.enabled && assets?.resolved_trailer?.available
    ? (assets?.resolved_trailer?.trailer_url ||
       assets?.resolved_trailer?.trailer_key ||
       assets?.resolved_trailer?.manifest_url ||
       assets?.preview_video_url)
    : null;

  const hoverLogoUrl = firstNonTmdbArtwork(
    automaticAssets?.logo_path,
    assets?.logo_path,
    video?.netflix_logo_url,
    video?.logo_path,
    video?.logo
  );

  const hoverArtwork = automaticLandscape || mappedBackdrop || legacyLandscape || automaticPoster || mappedPoster || legacyPoster;
  const hoverPoster = automaticPoster || mappedPoster || legacyPoster || hoverArtwork;
  const staticEmbedded = !!automaticAssets?.backdrop_embedded_title_treatment;

  return (
    <>
      <NetflixStandardCard
        ref={ref}
        imageUrl={imageCandidates[0] || null}
        imageCandidates={imageCandidates.slice(1)}
        fallbackImageUrl={null}
        logoUrl={hoverLogoUrl}
        embeddedTitleTreatment={staticEmbedded}
        title={title}
        href={detailHref}
        onClick={goDetail}
        onMouseEnter={handleEnter}
        onMouseLeave={onLeave}
        watch={watch}
        testId={`video-card-${id}`}
      />

      {open && !suppressHover ? (
        <ExpandOverlay
          position={position}
          closing={closing}
          onMouseLeave={onOverlayLeave}
          onClick={goDetail}
          testId={`hover-overlay-${id}`}
        >
          <ExpandedCard
            item={{
              ...video,
              ...assets,
              id,
              preview_video_url: "",
              netflix_artwork_url: hoverArtwork || undefined,
              netflixArtworkUrl: undefined,
              netflix_cover_url: undefined,
              contextualArtwork: undefined,
              artwork: undefined,
              image: undefined,
              image_url: undefined,
              thumbnail_url: undefined,
              backdrop_path: hoverArtwork || null,
              titled_backdrop_path: null,
              cover_path: null,
              cover: null,
              poster_path: hoverPoster || null,
              poster: null,
              // Keep the underlying expanded-card logo alive even when a trailer
              // exists. When the trailer ends/fails, the artwork and logo return
              // immediately instead of revealing a logo-less card.
              logo_path: hoverLogoUrl || null,
              logo: null,
              title_logo_path: null,
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
