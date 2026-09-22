// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import useDeferredMediaAssets from "src/hooks/useDeferredMediaAssets";
import useAutomaticMediaAssets, { isEmbeddedCardArtwork } from "src/hooks/useAutomaticMediaAssets";
import { getCDNImageUrl } from "src/config/cdnMapping";
import ExpandedCard from "./ExpandedCard";
import HoverTrailerOverlay from "./HoverTrailerOverlay";
import "./NetflixMiniModalExact.css";
import NetflixTop10RankSvg from "./NetflixTop10RankSvg";
import StreamingCommunityTop10RankSvg from "./StreamingCommunityTop10RankSvg";

const TRAILER_HOVER_DELAY_MS = 2000;

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

function firstLogo(...values: any[]) {
  for (const value of values) {
    const raw = firstArtwork(value);
    if (!raw) continue;
    const text = String(raw).trim();
    if (/^https?:\/\//i.test(text) || text.startsWith("data:") || text.startsWith("blob:")) return text;
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
  const isMobile = useMediaQuery("(max-width:899px)");
  const ref = useRef<HTMLDivElement>(null);
  const hoverStartedAtRef = useRef(0);
  const [nearViewport, setNearViewport] = useState(false);
  const [posterIndex, setPosterIndex] = useState(0);

  const normalizedId = item?.id || item?.tmdbId || item?.tmdb_id;
  const mType = mediaType ||
    (item?.type === "tv" || item?.media_type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie);
  const typeSlug = mType === MEDIA_TYPE.Tv ? "tv" : "movie";

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
      { rootMargin: "220px 360px" }
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
    { ...item, id: normalizedId },
    mType,
    nearViewport || intent || open
  );
  const deferredAssets = useDeferredMediaAssets(
    { ...item, id: normalizedId },
    mType,
    nearViewport || intent || open
  );
  const assets = useMemo(
    () => ({ ...(automaticAssets || {}), ...(deferredAssets || {}) }),
    [automaticAssets, deferredAssets]
  );

  const mappedPoster = normalizedId
    ? getCDNImageUrl(Number(normalizedId), "poster")
    : null;
  const mappedBackdrop = normalizedId
    ? getCDNImageUrl(Number(normalizedId), "backdrop")
    : null;

  const legacyPoster = firstNonTmdbArtwork(
    item?.netflix_ranked_artwork_url,
    item?.netflixRankedArtworkUrl,
    item?.poster_path,
    item?.poster,
    item?.artwork,
    item?.image,
    item?.cover_path,
    item?.cover
  );
  const legacyBackdrop = firstNonTmdbArtwork(
    item?.netflix_artwork_url,
    item?.netflixArtworkUrl,
    item?.backdrop_path,
    item?.backdrop,
    item?.cover_path,
    item?.cover,
    item?.artwork,
    item?.image
  );
  const legacyPosterEmbedded = !!(
    item?.poster_embedded_title_treatment ||
    item?.has_embedded_poster_title_treatment ||
    isEmbeddedCardArtwork(legacyPoster)
  );

  const automaticPoster = firstNonTmdbArtwork(automaticAssets?.poster_path);
  const automaticPosterEmbedded = !!automaticAssets?.poster_embedded_title_treatment;
  const automaticBackdrop = firstNonTmdbArtwork(
    automaticAssets?.backdrop_path,
    automaticAssets?.titled_backdrop_path
  );
  const hoverBackdrop = firstNonTmdbArtwork(
    automaticAssets?.hero_backdrop_path,
    automaticAssets?.detail_backdrop_path,
    automaticBackdrop,
    mappedBackdrop
  );
  const scLogoUrl = firstNonTmdbArtwork(
    automaticAssets?.logo_path,
    item?.netflix_logo_url,
    item?.logo_path,
    item?.logo
  );
  const logoUrl = scLogoUrl || firstLogo(deferredAssets?.logo_path, deferredAssets?.fallback_logo_path);

  const posterCandidates = useMemo(
    () => unique([
      automaticPosterEmbedded && automaticPoster && automaticPoster !== automaticBackdrop
        ? automaticPoster
        : null,
      mappedPoster && mappedPoster !== mappedBackdrop ? mappedPoster : null,
      legacyPosterEmbedded && legacyPoster && legacyPoster !== legacyBackdrop
        ? legacyPoster
        : null,
    ]),
    [
      automaticPoster,
      automaticPosterEmbedded,
      automaticBackdrop,
      mappedPoster,
      mappedBackdrop,
      legacyPoster,
      legacyPosterEmbedded,
      legacyBackdrop,
    ]
  );

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
    }, [navigate, detailHref]
  );

  const goPlay = useCallback(
    (event?: any) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      window.scrollTo(0, 0);
      const ep = watch && typeSlug === "tv" ? `?s=${watch.season || 1}&e=${watch.episode || 1}` : "";
      navigate(`/${MAIN_PATH.watch}/${typeSlug}/${normalizedId}${ep}`);
    }, [navigate, normalizedId, typeSlug, watch]
  );

  const handleEnter = useCallback(
    (event?: any) => {
      if (!suppressHover) {
        hoverStartedAtRef.current = Date.now();
        onEnter(event);
      }
    }, [suppressHover, onEnter]
  );

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

  const staticReady = !!automaticAssets?.top10_ready && posterCandidates.length > 0;

  if (!staticReady || !posterUrl) return null;

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
            {isMobile ? (
              <StreamingCommunityTop10RankSvg
                rank={rank}
                className="netflix-ranked-card-rank-svg"
              />
            ) : (
              <NetflixTop10RankSvg
                rank={rank}
                className="netflix-ranked-card-rank-svg"
                opacity={0.5}
              />
            )}
          </div>
          <div className="netflix-ranked-card-poster-wrap" style={{ position: "absolute", overflow: "hidden" }}>
            <img
              src={posterUrl}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              onError={() => setPosterIndex((index) => index + 1)}
              className="netflix-ranked-card-poster"
            />
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
              netflix_ranked_artwork_url: posterUrl || undefined,
              netflix_artwork_url: hoverBackdrop || undefined,
              netflixArtworkUrl: undefined,
              netflix_cover_url: undefined,
              contextualArtwork: undefined,
              artwork: undefined,
              image: undefined,
              image_url: undefined,
              thumbnail_url: undefined,
              backdrop_path: hoverBackdrop || null,
              titled_backdrop_path: null,
              cover_path: null,
              cover: null,
              poster_path: posterUrl || null,
              poster: null,
              logo_path: logoUrl || null,
              logo: null,
              title_logo_path: null,
            }}
            mediaType={mType}
            onPlay={goPlay}
            onDetail={goDetail}
            watch={watch}
          />
          <HoverTrailerOverlay url={trailerUrl} logoUrl={logoUrl} delay={trailerDelay} onOpen={goDetail} />
        </ExpandOverlay>
      ) : null}
    </>
  );
}
