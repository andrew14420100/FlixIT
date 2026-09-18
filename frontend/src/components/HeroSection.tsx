// @ts-nocheck
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";

import useOffSetTop from "src/hooks/useOffSetTop";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useGetAppendedVideosQuery } from "src/store/slices/discover";
import { useHeroData } from "src/hooks/useHeroData";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import TrailerPlayer from "./TrailerPlayer";
import { TMDB_IMG } from "./ExpandedCard";

const DEFAULT_FEATURED_ID = 202208;
const DEFAULT_FEATURED_TYPE = MEDIA_TYPE.Tv;
const TRAILER_DELAY_MS = 2500;

function artworkUrl(value: any, size = "w1280") {
  if (!value) return null;
  const raw = String(value);
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) {
    return raw;
  }
  return `${TMDB_IMG}${size}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

export default function HeroSection({ mediaType }) {
  const navigate = useNavigate();
  const { data: heroSettings, isLoading: heroLoading } = useHeroData();
  const { getProgress } = useContinueWatching();

  const featuredId = useMemo(
    () => (heroSettings?.contentId ? parseInt(heroSettings.contentId) : DEFAULT_FEATURED_ID),
    [heroSettings]
  );
  const featuredMediaType = useMemo(() => {
    if (heroSettings?.mediaType) {
      return heroSettings.mediaType === "movie" ? MEDIA_TYPE.Movie : MEDIA_TYPE.Tv;
    }
    return DEFAULT_FEATURED_TYPE;
  }, [heroSettings]);
  const typeSlug = featuredMediaType === MEDIA_TYPE.Movie ? "movie" : "tv";
  const skipQueries = heroLoading || !featuredId;

  const inlineDetail = heroSettings?.detail?.id === featuredId ? heroSettings.detail : null;
  const inlineAssets = heroSettings?.assets || null;
  const { data: fetchedDetail } = useGetAppendedVideosQuery(
    { mediaType: featuredMediaType, id: featuredId },
    { skip: skipQueries || !!inlineDetail }
  );
  const detailData = inlineDetail || fetchedDetail;
  const { data: fetchedAssets } = useQuery({
    queryKey: ["media-assets", typeSlug, featuredId],
    queryFn: () =>
      fetch(`/api/public/media-assets/${typeSlug}/${featuredId}`).then((r) =>
        r.ok ? r.json() : null
      ),
    enabled: !skipQueries && !inlineAssets,
    staleTime: 10 * 60 * 1000,
  });
  const assets = inlineAssets || fetchedAssets;
  const { data: trailerData } = useQuery({
    queryKey: ["trailer", typeSlug, featuredId],
    queryFn: () =>
      fetch(`/api/public/trailer/${typeSlug}/${featuredId}`).then((r) =>
        r.ok ? r.json() : null
      ),
    enabled: !skipQueries && !inlineAssets?.trailer_key,
    staleTime: 10 * 60 * 1000,
  });

  const [muted, setMuted] = useState(true);
  const [showVideo, setShowVideo] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [infoTarget, setInfoTarget] = useState(false);
  const [heroImageSrc, setHeroImageSrc] = useState<string | null>(null);
  const [heroLogoSrc, setHeroLogoSrc] = useState<string | null>(null);

  const isOffset = useOffSetTop(window.innerHeight * 0.6);

  const trailerKey = trailerData?.trailer_key || assets?.trailer_key || null;

  const logoPath = artworkUrl(assets?.logo_path, "w500");
  const fallbackLogoPath = artworkUrl(assets?.fallback_logo_path, "w500");

  const backdropUrl = useMemo(() => {
    if (heroSettings?.customBackdrop) return heroSettings.customBackdrop;
    const path = detailData?.backdrop_path || assets?.backdrop_path;
    return artworkUrl(path, "w1280");
  }, [heroSettings?.customBackdrop, detailData?.backdrop_path, assets?.backdrop_path]);

  const fallbackBackdropUrl = useMemo(
    () => artworkUrl(assets?.fallback_backdrop_path, "w1280"),
    [assets?.fallback_backdrop_path]
  );

  useEffect(() => {
    setHeroImageSrc(backdropUrl);
    setImageLoaded(false);
  }, [backdropUrl]);

  useEffect(() => {
    setHeroLogoSrc(logoPath);
  }, [logoPath]);

  const displayTitle =
    heroSettings?.customTitle || detailData?.name || detailData?.title || "";
  const displayDescription =
    heroSettings?.customDescription || detailData?.overview || "";
  const seasonLabel = heroSettings?.seasonLabel || "";

  useEffect(() => {
    setShowVideo(false);
    setVideoEnded(false);
    setVideoPlaying(false);
    setInfoTarget(false);

    const trailerTimer = setTimeout(() => setShowVideo(true), TRAILER_DELAY_MS);
    let raf = 0;
    if (trailerKey) raf = requestAnimationFrame(() => setInfoTarget(true));

    return () => {
      clearTimeout(trailerTimer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [featuredId, trailerKey]);

  const handleVideoEnded = useCallback(() => {
    setVideoEnded(true);
    setShowVideo(false);
    setVideoPlaying(false);
  }, []);
  const handleVideoPlaying = useCallback(() => setVideoPlaying(true), []);
  const videoActive = showVideo && !videoEnded && !!trailerKey && videoPlaying;

  const prefetchedRef = useRef(false);
  const prefetchStream = useCallback(() => {
    if (prefetchedRef.current) return;
    prefetchedRef.current = true;
    const url =
      typeSlug === "tv"
        ? `/api/player/tv/${featuredId}/1/1`
        : `/api/player/movie/${featuredId}`;
    fetch(url).catch(() => {
      prefetchedRef.current = false;
    });
  }, [typeSlug, featuredId]);

  const handlePlay = () => {
    const progress = getProgress(featuredId);
    const startTime = progress?.progress ? Math.floor(progress.progress) : 0;
    navigate(
      `/${MAIN_PATH.watch}/${typeSlug}/${featuredId}${startTime > 0 ? `?t=${startTime}` : ""}`
    );
  };

  return (
    <Box
      data-testid="hero-section"
      className="billboard"
      sx={{
        position: "relative",
        zIndex: 1,
        width: "100%",
        height: { xs: "34em", sm: "30em", md: "35em" },
        overflow: "visible",
        bgcolor: "#0f0f0f",
        fontFamily: '\"Netflix Sans\",\"Helvetica Neue\",Helvetica,Arial,sans-serif',
        fontSize: "1vw",
        lineHeight: "inherit",
        color: "#e8e8e8",
        userSelect: "none",
        boxSizing: "border-box",
        "& .su-info-wrap": { width: "36%" },
        "@media (min-width:1100px) and (max-width:1399px)": {
          "& .su-info-wrap": { width: "40%" },
        },
        "@media (min-width:800px) and (max-width:1099px)": {
          "& .su-info-wrap": { width: "45%" },
        },
        "@media (min-width:500px) and (max-width:799px)": {
          "& .su-info-wrap": { width: "75%" },
        },
        "@media (max-width:499px)": {
          "& .su-info-wrap": { width: "92%", bottom: "5%", top: "25%" },
        },
      }}
    >
      {heroImageSrc && (
        <Box
          component="img"
          src={heroImageSrc}
          alt="Hero backdrop"
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            if (fallbackBackdropUrl && heroImageSrc !== fallbackBackdropUrl) {
              setHeroImageSrc(fallbackBackdropUrl);
              setImageLoaded(false);
            } else {
              setHeroImageSrc(null);
            }
          }}
          fetchPriority="high"
          decoding="async"
          data-testid="hero-backdrop"
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            width: "100%",
            height: { xs: "35em", sm: "48em", md: "56.25em" },
            objectFit: "cover",
            objectPosition: "top center",
            opacity: imageLoaded ? (videoActive ? 0 : 1) : 0,
            transition: "opacity 1.5s ease-in-out",
            zIndex: 0,
          }}
        />
      )}

      {trailerKey && showVideo && !videoEnded && (
        <Box
          className="hero-video-container"
          data-testid="hero-trailer"
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: { xs: "35em", sm: "48em", md: "56.25em" },
            zIndex: 3,
            overflow: "hidden",
            opacity: videoActive ? 1 : 0,
            transition: "opacity 1.5s ease-in-out",
          }}
        >
          <TrailerPlayer
            videoKey={trailerKey}
            muted={muted}
            playing={!isOffset}
            loop={false}
            zoom={1.38}
            onEnded={handleVideoEnded}
            onPlaying={handleVideoPlaying}
          />
        </Box>
      )}

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: { xs: "35em", sm: "48em", md: "56.25em" },
          zIndex: 4,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "14.7em",
            backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,.5) 0%, rgba(0,0,0,0) 85%)",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: "26.09%",
            bottom: 0,
            display: { xs: "none", sm: "block" },
            backgroundImage: "linear-gradient(77deg, rgba(0,0,0,.6) 0%, rgba(0,0,0,0) 85%)",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: { xs: "50%", sm: "14.7em" },
            backgroundImage: {
              xs: "linear-gradient(to bottom, rgba(15,15,15,0) 0%, rgba(15,15,15,.75) 50%, #0f0f0f 100%)",
              sm: "linear-gradient(to bottom, rgba(15,15,15,0) 0%, rgba(15,15,15,.15) 15%, rgba(15,15,15,.35) 29%, rgba(15,15,15,.58) 44%, #141414 68%, #0f0f0f 100%)",
            },
          }}
        />
      </Box>

      <Box sx={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
        <Box
          className="info-wrap"
          sx={{
            position: "absolute",
            top: 0,
            bottom: "10%",
            left: "4%",
            width: "36%",
            zIndex: 10,
            pointerEvents: "none",
            "@media (min-width:1100px) and (max-width:1399px)": { width: "40%" },
            "@media (min-width:800px) and (max-width:1099px)": { width: "45%" },
            "@media (min-width:500px) and (max-width:799px)": { width: "75%" },
            "@media (max-width:499px)": { width: "92%", bottom: "5%", top: "25%" },
          }}
        >
          <Box
            className="info"
            data-testid="hero-content"
            sx={{
              position: "absolute",
              margin: "1em 0",
              bottom: 0,
              pointerEvents: "auto",
              width: { xs: "100%", sm: "auto" },
            }}
          >
            <Box
              className="title"
              sx={{
                color: "#fff",
                fontSize: "3em",
                textShadow: "2px 2px 4px #000",
                fontWeight: 700,
                lineHeight: "1em",
                transformOrigin: "left bottom",
                transform: infoTarget
                  ? "scale(0.8) translate3d(0px, 2.5em, 0px)"
                  : "scale(1) translate3d(0px, 0px, 0px)",
                transitionProperty: "transform",
                transitionDuration: "1.3s",
                transitionDelay: "5s",
                transitionTimingFunction: "ease",
                "@media (max-width:499px)": { display: "flex", justifyContent: "center" },
              }}
            >
              {heroLogoSrc ? (
                <Box
                  component="img"
                  src={heroLogoSrc}
                  alt={displayTitle}
                  data-testid="hero-logo"
                  onError={() => {
                    if (fallbackLogoPath && heroLogoSrc !== fallbackLogoPath) {
                      setHeroLogoSrc(fallbackLogoPath);
                    } else {
                      setHeroLogoSrc(null);
                    }
                  }}
                  sx={{
                    display: "block",
                    width: "auto",
                    height: "auto",
                    maxHeight: "3em",
                    objectFit: "contain",
                    objectPosition: "left bottom",
                    pointerEvents: "none",
                    "@media (min-width:500px) and (max-width:799px)": {
                      maxWidth: "60%",
                      maxHeight: "2.75em",
                    },
                    "@media (max-width:499px)": { maxWidth: "70%" },
                  }}
                />
              ) : (
                <Typography
                  data-testid="hero-title"
                  sx={{
                    font: "inherit",
                    fontFamily: "inherit",
                    fontSize: "1em",
                    fontWeight: 700,
                    lineHeight: "1em",
                    color: "#fff",
                    textShadow: "inherit",
                  }}
                >
                  {displayTitle}
                </Typography>
              )}
            </Box>

            {seasonLabel && (
              <Typography
                className="supplemental-msg"
                data-testid="hero-season-label"
                sx={{
                  opacity: infoTarget ? 0 : 1,
                  fontSize: "1.3em",
                  color: "#fff",
                  mt: "1em",
                  mb: "-.75em",
                  fontWeight: 700,
                  fontFamily: "inherit",
                  lineHeight: "inherit",
                  transitionProperty: "opacity",
                  transitionDuration: ".5s",
                  transitionDelay: "5s",
                  transitionTimingFunction: "ease",
                  "@media (max-width:499px)": { mb: "-.25em", textAlign: "center" },
                }}
              >
                {seasonLabel}
              </Typography>
            )}

            <Box
              className="genres"
              sx={{
                display: "none",
                "@media (max-width:499px)": {
                  display: "flex",
                  width: "fit-content",
                  maxWidth: "100%",
                  mt: "1.5em",
                  mx: "auto",
                  overflow: "hidden",
                },
              }}
            />

            <Typography
              className="plot"
              data-testid="hero-overview"
              sx={{
                opacity: infoTarget ? 0 : 1,
                mt: "1.5em",
                fontSize: "1.2em",
                lineHeight: 1.4,
                fontWeight: 400,
                fontFamily: "inherit",
                color: "#fff",
                textShadow: "2px 2px 4px rgba(0,0,0,.45)",
                transitionProperty: "opacity",
                transitionDuration: ".5s",
                transitionDelay: "5s",
                transitionTimingFunction: "ease",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                maxWidth: "100%",
                "@media (max-width:499px)": { display: "none" },
              }}
            >
              {displayDescription}
            </Typography>

            <Stack
              className="info-buttons"
              direction="row"
              spacing={0}
              sx={{
                mt: { xs: "1.25em", sm: "2em" },
                gap: 0,
                alignItems: "center",
                justifyContent: { xs: "center", sm: "flex-start" },
              }}
            >
              <Box
                component="button"
                onClick={handlePlay}
                onMouseEnter={prefetchStream}
                onFocus={prefetchStream}
                data-testid="hero-play-button"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 0,
                  bgcolor: "#fff",
                  color: "#000",
                  border: "none",
                  borderRadius: "3px",
                  height: "auto",
                  minWidth: 0,
                  px: "2em",
                  py: ".5em",
                  mr: "1em",
                  fontFamily: "inherit",
                  fontSize: "1em",
                  fontWeight: 700,
                  lineHeight: "inherit",
                  cursor: "pointer",
                  transition: "background-color 0.2s ease",
                  "&:hover": { bgcolor: "rgba(255,255,255,0.82)" },
                }}
              >
                <Box
                  component="svg"
                  viewBox="0 0 384 512"
                  aria-hidden="true"
                  className="play-icon"
                  sx={{ width: ".9em", height: "1.2em", mr: ".5em", flex: "0 0 auto", fontSize: "1.5em" }}
                >
                  <path fill="currentColor" d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80v352c0 17.4 9.4 33.4 24.5 41.9S58.2 482 73 473l288-176c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41z" />
                </Box>
                <Box component="span" sx={{ fontSize: "1.3em", fontFamily: "inherit", lineHeight: 1.2 }}>Riproduci</Box>
              </Box>
              <Box
                component="button"
                onClick={() => navigate(`/browse/${typeSlug}/${featuredId}`)}
                data-testid="hero-info-button"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 0,
                  bgcolor: "rgba(109,109,110,0.55)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "3px",
                  height: "auto",
                  minWidth: 0,
                  px: "2em",
                  py: ".5em",
                  mr: "1em",
                  fontFamily: "inherit",
                  fontSize: "1em",
                  fontWeight: 700,
                  lineHeight: "inherit",
                  cursor: "pointer",
                  transition: "background-color 0.2s ease",
                  "&:hover": { bgcolor: "rgba(109,109,110,0.72)" },
                }}
              >
                <Box
                  component="svg"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="info-icon"
                  sx={{ width: "1.2em", height: "1.2em", mr: ".5em", flex: "0 0 auto", fontSize: "1.7em" }}
                >
                  <path fill="currentColor" d="M11 17h2v-6h-2zm1.713-8.287Q13 8.425 13 8t-.288-.712T12 7t-.712.288T11 8t.288.713T12 9t.713-.288M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22m0-2q3.35 0 5.675-2.325T20 12t-2.325-5.675T12 4T6.325 6.325T4 12t2.325 5.675T12 20m0-8" />
                </Box>
                <Box component="span" sx={{ fontSize: "1.3em", fontFamily: "inherit", lineHeight: 1.2 }}>Altre info</Box>
              </Box>
            </Stack>
          </Box>
        </Box>

        <Stack
          direction="row"
          spacing={1.5}
          data-testid="hero-controls"
          sx={{
            alignItems: "center",
            position: "absolute",
            right: { xs: "18px", md: "2.5vw" },
            bottom: { xs: "20%", md: "20%" },
            zIndex: 150,
            pointerEvents: "auto",
          }}
        >
          {trailerKey && (
            <IconButton
              onClick={() => setMuted((m) => !m)}
              data-testid="hero-audio-toggle"
              sx={{
                border: "2px solid rgba(255,255,255,0.55)",
                color: "#fff",
                width: { xs: 46, md: 60 },
                height: { xs: 46, md: 60 },
                bgcolor: "rgba(0,0,0,0.35)",
                backdropFilter: "blur(8px)",
                transition: "background-color 200ms ease, border-color 200ms ease, transform 200ms ease",
                "&:hover": {
                  borderColor: "#fff",
                  color: "#fff",
                  bgcolor: "rgba(255,255,255,0.15)",
                  transform: "scale(1.06)",
                },
              }}
            >
              {!muted ? (
                <VolumeUpIcon sx={{ fontSize: { xs: 24, md: 31 } }} />
              ) : (
                <VolumeOffIcon sx={{ fontSize: { xs: 24, md: 31 } }} />
              )}
            </IconButton>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
