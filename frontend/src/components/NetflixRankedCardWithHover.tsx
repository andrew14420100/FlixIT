// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import useDeferredMediaAssets from "src/hooks/useDeferredMediaAssets";
import useNetflixArtwork from "src/hooks/useNetflixArtwork";
import ExpandedCard, { TMDB_IMG } from "./ExpandedCard";
import HoverTrailerOverlay from "./HoverTrailerOverlay";
import "./NetflixMiniModalExact.css";
import NetflixTop10RankSvg from "./NetflixTop10RankSvg";

function imageSrc(path: any, size = "w500") {
  if (!path) return "";
  if (typeof path === "string" && (/^https?:\/\//i.test(path) || path.startsWith("data:"))) return path;
  const raw = String(path);
  return `${TMDB_IMG}${size}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

export default function NetflixRankedCardWithHover({ item, rank, mediaType, watch, suppressHover = false }: any) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const normalizedId = item?.id || item?.tmdbId || item?.tmdb_id;
  const mType = mediaType || (item?.type === "tv" || item?.media_type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie);
  const typeSlug = mType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const { open, closing, position, onEnter, onLeave, onOverlayLeave } = useHoverExpand(ref);

  const assets = useDeferredMediaAssets({ ...item, id: normalizedId }, mType, open);
  const resolved = useNetflixArtwork({ ...item, id: normalizedId }, mType, "top10", true);
  const fallbackPosterUrl = useMemo(() => imageSrc(
    item?.netflix_ranked_artwork_url || item?.netflixRankedArtworkUrl || item?.netflix_artwork_url || item?.netflixArtworkUrl || item?.netflix_cover_url || item?.contextualArtwork?.artwork?.url || item?.artwork?.url || item?.image?.url || item?.poster_path || item?.poster || item?.backdrop_path,
    "w500"
  ), [item?.netflix_ranked_artwork_url, item?.netflixRankedArtworkUrl, item?.netflix_artwork_url, item?.netflixArtworkUrl, item?.netflix_cover_url, item?.poster_path, item?.poster, item?.backdrop_path]);

  const [posterUrl, setPosterUrl] = useState(resolved?.artwork?.url || fallbackPosterUrl);
  useEffect(() => { setPosterUrl(resolved?.artwork?.url || fallbackPosterUrl); }, [resolved?.artwork?.url, fallbackPosterUrl]);

  const title = item?.title || item?.name || "";
  const detailHref = `/${MAIN_PATH.browse}/${typeSlug}/${normalizedId}`;
  const goDetail = useCallback((event?: any) => {
    event?.preventDefault?.(); event?.stopPropagation?.(); window.scrollTo(0, 0); navigate(detailHref);
  }, [navigate, detailHref]);
  const goPlay = useCallback((event?: any) => {
    event?.preventDefault?.(); event?.stopPropagation?.(); window.scrollTo(0, 0);
    const ep = watch && typeSlug === "tv" ? `?s=${watch.season || 1}&e=${watch.episode || 1}` : "";
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${normalizedId}${ep}`);
  }, [navigate, normalizedId, typeSlug, watch]);
  const handleEnter = useCallback((event?: any) => { if (!suppressHover) onEnter(event); }, [suppressHover, onEnter]);
  const trailerUrl = assets?.resolved_trailer?.enabled && assets?.resolved_trailer?.available
    ? (assets?.resolved_trailer?.trailer_url || assets?.resolved_trailer?.trailer_key || assets?.preview_video_url)
    : null;

  return (
    <>
      <div ref={ref} className="netflix-ranked-card-root" onMouseEnter={handleEnter} onMouseLeave={onLeave} data-testid={`netflix-ranked-card-${normalizedId}`}>
        <a href={detailHref} aria-label={title} data-uia="ranked-card" className="netflix-ranked-card-link" onClick={goDetail}>
          <div className="netflix-ranked-card-rank"><NetflixTop10RankSvg rank={rank} className="netflix-ranked-card-rank-svg" opacity={0.5} /></div>
          <div className="netflix-ranked-card-poster-wrap">
            {posterUrl ? (
              <img src={posterUrl} alt="" draggable={false} loading="lazy" decoding="async" onError={() => {
                if (fallbackPosterUrl && posterUrl !== fallbackPosterUrl) setPosterUrl(fallbackPosterUrl); else setPosterUrl("");
              }} className="netflix-ranked-card-poster" />
            ) : <div className="netflix-ranked-card-placeholder">{title}</div>}
          </div>
        </a>
      </div>

      {open && !suppressHover ? (
        <ExpandOverlay position={position} closing={closing} onMouseLeave={onOverlayLeave} onClick={goDetail} testId={`hover-overlay-top10-${normalizedId}`}>
          <ExpandedCard
            item={{
              ...item,
              ...assets,
              id: normalizedId,
              preview_video_url: "",
              netflix_ranked_artwork_url: resolved?.artwork?.url || undefined,
              netflix_artwork_url: resolved?.artwork?.url || item?.netflix_artwork_url,
              logo_path: resolved?.logo?.url || assets?.logo_path || item?.logo_path,
            }}
            mediaType={mType}
            onPlay={goPlay}
            onDetail={goDetail}
            watch={watch}
          />
          <HoverTrailerOverlay url={trailerUrl} />
        </ExpandOverlay>
      ) : null}
    </>
  );
}
