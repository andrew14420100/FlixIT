// @ts-nocheck
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Movie } from "src/types/Movie";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import useDeferredMediaAssets from "src/hooks/useDeferredMediaAssets";
import useAutomaticMediaAssets, { tmdbImageUrl } from "src/hooks/useAutomaticMediaAssets";
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
      { rootMargin: "800px 1200px" }
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

  const automaticAssets = useAutomaticMediaAssets(
    { ...video, id },
    mType,
    nearViewport || intent || open
  );
  const deferredAssets = useDeferredMediaAssets(
    { ...video, id },
    mType,
    intent || open
  );
  const assets = useMemo(
    () => ({ ...(automaticAssets || {}), ...(deferredAssets || {}) }),
    [automaticAssets, deferredAssets]
  );

  // Automatic media-assets always wins, but every artwork shape that older
  // rows may already carry remains an instant fallback. This makes the cover
  // visible immediately instead of showing an empty tile while the automatic
  // request is still in flight.
  const legacyLandscape = firstArtwork(
    video?.backdrop_path,
    video?.titled_backdrop_path,
    video?.titledBackdropPath,
    video?.netflix_artwork_url,
    video?.netflixArtworkUrl,
    video?.netflix_cover_url,
    video?.contextualArtwork?.artwork,
    video?.artwork,
    video?.image,
    video?.cover_path,
    video?.cover,
    video?.image_url,
    video?.thumbnail_url
  );
  const legacyPoster = firstArtwork(
    video?.poster_path,
    video?.poster,
    video?.netflix_ranked_artwork_url,
    video?.netflixRankedArtworkUrl,
    video?.netflix_cover_url,
    video?.cover_path,
    video?.cover,
    video?.image,
    video?.artwork
  );

  const imageCandidates = useMemo(
    () => [
      tmdbImageUrl(automaticAssets?.backdrop_path, "original"),
      tmdbImageUrl(automaticAssets?.titled_backdrop_path, "original"),
      tmdbImageUrl(legacyLandscape, "original"),
      tmdbImageUrl(automaticAssets?.poster_path, "original"),
      tmdbImageUrl(legacyPoster, "original"),
    ].filter(Boolean),
    [
      automaticAssets?.backdrop_path,
      automaticAssets?.titled_backdrop_path,
      automaticAssets?.poster_path,
      legacyLandscape,
      legacyPoster,
    ]
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

  const hoverLogoUrl = tmdbImageUrl(
    automaticAssets?.logo_path || assets?.logo_path || video?.logo_path,
    "original"
  );

  return (
    <>
      <NetflixStandardCard
        ref={ref}
        imageUrl={imageCandidates[0] || null}
        imageCandidates={imageCandidates.slice(1)}
        fallbackImageUrl={tmdbImageUrl(legacyLandscape || legacyPoster, "original")}
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
              // Automatic assets win; pre-existing artwork is preserved only
              // as a visual fallback so migration never creates blank covers.
              netflix_artwork_url: undefined,
              netflixArtworkUrl: undefined,
              netflix_cover_url: undefined,
              contextualArtwork: undefined,
              artwork: undefined,
              image: undefined,
              backdrop_path:
                automaticAssets?.backdrop_path ||
                automaticAssets?.titled_backdrop_path ||
                legacyLandscape ||
                legacyPoster,
              titled_backdrop_path:
                automaticAssets?.titled_backdrop_path || video?.titled_backdrop_path,
              poster_path:
                automaticAssets?.poster_path || legacyPoster || legacyLandscape,
              logo_path: automaticAssets?.logo_path || video?.logo_path,
            }}
            mediaType={mType}
            onPlay={goPlay}
            onDetail={goDetail}
            watch={watch}
          />
          <HoverTrailerOverlay url={trailerUrl} logoUrl={hoverLogoUrl} />
        </ExpandOverlay>
      ) : null}
    </>
  );
}
