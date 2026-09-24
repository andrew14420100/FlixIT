// @ts-nocheck
import { useEffect, useState } from "react";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import TrailerPlayer from "src/components/TrailerPlayer";
import TrailerAudioButton from "src/components/TrailerAudioButton";
import { remainingText, runtimeText, seasonsText } from "./detailUtils";

const HERO_TRAILER_DELAY_MS = 3000;

/**
 * Cinematic hero: backdrop and trailer share the SAME absolute container
 * (.dp-hero__media). Switching between them is a pure opacity fade - no
 * resize, no crop change, no aspect-ratio change.
 */
export default function DetailHero({ data, mediaId, onPlay, onWarm }) {
  const {
    isTV, title, logoUrl, backdropUrl, trailerUrl, genres, year, certification,
    seasonsCount, runtimeMinutes, progressItem, progressPercent, remainingSeconds, season, episode,
  } = data;

  const [trailerArmed, setTrailerArmed] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [trailerFailed, setTrailerFailed] = useState(false);
  const [muted, setMuted] = useState(true);
  const [backdropFailed, setBackdropFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  // Reset per title (and when the resolver delivers a new trailer URL).
  useEffect(() => {
    setTrailerArmed(false);
    setTrailerPlaying(false);
    setTrailerFailed(false);
    setMuted(true);
  }, [mediaId, trailerUrl]);

  useEffect(() => {
    setBackdropFailed(false);
    setLogoFailed(false);
  }, [mediaId, backdropUrl, logoUrl]);

  // Start the trailer after the standard delay; never retry after a failure.
  useEffect(() => {
    if (!trailerUrl || trailerFailed) return undefined;
    const timer = window.setTimeout(() => setTrailerArmed(true), HERO_TRAILER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [trailerUrl, trailerFailed, mediaId]);

  const stopTrailer = () => {
    setTrailerArmed(false);
    setTrailerPlaying(false);
  };

  const trailerVisible = trailerArmed && trailerPlaying;
  const showBackdrop = !!backdropUrl && !backdropFailed;
  const showLogo = !!logoUrl && !logoFailed;

  const ctaLabel = progressItem ? "Continua a guardare" : isTV ? `Guarda S${season}:E${episode}` : "Riproduci";
  const showResumeBlock = !!progressItem || isTV;
  const metaParts = [
    isTV ? "Serie" : "Film",
    genres[0],
    year,
    isTV ? seasonsText(seasonsCount) : runtimeText(runtimeMinutes),
  ].filter(Boolean);

  return (
    <section
      className="dp-hero"
      data-testid="detail-hero"
      data-has-trailer={trailerUrl ? "true" : "false"}
      data-trailer-state={trailerVisible ? "playing" : trailerArmed ? "loading" : "idle"}
    >
      <div className="dp-hero__media">
        {showBackdrop ? (
          <img
            className={`dp-hero__backdrop${trailerVisible ? " is-hidden" : ""}`}
            src={backdropUrl}
            alt=""
            decoding="async"
            fetchPriority="high"
            onError={() => setBackdropFailed(true)}
            data-testid="detail-hero-backdrop"
          />
        ) : (
          <div className="dp-hero__backdrop dp-hero__backdrop--empty" data-testid="detail-hero-backdrop-fallback" />
        )}
        {trailerArmed && trailerUrl ? (
          <div className={`dp-hero__trailer${trailerPlaying ? " is-visible" : ""}`} data-testid="detail-hero-trailer">
            <TrailerPlayer
              key={trailerUrl}
              videoKey={trailerUrl}
              muted={muted}
              playing
              loop={false}
              zoom={1}
              onPlaying={() => setTrailerPlaying(true)}
              onEnded={stopTrailer}
              onError={() => {
                setTrailerFailed(true);
                stopTrailer();
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="dp-hero__shade dp-hero__shade--top" />
      <div className="dp-hero__shade dp-hero__shade--left" />
      <div className="dp-hero__shade dp-hero__shade--bottom" />

      <div className="dp-hero__content">
        {showLogo ? (
          <img
            className="dp-hero__logo"
            src={logoUrl}
            alt={title}
            decoding="async"
            fetchPriority="high"
            onError={() => setLogoFailed(true)}
            data-testid="detail-hero-logo"
          />
        ) : (
          <h1 className="dp-hero__title" data-testid="detail-hero-title">{title}</h1>
        )}

        <div className="dp-hero__meta" data-testid="detail-hero-meta">
          {metaParts.map((part, index) => (
            <span key={`${part}-${index}`} className="dp-hero__meta-item">
              {index ? <span className="dp-hero__dot" aria-hidden="true">•</span> : null}
              <span>{part}</span>
            </span>
          ))}
          {certification ? (
            <span className="dp-hero__meta-item">
              <span className="dp-hero__dot" aria-hidden="true">•</span>
              <span className="dp-badge" data-testid="detail-hero-certification">{certification}</span>
            </span>
          ) : null}
        </div>

        {showResumeBlock ? (
          <p className="dp-hero__label" data-testid="detail-hero-resume-label">{ctaLabel}</p>
        ) : null}

        {progressItem ? (
          <div className="dp-hero__progress-row">
            <div className="dp-progress" data-testid="detail-hero-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)}>
              <div className="dp-progress__fill" style={{ width: `${Math.max(2, progressPercent)}%` }} />
            </div>
            <span className="dp-hero__progress-text" data-testid="detail-hero-progress-text">
              {isTV ? `S${season}:E${episode} - ` : ""}{remainingText(remainingSeconds)} rimanenti
            </span>
          </div>
        ) : null}

        <button type="button" className="dp-play-btn" onClick={onPlay} onMouseEnter={onWarm} onFocus={onWarm} data-testid="detail-play">
          <PlayArrowRoundedIcon />
          <span>{ctaLabel}</span>
        </button>
      </div>

      {trailerVisible ? (
        <div className="dp-hero__audio">
          <TrailerAudioButton muted={muted} onToggle={() => setMuted((value) => !value)} testId="detail-hero-toggle-mute" />
        </div>
      ) : null}
    </section>
  );
}
