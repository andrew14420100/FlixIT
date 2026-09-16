// @ts-nocheck
import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import StarIcon from "@mui/icons-material/Star";
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

  const { data: detailData } = useGetAppendedVideosQuery({ mediaType: featuredMediaType, id: featuredId }, { skip: skipQueries });
  const { data: assets } = useQuery({
    queryKey: ["media-assets", typeSlug, featuredId],
    queryFn: () => fetch(`/api/public/media-assets/${typeSlug}/${featuredId}`).then((r) => (r.ok ? r.json() : null)),
    enabled: !skipQueries,
    staleTime: 10 * 60 * 1000,
  });
  const { data: trailerData } = useQuery({
    queryKey: ["trailer", typeSlug, featuredId],
    queryFn: () => fetch(`/api/public/trailer/${typeSlug}/${featuredId}`).then((r) => (r.ok ? r.json() : null)),
    enabled: !skipQueries,
    staleTime: 10 * 60 * 1000,
  });

  const [muted, setMuted] = useState(true);
  const [showVideo, setShowVideo] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const isOffset = useOffSetTop(window.innerHeight * 0.6);

  const trailerKey = trailerData?.trailer_key || assets?.trailer_key || null;
  const logoPath = assets?.logo_path ? `${TMDB_IMG}w500${assets.logo_path}` : null;
  const backdropUrl = useMemo(() => {
    if (heroSettings?.customBackdrop) return heroSettings.customBackdrop;
    const path = detailData?.backdrop_path || assets?.backdrop_path;
    return path ? `${TMDB_IMG}original${path}` : null;
  }, [heroSettings?.customBackdrop, detailData?.backdrop_path, assets?.backdrop_path]);

  const displayTitle = heroSettings?.customTitle || detailData?.name || detailData?.title || "";
  const displayDescription = heroSettings?.customDescription || detailData?.overview || "";
  const seasonLabel = heroSettings?.seasonLabel;
  const releaseYear = (detailData?.release_date || detailData?.first_air_date || "").split("-")[0];
  const voteAvg = detailData?.vote_average ? detailData.vote_average.toFixed(1) : null;
  const genres = detailData?.genres?.slice(0, 3).map((g) => g.name) || [];
  const isTV = featuredMediaType === MEDIA_TYPE.Tv;
  const certification = assets?.certification;

  useEffect(() => {
    setShowVideo(false);
    setVideoEnded(false);
    setVideoPlaying(false);
    const timer = setTimeout(() => setShowVideo(true), TRAILER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [featuredId]);

  const handleVideoEnded = useCallback(() => { setVideoEnded(true); setShowVideo(false); setVideoPlaying(false); }, []);
  const handleVideoPlaying = useCallback(() => setVideoPlaying(true), []);
  const videoActive = showVideo && !videoEnded && !!trailerKey && videoPlaying;

  const handlePlay = () => {
    const progress = getProgress(featuredId);
    const startTime = progress?.progress ? Math.floor(progress.progress) : 0;
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${featuredId}${startTime > 0 ? `?t=${startTime}` : ""}`);
  };

  return (
    <Box
      data-testid="hero-section"
      sx={{ position: "relative", zIndex: 1, width: "100%", height: { xs: "78vh", md: "100vh" }, minHeight: { xs: 480, md: 560 }, overflow: "hidden", bgcolor: "#141414" }}
    >
      {/* Backdrop */}
      {backdropUrl && (
        <Box
          component="img"
          src={backdropUrl}
          alt="Hero backdrop"
          onLoad={() => setImageLoaded(true)}
          data-testid="hero-backdrop"
          sx={{
            position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
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
        background: "linear-gradient(to top, #141414 0%, rgba(20,20,20,0.92) 10%, rgba(20,20,20,0.6) 28%, rgba(20,20,20,0.15) 48%, transparent 65%)" }} />
      <Box sx={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none",
        background: "linear-gradient(to right, rgba(20,20,20,0.75) 0%, rgba(20,20,20,0.35) 30%, transparent 60%)" }} />
      <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 160, zIndex: 4, pointerEvents: "none",
        background: "linear-gradient(to bottom, rgba(20,20,20,0.55) 0%, transparent 100%)" }} />

      {/* Content */}
      <Box sx={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
        <motion.div
          initial="hidden"
          animate={detailData ? "visible" : "hidden"}
          variants={containerVariants}
          data-testid="hero-content"
          style={{ position: "absolute", left: 0, width: "min(48%, 700px)", display: "flex", flexDirection: "column", gap: "12px", pointerEvents: "auto" }}
          className="hero-content-block"
        >
          <motion.div variants={itemVariants}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "#E50914" }} />
              <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
                {isTV ? "Serie TV" : "Film"}
              </Typography>
              {seasonLabel && (
                <Chip label={seasonLabel} size="small" sx={{ bgcolor: "rgba(229,9,20,0.85)", color: "#fff", fontWeight: 700, fontSize: 10, height: 20 }} />
              )}
            </Stack>
          </motion.div>

          <motion.div variants={itemVariants}>
            {logoPath ? (
              <Box component="img" src={logoPath} alt={displayTitle} data-testid="hero-logo"
                sx={{ maxWidth: "100%", maxHeight: { xs: "80px", md: "150px" }, width: "auto", objectFit: "contain", objectPosition: "left",
                  filter: "drop-shadow(0 8px 32px rgba(0,0,0,0.6))", pointerEvents: "none" }} />
            ) : (
              <Typography data-testid="hero-title" sx={{ fontSize: { xs: "2.5rem", sm: "3.5rem", md: "4.5rem", lg: "5.5rem" }, fontWeight: 900,
                fontFamily: "'Unbounded', 'Inter', sans-serif", lineHeight: 0.9, letterSpacing: "-0.03em", color: "#fff", textShadow: "0 4px 24px rgba(0,0,0,0.5)" }}>
                {displayTitle}
              </Typography>
            )}
          </motion.div>

          <motion.div variants={itemVariants}>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" sx={{ mt: 0.5 }}>
              {voteAvg && (
                <Stack direction="row" spacing={0.4} alignItems="center">
                  <StarIcon sx={{ fontSize: 14, color: "#46d369" }} />
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#46d369" }}>{voteAvg}</Typography>
                </Stack>
              )}
              {releaseYear && <Typography sx={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{releaseYear}</Typography>}
              <Box sx={{ px: 0.8, py: 0.2, border: "1px solid rgba(255,255,255,0.3)", borderRadius: "3px", lineHeight: 1 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>HD</Typography>
              </Box>
              {detailData?.number_of_seasons && (
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>
                  {detailData.number_of_seasons} Stagion{detailData.number_of_seasons > 1 ? "i" : "e"}
                </Typography>
              )}
              {genres.length > 0 && <Typography sx={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{genres.join(" · ")}</Typography>}
            </Stack>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Box sx={{ opacity: videoActive ? 0 : 1, maxHeight: videoActive ? 0 : "150px", overflow: "hidden", transition: "opacity 1s ease, max-height 1s ease" }}>
              <Typography data-testid="hero-overview" sx={{ fontSize: { xs: "0.8rem", md: "0.95rem" }, lineHeight: 1.55, color: "rgba(255,255,255,0.85)",
                display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", maxWidth: "480px", textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
                {displayDescription}
              </Typography>
            </Box>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
              <Box component="button" onClick={handlePlay} data-testid="hero-play-button"
                sx={{ display: "flex", alignItems: "center", gap: "8px", bgcolor: "#fff", color: "#000", border: "none", borderRadius: "4px",
                  px: { xs: 2.5, md: 3.5 }, py: { xs: 1, md: 1.3 }, fontSize: { xs: "0.95rem", md: "1.15rem" }, fontWeight: 700, cursor: "pointer",
                  transition: "background-color 0.2s ease, transform 0.2s ease", "&:hover": { bgcolor: "rgba(255,255,255,0.8)", transform: "scale(1.02)" } }}>
                <PlayArrowIcon sx={{ fontSize: 28 }} />
                Riproduci
              </Box>
              <Box component="button" onClick={() => navigate(`/browse/${typeSlug}/${featuredId}`)} data-testid="hero-info-button"
                sx={{ display: "flex", alignItems: "center", gap: "8px", bgcolor: "rgba(109,109,110,0.4)", backdropFilter: "blur(12px)", color: "#fff", border: "none", borderRadius: "4px",
                  px: { xs: 2.5, md: 3.5 }, py: { xs: 1, md: 1.3 }, fontSize: { xs: "0.95rem", md: "1.15rem" }, fontWeight: 700, cursor: "pointer",
                  transition: "background-color 0.2s ease, transform 0.2s ease", "&:hover": { bgcolor: "rgba(109,109,110,0.6)", transform: "scale(1.02)" } }}>
                <InfoOutlinedIcon sx={{ fontSize: 24 }} />
                Altre info
              </Box>
            </Stack>
          </motion.div>
        </motion.div>

        {/* Right side: mute + certification */}
        <Stack direction="row" spacing={1.5} data-testid="hero-controls"
          sx={{ alignItems: "center", position: "absolute", right: { xs: "12px", md: "40px" }, bottom: { xs: "26%", md: "36%" }, zIndex: 150, pointerEvents: "auto" }}>
          {trailerKey && (
            <IconButton onClick={() => setMuted((m) => !m)} data-testid="hero-audio-toggle"
              sx={{ border: "2px solid rgba(255,255,255,0.55)", color: "#fff", width: { xs: 46, md: 54 }, height: { xs: 46, md: 54 }, bgcolor: "rgba(0,0,0,0.35)", backdropFilter: "blur(8px)",
                transition: "background-color 200ms ease, border-color 200ms ease, transform 200ms ease",
                "&:hover": { borderColor: "#fff", color: "#fff", bgcolor: "rgba(255,255,255,0.15)", transform: "scale(1.06)" } }}>
              {!muted ? <VolumeUpIcon sx={{ fontSize: { xs: 24, md: 28 } }} /> : <VolumeOffIcon sx={{ fontSize: { xs: 24, md: 28 } }} />}
            </IconButton>
          )}
          {certification && (
            <Box sx={{ bgcolor: "rgba(51,51,51,0.6)", borderLeft: "3px solid rgba(255,255,255,0.4)", px: 1.5, py: 0.5, backdropFilter: "blur(4px)" }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{certification}</Typography>
            </Box>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
