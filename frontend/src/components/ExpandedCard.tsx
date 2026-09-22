// @ts-nocheck
import { useMemo, useState } from "react";
import { MEDIA_TYPE } from "src/types/Common";
import useAutomaticMediaAssets, { TMDB_IMAGE_BASE } from "src/hooks/useAutomaticMediaAssets";
import "./NetflixMiniModalExact.css";

export const TMDB_IMG = TMDB_IMAGE_BASE;

export function useMediaAssets(video: any, mediaType: any) {
  return useAutomaticMediaAssets(video, mediaType, true);
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

function mediaUrl(value: any, size = "original") {
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
          return entry?.name || entry?.label || entry?.text || entry?.value || "";
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
  return ids.map((id) => table[Number(id)]).filter(Boolean);
}

function releaseYear(item: any) {
  const direct = firstValue(item?.year, item?.release_year, item?.releaseYear);
  if (direct && /^\d{4}$/.test(String(direct))) return String(direct);

  const value = firstValue(
    item?.release_date,
    item?.releaseDate,
    item?.first_air_date,
    item?.firstAirDate,
    item?.date
  );
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 4) : String(parsed.getFullYear());
}

function ratingLabel(item: any) {
  const raw = firstValue(
    item?.vote_average,
    item?.voteAverage,
    item?.rating,
    item?.score,
    item?.tmdb_rating,
    item?.tmdbRating
  );
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(1);
}

function ageLabel(value: any) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{1,2}$/.test(text)) return `${text}+`;
  return text;
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 4.6a1 1 0 0 1 1.52-.85l10.4 6.9a1.6 1.6 0 0 1 0 2.7l-10.4 6.9A1 1 0 0 1 7 19.4z" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d="M11 3h2v8h8v2h-8v8h-2v-8H3v-2h8z" clipRule="evenodd" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d="m9.55 17.48-5.4-5.4 1.41-1.42 3.99 3.99 8.89-8.9 1.42 1.42z" clipRule="evenodd" />
    </svg>
  );
}

function IconStar({ filled = false }: any) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m12 2.8 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17l-5.56 2.92 1.06-6.2L3 9.33l6.22-.9L12 2.8Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="m5 9 7 7 7-7" />
    </svg>
  );
}

