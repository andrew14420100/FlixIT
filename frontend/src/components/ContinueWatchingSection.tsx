// @ts-nocheck
import { useMemo } from "react";
import Box from "@mui/material/Box";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import HomepageSlider from "./HomepageSlider";

const formatMinutes = (s) => `${Math.max(1, Math.round((s || 0) / 60))}`;

export default function ContinueWatchingSection() {
  const { items, username, removeItem } = useContinueWatching();

  const sliderItems = useMemo(
    () =>
      items.map((item) => ({
        tmdbId: item.tmdb_id,
        id: item.tmdb_id,
        type: item.media_type,
        title: item.title,
        name: item.title,
        backdrop_path: item.backdrop_path,
        poster_path: item.poster_path,
        genre_ids: [],
        watch: {
          progress: item.progress,
          duration: item.duration,
          percent: item.duration > 0 ? Math.min(100, Math.max(0, (item.progress / item.duration) * 100)) : 0,
          season: item.season,
          episode: item.episode,
          minutesLabel: `${formatMinutes(item.progress)} di ${formatMinutes(item.duration)} min`,
          onRemove: () => removeItem(item.tmdb_id),
        },
      })),
    [items, removeItem]
  );

  if (sliderItems.length === 0) return null;

  return (
    <Box id="continua" data-testid="continue-watching-section" sx={{ position: "relative", zIndex: 10 }}>
      <HomepageSlider title={`${username}, continua a guardare`} items={sliderItems} />
    </Box>
  );
}
