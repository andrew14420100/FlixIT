// @ts-nocheck
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Stack from "@mui/material/Stack";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import ThumbUpOffAltIcon from "@mui/icons-material/ThumbUpOffAlt";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import { Movie } from "src/types/Movie";
import { usePortal } from "src/providers/PortalProvider";
import { formatMinuteToReadable } from "src/utils/common";
import NetflixIconButton from "./NetflixIconButton";
import AgeLimitChip from "./AgeLimitChip";
import QualityChip from "./QualityChip";
import GenreBreadcrumbs from "./GenreBreadcrumbs";
import { useGetConfigurationQuery } from "src/store/slices/configuration";
import { MEDIA_TYPE } from "src/types/Common";
import { useGetGenresQuery } from "src/store/slices/genre";
import { MAIN_PATH } from "src/constant";
import Box from "@mui/material/Box";
import { getMediaImageUrl } from "src/hooks/useCDNImage";
import {
  useGetAppendedVideosQuery,
  useGetMediaImagesQuery,
  useGetAllVideosQuery,
} from "src/store/slices/discover";
import { useContinueWatching } from "src/hooks/useContinueWatching";

interface VideoCardModalProps {
  video: Movie;
  anchorElement: HTMLElement;
  mediaType?: MEDIA_TYPE;
}

// Helper to get Italian trailer
const getItalianTrailerKey = (detailVideos: any[], allVideos: any[]): string | null => {
  const videoMap = new Map<string, any>();
  [...(detailVideos || []), ...(allVideos || [])].forEach(v => {
    if (v.site === "YouTube" && v.key) {
      videoMap.set(v.key, v);
    }
  });
  const videos = Array.from(videoMap.values());
  
  if (!videos.length) return null;
  
  const italianTrailer = videos.find((v: any) => v.iso_639_1 === "it" && v.type === "Trailer");
  if (italianTrailer) return italianTrailer.key;
  
  const italianTeaser = videos.find((v: any) => v.iso_639_1 === "it" && v.type === "Teaser");
  if (italianTeaser) return italianTeaser.key;
  
  const italianVideo = videos.find((v: any) => v.iso_639_1 === "it");
  if (italianVideo) return italianVideo.key;
  
  const englishTrailer = videos.find((v: any) => v.iso_639_1 === "en" && v.type === "Trailer");
  if (englishTrailer) return englishTrailer.key;
  
  const anyTrailer = videos.find((v: any) => v.type === "Trailer");
  if (anyTrailer) return anyTrailer.key;
  
  return videos[0]?.key || null;
};

