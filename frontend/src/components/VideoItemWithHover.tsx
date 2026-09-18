// @ts-nocheck
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Movie } from "src/types/Movie";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import useDeferredMediaAssets from "src/hooks/useDeferredMediaAssets";
import useNetflixArtwork from "src/hooks/useNetflixArtwork";
import ExpandedCard, { TMDB_IMG } from "./ExpandedCard";
import NetflixStandardCard from "./NetflixStandardCard";
import HoverTrailerOverlay from "./HoverTrailerOverlay";

interface Props {
  video: Movie;
  mediaType?: any;
  watch?: any;
  suppressHover?: boolean;
  artworkContext?: string;
}

function imageSrc(path: any, size: string) {
  if (!path) return null;
  if (typeof path === "string" && (/^https?:\/\//i.test(path) || path.startsWith("data:"))) return path;
  const raw = String(path);
  return `${TMDB_IMG}${size}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function inferArtworkContext(explicit?: string) {
  if (explicit) return explicit;
  if (typeof window === "undefined") return "home";
  const path = window.location.pathname.toLowerCase();
  if (path === "/browse" || path === "/") return "home";
  if (path.startsWith("/film")) return "movie";
  if (path.startsWith("/serie-tv") || path === "/serie") return "tv";
  if (/^\/browse\/(movie|tv)\/\d+/.test(path)) return "detail";
  if (path.includes("search") || path.startsWith("/archivio")) return "search";
  return "home";
}

function RemoveIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M5.293 5.293a1 1 0 0 1 1.414 0L12 10.586l5.293-5.293a1 1 0 1 1 1.414 1.414L13.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414L12 13.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L10.586 12 5.293 6.707a1 1 0 0 1 0-1.414Z"/></svg>;
}

export default function VideoItemWithHover({ video, mediaType, watch, suppressHover = false, artworkContext }: Props) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const mType = mediaType || MEDIA_TYPE.Movie;
  const typeSlug = mType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const resolvedContext = inferArtworkContext(artworkContext);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") { setNearViewport(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNearViewport(true); observer.disconnect(); }
    }, { rootMargin: "1000px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { open, closing, position, onEnter, onLeave, onOverlayLeave } = useHoverExpand(ref);
  const assets = useDeferredMediaAssets(video, mType, open);
  const resolved = useNetflixArtwork(video, mType, resolvedContext, nearViewport);

  const existingNetflixArtwork = video.netflix_artwork_url || video.netflixArtworkUrl || video.netflix_cover_url || video.contextualArtwork?.artwork?.url || video.artwork?.url || video.image?.url;
  const existingBackdrop = existingNetflixArtwork || video.titled_backdrop_path || video.backdrop_path;
  const fallbackImageUrl = useMemo(() => {
    if (existingBackdrop) return imageSrc(existingBackdrop, "w500");
    return video.poster_path ? imageSrc(video.poster_path, "w342") : null;
  }, [existingBackdrop, video.poster_path]);
  const imageUrl = resolved?.artwork?.url || fallbackImageUrl;

  const id = video.id || video.tmdbId || video.tmdb_id;
  const title = video.title || video.name || "";
  const detailHref = `/${MAIN_PATH.browse}/${typeSlug}/${id}`;

  const goPlay = useCallback((event?: any) => {
    event?.preventDefault?.(); event?.stopPropagation?.(); window.scrollTo(0, 0);
    const ep = watch && typeSlug === "tv" ? `?s=${watch.season || 1}&e=${watch.episode || 1}` : "";
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${id}${ep}`);
  }, [navigate, typeSlug, id, watch]);

  const goDetail = useCallback((event?: any) => {
    event?.preventDefault?.(); event?.stopPropagation?.(); window.scrollTo(0, 0); navigate(detailHref);
  }, [navigate, detailHref]);

  const handleEnter = useCallback((event?: any) => { if (!suppressHover) onEnter(event); }, [suppressHover, onEnter]);
  const trailerUrl = assets?.resolved_trailer?.enabled && assets?.resolved_trailer?.available
    ? (assets?.resolved_trailer?.trailer_url || assets?.resolved_trailer?.trailer_key || assets?.preview_video_url)
    : null;

  return (
    <>
      <NetflixStandardCard
        ref={ref}
        imageUrl={imageUrl}
        fallbackImageUrl={fallbackImageUrl}
        title={title}
        href={detailHref}
        onClick={goDetail}
        onMouseEnter={handleEnter}
        onMouseLeave={onLeave}
        watch={watch}
        testId={`video-card-${id}`}
      />

      {open && !suppressHover ? (
        <ExpandOverlay position={position} closing={closing} onMouseLeave={onOverlayLeave} onClick={goDetail} testId={`hover-overlay-${id}`}>
          <ExpandedCard
            item={{
              ...video,
              ...assets,
              id,
              preview_video_url: "",
              netflix_artwork_url: resolved?.artwork?.url || existingNetflixArtwork,
              logo_path: resolved?.logo?.url || assets?.logo_path || video?.logo_path,
            }}
            mediaType={mType}
            onPlay={goPlay}
            onDetail={goDetail}
            watch={watch}
          />
          <HoverTrailerOverlay url={trailerUrl} />

          {typeof watch?.onRemove === "function" ? (
            <button type="button" className="nflx-mini-control color-supplementary hasIcon round continue-hover-remove" aria-label="Rimuovi da Continua a guardare" title="Rimuovi da Continua a guardare" onClick={(event) => { event.preventDefault(); event.stopPropagation(); watch.onRemove(); }}>
              <span className="small" role="presentation"><RemoveIcon /></span>
            </button>
          ) : null}
        </ExpandOverlay>
      ) : null}
    </>
  );
}
