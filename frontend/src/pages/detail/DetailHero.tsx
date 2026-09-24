// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
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
    logoUrl,
    backdropUrl,
    backdropUrls,
    trailerUrl,
    seasonsCount,
    runtimeMinutes,
    hasRealProgress,
    remainingSeconds,
    season,
    episode,
  } = data;

  const backdropCandidates = useMemo(() => {
    const values = Array.isArray(backdropUrls) && backdropUrls.length
      ? backdropUrls
      : backdropUrl
      ? [backdropUrl]
      : [];
    return [...new Set(values.filter(Boolean))];
  }, [backdropUrl, backdropUrls]);
  const backdropKey = backdropCandidates.join("|");

  const [muted, setMuted] = useState(true);
  const [trailerGateOpen, setTrailerGateOpen] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [backdropIndex, setBackdropIndex] = useState(0);
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
    setBackdropIndex(0);
    setBackdropFailed(false);
    setLogoFailed(false);

    const timer = window.setTimeout(() => {
      if (trailerUrl) setTrailerGateOpen(true);
    }, HERO_TRAILER_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [mediaId, trailerUrl, backdropKey, logoUrl]);

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

  const handleBackdropError = useCallback(() => {
    setImageLoaded(false);
    setBackdropIndex((current) => {
      const next = current + 1;
      if (next < backdropCandidates.length) return next;
      setBackdropFailed(true);
      return current;
    });
  }, [backdropCandidates.length]);

  const videoMounted = !!trailerUrl && !videoEnded;
  const videoShouldPlay = trailerGateOpen && !!trailerUrl && !videoEnded && !isOffset;
  const videoActive = videoShouldPlay && videoPlaying;
  const activeBackdropUrl = backdropCandidates[backdropIndex] || null;
  const showBackdrop = !!activeBackdropUrl && !backdropFailed;
  const showLogo = !!logoUrl && !logoFailed;
  const playLabel = hasRealProgress ? "Continua a guardare" : "Riproduci";

  const callouts = hasRealProgress
    ? [
        "Riprendi da dove eri rimasto",
        isTV
          ? `S${season} · E${episode} · ${remainingText(remainingSeconds)} alla fine`
          : `${remainingText(remainingSeconds)} alla fine`,
      ]
    : isTV
    ? [
        "Pronto per la maratona",
        seasonsCount ? `${seasonsText(seasonsCount)} da scoprire` : "Inizia dal primo episodio",
      ]
    : [
        "Serata cinema",
        runtimeMinutes ? `${runtimeText(runtimeMinutes)} da vivere` : "Scelto per te",
      ];

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
        "& .netflix-home-video-layer": {
          position: "absolute !important",
          inset: "0 !important",
          width: "100% !important",
          height: "100% !important",
          overflow: "hidden !important",
        },
        "& .netflix-home-video-layer [data-testid='trailer-player']": {
          position: "absolute !important",
          inset: "0 !important",
          width: "100% !important",
          height: "100% !important",
          overflow: "hidden !important",
          backgroundColor: "#000 !important",
        },
        "& .netflix-home-video-layer video": {
          position: "absolute !important",
          top: "50% !important",
          left: "50% !important",
          width: "100% !important",
          height: "100% !important",
          minWidth: "100% !important",
          minHeight: "100% !important",
          objectFit: "cover !important",
          objectPosition: "center center !important",
          transform: "translate(-50%, -50%) scale(1.10) !important",
          transformOrigin: "center center !important",
          backgroundColor: "#000 !important",
        },
      }}
    >
      {showBackdrop ? (
        <Box
          component="img"
          src={activeBackdropUrl}
          alt=""
          aria-hidden="true"
          data-uia="billboard-background-media+image"
          data-testid="detail-hero-backdrop"
          className="netflix-home-backdrop"
          onLoad={() => setImageLoaded(true)}
          onError={handleBackdropError}
          fetchPriority="high"
          loading="eager"
          decoding="async"
          sx={{
            opacity: imageLoaded ? (videoActive ? 0 : 1) : 0,
            transition: "opacity 420ms ease-in-out",
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
          }}
        >
          <TrailerPlayer
            key={trailerUrl}
            videoKey={trailerUrl}
            muted={muted}
            playing={videoShouldPlay}
            loop={false}
            zoom={1.1}
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
        </Box>

        <Box className="netflix-home-actions-row">
          <Box className="netflix-home-actions" data-uia="billboard-actions">
            <Box
              component="button"
              type="button"
              aria-label={playLabel}
              data-uia="play-video-button"
              data-testid="detail-play"
              className="netflix-home-action netflix-home-action-play"
              onClick={onPlay}
              onMouseEnter={onWarm}
              onFocus={onWarm}
            >
              <PlayIcon />
              <span>{playLabel}</span>
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
                  {index === 0 ? "F" : isTV ? "EP" : "★"}
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