export default function VideoCardModal({
  video,
  anchorElement,
  mediaType = MEDIA_TYPE.Movie,
}: VideoCardModalProps) {
  const navigate = useNavigate();
  const { data: configuration } = useGetConfigurationQuery(undefined);
  const { data: genres } = useGetGenresQuery(mediaType);
  const setPortal = usePortal();
  const { saveProgress, getProgress } = useContinueWatching();
  const rect = anchorElement.getBoundingClientRect();
  const [muted, setMuted] = useState(true);
  const [showVideo, setShowVideo] = useState(false);

  // Fetch videos and images
  const { data: detailData } = useGetAppendedVideosQuery({
    mediaType,
    id: video.id,
  });
  
  const { data: allVideosData } = useGetAllVideosQuery({
    mediaType,
    id: video.id,
  });
  
  const { data: imagesData } = useGetMediaImagesQuery({
    mediaType,
    id: video.id,
  });

  const trailerKey = useMemo(() => {
    return getItalianTrailerKey(
      detailData?.videos?.results || [],
      allVideosData?.results || []
    );
  }, [detailData?.videos?.results, allVideosData?.results]);

  // Get logo from TMDB
  const logoPath = useMemo(() => {
    if (imagesData?.logos && imagesData.logos.length > 0) {
      const italianLogo = imagesData.logos.find((l: any) => l.iso_639_1 === 'it');
      const englishLogo = imagesData.logos.find((l: any) => l.iso_639_1 === 'en');
      const logo = italianLogo || englishLogo || imagesData.logos[0];
      return `https://image.tmdb.org/t/p/w500${logo.file_path}`;
    }
    return null;
  }, [imagesData]);

  // ✅ Wait 6 SECONDS before starting video
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowVideo(true);
    }, 6000);
    return () => clearTimeout(timer);
  }, []);

  const handleNavigateToDetail = () => {
    setPortal(null, null);
    navigate(`/${MAIN_PATH.browse}/${mediaType}/${video.id}`);
  };

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPortal(null, null);
    
    const mType = mediaType === MEDIA_TYPE.Tv ? 'tv' : 'movie';
    
    // Save to Continue Watching
    saveProgress({
      tmdb_id: video.id,
      media_type: mType,
      title: video.title || video.name || '',
      backdrop_path: video.backdrop_path || '',
      poster_path: video.poster_path || video.backdrop_path || '',
      progress: 0,
      duration: mType === 'tv' ? 2700 : 7200,
      ...(mediaType === MEDIA_TYPE.Tv && { season: 1, episode: 1 }),
    });
    
    // Check for saved progress to resume
    const saved = getProgress(video.id);
    if (mediaType === MEDIA_TYPE.Tv) {
      const s = saved?.season || 1;
      const ep = saved?.episode || 1;
      let url = `/${MAIN_PATH.watch}/tv/${video.id}?s=${s}&e=${ep}`;
      if (saved && saved.progress > 30) url += `&t=${Math.floor(saved.progress)}`;
      navigate(url);
    } else {
      let url = `/${MAIN_PATH.watch}/movie/${video.id}`;
      if (saved && saved.progress > 30) url += `?t=${Math.floor(saved.progress)}`;
      navigate(url);
    }
  };

  const imageUrl = getMediaImageUrl(
    video.id,
    'backdrop',
    video.backdrop_path,
    configuration?.images.base_url,
    'w780'
  );

  // ✅ Build YouTube embed URL with mute parameter
  const youtubeEmbedUrl = useMemo(() => {
    if (!trailerKey) return null;
    
    const muteParam = muted ? '1' : '0';
    return `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=${muteParam}&loop=1&playlist=${trailerKey}&controls=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&playsinline=1`;
  }, [trailerKey, muted]);

  return (
    <Card
      data-portal-card="true"
      onPointerLeave={() => {
        setPortal(null, null);
      }}
      onPointerEnter={() => {
        // Keep portal alive
      }}
      sx={{
        width: rect.width * 1.5,
        height: "100%",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
        borderRadius: "8px",
        overflow: "hidden",
        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        pointerEvents: "auto",
        "&:hover": {
          boxShadow: "0 12px 48px rgba(0, 0, 0, 0.8)",
        },
      }}
    >
      <div
        style={{
          width: "100%",
          position: "relative",
          paddingTop: "calc(9 / 16 * 100%)",
          cursor: "pointer",
          backgroundColor: "#000",
        }}
        onClick={handleNavigateToDetail}
        data-testid={`video-card-image-${video.id}`}
      >
        {/* ✅ Background Image - Visible for 6 seconds */}
        <img
          src={imageUrl}
          style={{
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            opacity: showVideo ? 0 : 1,
            transition: "opacity 0.8s ease-in-out",
            zIndex: showVideo ? 0 : 2,
          }}
          alt={video.title}
        />

        {/* ✅ YouTube Trailer - Direct iframe embed */}
        {youtubeEmbedUrl && showVideo && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              zIndex: 1,
              opacity: showVideo ? 1 : 0,
              transition: "opacity 0.8s ease-in-out",
            }}
          >
            <iframe
              key={muted ? 'muted' : 'unmuted'} // Force reload on mute change
              src={youtubeEmbedUrl}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                border: "none",
              }}
              allow="autoplay; encrypted-media"
              title="Trailer"
            />
            {/* ✅ COMPLETE OVERLAY - Blocks ALL interactions with video */}
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 100,
                backgroundColor: 'transparent',
                cursor: 'pointer',
                pointerEvents: 'all',
              }}
              onClick={handleNavigateToDetail}
            />
          </Box>
        )}

        {/* Gradient overlay for better readability */}
        <Box
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "60%",
            background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)",
            zIndex: 3,
            pointerEvents: "none",
          }}
        />

        {/* ✅ Logo in bottom left - NO TEXT TITLE */}
        {logoPath && (
          <Box
            sx={{
              position: "absolute",
              bottom: 12,
              left: 12,
              zIndex: 4,
              maxWidth: "50%",
              pointerEvents: "none",
            }}
          >
            <img
              src={logoPath}
              alt={video.title}
              style={{
                maxWidth: "100%",
                maxHeight: "80px",
                objectFit: "contain",
                filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.8))",
              }}
            />
          </Box>
        )}

        {/* Audio toggle button - Actually works by reloading iframe */}
        <Box
          sx={{
            position: "absolute",
            bottom: 12,
            right: 12,
            zIndex: 4,
          }}
        >
          <NetflixIconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setMuted(!muted);
            }}
          >
            {muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
          </NetflixIconButton>
        </Box>
      </div>

      <CardContent>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1}>
            <NetflixIconButton
              sx={{ p: 0 }}
              onClick={handlePlayClick}
              data-testid={`video-card-play-${video.id}`}
            >
              <PlayCircleIcon sx={{ width: 40, height: 40 }} />
            </NetflixIconButton>
            <NetflixIconButton 
              onClick={(e) => e.stopPropagation()}
              data-testid={`video-card-add-${video.id}`}
            >
              <AddIcon />
            </NetflixIconButton>
            <NetflixIconButton 
              onClick={(e) => e.stopPropagation()}
              data-testid={`video-card-like-${video.id}`}
            >
              <ThumbUpOffAltIcon />
            </NetflixIconButton>
            <div style={{ flexGrow: 1 }} />
            <NetflixIconButton
              onClick={(e) => {
                e.stopPropagation();
                handleNavigateToDetail();
              }}
              data-testid={`video-card-expand-${video.id}`}
            >
              <ExpandMoreIcon />
            </NetflixIconButton>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography
              variant="subtitle1"
              sx={{ color: "success.main" }}
            >{`${Math.round(video.vote_average * 10)}% Corrispondenza`}</Typography>
            <AgeLimitChip label={video.adult ? "18+" : "13+"} />
            <Typography variant="subtitle2">{`${formatMinuteToReadable(
              video.runtime || (mediaType === MEDIA_TYPE.Tv ? 45 : 120)
            )}`}</Typography>
            <QualityChip label="HD" />
          </Stack>
          {genres && (
            <GenreBreadcrumbs
              genres={genres
                .filter((genre) => video.genre_ids.includes(genre.id))
                .map((genre) => genre.name)}
            />
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