function ScHoverButton({ primary = false, label, onClick, selected = false, children, end = false }: any) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`sc-hover-action${primary ? " is-primary" : ""}${selected ? " is-selected" : ""}${end ? " is-end" : ""}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      {children}
    </button>
  );
}

export default function ExpandedCard({ item, mediaType, onPlay, onDetail }: any) {
  const [inList, setInList] = useState(
    !!firstValue(item?.isInPlaylist, item?.in_playlist, item?.inList, item?.in_list, false)
  );
  const [liked, setLiked] = useState(!!firstValue(item?.liked, item?.thumb_up, item?.favorite, false));

  const type = item?.type || item?.media_type || (mediaType === MEDIA_TYPE.Tv ? "tv" : "movie");
  const title = item?.title || item?.name || "";

  const cover = mediaUrl(
    firstValue(
      item?.backdrop_path,
      item?.titled_backdrop_path,
      item?.cover_path,
      item?.poster_path,
      item?.netflix_artwork_url,
      item?.netflixArtworkUrl,
      item?.netflix_cover_url,
      item?.contextualArtwork?.artwork?.url,
      item?.artwork?.url,
      item?.image?.url
    ),
    "original"
  );

  const logo = mediaUrl(firstValue(item?.logo_path, item?.logo, item?.title_logo_path), "original");
  const previewVideo = firstValue(
    item?.preview_video_url,
    item?.previewVideoUrl,
    item?.preview?.video_url,
    item?.preview?.url,
    ""
  );

  const age = ageLabel(firstValue(
    item?.certificationValue,
    item?.age,
    item?.content_rating,
    item?.contentRating,
    item?.certification,
    item?.certification_value,
    item?.maturity_rating,
    item?.maturityRating,
    item?.maturity
  ));

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
    item?.displayRuntimeSec ? Math.max(1, Math.round(Number(item.displayRuntimeSec) / 60)) : undefined,
    item?.runtime,
    item?.duration,
    item?.runtime_minutes,
    item?.runtimeMinutes
  );

  const genres = useMemo(() => {
    const explicit = normalizeTextList(
      item?.genre_names,
      item?.genreNames,
      item?.genres,
      item?.evidence,
      item?.evidence_tags,
      item?.tags
    );
    const fallback = genreNamesFromIds(item?.genre_ids || item?.genreIds, type);
    return (explicit.length ? explicit : fallback).slice(0, 2);
  }, [item, type]);

  const rating = ratingLabel(item);
  const year = releaseYear(item);

  let durationLabel = "";
  if (type === "tv" && seasons) {
    durationLabel = typeof seasons === "string" && /stagion/i.test(seasons)
      ? seasons
      : `${seasons} ${Number(seasons) === 1 ? "stagione" : "stagioni"}`;
  } else if (runtime) {
    durationLabel = String(runtime).match(/min|h|ora/i) ? String(runtime) : `${runtime} min`;
  }

  const toggleList = (event: any) => {
    const next = !inList;
    setInList(next);
    item?.onToggleMyList?.(next, event);
  };

  const toggleFavorite = (event: any) => {
    const next = !liked;
    setLiked(next);
    item?.onRate?.(next ? "like" : null, event);
  };

  return (
    <>
      <div className="previewModal--player_container has-smaller-buttons mini-modal" data-uia="previewModal--player_container">
        <div className="previewModal--video-shell">
          <div className="previewModal--video-shell-inner">
            {previewVideo ? (
              <video disablePictureInPicture src={previewVideo} className="previewModal--video" autoPlay muted playsInline />
            ) : null}
          </div>
        </div>

        <div className="videoMerchPlayer--boxart-wrapper">
          {cover ? (
            <img
              alt={title}
              src={cover}
              className="previewModal--boxart"
              aria-hidden="true"
              decoding="async"
              style={{ opacity: previewVideo ? 0 : 1 }}
            />
          ) : null}
        </div>

        {logo ? (
          <div aria-hidden="true" className="previewModal--player-titleTreatmentWrapper" style={{ pointerEvents: "none", opacity: previewVideo ? 0 : 1 }}>
            <div className="previewModal--player-titleTreatment previewModal--player-titleTreatment-left has-smaller-buttons mini-modal">
              <img className="previewModal--player-titleTreatment-logo" src={logo} alt="" decoding="async" style={{ opacity: previewVideo ? 0 : 1 }} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="previewModal--info sc-hover-info">
        <div className="sc-hover-panel" data-uia="previewModal--info-container">
          <div className="sc-hover-controls">
            <ScHoverButton primary label="Riproduci" onClick={onPlay}>
              <IconPlay />
            </ScHoverButton>

            <ScHoverButton
              label={inList ? "Rimuovi dalla mia lista" : "Aggiungi alla mia lista"}
              onClick={toggleList}
              selected={inList}
            >
              {inList ? <IconCheck /> : <IconPlus />}
            </ScHoverButton>

            <ScHoverButton label="Preferito" onClick={toggleFavorite} selected={liked}>
              <IconStar filled={liked} />
            </ScHoverButton>

            <div className="sc-hover-controls-spacer" />

            <ScHoverButton label="Altre info" onClick={onDetail} end>
              <IconChevron />
            </ScHoverButton>
          </div>

          <div className="sc-hover-meta-line">
            {rating ? <span className="sc-hover-rating">Valutazione {rating}</span> : null}
            {year ? <span className="sc-hover-year">{year}</span> : null}
            {durationLabel ? (
              <>
                {year ? <span className="sc-hover-dash">-</span> : null}
                <span className="sc-hover-duration">{durationLabel}</span>
              </>
            ) : null}
            {age ? <span className="sc-hover-age">{age}</span> : null}
          </div>

          {genres.length ? (
            <div className="sc-hover-genres">
              {genres.map((genre: string, index: number) => (
                <span key={`${genre}-${index}`} className="sc-hover-genre">
                  {index > 0 ? <span className="sc-hover-genre-separator">•</span> : null}
                  {genre}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
