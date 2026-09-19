// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import useDeferredMediaAssets from "src/hooks/useDeferredMediaAssets";
import useAutomaticMediaAssets, { tmdbImageUrl } from "src/hooks/useAutomaticMediaAssets";
import useNetflixArtwork from "src/hooks/useNetflixArtwork";
import { getCDNImageUrl } from "src/config/cdnMapping";
import ExpandedCard from "./ExpandedCard";
import HoverTrailerOverlay from "./HoverTrailerOverlay";
import "./NetflixMiniModalExact.css";
import NetflixTop10RankSvg from "./NetflixTop10RankSvg";

function unique(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function firstArtwork(...values: any[]) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string") return value;
    if (typeof value?.url === "string") return value.url;
  }
  return null;
}

export default function NetflixRankedCardWithHover({
  item,
  rank,
  mediaType,
  watch,
  suppressHover = false,
}: any) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const normalizedId = item?.id || item?.tmdbId || item?.tmdb_id;
  const mType = mediaType ||
    (item?.type === "tv" || item?.media_type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie);
  const typeSlug = mType === MEDIA_TYPE.Tv ? "tv" : "movie";

  const {
    open,
    intent,
    closing,
    position,
    onEnter,
    onLeave,
    onOverlayLeave,
  } = useHoverExpand(ref);

  const netflixArtwork = useNetflixArtwork(
    { ...item, id: normalizedId },
    mType,
    "top10",
    true
  );

  const automaticAssets = useAutomaticMediaAssets(
    { ...item, id: normalizedId },
    mType,
    true
  );
  const deferredAssets = useDeferredMediaAssets(
    { ...item, id: normalizedId },
    mType,
    intent || open
  );
  const assets = useMemo(
    () => ({ ...(automaticAssets || {}), ...(deferredAssets || {}) }),
    [automaticAssets, deferredAssets]
  );

  const existingNetflixPoster = firstArtwork(
    item?.netflix_ranked_artwork_url,
    item?.netflixRankedArtworkUrl,
    item?.netflix_artwork_url,
    item?.netflixArtworkUrl,
    item?.netflix_cover_url,
    item?.contextualArtwork?.artwork,
    item?.artwork,
    item?.image
  );

  const legacyPoster = firstArtwork(
    item?.poster_path,
    item?.poster,
    item?.cover_path,
    item?.cover
  );
  const legacyLandscape = firstArtwork(
    item?.backdrop_path,
    item?.titled_backdrop_path,
    item?.titledBackdropPath
  );

  const mappedPoster = normalizedId
    ? getCDNImageUrl(Number(normalizedId), "poster") || getCDNImageUrl(Number(normalizedId), "backdrop")
    : null;
  const resolvedArtwork = netflixArtwork?.artwork?.url || null;

  const posterCandidates = useMemo(
    () => unique([
      resolvedArtwork,
      existingNetflixPoster,
      mappedPoster,
      tmdbImageUrl(legacyPoster, "original"),
      tmdbImageUrl(automaticAssets?.poster_path, "original"),
      tmdbImageUrl(legacyLandscape, "original"),
      tmdbImageUrl(automaticAssets?.backdrop_path, "original"),
      tmdbImageUrl(automaticAssets?.titled_backdrop_path, "original"),
    ]),
    [
      resolvedArtwork,
      existingNetflixPoster,
      mappedPoster,
      legacyPoster,
      legacyLandscape,
      automaticAssets?.poster_path,
      automaticAssets?.backdrop_path,
      automaticAssets?.titled_backdrop_path,
    ]
  );

  const [posterIndex, setPosterIndex] = useState(0);
  useEffect(() => setPosterIndex(0), [posterCandidates.join("|")]);
  const posterUrl = posterCandidates[posterIndex] || "";

  const title = automaticAssets?.title || item?.title || item?.name || "";
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
      const ep = watch && typeSlug === "tv" ? `?s=${watch.season || 1}&e=${watch.episode || 1}` : "";
      navigate(`/${MAIN_PATH.watch}/${typeSlug}/${normalizedId}${ep}`);
    },
    [navigate, normalizedId, typeSlug, watch]
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

  const hoverLogoUrl =
    netflixArtwork?.logo?.url ||
    tmdbImageUrl(automaticAssets?.logo_path || assets?.logo_path || item?.logo_path, "original");

  return (
    <>
      <div
        ref={ref}
        className="netflix-ranked-card-root"
        onMouseEnter={handleEnter}
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
            <NetflixTop10RankSvg rank={rank} className="netflix-ranked-card-rank-svg" opacity={0.5} />
          </div>
          <div className="netflix-ranked-card-poster-wrap">
            {posterUrl ? (
              <img
                src={posterUrl}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                onError={() => setPosterIndex((index) => index + 1)}
                className="netflix-ranked-card-poster"
              />
            ) : (
              <div className="netflix-ranked-card-placeholder">{title}</div>
            )}
          </div>
        </a>
      </div>

      {open && !suppressHover ? (
        <ExpandOverlay
          position={position}
          closing={closing}
          onMouseLeave={onOverlayLeave}
          onClick={goDetail}
          testId={`hover-overlay-top10-${normalizedId}`}
        >
          <ExpandedCard
            item={{
              ...item,
              ...assets,
              id: normalizedId,
              preview_video_url: "",
              netflix_ranked_artwork_url:
                resolvedArtwork || existingNetflixPoster || mappedPoster || undefined,
              netflix_artwork_url:
                resolvedArtwork || existingNetflixPoster || mappedPoster || undefined,
              netflixArtworkUrl: undefined,
              netflix_cover_url: undefined,
              contextualArtwork: undefined,
              artwork: undefined,
              image: undefined,
              backdrop_path:
                resolvedArtwork ||
                existingNetflixPoster ||
                mappedPoster ||
                automaticAssets?.backdrop_path ||
                automaticAssets?.titled_backdrop_path ||
                legacyLandscape ||
                legacyPoster,
              titled_backdrop_path:
                automaticAssets?.titled_backdrop_path || item?.titled_backdrop_path,
              poster_path:
                automaticAssets?.poster_path || legacyPoster || legacyLandscape,
              logo_path:
                netflixArtwork?.logo?.url || automaticAssets?.logo_path || item?.logo_path,
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
