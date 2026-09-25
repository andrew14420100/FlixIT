// @ts-nocheck
import Button, { ButtonProps } from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { MEDIA_TYPE } from "src/types/Common";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import useProviderPlayback from "src/hooks/useProviderPlayback";
import ProviderPlaybackFeedback from "./ProviderPlaybackFeedback";

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
  const { getProgress, saveProgress } = useContinueWatching();
  const { isLoading, error, clearError, startPlayback } = useProviderPlayback();

  const isValidId =
    mediaId !== undefined &&
    mediaId !== null &&
    mediaId !== 0 &&
    mediaId !== "0";
  const normalizedMediaType =
    typeof mediaType === "string" ? mediaType : mediaType?.toString();
  const isValidMediaType =
    normalizedMediaType === "movie" || normalizedMediaType === "tv";

  const handleClick = async () => {
    if (!isValidId || !isValidMediaType || isLoading) return;

    const tmdbId = typeof mediaId === "string" ? parseInt(mediaId) : mediaId!;

    // Preserve the existing Continue Watching bootstrap. A zero-progress item is
    // ignored by the current catalogue UI until playback actually advances.
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

    const saved = getProgress(tmdbId);
    const resolvedSeason =
      normalizedMediaType === "tv" ? saved?.season || season : season;
    const resolvedEpisode =
      normalizedMediaType === "tv" ? saved?.episode || episode : episode;
    const startTime = saved?.progress > 30 ? Math.floor(saved.progress) : 0;

    await startPlayback({
      contentTitle: title || String(mediaId),
      mediaType: normalizedMediaType,
      mediaId: tmdbId,
      season: resolvedSeason,
      episode: resolvedEpisode,
      startTime,
    });
  };

  return (
    <>
      <Button
        color="inherit"
        variant="contained"
        disabled={!isValidId || !isValidMediaType || isLoading}
        startIcon={
          isLoading ? (
            <CircularProgress size={20} thickness={5} color="inherit" />
          ) : (
            <PlayArrowIcon
              sx={{
                fontSize: {
                  xs: "18px !important",
                  sm: "22px !important",
                  md: "40px !important",
                },
              }}
            />
          )
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
        {isLoading ? "Preparazione..." : "Guarda"}
      </Button>

      <ProviderPlaybackFeedback
        loading={isLoading}
        error={error}
        title={title}
        onCloseError={clearError}
      />
    </>
  );
}
