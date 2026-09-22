// @ts-nocheck
import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
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

const TRAILER_HOVER_DELAY_MS = 2000;

function firstArtwork(...values: any[]) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string") return value;
    if (typeof value?.url === "string") return value.url;
  }
  return null;
}

function usableArtwork(value: any) {
  const raw = firstArtwork(value);
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith("/") || text.startsWith("data:") || text.startsWith("blob:")) return text;
  if (!/^https?:\/\//i.test(text)) return null;
  return text;
}

function firstUsableArtwork(...values: any[]) {
  for (const value of values) {
    const resolved = usableArtwork(value);
    if (resolved) return resolved;
  }
  return null;
}

function firstNonTmdbArtwork(...values: any[]) {
  for (const value of values) {
    const raw = usableArtwork(value);
    if (!raw) continue;
    if (/^https?:\/\/image\.tmdb\.org\//i.test(raw)) continue;
    return raw;
  }
  return null;
}

function firstLogo(...values: any[]) {
  return firstUsableArtwork(...values);
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
  const hoverStartedAtRef = useRef(0);
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
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "320px 480px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { open, intent, closing, position, onEnter, onLeave, onOverlayLeave } = useHoverExpand(ref);

  const automaticAssets = useAutomaticMediaAssets(
    { ...video, id },
    mType,
    nearViewport || intent || open || isMobile
  );
  const deferredAssets = useDeferredMediaAssets(
    { ...video, id },
    mType,
    nearViewport || intent || open
  );
  const assets = useMemo(
    () => ({ ...(automaticAssets || {}), ...(deferredAssets || {}) }),
    [automaticAssets, deferredAssets]
  );

  const mappedBackdrop = id ? usableArtwork(getCDNImageUrl(Number(id), "backdrop")) : null;
  const mappedPoster = id ? usableArtwork(getCDNImageUrl(Number(id), "poster")) : null;

  const embeddedScLandscape = firstUsableArtwork(
    video?.__artwork?.backdrop_url,
    video?.__artwork?.titled_backdrop_url
  );
  const embeddedScPoster = firstUsableArtwork(video?.__artwork?.poster_url);

  const legacyLandscape = firstUsableArtwork(
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

  const automaticLandscape = firstUsableArtwork(
    automaticAssets?.backdrop_path,
    automaticAssets?.titled_backdrop_path
  );
  const heroLandscape = firstUsableArtwork(
    automaticAssets?.hero_backdrop_path,
    automaticAssets?.detail_backdrop_path,
    embeddedScLandscape,
    automaticLandscape
  );
  const automaticPoster = firstUsableArtwork(
    automaticAssets?.poster_path,
    automaticAssets?.poster
  );
  const explicitScPoster = firstUsableArtwork(video?.mobile_sc_poster_url);
  const automaticScPoster = automaticAssets?.poster_source === "streamingcommunity"
    ? automaticPoster
    : null;

  const landscapeCandidates = useMemo(
    () => unique([
      embeddedScLandscape,
      automaticLandscape,
      mappedBackdrop,
      legacyLandscape,
    ]),
    [embeddedScLandscape, automaticLandscape, mappedBackdrop, legacyLandscape]
  );

  const posterCandidates = useMemo(
    () => unique([
      embeddedScPoster,
      explicitScPoster,
      automaticScPoster,
      automaticPoster,
      mappedPoster,
    ]),
    [embeddedScPoster, explicitScPoster, automaticScPoster, automaticPoster, mappedPoster]
  );

  const imageCandidates = isMobile ? posterCandidates : landscapeCandidates;
  const title = automaticAssets?.title || video?.title || video?.name || "";
  const detailHref = `/${MAIN_PATH.browse}/${typeSlug}/${id}`;

  const goPlay = useCallback((event?: any) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    window.scrollTo(0, 0);
    const ep = watch && typeSlug === "tv" ? `?s=${watch.season || 1}&e=${watch.episode || 1}` : "";
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${id}${ep}`);
  }, [navigate, typeSlug, id, watch]);

  const goDetail = useCallback((event?: any) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    window.scrollTo(0, 0);
    navigate(detailHref);
  }, [navigate, detailHref]);

  const handleEnter = useCallback((event?: any) => {
    if (!suppressHover && !isMobile) {
      hoverStartedAtRef.current = Date.now();
      onEnter(event);
    }
  }, [suppressHover, isMobile, onEnter]);

  const trailerUrl = assets?.resolved_trailer?.enabled && assets?.resolved_trailer?.available
    ? (assets?.resolved_trailer?.trailer_url ||
       assets?.resolved_trailer?.trailer_key ||
       assets?.resolved_trailer?.manifest_url ||
       assets?.preview_video_url)
    : null;

  const trailerDelay = useMemo(() => {
    if (!open || !hoverStartedAtRef.current) return TRAILER_HOVER_DELAY_MS;
    return Math.max(0, TRAILER_HOVER_DELAY_MS - (Date.now() - hoverStartedAtRef.current));
  }, [open, trailerUrl]);

  useEffect(() => {
    if (!intent || open || !trailerUrl || !/\.m3u8(?:$|\?)/i.test(String(trailerUrl))) return;
    const controller = new AbortController();
    fetch(String(trailerUrl), {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*" },
    }).catch(() => {});
    return () => controller.abort();
  }, [intent, open, trailerUrl]);

  const scHoverLogo = firstNonTmdbArtwork(
    video?.__artwork?.logo_url,
    automaticAssets?.logo_path,
    video?.netflix_logo_url,
    video?.logo_path,
    video?.logo
  );
  const hoverLogoUrl = scHoverLogo || firstLogo(
    deferredAssets?.logo_path,
    deferredAssets?.fallback_logo_path
  );
  const hoverArtwork = heroLandscape || embeddedScLandscape || automaticLandscape || mappedBackdrop || legacyLandscape;
  const hoverCoverUrl = embeddedScLandscape || automaticLandscape || mappedBackdrop || legacyLandscape || hoverArtwork;
  const hoverPoster = embeddedScPoster || automaticPoster || mappedPoster || hoverArtwork;

  useEffect(() => {
    if (!nearViewport || !hoverLogoUrl || typeof Image === "undefined") return;
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "high";
    image.src = hoverLogoUrl;
  }, [nearViewport, hoverLogoUrl]);

  const staticReady = isMobile
    ? posterCandidates.length > 0
    : landscapeCandidates.length > 0 && !!automaticAssets?.card_ready;
  if (!staticReady) return null;

  return (
    <>
      <NetflixStandardCard
        ref={ref}
        imageUrl={imageCandidates[0] || null}
        imageCandidates={imageCandidates.slice(1)}
        fallbackImageUrl={null}
        embeddedTitleTreatment={true}
        portrait={isMobile}
        title={title}
        href={detailHref}
        onClick={goDetail}
        onMouseEnter={handleEnter}
        onMouseLeave={isMobile ? undefined : onLeave}
        watch={watch}
        testId={`video-card-${id}`}
      />

      {open && !suppressHover && !isMobile ? (
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
              logo_path: hoverLogoUrl || null,
              logo: null,
              title_logo_path: null,
            }}
            mediaType={mType}
            onPlay={goPlay}
            onDetail={goDetail}
            watch={watch}
          />
          <HoverTrailerOverlay
            url={trailerUrl}
            logoUrl={hoverLogoUrl}
            coverUrl={hoverCoverUrl}
            delay={trailerDelay}
            onOpen={goDetail}
          />
        </ExpandOverlay>
      ) : null}
    </>
  );
}
