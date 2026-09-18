// @ts-nocheck
import { useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Movie } from "src/types/Movie";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import ExpandedCard, { TMDB_IMG, useMediaAssets } from "./ExpandedCard";
import NetflixStandardCard from "./NetflixStandardCard";

interface Props {
  video: Movie;
  mediaType?: any;
  watch?: any;
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

export default function VideoItemWithHover({
  video,
  mediaType,
  watch,
}: Props) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const mType = mediaType || MEDIA_TYPE.Movie;
  const typeSlug = mType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const assets = useMediaAssets(video, mType);

  const {
    open,
    closing,
    position,
    onEnter,
    onLeave,
    onOverlayLeave,
  } = useHoverExpand(ref);

  // Keep FLIX-IT's own artwork data, but render it through the Netflix card shell.
  const netflixArtwork =
    video.netflix_artwork_url ||
    video.netflixArtworkUrl ||
    video.netflix_cover_url ||
    video.contextualArtwork?.artwork?.url ||
    video.artwork?.url ||
    video.image?.url ||
    assets.netflix_artwork_url ||
    assets.netflixArtworkUrl;

  const titled = video.titled_backdrop_path || assets.titled_backdrop_path;
  const backdrop =
    netflixArtwork ||
    titled ||
    video.backdrop_path ||
    assets.backdrop_path;

  const imageUrl = useMemo(() => {
    if (backdrop) return imageSrc(backdrop, "w500");

    const poster =
      video.poster_path ||
      assets.poster_path;

    return poster ? imageSrc(poster, "w342") : null;
  }, [
    backdrop,
    video.poster_path,
    assets.poster_path,
  ]);

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

  return (
    <>
      <NetflixStandardCard
        ref={ref}
        imageUrl={imageUrl}
        title={title}
        href={detailHref}
        onClick={goDetail}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        watch={watch}
        testId={`video-card-${id}`}
      />

      {open ? (
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
        </ExpandOverlay>
      ) : null}
    </>
  );
}
