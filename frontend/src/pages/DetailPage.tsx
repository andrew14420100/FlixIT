// @ts-nocheck
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import CircularProgress from "@mui/material/CircularProgress";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import DownloadIcon from "@mui/icons-material/Download";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import MovieIcon from "@mui/icons-material/Movie";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import EventIcon from "@mui/icons-material/Event";
import Player from "video.js/dist/types/player";

import {
  useLazyGetAppendedVideosQuery,
  useGetSimilarVideosQuery,
  useLazyGetMediaImagesQuery,
  useLazyGetTVSeasonDetailsQuery,
  useLazyGetAllVideosQuery,
} from "src/store/slices/discover";
import { useGetConfigurationQuery } from "src/store/slices/configuration";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useAvailableItems } from "src/hooks/useAvailability";
import MaxLineTypography from "src/components/MaxLineTypography";
import NetflixIconButton from "src/components/NetflixIconButton";
import AgeLimitChip from "src/components/AgeLimitChip";
import QualityChip from "src/components/QualityChip";
import TrailerPlayer from "src/components/TrailerPlayer";
import CleanTrailer from "src/components/CleanTrailer";
import { formatMinuteToReadable, getRandomNumber } from "src/utils/common";
import { getMediaImageUrl } from "src/hooks/useCDNImage";
import { useContinueWatching } from "src/hooks/useContinueWatching";

// Backend API URL
const API_URL = process.env.REACT_APP_BACKEND_URL || "";

