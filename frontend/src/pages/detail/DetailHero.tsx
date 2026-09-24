// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import ReplayIcon from "@mui/icons-material/Replay";
import useOffSetTop from "src/hooks/useOffSetTop";
import TrailerPlayer from "src/components/TrailerPlayer";
import { remainingText, runtimeText, seasonsText } from "./detailUtils";
import "../../components/NetflixHeroExact.css";

const HERO_TRAILER_DELAY_MS = 2000;

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.2 3.2a1 1 0 0 1 1.51-.86l12.1 8.1a1.86 1.86 0 0 1 0 3.12l-12.1 8.1A1 1 0 0 1 6.2 20.8z"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 10.6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="7.3" r="1.15" fill="currentColor" />
    </svg>
  );
}

function NetflixNMark() {
  return (
    <svg viewBox="0 0 24 36" aria-hidden="true">
      <path fill="#b20710" d="M2 0h6v36H2zM16 0h6v36h-6z" />
      <path fill="#e50914" d="M8 0h6l8 36h-6z" />
    </svg>
  );
}

export default function DetailHero({ data, mediaId, onPlay, onWarm, onMoreInfo }) {
  const {
    isTV,
    title,
    overview,
    logoUrl,
    backdropUrl,
    trailerUrl,
    genres,
    year,
    certification,
    seasonsCount,
    runtimeMinutes,
    hasRealProgress,
    remainingSeconds,
    season,
    episode,
  } = data;

  const [muted, setMuted] = useState(true);
  const [trailerGateOpen, setTrailerGateOpen] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [backdropFailed, setBackdropFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const isOffset = useOffSetTop(
    typeof window !== "undefined" ? window.innerHeight * 0.6 : 600
  );

  useEffect(() => {
    setMuted(true);
    setTrailerGateOpen(false);
    setVideoPlaying(false);
    setVideoEnded(false);
    setImageLoaded(false);
    setBackdropFailed(false);
    setLogoFailed(false);

    const timer = window.setTimeout(() => {
      if (trailerUrl) setTrailerGateOpen(true);
    }, HERO_TRAILER_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [mediaId, trailerUrl, backdropUrl, logoUrl]);

  const handleVideoEnded = useCallback(() => {
    setVideoEnded(true);
    setVideoPlaying(false);
  }, []);

  const handleReplay = useCallback(() => {
    setVideoEnded(false);
    setVideoPlaying(false);
    setTrailerGateOpen(false);
    window.setTimeout(() => setTrailerGateOpen(true), 60);
  }, []);

  const videoMounted = !!trailerUrl && !videoEnded;
  const videoShouldPlay = trailerGateOpen && !!trailerUrl && !videoEnded && !isOffset;
  const videoActive = videoShouldPlay && videoPlaying;
  const showBackdrop = !!backdropUrl && !backdropFailed;
  const showLogo = !!logoUrl && !logoFailed;

  const duration = isTV ? seasonsText(seasonsCount) : runtimeText(runtimeMinutes);
  const attributes = [
    { text: isTV ? "Serie" : "Film" },
    genres?.[0] ? { text: genres[0] } : null,
    year ? { text: year } : null,
    duration ? { text: duration } : null,
    certification ? { text: certification, age: true } : null,
  ].filter(Boolean);

  const callouts = hasRealProgress
    ? [
        "Continua a guardare",
        isTV
          ? `S${season}:E${episode} • ${remainingText(remainingSeconds)} rimanenti`
          : `${remainingText(remainingSeconds)} rimanenti`,
      ]
    : ["Disponibile ora", isTV ? "Serie" : "Film"];

  return (
    <Box
      component="section"
      data-uia="billboard"
      aria-label={`Contenuti consigliati: ${title}`}
      data-testid="detail-hero"
      data-compact={videoActive ? "true" : "false"}
      data-has-trailer={trailerUrl ? "true" : "false"}
      className="netflix-home-billboard dp-hero"
      style={{ height: "auto", aspectRatio: "1505.14 / 600" }}
      sx={{
        "& .netflix-home-video-layer [data-testid='trailer-player']": {
          backgroundColor: "transparent !important",
        },
        "& .netflix-home-video-layer video": {
          width: "100% !important",
          height: "100% !important",
          objectFit: "contain !important",
          objectPosition: "center center !important",
          transform: "translate(-50%, -50%) scale(1) !important",
          backgroundColor: "transparent !important",
        },
      }}
    >
      {showBackdrop ? (
        <Box
          component="img"
          src={backdropUrl}
          alt=""
          aria-hidden="true"
          data-uia="billboard-background-media+image"
          data-testid="detail-hero-backdrop"
          className="netflix-home-backdrop"
          onLoad={() => setImageLoaded(true)}
          onError={() => setBackdropFailed(true)}
          fetchPriority="high"
          loading="eager"
          decoding="async"
          sx={{
            opacity: imageLoaded ? (videoActive ? 0.34 : 1) : 0,
            filter: videoActive ? "brightness(.58) blur(2px)" : "none",
            transform: videoActive ? "scale(1.015)" : "scale(1.001)",
            transition: "opacity 420ms ease-in-out, filter 420ms ease-in-out, transform 420ms ease-in-out",
          }}
        />
      ) : null}

      {videoMounted ? (
        <Box
          data-uia="billboard-background-media+player"
          data-testid="detail-hero-trailer"
          className="netflix-home-video-layer"
          sx={{
            opacity: videoActive ? 1 : 0,
            transition: "opacity 420ms ease-in-out",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "transparent !important",
          }}
        >
          <TrailerPlayer
            key={trailerUrl}
            videoKey={trailerUrl}
            muted={muted}
            playing={videoShouldPlay}
            loop={false}
            zoom={1}
            onPlaying={() => setVideoPlaying(true)}
            onEnded={handleVideoEnded}
            onError={handleVideoEnded}
          />
        </Box>
      ) : null}

      <Box aria-hidden="true" className="netflix-home-shade" />

      <Box aria-hidden="true" className="netflix-home-brand-mark">
        <NetflixNMark />
      </Box>

      {trailerUrl ? (
        <Box
          className="netflix-home-volume-wrap"
          data-uia="billboard-controls"
          data-testid="detail-hero-controls"
        >
          {videoEnded ? (
            <IconButton
              aria-label="Riproduci di nuovo il trailer"
              onClick={handleReplay}
              className="netflix-home-replay-button"
            >
              <ReplayIcon />
            </IconButton>
          ) : (
            <IconButton
              aria-label={muted ? "Volume disattivato" : "Volume attivato"}
              onClick={() => setMuted((value) => !value)}
              data-testid="detail-hero-toggle-mute"
              className="netflix-home-volume-button"
            >
              {muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
            </IconButton>
          )}
        </Box>
      ) : null}

      <Box className="netflix-home-content" data-testid="detail-hero-content">
        <Box className="netflix-home-title-block" data-uia="billboard-title">
          {showLogo ? (
            <Box
              component="img"
              src={logoUrl}
              alt={title}
              data-uia="billboard-logo"
              data-testid="detail-hero-logo"
              className="netflix-home-logo"
              fetchPriority="high"
              loading="eager"
              decoding="async"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <Box className="netflix-home-title-fallback" data-testid="detail-hero-title">
              {title}
            </Box>
          )}

          {attributes.length ? (
            <Box className="netflix-home-attributes" data-uia="attributes-elements" data-testid="detail-hero-meta">
              {attributes.map((attribute: any, index: number) => (
                <Box key={`${attribute.text}-${index}`} sx={{ display: "contents" }}>
                  {index > 0 ? (
                    <span className="netflix-home-attribute-dot" aria-hidden="true">•</span>
                  ) : null}
                  <span className={attribute.age ? "netflix-home-attribute netflix-home-age" : "netflix-home-attribute"}>
                    {attribute.text}
                  </span>
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>

        {overview ? (
          <Box
            className="netflix-home-metadata"
            data-uia="billboard-metadata"
            data-testid="detail-hero-overview"
          >
            {overview}
          </Box>
        ) : null}

        <Box className="netflix-home-actions-row">
          <Box className="netflix-home-actions" data-uia="billboard-actions">
            <Box
              component="button"
              type="button"
              aria-label="Riproduci"
              data-uia="play-video-button"
              data-testid="detail-play"
              className="netflix-home-action netflix-home-action-play"
              onClick={onPlay}
              onMouseEnter={onWarm}
              onFocus={onWarm}
            >
              <PlayIcon />
              <span>Riproduci</span>
            </Box>

            <Box
              component="button"
              type="button"
              data-uia="billboard-more-info"
              data-testid="detail-more-info"
              className="netflix-home-action netflix-home-action-info"
              onClick={onMoreInfo}
            >
              <InfoIcon />
              <span>Altre info</span>
            </Box>
          </Box>

          <Box className="netflix-home-callouts" data-uia="billboard-callouts">
            {callouts.map((text, index) => (
              <Box
                className="netflix-home-callout"
                data-uia="billboard-callout"
                key={`${text}-${index}`}
              >
                <span className="netflix-home-callout-mark">
                  {/top\s*10/i.test(text) ? "10" : index === 0 ? "◢" : "N"}
                </span>
                <span>{text}</span>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
