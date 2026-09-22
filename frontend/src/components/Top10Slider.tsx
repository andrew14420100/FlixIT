// @ts-nocheck
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import Slider from "react-slick";
import { styled, useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CustomNavigation from "./slick-slider/CustomNavigation";
import { ARROW_MAX_WIDTH } from "src/constant";
import { MEDIA_TYPE } from "src/types/Common";
import NetflixRankedCardWithHover from "./NetflixRankedCardWithHover";
import useArtworkBatch from "src/hooks/useArtworkBatch";

const StyledSlider = styled(Slider)(({ theme, padding }) => ({
  display: "flex !important",
  justifyContent: "center",
  overflow: "visible !important",
  transform: "translate3d(0,0,0)",
  "& > .slick-list": {
    overflow: "visible",
    transform: "translate3d(0,0,0)",
    backfaceVisibility: "hidden",
  },
  "& .slick-track": {
    marginLeft: "0 !important",
    marginRight: "0 !important",
    willChange: "transform",
    backfaceVisibility: "hidden",
  },
  "& .slick-slide": {
    position: "relative",
    zIndex: 1,
    backfaceVisibility: "hidden",
  },
  "& .slick-slide > div": { height: "100%" },
  [theme.breakpoints.up("sm")]: {
    "& > .slick-list": { width: `calc(100% - ${2 * padding}px)` },
  },
  [theme.breakpoints.down("sm")]: {
    "& > .slick-list": { width: `calc(100% - ${padding}px)` },
  },
}));

function top10Key(item: any) {
  const id = item?.id || item?.tmdbId || item?.tmdb_id;
  if (!id) return "";
  const type = item?.type === "tv" || item?.media_type === "tv" ? "tv" : "movie";
  return `${type}-${id}`;
}

function tmdbPosterFallback(value: any) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(raw)) {
    return `https://image.tmdb.org/t/p/w780${raw}`;
  }
  return null;
}

