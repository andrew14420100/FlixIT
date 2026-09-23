// @ts-nocheck
/**
 * CatalogPage - griglia con filtri per genere, riutilizzata da Film e Serie TV.
 * Loads network pages and DOM cards progressively so long browsing sessions do
 * not turn into hundreds of active hover/artwork components at once.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import { APP_BAR_HEIGHT } from "src/constant";
import { MEDIA_TYPE } from "src/types/Common";
import { useAppDispatch, useAppSelector } from "src/hooks/redux";
import { useGetGenresQuery } from "src/store/slices/genre";
import {
  initiateItem,
  useLazyGetVideosByMediaTypeAndGenreIdQuery,
  useLazyGetVideosByMediaTypeAndCustomGenreQuery,
} from "src/store/slices/discover";
import VideoItemWithHover from "src/components/VideoItemWithHover";
import { useAvailableItems } from "src/hooks/useAvailability";
import useArtworkBatch from "src/hooks/useArtworkBatch";

interface CatalogPageProps {
  mediaType: MEDIA_TYPE;
  title: string;
  categories: { name: string; apiString: string }[];
}

const INITIAL_RENDER_LIMIT = 36;
const RENDER_STEP = 36;

function artworkKey(item: any, mediaType: MEDIA_TYPE) {
  const id = Number(item?.tmdbId || item?.tmdb_id || item?.id || 0);
  if (!id) return "";
  const type = mediaType === MEDIA_TYPE.Tv || item?.type === "tv" || item?.media_type === "tv"
    ? "tv"
    : "movie";
  return `${type}:${id}`;
}

export default function CatalogPage({ mediaType, title, categories }: CatalogPageProps) {
  const dispatch = useAppDispatch();
  const { data: genres = [] } = useGetGenresQuery(mediaType);
  const [active, setActive] = useState(() => ({ type: "custom", value: categories[0]?.apiString }));
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT);
  const requestedPageRef = useRef(0);

  const itemKey = active.value;
  const mediaState = useAppSelector((state) => state.discover[mediaType]);
  const pageState = mediaState ? mediaState[itemKey] : undefined;

  const [getByGenreId] = useLazyGetVideosByMediaTypeAndGenreIdQuery();
  const [getByCustom] = useLazyGetVideosByMediaTypeAndCustomGenreQuery();

  const handleNext = useCallback(
    (page: number) => {
      if (!page || requestedPageRef.current === page) return;
      requestedPageRef.current = page;
      const request = active.type === "genre"
        ? getByGenreId({ mediaType, genreId: active.value, page })
        : getByCustom({ mediaType, apiString: active.value, page });
      Promise.resolve(request).catch(() => {
        if (requestedPageRef.current === page) requestedPageRef.current = 0;
      });
    },
    [active, getByGenreId, getByCustom, mediaType]
  );

  useEffect(() => {
    requestedPageRef.current = 0;
    setRenderLimit(INITIAL_RENDER_LIMIT);
  }, [mediaType, itemKey, active.type]);

  useEffect(() => {
    if (!mediaState || !pageState) {
      dispatch(initiateItem({ mediaType, itemKey }));
    }
  }, [mediaState, pageState, dispatch, mediaType, itemKey]);

  useEffect(() => {
    if (pageState && pageState.page === 0) {
      handleNext(1);
    } else if (pageState?.page && requestedPageRef.current <= pageState.page) {
      requestedPageRef.current = 0;
    }
  }, [pageState?.page, handleNext]);

  const results = pageState?.results ?? [];
  const candidateResults = useMemo(
    () => results.slice(0, Math.min(renderLimit, results.length)),
    [results, renderLimit]
  );
  const availableResults = useAvailableItems(candidateResults, mediaType);
  const artworkBatch = useArtworkBatch(availableResults, availableResults.length > 0);
  const visible = useMemo(
    () => availableResults
      .filter((item) => artworkBatch.isReady(item, "landscape"))
      .map((item) => {
        const raw = artworkBatch.byKey.get(artworkKey(item, mediaType));
        // Giving the validated batch result directly to the card means its asset
        // hook can render synchronously and skip a per-card viewport observer /
        // individual resolver request. Fallback-only items remain untouched.
        return raw?.active ? { ...item, __artwork: raw } : item;
      }),
    [availableResults, artworkBatch.data, mediaType]
  );

  const intersectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = intersectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (renderLimit < results.length) {
          setRenderLimit((current) => Math.min(results.length, current + RENDER_STEP));
          return;
        }
        if (pageState && pageState.page < pageState.total_pages) {
          handleNext(pageState.page + 1);
        }
      },
      { rootMargin: "900px 0px", threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [renderLimit, results.length, pageState?.page, pageState?.total_pages, handleNext]);

  const isActiveFilter = (type: string, value: any) => active.type === type && active.value === value;
  const chipSx = (selected: boolean) => ({
    bgcolor: selected ? "#E50914" : "rgba(255,255,255,0.08)",
    color: "#fff",
    fontWeight: 600,
    border: selected ? "1px solid #E50914" : "1px solid rgba(255,255,255,0.15)",
    transition: "background-color 0.2s ease, transform 0.2s ease",
    "&:hover": { bgcolor: selected ? "#B20710" : "rgba(255,255,255,0.16)", transform: "translateY(-1px)" },
  });

  const select = (type: string, value: any) => {
    if (isActiveFilter(type, value)) return;
    setActive({ type, value });
  };

  const waitingForArtwork = availableResults.length > 0 && artworkBatch.isPending && visible.length === 0;

  return (
    <Box data-testid="catalog-page" sx={{ minHeight: "100vh", bgcolor: "#050505", pt: `${APP_BAR_HEIGHT + 24}px`, pb: 6 }}>
      <Container maxWidth={false} sx={{ px: { xs: "20px", sm: "60px" } }}>
        <Typography component="h1" data-testid="catalog-title"
          sx={{ color: "#fff", fontWeight: 800, fontSize: { xs: "1.8rem", md: "2.6rem" }, letterSpacing: "-0.02em", mb: 2.5 }}>
          {title}
        </Typography>

        <Stack direction="row" spacing={1.2} sx={{ flexWrap: "wrap", gap: 1.2, mb: 4 }} data-testid="catalog-filters">
          {categories.map((c) => (
            <Chip key={c.apiString} label={c.name} onClick={() => select("custom", c.apiString)}
              data-testid={`filter-custom-${c.apiString}`} sx={chipSx(isActiveFilter("custom", c.apiString))} />
          ))}
          {genres.map((g) => (
            <Chip key={g.id} label={g.name} onClick={() => select("genre", g.id)}
              data-testid={`filter-genre-${g.id}`} sx={chipSx(isActiveFilter("genre", g.id))} />
          ))}
        </Stack>

        {!pageState || (pageState.page === 0 && availableResults.length === 0) || waitingForArtwork ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
            <CircularProgress sx={{ color: "#E50914" }} />
          </Box>
        ) : visible.length === 0 ? (
          <Typography data-testid="catalog-empty" sx={{ color: "rgba(255,255,255,0.6)", py: 8, textAlign: "center" }}>
            Nessun titolo con artwork completo disponibile per questo filtro.
          </Typography>
        ) : (
          <Grid container spacing={2} data-testid="catalog-grid">
            {visible.map((video, idx) => (
              <Grid
                key={`${video.id || video.tmdbId || video.tmdb_id}_${idx}`}
                item xs={6} sm={4} md={3} lg={2}
                sx={{
                  zIndex: 1,
                  contentVisibility: "auto",
                  containIntrinsicSize: "342px 192px",
                }}
              >
                <VideoItemWithHover video={video} mediaType={mediaType} />
              </Grid>
            ))}
          </Grid>
        )}
      </Container>
      <Box sx={{ height: 1 }} ref={intersectionRef} data-testid="catalog-sentinel" />
    </Box>
  );
}
