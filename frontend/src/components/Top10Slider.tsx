// @ts-nocheck
import { useMemo, useRef, useState } from "react";
import Slider from "react-slick";
import { styled, useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
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
    "& .slick-list > .slick-track": { margin: "0 !important" },
  },
  [theme.breakpoints.down("sm")]: {
    "& > .slick-list": { width: `calc(100% - ${padding}px)` },
  },
}));

export default function Top10Slider({ title, items }) {
  const sliderRef = useRef<Slider>(null);
  const theme = useTheme();
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isSliding, setIsSliding] = useState(false);

  const up1536 = useMediaQuery("(min-width:1536px)");
  const up1200 = useMediaQuery("(min-width:1200px)");
  const up900 = useMediaQuery("(min-width:900px)");
  const up600 = useMediaQuery("(min-width:600px)");
  const tiles = up1536 ? 6 : up1200 ? 5 : up900 ? 4 : up600 ? 3 : 2;

  const list = useMemo(() => (items || []).slice(0, 10), [items]);
  const artworkBatch = useArtworkBatch(list, list.length > 0);
  const published = useMemo(
    () => list.filter((item) => artworkBatch.isReady(item, "poster")),
    [list, artworkBatch.data]
  );

  if (!list.length) return null;

  const isEnd =
    published.length <= tiles ||
    activeSlideIndex >= Math.max(0, published.length - tiles);

  const settings = {
    speed: 750,
    cssEase: "cubic-bezier(.5,0,.1,1)",
    arrows: false,
    dots: false,
    infinite: false,
    swipe: true,
    swipeToSlide: true,
    draggable: true,
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
      data-testid="top10-slider"
      className="slider-row top10-row"
      data-sliding={isSliding ? "true" : "false"}
      sx={{
        position: "relative",
        zIndex: 1,
        fontSize: "1vw",
        lineHeight: 1.5,
        contain: "layout style",
        "&:hover": { zIndex: 100 },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        className="row-header"
        sx={{ mx: "4%", mb: "0.7em" }}
      >
        <Typography
          className="label"
          sx={{
            fontWeight: 700,
            color: "#e8e8e8",
            fontSize: "1.4em",
            lineHeight: 1.5,
          }}
        >
          {title}
        </Typography>
        <ChevronRightIcon sx={{ color: "rgba(255,255,255,0.6)", ml: 0.5 }} />
      </Stack>

      <Box className="slider" sx={{ position: "relative", px: "4%", overflow: "visible" }}>
        <CustomNavigation
          isEnd={isEnd}
          arrowWidth={ARROW_MAX_WIDTH}
          onNext={() => sliderRef.current?.slickNext()}
          onPrevious={() => sliderRef.current?.slickPrev()}
          activeSlideIndex={activeSlideIndex}
        >
          <StyledSlider
            ref={sliderRef}
            {...settings}
            padding={ARROW_MAX_WIDTH}
            theme={theme}
          >
            {published.map((item) => {
              const id = item.id || item.tmdbId || item.tmdb_id;
              const mediaType =
                item.type === "tv" || item.media_type === "tv"
                  ? MEDIA_TYPE.Tv
                  : MEDIA_TYPE.Movie;
              const originalIndex = Math.max(0, list.indexOf(item));
              const suppressHover =
                isSliding || (activeSlideIndex > 0 && originalIndex === activeSlideIndex);

              return (
                <div key={`${item.type || item.media_type || "movie"}-${id}`}>
                  <NetflixRankedCardWithHover
                    item={{
                      ...item,
                      id,
                      title: item.title || item.name,
                      name: item.title || item.name,
                    }}
                    rank={originalIndex + 1}
                    mediaType={mediaType}
                    watch={item.watch}
                    suppressHover={suppressHover}
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
