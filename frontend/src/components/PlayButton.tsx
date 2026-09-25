// @ts-nocheck
import Button, { ButtonProps } from "@mui/material/Button";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useNavigate } from "react-router-dom";
import { MAIN_PATH } from "src/constant";
import { MEDIA_TYPE } from "src/types/Common";
import { useContinueWatching } from "src/hooks/useContinueWatching";

interface PlayButtonProps extends ButtonProps {
  mediaType?: string | MEDIA_TYPE;
  mediaId?: number | string;
  season?: number;
  episode?: number;
  title?: string;
  backdrop_path?: string;
  poster_path?: string;
}

export default function PlayButton({
  sx,
  mediaType,
  mediaId,
  season = 1,
  episode = 1,
  title,
  backdrop_path,
  poster_path,
  ...others
}: PlayButtonProps) {
  const navigate = useNavigate();
  const { getProgress, saveProgress } = useContinueWatching();

  const isValidId = mediaId !== undefined && mediaId !== null && mediaId !== 0 && mediaId !== "0";
  const normalizedMediaType = typeof mediaType === "string" ? mediaType : mediaType?.toString();
  const isValidMediaType = normalizedMediaType === "movie" || normalizedMediaType === "tv";

  const handleClick = () => {
    if (!isValidId || !isValidMediaType) return;

    const tmdbId = typeof mediaId === "string" ? parseInt(mediaId) : mediaId!;

    // Save initial entry to continue watching
    if (title && backdrop_path) {
      saveProgress({
        tmdb_id: tmdbId,
        media_type: normalizedMediaType as "movie" | "tv",
        title,
        backdrop_path,
        poster_path: poster_path || backdrop_path,
        progress: 0,
        duration: normalizedMediaType === "tv" ? 2700 : 7200,
        ...(normalizedMediaType === "tv" && { season, episode }),
      });
    }

    // Check for saved progress to resume
    const saved = getProgress(tmdbId);
    let watchUrl = "";

    if (normalizedMediaType === "tv") {
      const s = saved?.season || season;
      const e = saved?.episode || episode;
      watchUrl = `/${MAIN_PATH.watch}/tv/${tmdbId}?s=${s}&e=${e}`;
      if (saved && saved.progress > 30) {
        watchUrl += `&t=${Math.floor(saved.progress)}`;
      }
    } else {
      watchUrl = `/${MAIN_PATH.watch}/movie/${tmdbId}`;
      if (saved && saved.progress > 30) {
        watchUrl += `?t=${Math.floor(saved.progress)}`;
      }
    }

    navigate(watchUrl);
  };

  return (
    <Button
      color="inherit"
      variant="contained"
      disabled={!isValidId || !isValidMediaType}
      startIcon={
        <PlayArrowIcon
          sx={{ fontSize: { xs: "18px !important", sm: "22px !important", md: "40px !important" } }}
        />
      }
      {...others}
      sx={{
        px: { xs: 1, sm: 1.5 },
        py: { xs: 0.4, sm: 0.6 },
        fontSize: { xs: 12, sm: 14, md: 20 },
        lineHeight: 1.5,
        fontWeight: "bold",
        whiteSpace: "nowrap",
        textTransform: "capitalize",
        ...sx,
      }}
      onClick={handleClick}
      data-testid="play-button"
    >
      Riproduci
    </Button>
  );
}
