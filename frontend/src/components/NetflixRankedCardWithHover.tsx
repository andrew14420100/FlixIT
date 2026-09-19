// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import useDeferredMediaAssets from "src/hooks/useDeferredMediaAssets";
import useAutomaticMediaAssets from "src/hooks/useAutomaticMediaAssets";
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

  const rankedArtwork = useNetflixArtwork(
    { ...item, id: normalizedId },
    mType,
    "top10",
    true
  );
  const hoverArtwork = useNetflixArtwork(
    { ...item, id: normalizedId },
    mType,
    "home",
    intent || open
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

  const existingNetflixPoster = firstNonTmdbArtwork(
    item?.netflix_ranked_artwork_url,
    item?.netflixRankedArtworkUrl,
    item?.netflix_artwork_url,
    item?.netflixArtworkUrl,
    item?.netflix_cover_url,
    item?.contextualArtwork?.artwork
  );

  const legacyPoster = firstNonTmdbArtwork(
    item?.poster_path,
    item?.poster,
    item?.artwork,
    item?.image,
    item?.cover_path,
    item?.cover
  );
  const legacyLandscape = firstNonTmdbArtwork(
    item?.backdrop_path,
    item?.titled_backdrop_path,
    item?.titledBackdropPath,
    item?.artwork,
    item?.image,
    item?.image_url,
    item?.thumbnail_url
  );

  const mappedPoster = normalizedId
    ? getCDNImageUrl(Number(normalizedId), "poster") || getCDNImageUrl(Number(normalizedId), "backdrop")
    : null;
  const mappedBackdrop = normalizedId
    ? getCDNImageUrl(Number(normalizedId), "backdrop") || getCDNImageUrl(Number(normalizedId), "poster")
    : null;

  const rankedResolved = nonTmdbArtwork(rankedArtwork?.artwork?.url);
  const hoverResolved = nonTmdbArtwork(hoverArtwork?.artwork?.url);

  const automaticPoster = firstNonTmdbArtwork(automaticAssets?.poster_path);
  const automaticBackdrop = firstNonTmdbArtwork(
    automaticAssets?.netflix_artwork_url,
    automaticAssets?.backdrop_path,
    automaticAssets?.titled_backdrop_path
  );

  const posterCandidates = useMemo(
    () => unique([
      rankedResolved,
      automaticPoster,
      existingNetflixPoster,
      mappedPoster,
      legacyPoster,
      automaticBackdrop,
      mappedBackdrop,
      legacyLandscape,
    ]),
    [
      rankedResolved,
      automaticPoster,
      existingNetflixPoster,
      mappedPoster,
      legacyPoster,
      automaticBackdrop,
      mappedBackdrop,
      legacyLandscape,
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

  const hoverLogoUrl = firstNonTmdbArtwork(
    hoverArtwork?.logo?.url,
    rankedArtwork?.logo?.url,
    automaticAssets?.netflix_logo_url,
    automaticAssets?.logo_path,
    assets?.logo_path
  );

  const hoverBackdrop =
    hoverResolved || automaticBackdrop || mappedBackdrop || legacyLandscape || existingNetflixPoster || rankedResolved || automaticPoster || mappedPoster || legacyPoster;
  const hoverPoster = rankedResolved || automaticPoster || existingNetflixPoster || mappedPoster || legacyPoster || hoverBackdrop;

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
          <div className="netflix-ranked-card-poster-wrap" style={{ position: "absolute" }}>
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
              <div className="netflix-ranked-card-placeholder" aria-hidden="true" />
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
              netflix_ranked_artwork_url: hoverPoster || undefined,
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
              poster_path: hoverPoster || null,
              poster: null,
              logo_path: trailerUrl ? null : (hoverLogoUrl || null),
              logo: null,
              title_logo_path: null,
            }}
            mediaType={mType}
            onPlay={goPlay}
            onDetail={goDetail}
            watch={watch}
          />
          <HoverTrailerOverlay url={trailerUrl} logoUrl={hoverLogoUrl} onOpen={goDetail} />
        </ExpandOverlay>
      ) : null}
    </>
  );
}
