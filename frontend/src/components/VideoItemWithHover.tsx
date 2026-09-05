// @ts-nocheck
import { useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Movie } from "src/types/Movie";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import ExpandedCard, { TMDB_IMG, useMediaAssets } from "./ExpandedCard";

interface Props { video: Movie; mediaType?: any; }

const EXPAND_SCALE = 1.5;
const getExpandedWidth = (r: DOMRect) => Math.round(r.width * EXPAND_SCALE);

export default function VideoItemWithHover({ video, mediaType }: Props) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const mType = mediaType || MEDIA_TYPE.Movie;
  const typeSlug = mType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const assets = useMediaAssets(video, mType);
  const { open, entered, align, width, onEnter, onLeave } = useHoverExpand(ref, getExpandedWidth);

  const titled = video.titled_backdrop_path || assets.titled_backdrop_path;
  const backdrop = titled || video.backdrop_path || assets.backdrop_path;
  const imageUrl = useMemo(() => {
    if (backdrop) return `${TMDB_IMG}w500${backdrop}`;
    const poster = video.poster_path || assets.poster_path;
    return poster ? `${TMDB_IMG}w342${poster}` : null;
  }, [backdrop, video.poster_path, assets.poster_path]);
  const logoUrl = !titled && assets.logo_path ? `${TMDB_IMG}w185${assets.logo_path}` : null;

  const goPlay = useCallback((e) => {
    e?.stopPropagation();
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${video.id}`);
  }, [navigate, typeSlug, video.id]);
  const goDetail = useCallback((e) => {
    e?.stopPropagation?.();
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.browse}/${typeSlug}/${video.id}`);
  }, [navigate, typeSlug, video.id]);

  return (
    <div
      ref={ref}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      data-testid={`video-card-${video.id}`}
      style={{ position: "relative", width: "100%", aspectRatio: "16/9", cursor: "pointer", zIndex: open ? 100 : 1 }}
    >
      <div
        onClick={goDetail}
        style={{ position: "absolute", inset: 0, borderRadius: 6, overflow: "hidden", background: "#141414" }}
      >
        {imageUrl && (
          <img
            src={imageUrl} alt={video.title || video.name || ""} loading="lazy" draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
        {logoUrl && (
          <>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "60%", pointerEvents: "none",
              background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)" }} />
            <img
              src={logoUrl} alt="" data-testid={`card-logo-static-${video.id}`}
              style={{ position: "absolute", left: 10, bottom: 8, maxWidth: "50%", maxHeight: "38%",
                objectFit: "contain", pointerEvents: "none", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.9))" }}
            />
          </>
        )}
      </div>

      {open && (
        <ExpandOverlay align={align} width={width} entered={entered} initialScale={1 / EXPAND_SCALE} testId={`hover-overlay-${video.id}`}>
          <ExpandedCard item={{ ...video, ...assets, id: video.id }} mediaType={mType} onPlay={goPlay} onDetail={goDetail} entered={entered} />
        </ExpandOverlay>
      )}
    </div>
  );
}
