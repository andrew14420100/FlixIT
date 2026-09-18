// @ts-nocheck
import { useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Movie } from "src/types/Movie";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import ExpandedCard, { TMDB_IMG } from "./ExpandedCard";

interface Props {
  video: Movie;
  mediaType?: any;
  watch?: any;
}

const EXPAND_SCALE = 1.5;
const getExpandedWidth = (r: DOMRect) => Math.round(r.width * EXPAND_SCALE);

function useOriginalMediaAssets(video: any, mediaType: any) {
  const typeSlug =
    mediaType === MEDIA_TYPE.Tv ? "tv" : "movie";

  const id =
    video?.id ||
    video?.tmdbId ||
    video?.tmdb_id;

  const { data } = useQuery({
    queryKey: ["media-assets", typeSlug, id],
    queryFn: async () => {
      if (!id) return {};
      const response = await fetch(
        `/api/public/media-assets/${typeSlug}/${id}`
      );
      if (!response.ok) return {};
      return response.json();
    },
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
  });

  return data || {};
}

function formatReleaseLabel(dateValue?: string) {
  if (!dateValue) return "Prossimamente";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "Prossimamente";
  }

  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default function VideoItemWithHover({
  video,
  mediaType,
  watch,
}: Props) {
  const navigate = useNavigate();

  // SC: per le card normali il trigger hover è proprio l'immagine.
  const ref = useRef<HTMLImageElement>(null);

  const mType =
    mediaType || MEDIA_TYPE.Movie;

  const typeSlug =
    mType === MEDIA_TYPE.Tv ? "tv" : "movie";

  const assets =
    useOriginalMediaAssets(video, mType);

  const {
    open,
    entered,
    display,
    position,
    onEnter,
    onLeave,
    onOverlayLeave,
  } = useHoverExpand(ref, getExpandedWidth, {
    upcoming: !!video.upcoming,
  });

  // COPERTINE ORIGINALI: stessa logica del tuo file.
  const titled =
    video.titled_backdrop_path ||
    assets.titled_backdrop_path;

  const backdrop =
    titled ||
    video.backdrop_path ||
    assets.backdrop_path;

  const imageUrl = useMemo(() => {
    if (backdrop) {
      return `${TMDB_IMG}w500${backdrop}`;
    }

    const poster =
      video.poster_path ||
      assets.poster_path;

    return poster
      ? `${TMDB_IMG}w342${poster}`
      : null;
  }, [
    backdrop,
    video.poster_path,
    assets.poster_path,
  ]);

  const logoUrl =
    !titled && assets.logo_path
      ? `${TMDB_IMG}w185${assets.logo_path}`
      : null;

  const goPlay = useCallback(
    (e) => {
      e?.stopPropagation();

      window.scrollTo(0, 0);

      const ep =
        watch && typeSlug === "tv"
          ? `?s=${watch.season || 1}&e=${watch.episode || 1}`
          : "";

      navigate(
        `/${MAIN_PATH.watch}/${typeSlug}/${video.id}${ep}`
      );
    },
    [navigate, typeSlug, video.id, watch]
  );

  const goDetail = useCallback(
    (e) => {
      e?.stopPropagation?.();

      window.scrollTo(0, 0);

      navigate(
        `/${MAIN_PATH.browse}/${typeSlug}/${video.id}`
      );
    },
    [navigate, typeSlug, video.id]
  );

  return (
    <div
      data-testid={`video-card-${video.id}`}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/9",
        cursor: "pointer",
        zIndex: open ? 100 : 1,
      }}
    >
      <div
        onClick={goDetail}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 6,
          overflow: "hidden",
          background: "#141414",
        }}
      >
        {imageUrl && (
          <img
            ref={ref}
            src={imageUrl}
            alt={video.title || video.name || ""}
            loading="lazy"
            draggable={false}
            className="cover-image"
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        )}

        {logoUrl && (
          <>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: "60%",
                pointerEvents: "none",
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
              }}
            />

            <img
              src={logoUrl}
              alt=""
              data-testid={`card-logo-static-${video.id}`}
              style={{
                position: "absolute",
                left: 10,
                bottom: 8,
                maxWidth: "50%",
                maxHeight: "38%",
                objectFit: "contain",
                pointerEvents: "none",
                filter:
                  "drop-shadow(0 2px 4px rgba(0,0,0,0.9))",
              }}
            />
          </>
        )}

        {(video.upcoming || video.new_release) && (
          <div
            data-testid={`upcoming-badge-${video.id}`}
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              padding: "3px 8px",
              borderRadius: 6,
              background: video.new_release
                ? "#fff"
                : "#E50914",
              color: video.new_release
                ? "#000"
                : "#fff",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              boxShadow:
                "0 4px 12px rgba(0,0,0,0.5)",
            }}
          >
            {video.badge ||
              (video.release_date
                ? formatReleaseLabel(video.release_date)
                : "Prossimamente")}
          </div>
        )}

        {watch && (
          <div
            data-testid={`progress-bar-${video.id}`}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 4,
              background:
                "rgba(255,255,255,0.25)",
            }}
          >
            <div
              style={{
                width: `${watch.percent || 0}%`,
                height: "100%",
                background: "#e50914",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        )}
      </div>

      {open && (
        <ExpandOverlay
          position={position}
          entered={entered}
          display={display}
          fadeImageOut={false}
          onMouseLeave={onOverlayLeave}
          testId={`hover-overlay-${video.id}`}
        >
          <ExpandedCard
            item={{
              ...video,
              ...assets,
              id: video.id,
              watch,
            }}
            mediaType={mType}
            onPlay={goPlay}
            onDetail={goDetail}
            display={display}
            watch={watch}
          />
        </ExpandOverlay>
      )}
    </div>
  );
}
