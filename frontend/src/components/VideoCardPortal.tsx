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
import { useGetMediaImagesQuery } from "src/store/slices/discover";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import TrailerPlayer from "./TrailerPlayer";

interface VideoCardModalProps {
  video: Movie;
  anchorElement: HTMLElement;
  mediaType?: MEDIA_TYPE;
}

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
  const [trailerFailed, setTrailerFailed] = useState(false);

  // Resolve the clean direct trailer immediately so it is warm by the time the
  // intentional hover delay expires. This is independent from the movie player.
  const resolvedTrailer = useResolvedTrailer(mediaType, video.id, true);
  const trailerUrl = resolvedTrailer?.url || null;

  const { data: imagesData } = useGetMediaImagesQuery({
    mediaType,
    id: video.id,
  });

  // Get logo from TMDB
  const logoPath = useMemo(() => {
    if (imagesData?.logos && imagesData.logos.length > 0) {
      const italianLogo = imagesData.logos.find((l: any) => l.iso_639_1 === "it");
      const englishLogo = imagesData.logos.find((l: any) => l.iso_639_1 === "en");
      const logo = italianLogo || englishLogo || imagesData.logos[0];
      return `https://image.tmdb.org/t/p/w500${logo.file_path}`;
    }
    return null;
  }, [imagesData]);

  // Intentional user-defined delay: keep the image visible for 6 seconds.
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowVideo(true);
    }, 6000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    setTrailerFailed(false);
  }, [trailerUrl]);

  const handleNavigateToDetail = () => {
    setPortal(null, null);
    navigate(`/${MAIN_PATH.browse}/${mediaType}/${video.id}`);
  };

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPortal(null, null);

    const mType = mediaType === MEDIA_TYPE.Tv ? "tv" : "movie";

    // Save to Continue Watching
    saveProgress({
      tmdb_id: video.id,
      media_type: mType,
      title: video.title || video.name || "",
      backdrop_path: video.backdrop_path || "",
      poster_path: video.poster_path || video.backdrop_path || "",
      progress: 0,
      duration: mType === "tv" ? 2700 : 7200,
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
    "backdrop",
    video.backdrop_path,
    configuration?.images.base_url,
    "w780"
  );

  const trailerVisible = !!showVideo && !!trailerUrl && !trailerFailed;

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
        {/* Background image intentionally remains visible for the configured delay. */}
        <img
          src={imageUrl}
          style={{
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            opacity: trailerVisible ? 0 : 1,
            transition: "opacity 0.8s ease-in-out",
            zIndex: trailerVisible ? 0 : 2,
          }}
          alt={video.title}
        />

        {/* Direct MP4/HLS trailer: no YouTube iframe, controls or provider branding. */}
        {trailerVisible ? (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              zIndex: 1,
              opacity: 1,
              transition: "opacity 0.8s ease-in-out",
              overflow: "hidden",
            }}
          >
            <TrailerPlayer
              videoKey={trailerUrl}
              muted={muted}
              playing={trailerVisible}
              loop
              zoom={1.15}
              onError={() => setTrailerFailed(true)}
            />
            <Box
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 100,
                backgroundColor: "transparent",
                cursor: "pointer",
                pointerEvents: "all",
              }}
              onClick={handleNavigateToDetail}
            />
          </Box>
        ) : null}

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

        {/* Logo in bottom left - no text title */}
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
            <Typography variant="subtitle1" sx={{ color: "success.main" }}>
              {`${Math.round(video.vote_average * 10)}% Corrispondenza`}
            </Typography>
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
