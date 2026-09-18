// @ts-nocheck
import { useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import ExpandedCard, { TMDB_IMG, useMediaAssets } from "./ExpandedCard";
import "./NetflixMiniModalExact.css";
import NetflixTop10RankSvg from "./NetflixTop10RankSvg";

function imageSrc(path: any, size = "w500") {
  if (!path) return "";
  if (
    typeof path === "string" &&
    (/^https?:\/\//i.test(path) || path.startsWith("data:"))
  ) {
    return path;
  }
  const raw = String(path);
  return `${TMDB_IMG}${size}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

export default function NetflixRankedCardWithHover({
  item,
  rank,
  mediaType,
  watch,
}: any) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const normalizedId = item?.id || item?.tmdbId || item?.tmdb_id;
  const mType =
    mediaType ||
    (item?.type === "tv" || item?.media_type === "tv"
      ? MEDIA_TYPE.Tv
      : MEDIA_TYPE.Movie);

  const typeSlug = mType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const assets = useMediaAssets(
    {
      ...item,
      id: normalizedId,
    },
    mType
  );

  const {
    open,
    closing,
    position,
    onEnter,
    onLeave,
    onOverlayLeave,
  } = useHoverExpand(ref);

  const posterUrl = useMemo(
    () =>
      imageSrc(
        item?.netflix_ranked_artwork_url ||
          item?.netflixRankedArtworkUrl ||
          item?.netflix_artwork_url ||
          item?.netflixArtworkUrl ||
          item?.netflix_cover_url ||
          item?.contextualArtwork?.artwork?.url ||
          item?.artwork?.url ||
          item?.image?.url ||
          item?.poster_path ||
          item?.poster ||
          assets?.poster_path ||
          item?.backdrop_path ||
          assets?.backdrop_path,
        "w500"
      ),
    [
      item?.netflix_ranked_artwork_url,
      item?.netflixRankedArtworkUrl,
      item?.netflix_artwork_url,
      item?.netflixArtworkUrl,
      item?.netflix_cover_url,
      item?.poster_path,
      item?.poster,
      item?.backdrop_path,
      assets?.poster_path,
      assets?.backdrop_path,
    ]
  );

  const title = item?.title || item?.name || "";

  const detailHref = `/${MAIN_PATH.browse}/${typeSlug}/${normalizedId}`;

  const goDetail = useCallback(
    (event?: any) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      window.scrollTo(0, 0);
      navigate(detailHref);
    },
    [navigate, detailHref]
  );

  const goPlay = useCallback(
    (event?: any) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      window.scrollTo(0, 0);

      const ep =
        watch && typeSlug === "tv"
          ? `?s=${watch.season || 1}&e=${watch.episode || 1}`
          : "";

      navigate(`/${MAIN_PATH.watch}/${typeSlug}/${normalizedId}${ep}`);
    },
    [navigate, normalizedId, typeSlug, watch]
  );

  return (
    <>
      <div
        ref={ref}
        className="netflix-ranked-card-root"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        data-testid={`netflix-ranked-card-${normalizedId}`}
      >
        <a
          href={detailHref}
          aria-label={title}
          data-uia="ranked-card"
          className="netflix-ranked-card-link"
          onClick={goDetail}
        >
          <div className="netflix-ranked-card-rank">
            <NetflixTop10RankSvg
              rank={rank}
              className="netflix-ranked-card-rank-svg"
              opacity={0.5}
            />
          </div>

          <div className="netflix-ranked-card-poster-wrap">
            {posterUrl ? (
              <img
                src={posterUrl}
                alt=""
                draggable={false}
                loading="lazy"
                className="netflix-ranked-card-poster"
              />
            ) : (
              <div className="netflix-ranked-card-placeholder">{title}</div>
            )}
          </div>
        </a>
      </div>

      {open ? (
        <ExpandOverlay
          position={position}
          closing={closing}
          onMouseLeave={onOverlayLeave}
          testId={`hover-overlay-top10-${normalizedId}`}
        >
          <ExpandedCard
            item={{
              ...item,
              ...assets,
              id: normalizedId,
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
