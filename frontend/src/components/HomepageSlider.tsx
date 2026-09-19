// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Slider, { Settings } from "react-slick";
import { styled, Theme, useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import CustomNavigation from "./slick-slider/CustomNavigation";
import VideoItemWithHover from "src/components/VideoItemWithHover";
import NetflixRankedCardWithHover from "src/components/NetflixRankedCardWithHover";
import { ARROW_MAX_WIDTH } from "src/constant";
import NetflixNavigationLink from "src/components/NetflixNavigationLink";
import { MEDIA_TYPE } from "src/types/Common";
import useArtworkBatch from "src/hooks/useArtworkBatch";

const TARGET_ROW_ITEMS = 50;
const ARTWORK_CANDIDATE_LIMIT = 100;

const RootStyle = styled("div")(() => ({
  position: "relative",
  overflow: "visible",
}));

const StyledSlider = styled(Slider)(
  ({ theme }: { theme: Theme }) => ({
    display: "flex !important",
    justifyContent: "flex-start",
    overflow: "visible !important",
    transform: "translate3d(0,0,0)",

    "& > .slick-list": {
      width: "100%",
      overflow: "visible !important",
      transform: "translate3d(0,0,0)",
      backfaceVisibility: "hidden",
      WebkitBackfaceVisibility: "hidden",
    },
    "& .slick-track": {
      marginLeft: "0 !important",
      marginRight: "0 !important",
      willChange: "transform",
      backfaceVisibility: "hidden",
      WebkitBackfaceVisibility: "hidden",
    },
    "& .slick-slide": {
      position: "relative",
      zIndex: 1,
      transition: "z-index 0s .28s",
      backfaceVisibility: "hidden",
      WebkitBackfaceVisibility: "hidden",
    },
    "& .slick-slide:hover": {
      zIndex: "2 !important",
      transition: "z-index 0s 0s",
    },
    "& .slick-slide:hover > div": {
      position: "relative",
      zIndex: "2",
    },
    "& .slick-slide > div": {
      height: "100%",
    },
    [theme.breakpoints.up("sm")]: {},
  })
);

interface HomepageSliderProps {
  title: string;
  items: any[];
  linkTo?: string;
  compactSpacing?: boolean;
  rowId?: string;
}

function sliderItemKey(item: any) {
  const id = item?.tmdbId || item?.tmdb_id || item?.id;
  const type = item?.type === "tv" || item?.media_type === "tv" ? "tv" : "movie";
  return id ? `${type}-${id}` : "";
}

export default function HomepageSlider({
  title,
  items,
  linkTo,
  compactSpacing = false,
  rowId,
}: HomepageSliderProps) {
  const sliderRef = useRef<Slider>(null);
  const theme = useTheme();

  const up1400 = useMediaQuery("(min-width:1400px)");
  const up1100 = useMediaQuery("(min-width:1100px)");
  const up800 = useMediaQuery("(min-width:800px)");
  const up500 = useMediaQuery("(min-width:500px)");

  const tiles = up1400 ? 6 : up1100 ? 5 : up800 ? 4 : up500 ? 3 : 2;
  const visibleTiles = up1400 ? 6.38 : up1100 ? 5.35 : tiles;

  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const [showExplore, setShowExplore] = useState(false);

  const visibleItems = useMemo(() => {
    const seen = new Set();
    return (items || []).filter((item) => {
      if (!item) return false;
      const key = sliderItemKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [items]);

  const isTop10 = /top\s*10/i.test(title);

  // Resolve a much deeper candidate pool up-front. Previously only the first
  // ~14 candidates were checked for complete artwork, so a row could get stuck
  // at 4-5 published cards even when valid cards existed later in the source.
  const artworkCandidates = useMemo(
    () => visibleItems.slice(0, isTop10 ? 10 : ARTWORK_CANDIDATE_LIMIT),
    [visibleItems, isTop10]
  );
  const artworkBatch = useArtworkBatch(artworkCandidates, artworkCandidates.length > 0);
  const readyItems = useMemo(
    () =>
      artworkCandidates
        .filter((item) =>
          artworkBatch.isReady(item, isTop10 ? "poster" : "landscape")
        )
        .slice(0, isTop10 ? 10 : TARGET_ROW_ITEMS),
    [artworkCandidates, artworkBatch.data, isTop10]
  );

  // Mount only about two screens of card components at a time, while the
  // artwork for the whole row is already resolved in the background. This keeps
  // the Home responsive without making later pages wait for provider lookups.
  const minimumBatch = Math.min(readyItems.length, Math.max(tiles * 2 + 2, 14));
  const [renderedCount, setRenderedCount] = useState(minimumBatch);

  useEffect(() => {
    setRenderedCount((current) => {
      const bounded = Math.min(current || 0, readyItems.length);
      return Math.max(bounded, minimumBatch);
    });
  }, [readyItems.length, minimumBatch]);

  const ensureRenderedThrough = useCallback(
    (startIndex: number) => {
      setRenderedCount((current) =>
        Math.min(
          readyItems.length,
          Math.max(current, Math.max(minimumBatch, startIndex + tiles * 3))
        )
      );
    },
    [readyItems.length, minimumBatch, tiles]
  );

  const publishedItems = useMemo(
    () => readyItems.slice(0, renderedCount),
    [readyItems, renderedCount]
  );

  const pageCount = Math.max(1, Math.ceil(readyItems.length / tiles));
  const activePage = Math.min(
    pageCount - 1,
    Math.floor(activeSlideIndex / Math.max(1, tiles))
  );
  const isEnd =
    readyItems.length <= tiles ||
    activeSlideIndex >= Math.max(0, readyItems.length - tiles);

  const settings: Settings = {
    speed: 750,
    cssEase: "cubic-bezier(.5,0,.1,1)",
    arrows: false,
    dots: false,
    infinite: false,
    lazyLoad: "ondemand",
    swipeToSlide: true,
    swipe: true,
    draggable: true,
    touchMove: true,
    waitForAnimate: true,
    useCSS: true,
    useTransform: true,
    adaptiveHeight: false,
    slidesToShow: visibleTiles,
    slidesToScroll: tiles,
    beforeChange: (_current, next) => {
      ensureRenderedThrough(next);
      setIsSliding(true);
      setActiveSlideIndex(next);
    },
    afterChange: (current) => {
      setActiveSlideIndex(current);
      setIsSliding(false);
    },
    responsive: [
      { breakpoint: 1400, settings: { slidesToShow: 5.35, slidesToScroll: 5 } },
      { breakpoint: 1100, settings: { slidesToShow: 4.25, slidesToScroll: 4 } },
      { breakpoint: 800, settings: { slidesToShow: 3, slidesToScroll: 3 } },
      { breakpoint: 500, settings: { slidesToShow: 2, slidesToScroll: 2 } },
    ],
  };

  if (!visibleItems.length) return null;

  const handleNext = () => {
    ensureRenderedThrough(activeSlideIndex + tiles);
    window.setTimeout(() => sliderRef.current?.slickNext(), 0);
  };

  return (
    <Box
      id={rowId}
      className={`slider-row${isTop10 ? " top10-row" : ""}${compactSpacing ? " compact-row" : ""}`}
      data-testid={`homepage-slider-${title.toLowerCase().replace(/\s+/g, "-")}`}
      data-sliding={isSliding ? "true" : "false"}
      sx={{
        position: "relative",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: "100%",
        height: { xs: "auto", md: "237.241px" },
        mt: compactSpacing
          ? { xs: "10px", md: "16px" }
          : { xs: "32px", md: "57.3007px" },
        mb: compactSpacing
          ? { xs: "14px", md: "20px" }
          : { xs: "32px", md: "57.3007px" },
        boxSizing: "border-box",
        userSelect: "none",
        overflow: "visible",
        zIndex: 1,
        fontFamily: '"Netflix Sans","Helvetica Neue",Helvetica,Arial,sans-serif',
        fontSize: { md: "19.1002px" },
        lineHeight: { md: "28.6503px" },
        color: "#e8e8e8",
        contain: "layout style",
        "&:hover": { zIndex: 100 },
      }}
    >
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
              onNext={handleNext}
              onPrevious={() => sliderRef.current?.slickPrev()}
              activeSlideIndex={activeSlideIndex}
            >
              <StyledSlider ref={sliderRef} {...settings} theme={theme}>
                {publishedItems.map((item, index) => {
                  const key = sliderItemKey(item) || `item-${index}`;
                  const suppressHover = isSliding;
                  const originalRank = Math.max(1, readyItems.indexOf(item) + 1);

                  return (
                    <Box
                      className="slider-item"
                      key={key}
                      sx={{
                        px: { xs: "2px", sm: "3px", md: "3.82005px" },
                        boxSizing: "border-box",
                        position: "relative",
                      }}
                    >
                      {isTop10 ? (
                        <NetflixRankedCardWithHover
                          item={{
                            ...item,
                            id: item.id || item.tmdbId,
                            title: item.title || item.name,
                            name: item.title || item.name,
                          }}
                          rank={originalRank}
                          mediaType={
                            item.type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie
                          }
                          watch={item.watch}
                          suppressHover={suppressHover}
                        />
                      ) : (
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
                          suppressHover={suppressHover}
                        />
                      )}
                    </Box>
                  );
                })}
              </StyledSlider>
            </CustomNavigation>
          </RootStyle>
        </Box>
      </Box>
    </Box>
  );
}
