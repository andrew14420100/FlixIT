// @ts-nocheck
import { useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Movie } from "src/types/Movie";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import useDeferredMediaAssets from "src/hooks/useDeferredMediaAssets";
import ExpandedCard, { TMDB_IMG } from "./ExpandedCard";
import NetflixStandardCard from "./NetflixStandardCard";

interface Props {
  video: Movie;
  mediaType?: any;
  watch?: any;
  suppressHover?: boolean;
}

function imageSrc(path: any, size: string) {
  if (!path) return null;
  if (
    typeof path === "string" &&
    (/^https?:\/\//i.test(path) || path.startsWith("data:"))
  ) {
    return path;
  }
  const raw = String(path);
  return `${TMDB_IMG}${size}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.293 5.293a1 1 0 0 1 1.414 0L12 10.586l5.293-5.293a1 1 0 1 1 1.414 1.414L13.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414L12 13.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L10.586 12 5.293 6.707a1 1 0 0 1 0-1.414Z"
      />
    </svg>
  );
}

export default function VideoItemWithHover({
  video,
  mediaType,
  watch,
  suppressHover = false,
}: Props) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const mType = mediaType || MEDIA_TYPE.Movie;
  const typeSlug = mType === MEDIA_TYPE.Tv ? "tv" : "movie";

  const {
    open,
    closing,
    position,
    onEnter,
    onLeave,
    onOverlayLeave,
  } = useHoverExpand(ref);

  // Rich logos/trailers/certifications are fetched only after the preview opens.
  // Normal rows therefore stay light even with 50-60 titles.
  const assets = useDeferredMediaAssets(video, mType, open);

  const netflixArtwork =
    video.netflix_artwork_url ||
    video.netflixArtworkUrl ||
    video.netflix_cover_url ||
    video.contextualArtwork?.artwork?.url ||
    video.artwork?.url ||
    video.image?.url;

  const titled = video.titled_backdrop_path;
  const backdrop = netflixArtwork || titled || video.backdrop_path;

  const imageUrl = useMemo(() => {
    if (backdrop) return imageSrc(backdrop, "w500");
    const poster = video.poster_path;
    return poster ? imageSrc(poster, "w342") : null;
  }, [backdrop, video.poster_path]);

  const id = video.id || video.tmdbId || video.tmdb_id;
  const title = video.title || video.name || "";
  const detailHref = `/${MAIN_PATH.browse}/${typeSlug}/${id}`;

  const goPlay = useCallback(
    (event?: any) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      window.scrollTo(0, 0);

      const ep =
        watch && typeSlug === "tv"
          ? `?s=${watch.season || 1}&e=${watch.episode || 1}`
          : "";

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
      if (suppressHover) return;
      onEnter(event);
    },
    [suppressHover, onEnter]
  );

  return (
    <>
      <NetflixStandardCard
        ref={ref}
        imageUrl={imageUrl}
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
            }}
            mediaType={mType}
            onPlay={goPlay}
            onDetail={goDetail}
            watch={watch}
          />

          {typeof watch?.onRemove === "function" ? (
            <button
              type="button"
              className="nflx-mini-control color-supplementary hasIcon round continue-hover-remove"
              aria-label="Rimuovi da Continua a guardare"
              title="Rimuovi da Continua a guardare"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                watch.onRemove();
              }}
            >
              <span className="small" role="presentation">
                <RemoveIcon />
              </span>
            </button>
          ) : null}
        </ExpandOverlay>
      ) : null}
    </>
  );
}