export default function Top10Slider({ title, items }) {
  const sliderRef = useRef<Slider>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const theme = useTheme();
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isSliding, setIsSliding] = useState(false);

  const up1536 = useMediaQuery("(min-width:1536px)");
  const up1200 = useMediaQuery("(min-width:1200px)");
  const up900 = useMediaQuery("(min-width:900px)");
  const up600 = useMediaQuery("(min-width:600px)");
  const tiles = up1536 ? 6 : up1200 ? 5 : up900 ? 4 : up600 ? 3 : 2;

  const candidates = useMemo(() => {
    const seen = new Set<string>();
    return (items || [])
      .filter((item) => {
        const key = top10Key(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10);
  }, [items]);

  const artworkBatch = useArtworkBatch(candidates, candidates.length > 0);

  // Keep the original item intact. In particular, never overwrite poster_path:
  // it is the independent fallback if an SC CDN image fails in the browser.
  // The ranked tile always mounts so its number never vanishes with the image.
  const published = useMemo(
    () => candidates
      .map((item) => {
        const resolved = artworkBatch.getResolved(item);
        const scPoster =
          resolved?.poster_path ||
          resolved?.poster ||
          resolved?.poster_url ||
          item?.__artwork?.poster_url ||
          null;
        const fallbackPoster = tmdbPosterFallback(item?.poster_path || item?.poster);
        return {
          ...item,
          netflix_ranked_artwork_url: scPoster || fallbackPoster || undefined,
          __resolved_top10_poster: scPoster || null,
          __resolved_top10_fallback: fallbackPoster || null,
        };
      })
      .slice(0, 10),
    [candidates, artworkBatch.data]
  );

  const syncRowAxis = useCallback(() => {
    const row = rowRef.current;
    if (!row || typeof window === "undefined") return;

    const firstCard = (
      row.querySelector(".slick-slide.slick-active .netflix-ranked-card-root") ||
      row.querySelector(".netflix-ranked-card-root")
    ) as HTMLElement | null;
    if (!firstCard) return;

    const rowRect = row.getBoundingClientRect();
    const cardRect = firstCard.getBoundingClientRect();
    const axis = Math.max(0, Math.round((cardRect.left - rowRect.left) * 100) / 100);
    row.style.setProperty("--flix-row-axis", `${axis}px`);
  }, []);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || !published.length || typeof window === "undefined") return;

    let frame = window.requestAnimationFrame(syncRowAxis);
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncRowAxis);
    };

    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(row);

    const firstCard = (
      row.querySelector(".slick-slide.slick-active .netflix-ranked-card-root") ||
      row.querySelector(".netflix-ranked-card-root")
    ) as HTMLElement | null;
    if (firstCard) observer?.observe(firstCard);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [syncRowAxis, published.length, activeSlideIndex, tiles]);

  if (!candidates.length) return null;

  const isEnd =
    published.length <= tiles ||
    activeSlideIndex >= Math.max(0, published.length - tiles);

  const settings = {
    speed: 620,
    cssEase: "cubic-bezier(.21,0,.07,1)",
    arrows: false,
    dots: false,
    infinite: false,
    swipe: true,
    swipeToSlide: true,
    draggable: true,
    touchMove: true,
    waitForAnimate: true,
    useCSS: true,
    useTransform: true,
    slidesToShow: 6,
    slidesToScroll: 6,
    beforeChange: (_current, next) => {
      setIsSliding(true);
      setActiveSlideIndex(next);
    },
    afterChange: (index) => {
      setActiveSlideIndex(index);
      setIsSliding(false);
    },
    responsive: [
      { breakpoint: 1536, settings: { slidesToShow: 5, slidesToScroll: 5 } },
      { breakpoint: 1200, settings: { slidesToShow: 4, slidesToScroll: 4 } },
      { breakpoint: 900, settings: { slidesToShow: 3, slidesToScroll: 3 } },
      { breakpoint: 600, settings: { slidesToShow: 2, slidesToScroll: 2 } },
    ],
  };

  return (
    <Box
      ref={rowRef}
      data-testid="top10-slider"
      className="slider-row top10-row"
      data-sliding={isSliding ? "true" : "false"}
      sx={{
        position: "relative",
        zIndex: 1,
        fontSize: "1vw",
        lineHeight: 1.5,
        overflow: "visible",
        "&:hover": { zIndex: 100 },
      }}
    >
      <Stack direction="row" alignItems="center" className="row-header">
        <Typography className="label" sx={{ fontWeight: 700, color: "#e8e8e8" }}>
          {title}
        </Typography>
      </Stack>

      <Box className="slider" sx={{ position: "relative", overflow: "visible" }}>
        <CustomNavigation
          isEnd={isEnd}
          arrowWidth={ARROW_MAX_WIDTH}
          onNext={() => sliderRef.current?.slickNext()}
          onPrevious={() => sliderRef.current?.slickPrev()}
          activeSlideIndex={activeSlideIndex}
        >
          <StyledSlider ref={sliderRef} {...settings} padding={ARROW_MAX_WIDTH} theme={theme}>
            {published.map((item, publishedIndex) => {
              const id = item.id || item.tmdbId || item.tmdb_id;
              const mediaType =
                item.type === "tv" || item.media_type === "tv"
                  ? MEDIA_TYPE.Tv
                  : MEDIA_TYPE.Movie;

              return (
                <div key={`${item.type || item.media_type || "movie"}-${id}`}>
                  <NetflixRankedCardWithHover
                    item={{
                      ...item,
                      id,
                      title: item.title || item.name,
                      name: item.title || item.name,
                    }}
                    rank={publishedIndex + 1}
                    mediaType={mediaType}
                    watch={item.watch}
                    suppressHover={isSliding}
                  />
                </div>
              );
            })}
          </StyledSlider>
        </CustomNavigation>
      </Box>
    </Box>
  );
}