// Simple user ID (in production, use auth)
const getUserId = () => {
  let userId = localStorage.getItem("netflix_user_id");
  if (!userId) {
    userId = `user_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem("netflix_user_id", userId);
  }
  return userId;
};

export async function loader() {
  return null;
}

// Tab configuration - Minimalist text-only style
const tabConfig = {
  movie: [
    { id: "overview", label: "PANORAMICA" },
    { id: "details", label: "DETTAGLI" },
    { id: "trailer", label: "TRAILER" },
    { id: "download", label: "SCARICA" },
  ],
  tv: [
    { id: "overview", label: "PANORAMICA" },
    { id: "episodes", label: "EPISODI" },
    { id: "details", label: "DETTAGLI" },
    { id: "trailer", label: "TRAILER" },
  ],
};

export function Component() {
  const { mediaType, id } = useParams<{ mediaType: string; id: string }>();
  const navigate = useNavigate();
  const [getVideoDetail, { data: detail }] = useLazyGetAppendedVideosQuery();
  const [getMediaImages, { data: imagesData }] = useLazyGetMediaImagesQuery();
  const [getSeasonDetails, { data: seasonData }] = useLazyGetTVSeasonDetailsQuery();
  const [getAllVideos, { data: allVideosData }] = useLazyGetAllVideosQuery();
  const { data: configuration } = useGetConfigurationQuery(undefined);
  const { data: similarVideos } = useGetSimilarVideosQuery(
    { mediaType: (mediaType as MEDIA_TYPE) ?? MEDIA_TYPE.Movie, id: Number(id) || 0 },
    { skip: !id }
  );
  const similarList = useAvailableItems(similarVideos?.results, mediaType);
  
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [showVideo, setShowVideo] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [inMyList, setInMyList] = useState(false);
  const [userRating, setUserRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [activeVideoKey, setActiveVideoKey] = useState<string | null>(null);
  
  // Seasons filtered by vixsrc availability
  const [availableSeasons, setAvailableSeasons] = useState<any[]>([]);
  const [filteredEpisodes, setFilteredEpisodes] = useState<any[]>([]);
  const [seasonNotAvailableMsg, setSeasonNotAvailableMsg] = useState<string | null>(null);
  const [seasonReleaseDate, setSeasonReleaseDate] = useState<string | null>(null);
  
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  
  // Continue watching data for episode progress bars
  const { items: continueWatchingItems, getProgress } = useContinueWatching();
  
  // Helper to get episode progress percentage
  const getEpisodeProgress = useCallback((seasonNum: number, episodeNum: number): number => {
    if (!id) return 0;
    
    // Find matching continue watching item for this show
    const watchingItem = continueWatchingItems.find(
      item => item.tmdb_id === Number(id) && 
              item.media_type === 'tv' && 
              item.season === seasonNum && 
              item.episode === episodeNum
    );
    
    if (!watchingItem) return 0;
    
    // Calculate progress percentage
    if (watchingItem.progress > 0 && watchingItem.duration > 0) {
      return Math.min((watchingItem.progress / watchingItem.duration) * 100, 100);
    }
    
    return 0;
  }, [id, continueWatchingItems]);
  
  const maturityRate = useMemo(() => getRandomNumber(20), []);
  const matchPercent = useMemo(() => getRandomNumber(100), []);
  
  // FIX 3: Reset all state when id changes (content navigation)
  useEffect(() => {
    // Reset all states when content changes
    setLogoUrl(null);
    setShowVideo(false);
    setActiveTab("overview");
    setSelectedSeason(1);
    setAvailableSeasons([]);
    setFilteredEpisodes([]);
    setSeasonNotAvailableMsg(null);
    setSeasonReleaseDate(null);
    setMuted(true);
  }, [id]);

  const isTVShow = mediaType === MEDIA_TYPE.Tv;
  const isMovie = mediaType === MEDIA_TYPE.Movie;
  const tabs = isTVShow ? tabConfig.tv : tabConfig.movie;

  // Check initial list/rating status
  useEffect(() => {
    const checkStatus = async () => {
      if (!mediaType || !id) return;
      const userId = getUserId();
      
      try {
        const [listRes, ratingRes] = await Promise.all([
          fetch(`${API_URL}/api/user/list/check/${userId}/${mediaType}/${id}`),
          fetch(`${API_URL}/api/user/rating/${userId}/${mediaType}/${id}`)
        ]);
        
        if (listRes.ok) {
          const data = await listRes.json();
          setInMyList(data.in_list);
        }
        if (ratingRes.ok) {
          const data = await ratingRes.json();
          setUserRating(data.rating || 0);
        }
      } catch (e) {
        console.log("Status check failed, using local state");
      }
    };
    checkStatus();
  }, [mediaType, id]);

  useEffect(() => {
    if (mediaType && id) {
      getVideoDetail({ mediaType: mediaType as MEDIA_TYPE, id: Number(id) });
      getMediaImages({ mediaType: mediaType as MEDIA_TYPE, id: Number(id) });
      getAllVideos({ mediaType: mediaType as MEDIA_TYPE, id: Number(id) });
    }
  }, [mediaType, id, getVideoDetail, getMediaImages, getAllVideos]);

  // Ottimizzazione: funzione per caricare gli episodi con caching
  const loadSeasonEpisodes = useCallback(async (seasonNum: number) => {
    setIsLoadingEpisodes(true);
    try {
      const res = await fetch(`${API_URL}/api/public/tv/${id}/season/${seasonNum}`);
      if (res.ok) {
        const data = await res.json();
        const episodes = data.episodes || [];
        
        setFilteredEpisodes(episodes);
        
        // FIX 2: Handle season not yet available with proper message and date
        if (data.is_aired === false) {
          // Set the release date from TMDB
          setSeasonReleaseDate(data.release_date_it || data.release_date || null);
          setSeasonNotAvailableMsg(data.message || "Stagione non ancora disponibile");
        } else {
          setSeasonNotAvailableMsg(null);
          setSeasonReleaseDate(null);
        }
      }
    } catch (e) {
      console.log("Failed to fetch filtered episodes");
      setSeasonNotAvailableMsg(null);
      setSeasonReleaseDate(null);
    } finally {
      setIsLoadingEpisodes(false);
    }
  }, [id]);

  useEffect(() => {
    if (isTVShow && id && selectedSeason) {
      // Fetch season details from TMDB API
      getSeasonDetails({ seriesId: Number(id), seasonNumber: selectedSeason });
      
      // Carica episodi con caching ottimizzato
      loadSeasonEpisodes(selectedSeason);
    }
  }, [isTVShow, id, selectedSeason, getSeasonDetails, loadSeasonEpisodes]);
  
  // Fetch ALL seasons from backend (marks availability) e precarica la prima stagione
  useEffect(() => {
    if (isTVShow && id) {
      const fetchSeasons = async () => {
        try {
          const res = await fetch(`${API_URL}/api/public/tv/${id}/seasons`);
          if (res.ok) {
            const data = await res.json();
            const seasons = data.seasons || [];
            setAvailableSeasons(seasons);
            
            // Set initial season to first AVAILABLE season
            const firstAvailable = seasons.find((s: any) => s.vixsrc_available);
            if (firstAvailable) {
              setSelectedSeason(firstAvailable.season_number);
              // Precarica la prima stagione
              loadSeasonEpisodes(firstAvailable.season_number);
            } else if (seasons.length > 0) {
              // If no available, select first season anyway
              setSelectedSeason(seasons[0].season_number);
              loadSeasonEpisodes(seasons[0].season_number);
            }
          }
        } catch (e) {
          console.log("Failed to fetch seasons from backend");
          // Fallback to TMDB data
          if (detail) {
            const seasons = (detail as any).seasons?.filter((s: any) => s.season_number > 0) || [];
            setAvailableSeasons(seasons);
          }
        }
      };
      fetchSeasons();
    }
  }, [isTVShow, id, detail]);

  useEffect(() => {
    if (imagesData?.logos?.length) {
      const italianLogo = imagesData.logos.find((logo) => logo.iso_639_1 === "it");
      const englishLogo = imagesData.logos.find((logo) => logo.iso_639_1 === "en");
      const selectedLogo = italianLogo || englishLogo || imagesData.logos[0];
      setLogoUrl(`https://image.tmdb.org/t/p/w500${selectedLogo.file_path}`);
    } else {
      setLogoUrl(null);
    }
  }, [imagesData]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowVideo(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  // Handle mute toggle
  const handleMuteToggle = useCallback(() => setMuted((m) => !m), []);

  // Handle Add to List
  const handleToggleList = async () => {
    const userId = getUserId();
    const title = getTitle();
    
    try {
      const endpoint = inMyList ? "/api/user/list/remove" : "/api/user/list/add";
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          media_id: Number(id),
          media_type: mediaType,
          title: title,
          poster_path: detail?.poster_path,
          backdrop_path: detail?.backdrop_path
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        setInMyList(data.in_list);
      }
    } catch (e) {
      setInMyList(!inMyList);
    }
  };

  // Handle Rating
  const handleSetRating = async (rating: number) => {
    const userId = getUserId();
    setUserRating(rating);
    
    try {
      await fetch(`${API_URL}/api/user/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          media_id: Number(id),
          media_type: mediaType,
          rating: rating
        })
      });
    } catch (e) {
      console.log("Rating save failed");
    }
  };

  // Get Italian trailer first, then fallback to other languages
  const getItalianTrailerKey = useCallback(() => {
    const detailVideos = detail?.videos?.results || [];
    const allVideos = allVideosData?.results || [];
    
    const videoMap = new Map<string, any>();
    [...detailVideos, ...allVideos].forEach(v => {
      if (v.site === "YouTube" && v.key) {
        videoMap.set(v.key, v);
      }
    });
    const videos = Array.from(videoMap.values());
    
    if (!videos.length) return null;
    
    // Priority 1: Italian trailer
    const italianTrailer = videos.find(
      (v: any) => v.iso_639_1 === "it" && v.type === "Trailer"
    );
    if (italianTrailer) return italianTrailer.key;
    
    // Priority 2: Italian teaser
    const italianTeaser = videos.find(
      (v: any) => v.iso_639_1 === "it" && v.type === "Teaser"
    );
    if (italianTeaser) return italianTeaser.key;
    
    // Priority 3: Italian video (any type)
    const italianVideo = videos.find(
      (v: any) => v.iso_639_1 === "it"
    );
    if (italianVideo) return italianVideo.key;
    
    // Priority 4: English trailer
    const englishTrailer = videos.find(
      (v: any) => v.iso_639_1 === "en" && v.type === "Trailer"
    );
    if (englishTrailer) return englishTrailer.key;
    
    // Priority 5: Any trailer
    const anyTrailer = videos.find(
      (v: any) => v.type === "Trailer"
    );
    if (anyTrailer) return anyTrailer.key;
    
    // Priority 6: First YouTube video
    return videos[0]?.key || null;
  }, [detail?.videos?.results, allVideosData?.results]);

  const videoKey = getItalianTrailerKey();
  const trailerKey = getItalianTrailerKey();

  const getTitle = () => {
    if (!detail) return "";
    if ('name' in detail) return detail.name;
    if ('title' in detail) return detail.title;
    return "";
  };

  const getSeasons = () => {
    // Get seasons directly from TMDB data, filter out season 0 (specials)
    if (!detail || !isTVShow) return [];
    return (detail as any).seasons?.filter((s: any) => s.season_number > 0) || [];
  };
  
  // Get episodes from TMDB API season data
  const getEpisodes = () => {
    return seasonData?.episodes || [];
  };
  
  // Format date to Italian locale
  const formatItalianDate = (dateStr: string | undefined) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString('it-IT', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });
    } catch {
      return dateStr;
    }
  };

  // No longer blocking content - just show warning if not available
  if (!detail) {
    return (
      <Box sx={{ 
        minHeight: "100vh", 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center",
        bgcolor: "#0a0a0a"
      }}>
        <Box sx={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          border: '3px solid transparent',
          borderTopColor: '#e50914',
          animation: 'spin 1s linear infinite',
          '@keyframes spin': {
            '0%': { transform: 'rotate(0deg)' },
            '100%': { transform: 'rotate(360deg)' }
          }
        }} />
      </Box>
    );
  }

  // Usa CDN se disponibile per il backdrop (usa detail_backdrop per pagina dettaglio)
  const backdropUrl = getMediaImageUrl(
    Number(id),
    'detail_backdrop',
    detail.backdrop_path,
    configuration?.images.base_url,
    'original'
  );
  const seasons = getSeasons();

  return (
    <Box sx={{ bgcolor: "#0a0a0a", minHeight: "100vh" }}>
      {/* Hero Section */}
      <Box sx={{ 
        position: "relative", 
        width: "100%", 
        height: { xs: "65vh", md: "80vh" },
        overflow: "hidden"
      }}>
        {/* Background: cover image, then the trailer fades in on top (cropped, no YouTube UI, no letterbox) */}
        <img
          src={backdropUrl as string}
          alt={String(getTitle())}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.6)",
            opacity: trailerPlaying ? 0 : 1, transition: "opacity 900ms ease" }}
          data-testid="detail-cover-image"
        />
        {showVideo && videoKey && (
          <Box sx={{ position: "absolute", inset: 0, opacity: trailerPlaying ? 1 : 0, transition: "opacity 900ms ease" }} data-testid="detail-trailer">
            <TrailerPlayer videoKey={videoKey} muted={muted} loop zoom={1.38} onPlaying={() => setTrailerPlaying(true)} onEnded={() => setTrailerPlaying(false)} />
          </Box>
        )}

        {/* Gradient Overlays */}
        <Box
          sx={{
            background: "linear-gradient(90deg, rgba(10,10,10,0.98) 0%, rgba(10,10,10,0.7) 35%, rgba(10,10,10,0.3) 60%, transparent 80%)",
            position: "absolute",
            inset: 0,
            zIndex: 1,
          }}
        />
        <Box
          sx={{
            background: "linear-gradient(0deg, #0a0a0a 0%, rgba(10,10,10,0.9) 15%, rgba(10,10,10,0.4) 40%, transparent 60%)",
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "70%",
            zIndex: 1,
          }}
        />

        {/* Back Button */}
        <IconButton
          onClick={() => navigate(-1)}
          sx={{
            position: "absolute",
            top: { xs: 80, md: 100 },
            left: { xs: 16, md: 48 },
            bgcolor: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            transition: "all 0.3s ease",
            zIndex: 10,
            width: 44,
            height: 44,
            "&:hover": { 
              bgcolor: "#e50914",
              transform: "scale(1.1)",
              borderColor: "transparent"
            },
          }}
          data-testid="back-button"
        >
          <ArrowBackIcon />
        </IconButton>

        {/* Audio Toggle */}
        {showVideo && videoKey && (
          <IconButton
            onClick={handleMuteToggle}
            sx={{
              position: "absolute",
              right: { xs: 16, md: 48 },
              bottom: { xs: "22%", md: "28%" },
              width: { xs: 50, md: 58 },
              height: { xs: 50, md: 58 },
              borderRadius: '50%',
              bgcolor: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(12px)",
              border: "2px solid rgba(255,255,255,0.4)",
              color: "#fff",
              zIndex: 10,
              transition: "all 0.3s ease",
              "&:hover": {
                bgcolor: "rgba(255,255,255,0.2)",
                borderColor: "#fff",
                transform: "scale(1.1)"
              }
            }}
            data-testid="audio-toggle-button"
          >
            {!muted ? <VolumeUpIcon sx={{ fontSize: { xs: 26, md: 30 } }} /> : <VolumeOffIcon sx={{ fontSize: { xs: 26, md: 30 } }} />}
          </IconButton>
        )}

        {/* Content Overlay */}
        <Stack
          spacing={2.5}
          sx={{
            position: "absolute",
            bottom: { xs: "12%", md: "16%" },
            left: { xs: "4%", md: "48px" },
            width: { xs: "92%", md: "50%", lg: "45%" },
            zIndex: 10,
          }}
        >
          {/* Logo/Title */}
          {logoUrl ? (
            <Box
              component="img"
              src={logoUrl}
              alt={getTitle()}
              sx={{
                maxWidth: "75%",
                maxHeight: { xs: "90px", md: "150px" },
                width: "auto",
                objectFit: "contain",
                filter: "drop-shadow(0 8px 32px rgba(0,0,0,0.6))",
                pointerEvents: 'none',
              }}
              data-testid="detail-logo"
            />
          ) : (
            <Typography 
              variant="h2" 
              sx={{ 
                fontWeight: 800, 
                textShadow: "0 4px 24px rgba(0,0,0,0.6)",
                fontSize: { xs: '2rem', md: '3.5rem' },
                letterSpacing: '-0.02em',
                color: "#fff"
              }}
            >
              {getTitle()}
            </Typography>
          )}

          {/* Meta Info */}
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" sx={{ gap: 1 }}>
            <Typography 
              sx={{ 
                color: "#46d369", 
                fontWeight: 700,
                fontSize: { xs: '0.9rem', md: '1rem' }
              }}
            >
              {matchPercent}% Corrispondenza
            </Typography>
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>
              {detail.release_date?.substring(0, 4) || (detail as any).first_air_date?.substring(0, 4)}
            </Typography>
            {isTVShow && seasons.length > 0 && (
              <Chip 
                label={`${seasons.length} Stagion${seasons.length > 1 ? 'i' : 'e'}`}
                size="small"
                sx={{ 
                  bgcolor: 'rgba(255,255,255,0.15)', 
                  color: '#fff',
                  fontSize: '0.75rem',
                  height: 24,
                  fontWeight: 600
                }}
              />
            )}
            <AgeLimitChip label={`${maturityRate}+`} />
            {detail.runtime && (
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>
                {formatMinuteToReadable(detail.runtime)}
              </Typography>
            )}
            <QualityChip label="HD" />
          </Stack>

          {/* Description */}
          <Typography 
            variant="body1" 
            sx={{ 
              color: "rgba(255,255,255,0.9)",
              lineHeight: 1.7,
              maxWidth: "95%",
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontSize: { xs: '0.9rem', md: '1rem' }
            }}
          >
            {detail.overview || "Descrizione non disponibile."}
          </Typography>

          {/* Action Buttons */}
          <Stack direction="row" spacing={2} sx={{ mt: 1 }} alignItems="center">
            <NetflixIconButton
              sx={{
                bgcolor: "#fff",
                color: "#000",
                px: { xs: 3, md: 4 },
                py: 1.2,
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: { xs: '0.95rem', md: '1.1rem' },
                transition: "all 0.25s ease",
                boxShadow: '0 4px 20px rgba(255,255,255,0.2)',
                "&:hover": { 
                  bgcolor: "rgba(255,255,255,0.85)",
                  transform: "scale(1.03)",
                },
              }}
              onClick={() => navigate(`/${MAIN_PATH.watch}/${mediaType}/${id}${isTVShow ? '?s=1&e=1' : ''}`)}
              data-testid="play-button"
            >
              <PlayArrowIcon sx={{ mr: 0.5, fontSize: 28 }} />
              {isTVShow ? "Guarda S1 E1" : "Riproduci"}
            </NetflixIconButton>
            
            {/* Rating Badge */}
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(245, 197, 24, 0.2)',
              color: '#f5c518',
              borderRadius: '8px',
              width: 52,
              height: 44,
              fontWeight: 800,
              fontSize: '1rem',
              border: '2px solid rgba(245, 197, 24, 0.4)',
            }}>
              {(detail.vote_average || 0).toFixed(1)}
            </Box>
            
            {/* Add to List Button */}
            <NetflixIconButton
              onClick={handleToggleList}
              sx={{
                bgcolor: inMyList ? "rgba(70, 211, 105, 0.25)" : "rgba(255,255,255,0.1)",
                border: inMyList ? "2px solid #46d369" : "2px solid rgba(255,255,255,0.4)",
                width: 44,
                height: 44,
                borderRadius: "50%",
                transition: "all 0.25s ease",
                "&:hover": { 
                  bgcolor: inMyList ? "rgba(70, 211, 105, 0.35)" : "rgba(255,255,255,0.2)",
                  borderColor: inMyList ? "#46d369" : "#fff",
                  transform: "scale(1.1)"
                },
              }}
              data-testid="add-to-list-button"
            >
              {inMyList ? <CheckIcon sx={{ color: "#46d369" }} /> : <AddIcon sx={{ color: "#fff" }} />}
            </NetflixIconButton>
            
            {/* Star Rating */}
            <Box 
              sx={{ 
                display: 'flex', 
                alignItems: 'center',
                bgcolor: 'rgba(255,255,255,0.1)',
                borderRadius: '22px',
                px: 1.5,
                py: 0.5,
                border: '2px solid rgba(255,255,255,0.2)',
              }}
              data-testid="star-rating"
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <IconButton
                  key={star}
                  size="small"
                  onClick={() => handleSetRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  sx={{
                    p: 0.3,
                    transition: 'transform 0.15s ease',
                    '&:hover': { transform: 'scale(1.2)', bgcolor: 'transparent' },
                  }}
                  data-testid={`star-${star}`}
                >
                  {(hoverRating || userRating) >= star ? (
                    <StarIcon sx={{ 
                      color: '#f5c518', 
                      fontSize: { xs: 20, md: 24 },
                      filter: 'drop-shadow(0 0 4px rgba(245,197,24,0.5))'
                    }} />
                  ) : (
                    <StarBorderIcon sx={{ 
                      color: 'rgba(255,255,255,0.5)', 
                      fontSize: { xs: 20, md: 24 } 
                    }} />
                  )}
                </IconButton>
              ))}
            </Box>
          </Stack>
        </Stack>
      </Box>

      {/* REDESIGNED TABS - Minimalist Netflix Style */}
      <Container maxWidth="xl" sx={{ px: { xs: 2, md: 6 }, mt: -2 }}>
        {/* Tab Navigation - Text Only with Underline */}
        <Box sx={{ 
          display: 'flex',
          gap: { xs: 2, md: 4 },
          mb: 4,
          borderBottom: '1px solid rgba(255,255,255,0.15)',
          overflowX: 'auto',
          '&::-webkit-scrollbar': { display: 'none' },
        }}>
          {tabs.map((tab) => (
            <Box
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-${tab.id}`}
              sx={{
                position: 'relative',
                px: 1,
                py: 2,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.25s ease',
                color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.6)',
                fontWeight: activeTab === tab.id ? 600 : 400,
                fontSize: { xs: '0.85rem', md: '0.95rem' },
                letterSpacing: '1px',
                textTransform: 'uppercase',
                '&:hover': {
                  color: '#fff',
                },
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -1,
                  left: 0,
                  right: 0,
                  height: '3px',
                  bgcolor: activeTab === tab.id ? '#46d369' : 'transparent',
                  transition: 'all 0.25s ease',
                  borderRadius: '2px 2px 0 0',
                }
              }}
            >
              {tab.label}
            </Box>
          ))}
        </Box>

        {/* Tab Content with Fade Animation */}
        <Box sx={{ 
          animation: 'fadeInUp 0.4s ease-out',
          '@keyframes fadeInUp': {
            '0%': { opacity: 0, transform: 'translateY(20px)' },
            '100%': { opacity: 1, transform: 'translateY(0)' }
          },
          minHeight: 400,
        }}>
          {/* PANORAMICA */}
          {activeTab === "overview" && (
            <Grid container spacing={4}>
              <Grid item xs={12} md={8}>
                {/* Rating Card */}
                <Box sx={{ 
                  display: "flex", 
                  alignItems: "center", 
                  gap: 3, 
                  mb: 4,
                  p: 3,
                  bgcolor: "rgba(255,255,255,0.05)",
                  borderRadius: 3,
                  border: "1px solid rgba(255,255,255,0.1)",
                  backdropFilter: "blur(10px)"
                }}>
                  <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 64,
                    height: 64,
                    borderRadius: 2,
                    bgcolor: "rgba(245, 197, 24, 0.15)",
                    border: "1px solid rgba(245, 197, 24, 0.25)"
                  }}>
                    <StarIcon sx={{ color: "#f5c518", fontSize: 32 }} />
                  </Box>
                  <Box>
                    <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5, color: "#fff" }}>
                      {detail.vote_average?.toFixed(1)}<span style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.5)' }}>/10</span>
                    </Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.6)" }}>
                      {detail.vote_count?.toLocaleString()} valutazioni
                    </Typography>
                  </Box>
                </Box>

                {/* Tagline */}
                {detail.tagline && (
                  <Box sx={{ mb: 4 }}>
                    <Typography 
                      variant="h6" 
                      sx={{ 
                        fontStyle: "italic", 
                        color: "rgba(255,255,255,0.85)",
                        borderLeft: "4px solid #e50914",
                        pl: 3,
                        py: 1
                      }}
                    >
                      "{detail.tagline}"
                    </Typography>
                  </Box>
                )}

                {/* Trama */}
                <Box sx={{ mb: 4 }}>
                  <Typography variant="h6" sx={{ mb: 2, fontWeight: 700, color: "#fff" }}>
                    Trama
                  </Typography>
                  <Typography variant="body1" sx={{ lineHeight: 1.9, color: "rgba(255,255,255,0.85)" }}>
                    {detail.overview || "Descrizione non disponibile."}
                  </Typography>
                </Box>

                {/* Cast */}
                <Box>
                  <Typography variant="body2" sx={{ lineHeight: 1.8, color: "rgba(255,255,255,0.6)" }}>
                    <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>Cast: </span>
                    {(detail as any).credits?.cast?.slice(0, 5).map((c: any) => c.name).join(', ') || 'Non disponibile'}
                  </Typography>
                </Box>
              </Grid>

              {/* Sidebar */}
              <Grid item xs={12} md={4}>
                <Box sx={{ 
                  bgcolor: "rgba(255,255,255,0.03)", 
                  borderRadius: 3, 
                  p: 3,
                  border: "1px solid rgba(255,255,255,0.08)",
                }}>
                  {/* Generi */}
                  {detail.genres?.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="caption" sx={{ 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        display: 'block',
                        mb: 1.5,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Generi
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {detail.genres.map((genre: any) => (
                          <Chip
                            key={genre.id}
                            label={genre.name}
                            size="small"
                            sx={{ 
                              bgcolor: "rgba(229, 9, 20, 0.2)", 
                              color: "#ff8a8a", 
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              height: 28,
                              border: '1px solid rgba(229, 9, 20, 0.3)',
                            }}
                          />
                        ))}
                      </Stack>
                    </Box>
                  )}

                  {/* Data uscita */}
                  {(detail.release_date || (detail as any).first_air_date) && (
                    <Box sx={{ mb: 2.5 }}>
                      <Typography variant="caption" sx={{ 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        display: 'block',
                        mb: 1,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Data di uscita
                      </Typography>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <CalendarTodayIcon sx={{ fontSize: 16, color: "rgba(255,255,255,0.5)" }} />
                        <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>
                          {new Date(detail.release_date || (detail as any).first_air_date).toLocaleDateString('it-IT', { 
                            day: 'numeric', 
                            month: 'long', 
                            year: 'numeric' 
                          })}
                        </Typography>
                      </Stack>
                    </Box>
                  )}

                  {/* Durata */}
                  {(detail.runtime || (detail as any).episode_run_time?.[0]) && (
                    <Box>
                      <Typography variant="caption" sx={{ 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        display: 'block',
                        mb: 1,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Durata
                      </Typography>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <AccessTimeIcon sx={{ fontSize: 16, color: "rgba(255,255,255,0.5)" }} />
                        <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>
                          {formatMinuteToReadable(detail.runtime || (detail as any).episode_run_time?.[0])}
                        </Typography>
                      </Stack>
                    </Box>
                  )}
                </Box>
              </Grid>
            </Grid>
          )}

          {/* EPISODI (TV) */}
          {activeTab === "episodes" && isTVShow && (
            <Box>
              <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                <Typography variant="h5" fontWeight={700} sx={{ color: "#fff" }}>Episodi</Typography>
                {availableSeasons.length > 0 && (
                  <FormControl size="small">
                    <Select
                      value={selectedSeason}
                      onChange={(e) => setSelectedSeason(e.target.value as number)}
                      sx={{
                        color: '#fff',
                        bgcolor: 'rgba(255,255,255,0.1)',
                        borderRadius: 2,
                        minWidth: 220,
                        '.MuiOutlinedInput-notchedOutline': { border: '1px solid rgba(255,255,255,0.25)' },
                        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' },
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#e50914' },
                        '.MuiSelect-icon': { color: '#fff' },
                      }}
                      data-testid="season-selector"
                    >
                      {availableSeasons.map((season: any) => (
                        <MenuItem 
                          key={season.season_number} 
                          value={season.season_number}
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            opacity: season.vixsrc_available ? 1 : 0.6
                          }}
                        >
                          <span>Stagione {season.season_number}</span>
                          {!season.vixsrc_available && !season.is_aired && (
                            <Chip 
                              label="Prossimamente" 
                              size="small" 
                              sx={{ 
                                ml: 1, 
                                bgcolor: 'rgba(255,152,0,0.2)', 
                                color: '#ff9800',
                                fontSize: '0.65rem',
                                height: 20
                              }} 
                            />
                          )}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Box>

              {/* Season Not Available Message */}
              {seasonNotAvailableMsg && (
                <Box sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  py: 8,
                  bgcolor: 'rgba(255,152,0,0.08)',
                  borderRadius: 3,
                  border: '1px solid rgba(255,152,0,0.2)',
                }}
                data-testid="season-not-available"
                >
                  <EventIcon sx={{ fontSize: 56, color: '#ff9800', mb: 2 }} />
                  <Typography variant="h6" sx={{ color: '#fff', mb: 1, fontWeight: 600 }}>
                    Stagione non ancora disponibile
                  </Typography>
                  <Typography sx={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', maxWidth: 400 }}>
                    {seasonReleaseDate 
                      ? `Questa stagione sarà disponibile il ${seasonReleaseDate}`
                      : seasonNotAvailableMsg
                    }
                  </Typography>
                </Box>
              )}

              {/* Episodes List - Only shows vixsrc available episodes */}
              {!seasonNotAvailableMsg && (
                <Stack spacing={2}>
                  {/* Loading indicator per cambio stagione */}
                  {isLoadingEpisodes && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                      <CircularProgress size={32} sx={{ color: '#e50914' }} />
                    </Box>
                  )}
                  
                  {!isLoadingEpisodes && filteredEpisodes.map((episode: any) => (
                    <Box
                      key={episode.episode_number}
                      sx={{
                        display: 'flex',
                        gap: 3,
                        p: 2.5,
                        bgcolor: 'rgba(255,255,255,0.03)',
                        borderRadius: 3,
                        border: '1px solid rgba(255,255,255,0.08)',
                        transition: 'all 0.3s ease',
                        '&:hover': {
                          bgcolor: 'rgba(255,255,255,0.06)',
                          borderColor: 'rgba(229, 9, 20, 0.3)',
                        }
                      }}
                      data-testid={`episode-${episode.episode_number}`}
                    >
                      <Box sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 48,
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: '1.5rem',
                        fontWeight: 700
                      }}>
                        {episode.episode_number}
                      </Box>

                      <Box sx={{ 
                        position: 'relative', 
                        width: { xs: 120, md: 180 }, 
                        minWidth: { xs: 120, md: 180 },
                        aspectRatio: '16/9',
                        borderRadius: 2,
                        overflow: 'hidden',
                        bgcolor: '#1a1a1a'
                      }}>
                        {episode.still_path ? (
                          <Box
                            component="img"
                            src={`${configuration?.images.base_url || 'https://image.tmdb.org/t/p/'}w300${episode.still_path}`}
                            alt={episode.name}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <Box sx={{ 
                            width: '100%', 
                            height: '100%', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            bgcolor: 'rgba(255,255,255,0.03)'
                          }}>
                            <MovieIcon sx={{ fontSize: 32, color: 'rgba(255,255,255,0.3)' }} />
                          </Box>
                        )}
                        {/* Episode progress bar */}
                        {(() => {
                          const progress = getEpisodeProgress(selectedSeason, episode.episode_number);
                          return progress > 0 ? (
                            <Box
                              sx={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: 4,
                                bgcolor: 'rgba(100,100,100,0.6)',
                              }}
                            >
                              <Box
                                sx={{
                                  height: '100%',
                                  width: `${progress}%`,
                                  bgcolor: '#e50914',
                                  transition: 'width 0.3s ease',
                                }}
                              />
                            </Box>
                          ) : null;
                        })()}
                      </Box>

                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
                          <Box>
                            <Typography variant="subtitle1" fontWeight={600} sx={{ color: "#fff" }}>
                              {episode.name}
                            </Typography>
                            {(episode.air_date || episode.air_date_it) && (
                              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)" }}>
                                {episode.air_date_it || formatItalianDate(episode.air_date)}
                              </Typography>
                            )}
                          </Box>
                          {episode.runtime && (
                            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.5)", whiteSpace: 'nowrap', ml: 2 }}>
                              {episode.runtime} min
                            </Typography>
                          )}
                        </Stack>
                        <Typography 
                          variant="body2" 
                          sx={{
                            color: "rgba(255,255,255,0.7)",
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            lineHeight: 1.6
                          }}
                        >
                          {episode.overview || "Descrizione non disponibile."}
                        </Typography>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', ml: 2 }}>
                        <IconButton
                          onClick={() => {
                            // FIX 1: Validate all parameters before navigation to avoid 404
                            if (!id || !selectedSeason || !episode.episode_number) {
                              console.error('Invalid episode parameters:', { id, selectedSeason, episode: episode.episode_number });
                              return;
                            }
                            
                            // Save episode info to continue watching before navigating
                            const episodeProgress = getEpisodeProgress(selectedSeason, episode.episode_number);
                            const existingItem = continueWatchingItems.find(
                              item => item.tmdb_id === Number(id) && 
                                      item.media_type === 'tv' && 
                                      item.season === selectedSeason && 
                                      item.episode === episode.episode_number
                            );
                            
                            // Build URL with resume time if available
                            let watchUrl = `/${MAIN_PATH.watch}/tv/${id}?s=${selectedSeason}&e=${episode.episode_number}`;
                            if (existingItem?.progress && existingItem.progress > 30) {
                              watchUrl += `&t=${Math.floor(existingItem.progress)}`;
                            }
                            
                            navigate(watchUrl);
                          }}
                          sx={{
                            bgcolor: "rgba(255,255,255,0.1)",
                            border: "2px solid rgba(255,255,255,0.3)",
                            width: 48,
                            height: 48,
                            transition: "all 0.25s ease",
                            "&:hover": { 
                              bgcolor: "#e50914",
                              borderColor: "#e50914",
                              transform: "scale(1.1)"
                            },
                          }}
                          data-testid={`play-episode-${episode.episode_number}`}
                        >
                          <PlayArrowIcon sx={{ color: "#fff", fontSize: 28 }} />
                        </IconButton>
                      </Box>
                    </Box>
                  ))}

                  {!isLoadingEpisodes && filteredEpisodes.length === 0 && !seasonNotAvailableMsg && (
                    <Box sx={{ 
                      py: 8, 
                      textAlign: 'center',
                      bgcolor: 'rgba(255,255,255,0.02)',
                      borderRadius: 3
                    }}>
                      <MovieIcon sx={{ fontSize: 48, color: 'rgba(255,255,255,0.3)', mb: 2 }} />
                      <Typography sx={{ color: "rgba(255,255,255,0.5)" }}>
                        Gli episodi di questa stagione non sono ancora disponibili
                      </Typography>
                    </Box>
                  )}
                </Stack>
              )}
            </Box>
          )}

          {/* DETTAGLI */}
          {activeTab === "details" && (
            <Grid container spacing={5}>
              <Grid item xs={12} md={6}>
                <Stack spacing={4}>
                  {detail.spoken_languages?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ 
                        mb: 1.5, 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Lingue disponibili
                      </Typography>
                      <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.85)" }}>
                        {detail.spoken_languages.map((l: any) => l.name).join(", ")}
                      </Typography>
                    </Box>
                  )}

                  {detail.production_companies?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ 
                        mb: 1.5, 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Produzione
                      </Typography>
                      <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.85)" }}>
                        {detail.production_companies.map((c: any) => c.name).join(", ")}
                      </Typography>
                    </Box>
                  )}

                  {detail.status && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ 
                        mb: 1.5, 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Stato
                      </Typography>
                      <Chip 
                        label={detail.status} 
                        size="small"
                        sx={{ 
                          bgcolor: detail.status === 'Released' || detail.status === 'Returning Series' 
                            ? 'rgba(70, 211, 105, 0.2)' 
                            : 'rgba(255,255,255,0.1)',
                          color: detail.status === 'Released' || detail.status === 'Returning Series' 
                            ? '#46d369' 
                            : 'rgba(255,255,255,0.8)',
                          fontWeight: 600
                        }}
                      />
                    </Box>
                  )}

                  {isMovie && detail.budget > 0 && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ 
                        mb: 1.5, 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Budget
                      </Typography>
                      <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>
                        ${detail.budget.toLocaleString()}
                      </Typography>
                    </Box>
                  )}

                  {isMovie && detail.revenue > 0 && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ 
                        mb: 1.5, 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Incasso
                      </Typography>
                      <Typography variant="body1" sx={{ color: "#46d369", fontWeight: 600 }}>
                        ${detail.revenue.toLocaleString()}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </Grid>

              <Grid item xs={12} md={6}>
                <Stack spacing={4}>
                  {isTVShow && (detail as any).networks?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ 
                        mb: 1.5, 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Network
                      </Typography>
                      <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.85)" }}>
                        {(detail as any).networks.map((n: any) => n.name).join(", ")}
                      </Typography>
                    </Box>
                  )}

                  {isTVShow && (detail as any).created_by?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ 
                        mb: 1.5, 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Creato da
                      </Typography>
                      <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.85)" }}>
                        {(detail as any).created_by.map((c: any) => c.name).join(", ")}
                      </Typography>
                    </Box>
                  )}

                  {detail.production_countries?.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ 
                        mb: 1.5, 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        Paese di produzione
                      </Typography>
                      <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.85)" }}>
                        {detail.production_countries.map((c: any) => c.name).join(", ")}
                      </Typography>
                    </Box>
                  )}

                  {detail.imdb_id && (
                    <Box>
                      <Typography variant="subtitle2" sx={{ 
                        mb: 1.5, 
                        textTransform: "uppercase", 
                        letterSpacing: 1.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.5)"
                      }}>
                        IMDB ID
                      </Typography>
                      <Typography 
                        variant="body1" 
                        sx={{ 
                          color: '#f5c518',
                          cursor: 'pointer',
                          '&:hover': { textDecoration: 'underline' }
                        }}
                        onClick={() => window.open(`https://www.imdb.com/title/${detail.imdb_id}`, '_blank')}
                      >
                        {detail.imdb_id}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </Grid>
            </Grid>
          )}

          {/* TRAILER */}
          {activeTab === "trailer" && (
            <Box>
              {trailerKey ? (
                <Box sx={{ width: '100%', maxWidth: 1000, mx: 'auto' }}>
                  <CleanTrailer key={activeVideoKey || trailerKey} videoKey={activeVideoKey || trailerKey} poster={backdropUrl as string} testId="trailer-tab-player" />
                </Box>
              ) : (
                <Box sx={{ 
                  textAlign: 'center', 
                  py: 10,
                  bgcolor: 'rgba(255,255,255,0.02)',
                  borderRadius: 3,
                  border: '1px solid rgba(255,255,255,0.08)'
                }}>
                  <PlayCircleOutlineIcon sx={{ fontSize: 72, color: 'rgba(255,255,255,0.3)', mb: 2 }} />
                  <Typography sx={{ color: "rgba(255,255,255,0.5)" }} variant="h6">
                    Nessun trailer disponibile
                  </Typography>
                </Box>
              )}

              {/* Altri video */}
              {detail.videos?.results?.length > 1 && (
                <Box sx={{ mt: 6 }}>
                  <Typography variant="h6" sx={{ mb: 3, fontWeight: 700, color: "#fff" }}>
                    Altri video
                  </Typography>
                  <Grid container spacing={2.5}>
                    {detail.videos.results.filter((v: any) => v.key !== (activeVideoKey || trailerKey) && v.site === 'YouTube').slice(0, 6).map((video: any) => (
                      <Grid item xs={6} sm={4} md={3} key={video.id}>
                        <Box
                          sx={{
                            cursor: 'pointer',
                            borderRadius: 2,
                            overflow: 'hidden',
                            transition: 'all 0.3s ease',
                            bgcolor: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            '&:hover': { 
                              transform: 'scale(1.03)',
                              boxShadow: '0 8px 30px rgba(229, 9, 20, 0.2)',
                              borderColor: 'rgba(229, 9, 20, 0.3)'
                            }
                          }}
                          onClick={() => { setActiveVideoKey(video.key); document.querySelector('[data-testid="trailer-tab-player"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                          data-testid={`other-video-${video.key}`}
                        >
                          <Box sx={{ position: 'relative' }}>
                            <Box
                              component="img"
                              src={`https://img.youtube.com/vi/${video.key}/mqdefault.jpg`}
                              alt={video.name}
                              sx={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }}
                            />
                            <Box sx={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: 'rgba(0,0,0,0.4)',
                              opacity: 0,
                              transition: 'opacity 0.3s ease',
                              '&:hover': { opacity: 1 }
                            }}>
                              <PlayCircleOutlineIcon sx={{ fontSize: 48, color: '#fff' }} />
                            </Box>
                          </Box>
                          <Box sx={{ p: 1.5 }}>
                            <Chip 
                              label={video.type} 
                              size="small"
                              sx={{ 
                                mb: 1, 
                                bgcolor: 'rgba(229, 9, 20, 0.2)', 
                                color: '#ff8a8a',
                                fontSize: '0.65rem',
                                height: 20
                              }}
                            />
                            <MaxLineTypography maxLine={2} variant="body2" fontWeight={500} sx={{ color: "rgba(255,255,255,0.9)" }}>
                              {video.name}
                            </MaxLineTypography>
                          </Box>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              )}
            </Box>
          )}

          {/* SCARICA (Film) */}
          {activeTab === "download" && isMovie && (
            <Box sx={{ 
              textAlign: 'center', 
              py: 8,
              px: 4,
              bgcolor: 'rgba(255,255,255,0.02)',
              borderRadius: 3,
              border: '1px solid rgba(255,255,255,0.08)',
              maxWidth: 600,
              mx: 'auto'
            }}>
              <Box sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                bgcolor: 'rgba(229, 9, 20, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 3
              }}>
                <DownloadIcon sx={{ fontSize: 40, color: '#e50914' }} />
              </Box>
              <Typography variant="h5" sx={{ mb: 2, fontWeight: 700, color: "#fff" }}>
                Download disponibile
              </Typography>
              <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.6)", mb: 4, maxWidth: 400, mx: 'auto' }}>
                Scarica "{getTitle()}" per guardarlo offline sui tuoi dispositivi.
              </Typography>
              
              <Stack direction="row" spacing={2} justifyContent="center" flexWrap="wrap" useFlexGap>
                <NetflixIconButton
                  sx={{
                    bgcolor: "#e50914",
                    color: "#fff",
                    px: 4,
                    py: 1.5,
                    borderRadius: "8px",
                    fontWeight: 700,
                    fontSize: '1rem',
                    transition: 'all 0.25s ease',
                    "&:hover": { 
                      bgcolor: "#c40812",
                      transform: 'scale(1.02)'
                    },
                  }}
                  data-testid="download-hd-button"
                >
                  <DownloadIcon sx={{ mr: 1 }} />
                  Scarica HD
                </NetflixIconButton>
                
                <NetflixIconButton
                  sx={{
                    bgcolor: "rgba(255,255,255,0.1)",
                    color: "#fff",
                    px: 4,
                    py: 1.5,
                    borderRadius: "8px",
                    fontWeight: 700,
                    fontSize: '1rem',
                    border: '1px solid rgba(255,255,255,0.25)',
                    transition: 'all 0.25s ease',
                    "&:hover": { 
                      bgcolor: "rgba(255,255,255,0.2)",
                      borderColor: 'rgba(255,255,255,0.4)'
                    },
                  }}
                  data-testid="download-sd-button"
                >
                  <DownloadIcon sx={{ mr: 1 }} />
                  Scarica SD
                </NetflixIconButton>
              </Stack>
              
              <Typography variant="caption" sx={{ display: 'block', mt: 4, color: "rgba(255,255,255,0.4)" }}>
                Nota: Il download è simulato in questa demo
              </Typography>
            </Box>
          )}
        </Box>

        {/* Correlati */}
        {similarList.length > 0 && (
          <Box sx={{ mt: 8, mb: 6 }}>
            <Typography variant="h5" sx={{ mb: 4, fontWeight: 700, color: "#fff" }}>
              Titoli correlati
            </Typography>
            <Grid container spacing={2}>
              {similarList.slice(0, 12).map((video: any) => (
                <Grid item xs={4} sm={3} md={2} key={video.id}>
                  <Box
                    onClick={() => navigate(`/${MAIN_PATH.browse}/${mediaType}/${video.id}`)}
                    sx={{
                      cursor: "pointer",
                      borderRadius: 2,
                      overflow: "hidden",
                      transition: "all 0.35s ease",
                      position: 'relative',
                      bgcolor: '#1a1a1a',
                      "&:hover": { 
                        transform: "scale(1.08)",
                        zIndex: 10,
                        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                        '& .overlay': { opacity: 1 }
                      },
                    }}
                    data-testid={`similar-video-${video.id}`}
                  >
                    <Box
                      component="img"
                      src={getMediaImageUrl(
                        video.id,
                        video.poster_path ? 'poster' : 'backdrop',
                        video.poster_path || video.backdrop_path,
                        configuration?.images.base_url,
                        video.poster_path ? 'w342' : 'w300'
                      )}
                      alt={video.title || video.name}
                      sx={{ 
                        width: "100%", 
                        aspectRatio: "2/3", 
                        objectFit: "cover",
                        display: 'block'
                      }}
                      onError={(e: any) => { e.target.style.display = 'none'; }}
                    />
                    <Box 
                      className="overlay"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.9) 100%)',
                        opacity: 0,
                        transition: 'opacity 0.3s ease',
                        display: 'flex',
                        alignItems: 'flex-end',
                        p: 1.5
                      }}
                    >
                      <Stack spacing={0.5} sx={{ width: '100%' }}>
                        <Typography 
                          variant="caption" 
                          sx={{ 
                            fontWeight: 600,
                            color: '#fff',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            lineHeight: 1.3,
                            fontSize: '0.7rem'
                          }}
                        >
                          {video.title || video.name}
                        </Typography>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <StarIcon sx={{ fontSize: 12, color: '#f5c518' }} />
                          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.7)", fontSize: '0.65rem' }}>
                            {video.vote_average?.toFixed(1)}
                          </Typography>
                        </Stack>
                      </Stack>
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}
      </Container>
    </Box>
  );
}

Component.displayName = "DetailPage";
