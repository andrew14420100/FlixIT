// @ts-nocheck
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MEDIA_TYPE } from "src/types/Common";
import "./NetflixMiniModalExact.css";

export const TMDB_IMG = "https://image.tmdb.org/t/p/";

export function useMediaAssets(video: any, mediaType: any) {
  const typeSlug = mediaType === MEDIA_TYPE.Tv ? "tv" : "movie";
  const id = video?.id || video?.tmdbId || video?.tmdb_id;

  const { data } = useQuery({
    queryKey: ["media-assets", typeSlug, id],
    queryFn: async () => {
      if (!id) return {};
      const response = await fetch(`/api/public/media-assets/${typeSlug}/${id}`);
      return response.ok ? response.json() : {};
    },
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
  });

  return data || {};
}

export function formatReleaseLabel(value?: string) {
  if (!value) return "Prossimamente";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Prossimamente";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

function mediaUrl(value: any, size = "w780") {
  if (!value) return "";
  if (
    typeof value === "string" &&
    (/^https?:\/\//i.test(value) ||
      value.startsWith("data:") ||
      value.startsWith("blob:"))
  ) {
    return value;
  }
  const path = String(value);
  return `${TMDB_IMG}${size}${path.startsWith("/") ? path : `/${path}`}`;
}

function firstValue(...values: any[]) {
  return values.find(
    (value) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0)
  );
}

function normalizeTextList(...values: any[]) {
  for (const value of values) {
    if (!value) continue;

    if (Array.isArray(value)) {
      const normalized = value
        .map((entry: any) => {
          if (typeof entry === "string") return entry;
          return (
            entry?.name ||
            entry?.label ||
            entry?.text ||
            entry?.value ||
            ""
          );
        })
        .filter(Boolean);

      if (normalized.length) return normalized;
    }

    if (typeof value === "string") {
      const split = value
        .split(/[|,•]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (split.length) return split;
    }
  }

  return [];
}


const MOVIE_GENRES: Record<number, string> = {
  28: "Azione",
  12: "Avventura",
  16: "Animazione",
  35: "Commedia",
  80: "Crime",
  99: "Documentario",
  18: "Dramma",
  10751: "Famiglia",
  14: "Fantasy",
  36: "Storia",
  27: "Horror",
  10402: "Musica",
  9648: "Mistero",
  10749: "Romantico",
  878: "Fantascienza",
  10770: "Film TV",
  53: "Thriller",
  10752: "Guerra",
  37: "Western",
};

const TV_GENRES: Record<number, string> = {
  10759: "Azione e avventura",
  16: "Animazione",
  35: "Commedia",
  80: "Crime",
  99: "Documentario",
  18: "Dramma",
  10751: "Famiglia",
  10762: "Kids",
  9648: "Mistero",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi e Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "Guerra e politica",
  37: "Western",
};

function genreNamesFromIds(ids: any, type: string) {
  if (!Array.isArray(ids)) return [];
  const table = type === "tv" ? TV_GENRES : MOVIE_GENRES;
  return ids
    .map((id) => table[Number(id)])
    .filter(Boolean);
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 2.7a1 1 0 0 1 1.48-.88l16.93 9.3a1 1 0 0 1 0 1.76l-16.93 9.3A1 1 0 0 1 5 21.31z"
      />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11 11V2h2v9h9v2h-9v9h-2v-9H2v-2z"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="m9.55 17.48-5.4-5.4 1.41-1.42 3.99 3.99 8.89-8.9 1.42 1.42z"
      />
    </svg>
  );
}

