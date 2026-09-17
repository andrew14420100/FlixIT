// @ts-nocheck
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import { motion } from "framer-motion";

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
const TRAILER_DELAY_MS = 6000;

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.3 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.25, 0.1, 0, 1] } },
};

export default function HeroSection({ mediaType }) {
  const navigate = useNavigate();
  const { data: heroSettings, isLoading: heroLoading } = useHeroData();
  const { getProgress } = useContinueWatching();

  const featuredId = useMemo(() => (heroSettings?.contentId ? parseInt(heroSettings.contentId) : DEFAULT_FEATURED_ID), [heroSettings]);
  const featuredMediaType = useMemo(() => {
    if (heroSettings?.mediaType) return heroSettings.mediaType === "movie" ? MEDIA_TYPE.Movie : MEDIA_TYPE.Tv;
    return DEFAULT_FEATURED_TYPE;
  }, [heroSettings]);
  const typeSlug = featuredMediaType === MEDIA_TYPE.Movie ? "movie" : "tv";
  const skipQueries = heroLoading || !featuredId;

  // /api/public/hero already embeds detail + assets: TMDB/assets requests only run as a fallback.
  const inlineDetail = heroSettings?.detail?.id === featuredId ? heroSettings.detail : null;
  const inlineAssets = heroSettings?.assets || null;
  const { data: fetchedDetail } = useGetAppendedVideosQuery({ mediaType: featuredMediaType, id: featuredId }, { skip: skipQueries || !!inlineDetail });
  const detailData = inlineDetail || fetchedDetail;
  const { data: fetchedAssets } = useQuery({
    queryKey: ["media-assets", typeSlug, featuredId],
    queryFn: () => fetch(`/api/public/media-assets/${typeSlug}/${featuredId}`).then((r) => (r.ok ? r.json() : null)),
    enabled: !skipQueries && !inlineAssets,
    staleTime: 10 * 60 * 1000,
  });
  const assets = inlineAssets || fetchedAssets;
  const { data: trailerData } = useQuery({
    queryKey: ["trailer", typeSlug, featuredId],
    queryFn: () => fetch(`/api/public/trailer/${typeSlug}/${featuredId}`).then((r) => (r.ok ? r.json() : null)),
    enabled: !skipQueries && !inlineAssets?.trailer_key,
    staleTime: 10 * 60 * 1000,
  });

const [muted, setMuted] = useState(true);
const [showVideo, setShowVideo] = useState(false);
const [videoPlaying, setVideoPlaying] = useState(false);
const [videoEnded, setVideoEnded] = useState(false);
const [imageLoaded, setImageLoaded] = useState(false);

const isOffset = useOffSetTop(window.innerHeight * 0.6);

const trailerKey =
  trailerData?.trailer_key ||
  assets?.trailer_key ||
  null;

const logoPath = assets?.logo_path
  ? `${TMDB_IMG}w500${assets.logo_path}`
  : null;

const backdropUrl = useMemo(() => {
  if (heroSettings?.customBackdrop) {
    return heroSettings.customBackdrop;
  }

  const path =
    detailData?.backdrop_path ||
    assets?.backdrop_path;

  return path
    ? `${TMDB_IMG}w1280${path}`
    : null;
}, [
  heroSettings?.customBackdrop,
  detailData?.backdrop_path,
  assets?.backdrop_path,
]);

const displayTitle =
  heroSettings?.customTitle ||
  detailData?.name ||
  detailData?.title ||
  "";

const displayDescription =
  heroSettings?.customDescription ||
  detailData?.overview ||
  "";

useEffect(() => {
  setShowVideo(false);
  setVideoEnded(false);
  setVideoPlaying(false);

  const timer = setTimeout(
    () => setShowVideo(true),
    TRAILER_DELAY_MS
  );

  return () => clearTimeout(timer);
}, [featuredId]);

  const handleVideoEnded = useCallback(() => { setVideoEnded(true); setShowVideo(false); setVideoPlaying(false); }, []);
  const handleVideoPlaying = useCallback(() => setVideoPlaying(true), []);
  const videoActive = showVideo && !videoEnded && !!trailerKey && videoPlaying;

  const prefetchedRef = useRef(false);
  const prefetchStream = useCallback(() => {
    if (prefetchedRef.current) return;
    prefetchedRef.current = true;
    const url = typeSlug === "tv" ? `/api/player/tv/${featuredId}/1/1` : `/api/player/movie/${featuredId}`;
    fetch(url).catch(() => { prefetchedRef.current = false; });
  }, [typeSlug, featuredId]);

  const handlePlay = () => {
    const progress = getProgress(featuredId);
    const startTime = progress?.progress ? Math.floor(progress.progress) : 0;
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${featuredId}${startTime > 0 ? `?t=${startTime}` : ""}`);
  };

  return (
    <Box
      data-testid="hero-section"
      sx={{ position: "relative", zIndex: 1, width: "100%", height: { xs: "78vh", md: "67vh" }, minHeight: { xs: 560, md: 620 }, maxHeight: { md: 760 }, overflow: "hidden", bgcolor: "#141414" }}
    >
      {/* Backdrop */}
      {backdropUrl && (
        <Box
          component="img"
          src={backdropUrl}
          alt="Hero backdrop"
          onLoad={() => setImageLoaded(true)}
          fetchPriority="high"
          decoding="async"
          data-testid="hero-backdrop"
          sx={{
            position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center",
            opacity: imageLoaded ? 1 : 0, transition: "opacity 1s ease-in-out",
            animation: "kenBurns 25s ease-in-out infinite alternate",
            "@keyframes kenBurns": {
              "0%": { transform: "scale(1) translateX(0)" },
              "100%": { transform: "scale(1.08) translateX(-1%)" },
            },
          }}
        />
      )}

      {/* Trailer (uniform cropped player, starts after 6s) */}
      {trailerKey && showVideo && !videoEnded && (
        <Box
          className="hero-video-container"
          data-testid="hero-trailer"
          sx={{ position: "absolute", inset: 0, zIndex: 3, opacity: videoActive ? 1 : 0, transition: "opacity 1.5s ease-in-out" }}
        >
          <TrailerPlayer videoKey={trailerKey} muted={muted} playing={!isOffset} loop={false} zoom={1.38} onEnded={handleVideoEnded} onPlaying={handleVideoPlaying} />
        </Box>
      )}

      {/* Gradients */}
      <Box sx={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none",
        background: "linear-gradient(to top, #141414 0%, rgba(20,20,20,.96) 6%, rgba(20,20,20,.78) 17%, rgba(20,20,20,.46) 31%, rgba(20,20,20,.16) 47%, transparent 64%)" }} />
      <Box sx={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none",
        background: "linear-gradient(to right, rgba(0,0,0,0.58) 0%, rgba(0,0,0,0.28) 28%, rgba(0,0,0,0.05) 52%, transparent 68%)" }} />
      <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 160, zIndex: 4, pointerEvents: "none",
        background: "linear-gradient(to bottom, rgba(20,20,20,0.55) 0%, transparent 100%)" }} />

      {/* Content */}
      <Box sx={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
        <motion.div
          initial="hidden"
          animate={detailData ? "visible" : "hidden"}
          variants={containerVariants}
          data-testid="hero-content"
          style={{ position: "absolute", left: "4vw", bottom: "11%", width: "min(760px, 44vw)", display: "flex", flexDirection: "column", gap: "15px", pointerEvents: "auto" }}
          className="hero-content-block"
        >
          <motion.div variants={itemVariants}>
            {logoPath ? (
              <Box component="img" src={logoPath} alt={displayTitle} data-testid="hero-logo"
                sx={{ width: { xs: "250px", sm: "330px", md: "405px" }, maxWidth: { xs: "78vw", md: "405px" }, maxHeight: { xs: "115px", md: "155px" }, objectFit: "contain", objectPosition: "left",
                  filter: "drop-shadow(0 8px 32px rgba(0,0,0,0.6))", pointerEvents: "none" }} />
            ) : (
              <Typography data-testid="hero-title" sx={{ fontSize: { xs: "2.5rem", sm: "3.5rem", md: "4.5rem", lg: "5.5rem" }, fontWeight: 900,
                fontFamily: "'Unbounded', 'Inter', sans-serif", lineHeight: 0.9, letterSpacing: "-0.03em", color: "#fff", textShadow: "0 4px 24px rgba(0,0,0,0.5)" }}>
                {displayTitle}
              </Typography>
            )}
          </motion.div>



          <motion.div variants={itemVariants}>
            <Box sx={{ opacity: 1, maxHeight: "150px", minHeight: { xs: "58px", md: "72px" }, overflow: "hidden" }}>
              <Typography data-testid="hero-overview" sx={{ fontSize: { xs: "16px", sm: "18px", md: "21px" }, fontWeight: 500, lineHeight: 1.42, color: "#fff",
                display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", maxWidth: { xs: "88vw", md: "680px" }, textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
                {displayDescription}
              </Typography>
            </Box>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Stack direction="row" spacing={0} sx={{ mt: { xs: 1, md: "1.752vw" }, gap: { xs: "12px", md: "18px" } }}>
              <Box component="button" onClick={handlePlay} onMouseEnter={prefetchStream} onFocus={prefetchStream} data-testid="hero-play-button"
                sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "9px", bgcolor: "#fff", color: "#000", border: "none", borderRadius: "3px",
                  height: { xs: 44, md: 50 }, minWidth: { xs: 148, md: 178 }, px: { xs: 2.2, md: 2.7 }, py: 0,
                  fontSize: { xs: "16px", md: "20px" }, fontWeight: 700, lineHeight: 1, fontWeight: 700, cursor: "pointer",
                  transition: "background-color 0.2s ease", "&:hover": { bgcolor: "rgba(255,255,255,0.82)" } }}>
                <PlayArrowIcon sx={{ fontSize: { xs: 29, md: 34 } }} />
                Riproduci
              </Box>
              <Box component="button" onClick={() => navigate(`/browse/${typeSlug}/${featuredId}`)} data-testid="hero-info-button"
                sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "9px", bgcolor: "rgba(109,109,110,0.55)", color: "#fff", border: "none", borderRadius: "3px",
                  height: { xs: 44, md: 50 }, minWidth: { xs: 150, md: 188 }, px: { xs: 2.2, md: 2.7 }, py: 0,
                  fontSize: { xs: "16px", md: "20px" }, fontWeight: 700, lineHeight: 1, fontWeight: 700, cursor: "pointer",
                  transition: "background-color 0.2s ease", "&:hover": { bgcolor: "rgba(109,109,110,0.72)" } }}>
                <InfoOutlinedIcon sx={{ fontSize: { xs: 27, md: 32 } }} />
                Altre info
              </Box>
            </Stack>
          </motion.div>
        </motion.div>

        {/* Right side: mute + certification */}
        <Stack direction="row" spacing={1.5} data-testid="hero-controls"
          sx={{ alignItems: "center", position: "absolute", right: { xs: "18px", md: "2.5vw" }, bottom: { xs: "20%", md: "20%" }, zIndex: 150, pointerEvents: "auto" }}>
          {trailerKey && (
            <IconButton onClick={() => setMuted((m) => !m)} data-testid="hero-audio-toggle"
              sx={{ border: "2px solid rgba(255,255,255,0.55)", color: "#fff", width: { xs: 46, md: 60 }, height: { xs: 46, md: 60 }, bgcolor: "rgba(0,0,0,0.35)", backdropFilter: "blur(8px)",
                transition: "background-color 200ms ease, border-color 200ms ease, transform 200ms ease",
                "&:hover": { borderColor: "#fff", color: "#fff", bgcolor: "rgba(255,255,255,0.15)", transform: "scale(1.06)" } }}>
              {!muted ? <VolumeUpIcon sx={{ fontSize: { xs: 24, md: 31 } }} /> : <VolumeOffIcon sx={{ fontSize: { xs: 24, md: 31 } }} />}
            </IconButton>
          )}

        </Stack>
      </Box>
    </Box>
  );
}
