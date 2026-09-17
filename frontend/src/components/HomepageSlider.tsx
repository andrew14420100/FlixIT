// @ts-nocheck
import { useMemo, useRef, useState } from "react";
import Slider, { Settings } from "react-slick";
import { styled, Theme, useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import CustomNavigation from "./slick-slider/CustomNavigation";
import VideoItemWithHover from "src/components/VideoItemWithHover";
import { ARROW_MAX_WIDTH } from "src/constant";
import NetflixNavigationLink from "src/components/NetflixNavigationLink";
import { MEDIA_TYPE } from "src/types/Common";

const RootStyle = styled("div")(() => ({
  position: "relative",
  overflow: "visible",
}));

const StyledSlider = styled(Slider)(
  ({ theme }: { theme: Theme }) => ({
    display: "flex !important",
    justifyContent: "flex-start",
    overflow: "visible !important",

    "& > .slick-list": {
      width: "100%",
      overflow: "visible",
    },
    "& .slick-track": {
      marginLeft: "0 !important",
      marginRight: "0 !important",
    },
    "& .slick-slide": {
      position: "relative",
      zIndex: 1,
      transition: "z-index 0s .28s",
    },
    "& .slick-slide:hover": {
      zIndex: "10000 !important",
      transition: "z-index 0s 0s",
    },
    "& .slick-slide:hover > div": {
      position: "relative",
      zIndex: "10000",
    },
    "& .slick-slide > div": {
      height: "100%",
    },

    [theme.breakpoints.up("sm")]: {
      "& .slick-current > div > .NetflixBox-root > .NetflixPaper-root:hover": {
        transformOrigin: "0% 50% !important",
      },
    },
  })
);

interface HomepageSliderProps {
  title: string;
  items: any[];
  linkTo?: string;
}

export default function HomepageSlider({
  title,
  items,
  linkTo,
}: HomepageSliderProps) {
  const sliderRef = useRef<Slider>(null);
  const theme = useTheme();

  const up1400 = useMediaQuery("(min-width:1400px)");
  const up1100 = useMediaQuery("(min-width:1100px)");
  const up800 = useMediaQuery("(min-width:800px)");
  const up500 = useMediaQuery("(min-width:500px)");

  // StreamingUnity's source works with an integer tile count and computes
  // pages/translation from that count. The fractional visible value below
  // intentionally exposes the next card ("peek") like the supplied desktop UI.
  const tiles = up1400 ? 6 : up1100 ? 5 : up800 ? 4 : up500 ? 3 : 2;
  const visibleTiles = up1400 ? 6.38 : up1100 ? 5.35 : tiles;

  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [showExplore, setShowExplore] = useState(false);

  const visibleItems = useMemo(
    () => (items || []).filter((i) => !!i.backdrop_path || !!i.poster_path),
    [items]
  );

  const pageCount = Math.max(1, Math.ceil(visibleItems.length / tiles));
  const activePage = Math.min(
    pageCount - 1,
    Math.floor(activeSlideIndex / Math.max(1, tiles))
  );
  const isEnd =
    visibleItems.length <= tiles ||
    activeSlideIndex >= Math.max(0, visibleItems.length - tiles);

  const settings: Settings = {
    speed: 750,
    cssEase: "cubic-bezier(.5,0,.1,1)",
    arrows: false,
    dots: false,
    infinite: false,
    lazyLoad: "ondemand",
    swipeToSlide: true,
    slidesToShow: visibleTiles,
    slidesToScroll: tiles,
    beforeChange: (_current, next) => setActiveSlideIndex(next),
    responsive: [
      { breakpoint: 1400, settings: { slidesToShow: 5.35, slidesToScroll: 5 } },
      { breakpoint: 1100, settings: { slidesToShow: 4.25, slidesToScroll: 4 } },
      { breakpoint: 800, settings: { slidesToShow: 3, slidesToScroll: 3 } },
      { breakpoint: 500, settings: { slidesToShow: 2, slidesToScroll: 2 } },
    ],
  };

  if (!visibleItems.length) return null;

  return (
    <Box
      className="slider-row"
      data-testid={`homepage-slider-${title.toLowerCase().replace(/\s+/g, "-")}`}
      sx={{
        // Misure reali rilevate dal computed style di StreamingUnity
        position: "relative",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: "100%",
        height: { xs: "auto", md: "237.241px" },
        mt: { xs: "32px", md: "57.3007px" },
        mb: { xs: "32px", md: "57.3007px" },
        boxSizing: "border-box",
        userSelect: "none",
        overflow: "visible",
        zIndex: 1,
        fontFamily: '"Netflix Sans","Helvetica Neue",Helvetica,Arial,sans-serif',
        fontSize: { md: "19.1002px" },
        lineHeight: { md: "28.6503px" },
        color: "#e8e8e8",
        "&:hover": { zIndex: 100 },
      }}
    >
      {/* SC: row-header > header-wrap > label + browse */}
      <Box
        className="row-header"
        sx={{
          position: "relative",
          zIndex: 2,
          pl: { xs: 2, sm: 3, md: "4%" },
          pr: { xs: 2, sm: 3, md: "4%" },
          mb: { xs: "7px", md: "10px" },
          minHeight: { xs: 25, md: 34 },
          display: "flex",
          alignItems: "center",
        }}
      >
        <NetflixNavigationLink
          to={linkTo || "#"}
          sx={{
            color: "#fff",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
          onMouseEnter={() => setShowExplore(true)}
          onMouseLeave={() => setShowExplore(false)}
        >
          <Box
            className="header-wrap"
            sx={{ display: "inline-flex", alignItems: "baseline", whiteSpace: "nowrap" }}
          >
            <Box
              className="label"
              sx={{
                fontFamily: '"Netflix Sans","Helvetica Neue",Helvetica,Arial,sans-serif',
                fontWeight: 700,
                fontSize: { xs: "18px", sm: "22px", md: "27px" },
                lineHeight: 1.18,
                letterSpacing: "-0.018em",
                textShadow: "0 1px 2px rgba(0,0,0,.35)",
              }}
            >
              {title}
            </Box>

            {linkTo && (
              <Box
                className="browse"
                sx={{
                  ml: "9px",
                  overflow: "hidden",
                  opacity: showExplore ? 1 : 0,
                  maxWidth: showExplore ? "150px" : "18px",
                  transform: showExplore ? "translateX(0)" : "translateX(-8px)",
                  transition:
                    "opacity .22s ease, max-width .28s ease, transform .28s ease",
                  color: "#54b9c5",
                  fontSize: { xs: "12px", md: "14px" },
                  fontWeight: 700,
                }}
              >
                <Box
                  className="browse-container"
                  sx={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                >
                  <span>Sfoglia tutti</span>
                  <Box component="span" sx={{ fontSize: "1.45em", lineHeight: 0.8 }}>
                    ›
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </NetflixNavigationLink>

        {/* SC-style page indicator: visible when the row has more than one page */}
        {pageCount > 1 && (
          <Box
            className="tab-indicator"
            sx={{
              ml: "auto",
              display: { xs: "none", md: "flex" },
              gap: "2px",
              alignItems: "center",
              opacity: 0.9,
            }}
          >
            {Array.from({ length: pageCount }).map((_, index) => (
              <Box
                key={index}
                sx={{
                  width: "12px",
                  height: "2px",
                  bgcolor:
                    index === activePage
                      ? "rgba(255,255,255,.95)"
                      : "rgba(255,255,255,.28)",
                  transition: "background-color .2s ease",
                }}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* SC: slider > show-peek > slider-content > slider-item */}
      <Box className="slider" sx={{ position: "relative", zIndex: 3, width: "100%", overflow: "visible" }}>
        <Box
          className="show-peek"
          sx={{
            width: "100%",
            pl: { xs: 2, sm: 3, md: "4%" },
            pr: 0,
            boxSizing: "border-box",
            overflow: "visible",
          }}
        >
          <RootStyle className="slider-content">
            <CustomNavigation
              isEnd={isEnd}
              arrowWidth={ARROW_MAX_WIDTH}
              onNext={() => sliderRef.current?.slickNext()}
              onPrevious={() => sliderRef.current?.slickPrev()}
              activeSlideIndex={activeSlideIndex}
            >
              <StyledSlider ref={sliderRef} {...settings} theme={theme}>
                {visibleItems.map((item) => (
                  <Box
                    className="slider-item"
                    key={item.id || item.tmdbId}
                    sx={{
                      px: { xs: "2px", sm: "3px", md: "3.82005px" },
                      boxSizing: "border-box",
                      "&:first-of-type": { pl: 0 },
                      position: "relative",
                    }}
                  >
                    <VideoItemWithHover
                      video={{
                        ...item,
                        id: item.id || item.tmdbId,
                        title: item.title || item.name,
                        name: item.title || item.name,
                        genre_ids: item.genre_ids || [],
                      }}
                      mediaType={
                        item.type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie
                      }
                      watch={item.watch}
                    />
                  </Box>
                ))}
              </StyledSlider>
            </CustomNavigation>
          </RootStyle>
        </Box>
      </Box>
    </Box>
  );
}
