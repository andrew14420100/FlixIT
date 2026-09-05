// @ts-nocheck
import Box from "@mui/material/Box";
import { Movie } from "src/types/Movie";
import { MEDIA_TYPE } from "src/types/Common";
import VideoItemWithHover from "./VideoItemWithHover";
import { ContinueWatchingItem } from "src/hooks/useContinueWatching";

interface ContinueWatchingCardProps {
  video: Movie;
  item: ContinueWatchingItem;
}

export default function ContinueWatchingCard({ video, item }: ContinueWatchingCardProps) {
  const progressPercent =
    item.duration > 0
      ? Math.min(Math.max((item.progress / item.duration) * 100, 0), 100)
      : 0;

  return (
    <Box sx={{ position: 'relative' }} data-testid={`continue-watching-card-${item.tmdb_id}`}>
      <VideoItemWithHover
        video={video}
        mediaType={item.media_type === 'tv' ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie}
      />

      {/* Progress bar */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 4,
          bgcolor: 'rgba(100,100,100,0.5)',
          zIndex: 10,
          pointerEvents: 'none',
          borderRadius: '0 0 4px 4px',
        }}
      >
        <Box
          data-testid={`progress-bar-${item.tmdb_id}`}
          sx={{
            height: '100%',
            width: `${progressPercent}%`,
            bgcolor: '#e50914',
            borderRadius: progressPercent >= 99 ? '0 0 4px 4px' : '0 0 0 4px',
            transition: 'width 0.3s ease',
          }}
        />
      </Box>
    </Box>
  );
}
