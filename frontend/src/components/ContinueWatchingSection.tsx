// @ts-nocheck
import { useMemo } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { Movie } from "src/types/Movie";
import ContinueWatchingCard from "./ContinueWatchingCard";
import { ARROW_MAX_WIDTH } from "src/constant";

export default function ContinueWatchingSection() {
  const { items, username, isLoggedIn } = useContinueWatching();

  const movies = useMemo(
    (): Movie[] =>
      items.map((item) => ({
        id: item.tmdb_id,
        title: item.title,
        name: item.title,
        backdrop_path: item.backdrop_path,
        poster_path: item.poster_path,
        media_type: item.media_type,
        genre_ids: [],
        vote_average: 0,
        overview: "",
        release_date: "",
        adult: false,
      } as Movie)),
    [items]
  );

  // Only show for logged-in users with items
  if (!isLoggedIn || items.length === 0) return null;

  return (
    <Stack
      spacing={1}
      sx={{ position: "relative", zIndex: 10, mt: -2 }}
      data-testid="continue-watching-section"
    >
      <Box
        sx={{
          pl: { xs: "30px", sm: `${ARROW_MAX_WIDTH}px` },
          pt: 1,
          pb: 0.5,
          position: "relative",
          zIndex: 11,
        }}
      >
        <Typography
          variant="h6"
          sx={{
            color: "#fff",
            fontWeight: 700,
            lineHeight: 1.4,
            fontSize: { xs: "1rem", sm: "1.25rem" },
            textShadow: "0 2px 8px rgba(0,0,0,0.9)",
          }}
        >
          {username}, continua a guardare:
        </Typography>
      </Box>

      <Box
        sx={{
          display: "flex",
          flexWrap: "nowrap",
          overflowX: "auto",
          overflow: "hidden",
          pl: { xs: "30px", sm: `${ARROW_MAX_WIDTH}px` },
          pr: { xs: "30px", sm: `${ARROW_MAX_WIDTH}px` },
          gap: { xs: 0.5, sm: 1 },
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
          position: "relative",
          zIndex: 11,
        }}
      >
        {movies.slice(0, 12).map((movie, index) => (
          <Box
            key={`cw-${movie.id}-${items[index]?.media_type}`}
            sx={{
              flex: "0 0 auto",
              width: {
                xs: "calc(50% - 8px)",
                sm: "calc(33.333% - 8px)",
                md: "calc(25% - 8px)",
                lg: "calc(20% - 8px)",
                xl: "calc(16.666% - 8px)",
              },
            }}
          >
            <ContinueWatchingCard video={movie} item={items[index]} />
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
