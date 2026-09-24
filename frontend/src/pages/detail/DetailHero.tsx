// @ts-nocheck
import { useEffect, useState } from "react";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import TrailerPlayer from "src/components/TrailerPlayer";
import TrailerAudioButton from "src/components/TrailerAudioButton";
import { secondsText, seasonsText, runtimeText } from "./detailUtils";

const HERO_TRAILER_DELAY = 3000;

export default function DetailHero({ data, mediaId, onPlay, onWarm }) {
  const { isTV, title, logoUrl, backdropUrl, trailerUrl, genres, year, certification, seasonsCount, runtimeMinutes } = data;
  const { progressItem, progressPercent, remainingSeconds, season, episode } = data;

  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    setShowTrailer(false);
    setTrailerPlaying(false);
    setMuted(true);
  }, [mediaId]);

  useEffect(() => {
    if (!trailerUrl) return undefined;
    const timer = window.setTimeout(() => setShowTrailer(true), HERO_TRAILER_DELAY);
    return () => window.clearTimeout(timer);
  }, [trailerUrl, mediaId]);

  const stopTrailer = () => {
    setShowTrailer(false);
    setTrailerPlaying(false);
  };

  const trailerVisible = showTrailer && trailerPlaying;
  const heroLabel = progressItem ? "Continua a guardare" : isTV ? `Guarda S${season}:E${episode}` : "Riproduci";
  const metaParts = [isTV ? "Serie" : "Film", genres[0], year, isTV ? seasonsText(seasonsCount) : runtimeText(runtimeMinutes)].filter(Boolean);

  return (
    <section className="fxd-hero" data-testid="detail-hero" data-has-trailer={trailerUrl ? "true" : "false"} data-trailer-state={trailerVisible ? "playing" : showTrailer ? "loading" : "idle"}>
      <div className="fxd-hero__media">
        {backdropUrl ? (
          <img
            className={`fxd-hero__backdrop${trailerVisible ? " is-hidden" : ""}`}
            src={backdropUrl}
            alt=""
            decoding="async"
            fetchPriority="high"
            data-testid="detail-hero-backdrop"
          />
        ) : null}
        {showTrailer && trailerUrl ? (
          <div className={`fxd-hero__trailer${trailerPlaying ? " is-visible" : ""}`} data-testid="detail-hero-trailer">
            <TrailerPlayer
              key={trailerUrl}
              videoKey={trailerUrl}
              muted={muted}
              playing
              loop={false}
              zoom={1}
              onPlaying={() => setTrailerPlaying(true)}
              onEnded={stopTrailer}
              onError={stopTrailer}
            />
          </div>
        ) : null}
      </div>
      <div className="fxd-hero__shade-top" />
      <div className="fxd-hero__shade-left" />
      <div className="fxd-hero__shade-bottom" />

      <div className="fxd-hero__content">
        {logoUrl ? (
          <img className="fxd-hero__logo" src={logoUrl} alt={title} decoding="async" data-testid="detail-hero-logo" />
        ) : (
          <h1 className="fxd-hero__title" data-testid="detail-hero-title">{title}</h1>
        )}

        <div className="fxd-meta" data-testid="detail-hero-meta">
          {metaParts.map((part, index) => (
            <span key={`${part}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
              {index ? <span className="fxd-meta__dot">•</span> : null}
              <span>{part}</span>
            </span>
          ))}
          {certification ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
              <span className="fxd-meta__dot">•</span>
              <span className="fxd-badge">{certification}</span>
            </span>
          ) : null}
        </div>

        <p className="fxd-hero__resume-label" data-testid="detail-hero-resume-label">{heroLabel}</p>

        <div className="fxd-hero__progress-row">
          <div className="fxd-progress" data-testid="detail-hero-progress">
            <div className="fxd-progress__fill" style={{ width: `${progressItem ? Math.max(3, progressPercent) : 0}%` }} />
          </div>
          {progressItem ? (
            <span className="fxd-hero__progress-text" data-testid="detail-hero-progress-text">
              {isTV ? `S${season}:E${episode} - ` : ""}{secondsText(remainingSeconds)} rimanenti
            </span>
          ) : null}
        </div>

        <button type="button" className="fxd-play-btn" onClick={onPlay} onMouseEnter={onWarm} data-testid="detail-play">
          <PlayArrowRoundedIcon />
          <span>{heroLabel}</span>
        </button>
      </div>

      {trailerVisible ? (
        <div className="fxd-hero__audio">
          <TrailerAudioButton muted={muted} onToggle={() => setMuted((value) => !value)} testId="detail-hero-audio-toggle" />
        </div>
      ) : null}
    </section>
  );
}