function IconThumb() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.696 8.773A2 2 0 0 0 11 7.713V4h.838c.877 0 1.59.553 1.77 1.311C13.822 6.228 14 7.227 14 8a7 7 0 0 1-.246 1.75L13.432 11H17.5a1.5 1.5 0 0 1 1.476 1.77l-.08.445.28.354c.203.256.324.578.324.931s-.12.675-.324.93l-.28.355.08.445q.024.13.024.27c0 .49-.234.925-.6 1.2l-.4.3v.5a1.5 1.5 0 0 1-1.5 1.5h-3.877a9 9 0 0 1-2.846-.462l-1.493-.497A10.5 10.5 0 0 0 5 18.5v-4.747l2.036-.581a3 3 0 0 0 1.72-1.295zM10.5 2A1.5 1.5 0 0 0 9 3.5v4.213l-1.94 3.105a1 1 0 0 1-.574.432l-2.035.581A2 2 0 0 0 3 13.754v4.793c0 1.078.874 1.953 1.953 1.953.917 0 1.828.148 2.698.438l1.493.498a11 11 0 0 0 3.479.564H16.5a3.5 3.5 0 0 0 3.467-3.017 3.5 3.5 0 0 0 1.028-2.671c.32-.529.505-1.15.505-1.812s-.185-1.283-.505-1.812Q21 12.595 21 12.5A3.5 3.5 0 0 0 17.5 9h-1.566c.041-.325.066-.66.066-1 0-1.011-.221-2.194-.446-3.148C15.14 3.097 13.543 2 11.838 2z"
      />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="m12 15.586 7.293-7.293 1.414 1.414-8 8a1 1 0 0 1-1.414 0l-8-8 1.414-1.414z"
      />
    </svg>
  );
}

function SpatialAudioMark() {
  return (
    <div className="spatial-audio spatial-audio-icon-it" aria-label="Audio spaziale">
      <svg viewBox="0 0 72 18" aria-hidden="true">
        <path
          d="M10 9c0-3.6 2.4-6.3 5.8-6.3S22 5.4 22 9s-2.7 6.3-6.2 6.3S10 12.6 10 9Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M6.8 4.3a7.4 7.4 0 0 0 0 9.4M3.7 1.7a11.3 11.3 0 0 0 0 14.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <text x="29" y="12.5" fill="currentColor" fontSize="9.5" fontFamily="inherit">SPATIAL</text>
      </svg>
    </div>
  );
}

function MiniButton({
  primary = false,
  label,
  onClick,
  selected = false,
  children,
}: any) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`nflx-mini-control ${
        primary ? "color-primary" : "color-supplementary"
      } hasIcon round${selected ? " is-selected" : ""}`}
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <span className="small" role="presentation">
        {children}
      </span>
    </button>
  );
}

export default function ExpandedCard({
  item,
  mediaType,
  onPlay,
  onDetail,
  watch,
}: any) {
  const [inList, setInList] = useState(
    !!firstValue(
      item?.isInPlaylist,
      item?.in_playlist,
      item?.inList,
      item?.in_list,
      false
    )
  );
  const [liked, setLiked] = useState(
    !!firstValue(item?.liked, item?.thumb_up, false)
  );

  const type =
    item?.type ||
    item?.media_type ||
    (mediaType === MEDIA_TYPE.Tv ? "tv" : "movie");

  const title = item?.title || item?.name || "";

  const cover = mediaUrl(
    firstValue(
      item?.netflix_artwork_url,
      item?.netflixArtworkUrl,
      item?.netflix_cover_url,
      item?.contextualArtwork?.artwork?.url,
      item?.artwork?.url,
      item?.image?.url,
      item?.titled_backdrop_path,
      item?.backdrop_path,
      item?.cover_path,
      item?.poster_path
    ),
    "w780"
  );

  const hasTitledArtwork = !!firstValue(
    item?.titled_backdrop_path,
    item?.titledBackdropPath
  );

  const logo = hasTitledArtwork
    ? ""
    : mediaUrl(
        firstValue(item?.logo_path, item?.logo, item?.title_logo_path),
        "w500"
      );

  const previewVideo = firstValue(
    item?.preview_video_url,
    item?.previewVideoUrl,
    item?.preview?.video_url,
    item?.preview?.url,
    ""
  );

  const age = firstValue(
    item?.certificationValue,
    item?.age,
    item?.content_rating,
    item?.contentRating,
    item?.certification,
    item?.certification_value,
    item?.maturity_rating,
    item?.maturityRating,
    item?.maturity
  );

  const seasons = firstValue(
    item?.numSeasonsLabel,
    item?.num_seasons_label,
    item?.seasons_label,
    item?.seasons_count,
    item?.number_of_seasons,
    item?.seasonsCount,
    item?.season_count,
    item?.seasonCount
  );

  const runtime = firstValue(
    item?.displayRuntimeSec
      ? Math.max(1, Math.round(Number(item.displayRuntimeSec) / 60))
      : undefined,
    item?.runtime,
    item?.duration,
    item?.runtime_minutes,
    item?.runtimeMinutes
  );

  const quality = firstValue(
    item?.playback_badge,
    item?.playbackBadge,
    item?.hdr || item?.is_hdr ? "HDR" : undefined,
    item?.quality,
    "HD"
  );

  const hasSpatialAudio = !!firstValue(
    item?.hasAudioSpatial,
    item?.spatial_audio,
    item?.spatialAudio,
    item?.delivery?.hasAudioSpatial,
    false
  );

  const evidence = useMemo(() => {
    const explicit = normalizeTextList(
      item?.evidence,
      item?.evidence_tags,
      item?.tags,
      item?.genre_names,
      item?.genreNames,
      item?.genres
    );

    const fallbackGenres = genreNamesFromIds(
      item?.genre_ids || item?.genreIds,
      type
    );

    return (explicit.length ? explicit : fallbackGenres).slice(0, 4);
  }, [item, type]);

  const supplementalMessage = firstValue(
    item?.supplemental_message,
    item?.supplementalMessage,
    item?.availability_message,
    item?.availabilityMessage
  );

  const contentWarning = firstValue(
    item?.content_warning,
    item?.contentWarning?.message,
    item?.contentWarning
  );

  const mostLiked = firstValue(
    item?.most_liked_message,
    item?.mostLikedMessage,
    item?.most_liked
  );

  const watchPercent = Math.max(
    0,
    Math.min(100, Number(watch?.percent || item?.progress_percent || 0))
  );

  const toggleList = (event: any) => {
    const next = !inList;
    setInList(next);
    item?.onToggleMyList?.(next, event);
  };

  const toggleLike = (event: any) => {
    const next = !liked;
    setLiked(next);
    item?.onRate?.(next ? "like" : null, event);
  };

  const detailHref = "#";

  return (
    <>
      <div
        className="previewModal--player_container has-smaller-buttons mini-modal"
        data-uia="previewModal--player_container"
      >
        <div className="previewModal--video-shell">
          <div className="previewModal--video-shell-inner">
            {previewVideo ? (
              <video
                disablePictureInPicture
                src={previewVideo}
                className="previewModal--video"
                autoPlay
                muted
                playsInline
              />
            ) : null}
          </div>
        </div>

        <div className="videoMerchPlayer--boxart-wrapper">
          {cover ? (
            <>
              <img
                alt={title}
                src={cover}
                className="previewModal--boxart"
                aria-hidden="true"
                style={{ opacity: previewVideo ? 0 : 1 }}
              />
              <img
                alt=""
                src={cover}
                aria-hidden="true"
                className="previewModal--auxiliary-boxart"
              />
            </>
          ) : null}
        </div>

        {logo ? (
          <div
            aria-hidden="true"
            className="previewModal--player-titleTreatmentWrapper"
            style={{
              pointerEvents: "none",
              opacity: previewVideo ? 0 : 1,
            }}
          >
            <div className="previewModal--player-titleTreatment previewModal--player-titleTreatment-left has-smaller-buttons mini-modal">
              <img
                className="previewModal--player-titleTreatment-logo"
                src={logo}
                alt=""
                style={{ opacity: previewVideo ? 0 : 1 }}
              />
            </div>
          </div>
        ) : null}

        <div
          className="previewModal-audioToggle has-smaller-buttons mini-modal"
          style={{ display: "none" }}
        />
      </div>

      <div className="previewModal-close">
        <span role="button" aria-label="close" tabIndex={0} title="close" />
      </div>

      <div className="previewModal--info">
        <a
          href={detailHref}
          className="previewModal--info-link"
          onClick={(event) => {
            event.preventDefault();
            onDetail?.(event);
          }}
        >
          <div className="mini-modal-container">
            <div
              className="previewModal--info-container"
              data-uia="previewModal--info-container"
            >
              <div
                className="previewModal--metadatAndControls has-smaller-buttons mini-modal"
                data-uia="previewModal--metadatAndControls"
              >
                <div className="previewModal--metadatAndControls-container">
                  <div
                    className="buttonControls--container has-smaller-buttons mini-modal"
                    data-uia="mini-modal-controls"
                  >
                    <div className="nflx-control-wrap">
                      <MiniButton
                        primary
                        label="Riproduci"
                        onClick={onPlay}
                      >
                        <IconPlay />
                      </MiniButton>
                    </div>

                    <div className="nflx-control-wrap">
                      <MiniButton
                        label={inList ? "Rimuovi dalla mia lista" : "La mia lista"}
                        onClick={toggleList}
                        selected={inList}
                      >
                        {inList ? <IconCheck /> : <IconPlus />}
                      </MiniButton>
                    </div>

                    <div className="nflx-control-wrap">
                      <MiniButton
                        label={liked ? "Mi piace" : "Valuta"}
                        onClick={toggleLike}
                        selected={liked}
                      >
                        <IconThumb />
                      </MiniButton>
                    </div>

                    <div className="buttonControls--expand-button">
                      <MiniButton label="Altre info" onClick={onDetail}>
                        <IconChevron />
                      </MiniButton>
                    </div>
                  </div>

                  {watchPercent > 0 ? (
                    <div className="previewModal-progress">
                      <div className="previewModal-progress-track">
                        <div
                          className="previewModal-progress-value"
                          style={{ width: `${watchPercent}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {supplementalMessage ? (
                    <div className="previewModal-supplemental-message">
                      {String(supplementalMessage)}
                    </div>
                  ) : null}

                  <div className="previewModal--metadatAndControls-info">
                    <div>
                      <div>
                        <div
                          data-uia="videoMetadata--container"
                          className="videoMetadata--container"
                        >
                          <div className="videoMetadata--line">
                            <span className="content-type">
                              {type === "tv" ? "Serie" : "Film"}
                            </span>

                            {age ? (
                              <div
                                className="maturity-rating"
                                data-uia="maturity-rating"
                              >
                                <span className="maturity-number">
                                  {String(age)}
                                </span>
                              </div>
                            ) : null}

                            {type === "tv" && seasons ? (
                              <span className="duration">
                                {typeof seasons === "string" &&
                                /stagion/i.test(seasons)
                                  ? seasons
                                  : `${seasons} ${
                                      Number(seasons) === 1
                                        ? "stagione"
                                        : "stagioni"
                                    }`}
                              </span>
                            ) : runtime ? (
                              <span className="duration">
                                {String(runtime).match(/min|h|ora/i)
                                  ? String(runtime)
                                  : `${runtime} min`}
                              </span>
                            ) : null}

                            {quality ? (
                              <span
                                className="player-feature-badge"
                                data-uia={`player-feature-badge-${String(
                                  quality
                                ).toLowerCase()}`}
                              >
                                {String(quality)}
                              </span>
                            ) : null}

                            {hasSpatialAudio ? <SpatialAudioMark /> : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {evidence.length > 0 ? (
                    <div className="previewModal--metadatAndControls-tags-container">
                      <div className="evidence-tags">
                        <div className="evidence-list">
                          {evidence.map((value: string, index: number) => (
                            <div
                              className="evidence-item"
                              key={`${value}-${index}`}
                            >
                              {index === 0 ? null : (
                                <span className="evidence-separator" />
                              )}
                              <span className="evidence-text">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {contentWarning ? (
                    <div
                      data-uia="preview-modal-content-warning"
                      className="previewModal-contentWarning"
                    >
                      <span className="content-warning-icon">!</span>
                      <span>{String(contentWarning)}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {mostLiked ? (
                <div className="previewModal-most-liked">
                  {typeof mostLiked === "string"
                    ? mostLiked
                    : "Tra i più apprezzati"}
                </div>
              ) : null}
            </div>
          </div>
        </a>
      </div>
    </>
  );
}
