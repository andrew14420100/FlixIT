// @ts-nocheck
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Slider, { Settings } from "react-slick";
import { styled, Theme, useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import CustomNavigation from "./slick-slider/CustomNavigation";
import VideoItemWithHover from "src/components/VideoItemWithHover";
import NetflixNavigationLink from "src/components/NetflixNavigationLink";
import { ARROW_MAX_WIDTH } from "src/constant";
import { MEDIA_TYPE } from "src/types/Common";
import useArtworkBatch from "src/hooks/useArtworkBatch";

const TARGET_ROW_ITEMS = 50;

const RootStyle = styled("div")(() => ({
  position: "relative",
  overflow: "visible",
}));

const StyledSlider = styled(Slider)(({ theme }: { theme: Theme }) => ({
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
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  },
  "& .slick-slide:hover": { zIndex: "2 !important" },
  "& .slick-slide > div": { height: "100%" },
  [theme.breakpoints.down("md")]: {
    "& .slick-list": { touchAction: "pan-y pinch-zoom" },
  },
}));

interface HomepageSliderProps {
  title: string;
  items: any[];
  linkTo?: string;
  compactSpacing?: boolean;
  rowId?: string;
}

function itemKey(item: any) {
  const id = item?.tmdbId || item?.tmdb_id || item?.id;
  if (!id) return "";
  const type = item?.type === "tv" || item?.media_type === "tv" ? "tv" : "movie";
  return `${type}-${id}`;
}

function uniqueItems(items: any[]) {
  const seen = new Set<string>();
  return (items || []).filter((item) => {
    const key = itemKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function HomepageSlider({
  title,
  items,
  linkTo,
  compactSpacing = false,
  rowId,
}: HomepageSliderProps) {
  const sliderRef = useRef<Slider>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery("(max-width:899px)");
  const up1400 = useMediaQuery("(min-width:1400px)");
  const up1100 = useMediaQuery("(min-width:1100px)");
  const up900 = useMediaQuery("(min-width:900px)");
  const up600 = useMediaQuery("(min-width:600px)");

  const tiles = up1400 ? 6 : up1100 ? 5 : up900 ? 4 : up600 ? 3 : 2;
  const visibleTiles = isMobile
    ? 2.6
    : up1400 ? 6.31 : up1100 ? 5.35 : up900 ? 4.25 : 3;
  const scrollTiles = isMobile ? 1 : tiles;

  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const [showExplore, setShowExplore] = useState(false);

  const visibleItems = useMemo(() => uniqueItems(items).slice(0, TARGET_ROW_ITEMS), [items]);
  const artworkBatch = useArtworkBatch(visibleItems, visibleItems.length > 0);
  const readyItems = useMemo(
    () => visibleItems.filter((item) => artworkBatch.isReady(item, isMobile ? "poster" : "landscape")),
    [visibleItems, artworkBatch.data, isMobile]
  );

  // Mount only a few pages of cards at first. A 20-row Home previously mounted
  // hundreds of hover hooks, IntersectionObservers and media resolvers during a
  // refresh even though most cards were far off-screen. Grow the rail before the
  // user reaches its mounted tail, so navigation remains visually unchanged.
  const initialRenderCount = useMemo(
    () => Math.min(TARGET_ROW_ITEMS, Math.max(isMobile ? 12 : 18, Math.ceil(visibleTiles * 3))),
    [isMobile, visibleTiles]
  );
  const [renderLimit, setRenderLimit] = useState(initialRenderCount);

  useEffect(() => {
    setRenderLimit(initialRenderCount);
    setActiveSlideIndex(0);
  }, [rowId, title, initialRenderCount, visibleItems[0]?.id, visibleItems[0]?.tmdbId]);

  useEffect(() => {
    if (readyItems.length && renderLimit < Math.min(initialRenderCount, readyItems.length)) {
      setRenderLimit(Math.min(initialRenderCount, readyItems.length));
    }
  }, [readyItems.length, initialRenderCount, renderLimit]);

  const renderedItems = useMemo(
    () => readyItems.slice(0, Math.min(renderLimit, readyItems.length)),
    [readyItems, renderLimit]
  );

  const growRailIfNeeded = useCallback((index: number) => {
    if (renderLimit >= readyItems.length) return;
    const buffer = Math.max(4, Math.ceil(visibleTiles * 2));
    if (index < renderLimit - buffer) return;
    const chunk = Math.max(8, Math.ceil(visibleTiles * 3));
    setRenderLimit((current) => Math.min(readyItems.length, current + chunk));
  }, [renderLimit, readyItems.length, visibleTiles]);

  const syncRowAxis = useCallback(() => {
    const row = rowRef.current;
    if (!row || typeof window === "undefined") return;

    const firstCard = (
      row.querySelector(".slick-slide.slick-active .netflix-standard-card-root") ||
      row.querySelector(".netflix-standard-card-root")
    ) as HTMLElement | null;
    if (!firstCard) return;

    const rowRect = row.getBoundingClientRect();
    const cardRect = firstCard.getBoundingClientRect();
    const axis = Math.max(0, Math.round((cardRect.left - rowRect.left) * 100) / 100);
    row.style.setProperty("--flix-row-axis", `${axis}px`);
  }, []);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || !renderedItems.length || typeof window === "undefined") return;

    let frame = window.requestAnimationFrame(syncRowAxis);
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncRowAxis);
    };

    window.addEventListener("resize", schedule, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(row);

    const firstCard = (
      row.querySelector(".slick-slide.slick-active .netflix-standard-card-root") ||
      row.querySelector(".netflix-standard-card-root")
    ) as HTMLElement | null;
    if (firstCard) observer?.observe(firstCard);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [syncRowAxis, renderedItems.length, activeSlideIndex, isMobile, visibleTiles]);

  const pageCount = Math.max(1, Math.ceil(readyItems.length / Math.max(1, scrollTiles)));
  const activePage = Math.min(pageCount - 1, Math.floor(activeSlideIndex / Math.max(1, scrollTiles)));
  const isEnd =
    readyItems.length <= visibleTiles ||
    activeSlideIndex >= Math.max(0, readyItems.length - Math.ceil(visibleTiles));

  const settings: Settings = {
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
    useTransform: !isMobile,
    adaptiveHeight: false,
    lazyLoad: isMobile ? undefined : "ondemand",
    slidesToShow: visibleTiles,
    slidesToScroll: scrollTiles,
    beforeChange: (_current, next) => {
      growRailIfNeeded(next);
      setIsSliding(true);
      setActiveSlideIndex(next);
    },
    afterChange: (current) => {
      growRailIfNeeded(current);
      setActiveSlideIndex(current);
      setIsSliding(false);
    },
  };

  const handleNext = useCallback(() => {
    growRailIfNeeded(activeSlideIndex + scrollTiles);
    sliderRef.current?.slickNext();
  }, [growRailIfNeeded, activeSlideIndex, scrollTiles]);
  const handlePrevious = useCallback(() => sliderRef.current?.slickPrev(), []);

  if (!visibleItems.length) return null;

  const waitingForFirstCards = readyItems.length === 0 && artworkBatch.isFetching;

  return (
    <Box
      ref={rowRef}
      id={rowId}
      className={`slider-row${compactSpacing ? " compact-row" : ""}`}
      data-testid={`homepage-slider-${title.toLowerCase().replace(/\s+/g, "-")}`}
      data-sliding={isSliding ? "true" : "false"}
      sx={{
        position: "relative",
        width: "100%",
        boxSizing: "border-box",
        userSelect: "none",
        overflow: "visible",
        zIndex: 1,
        fontFamily: '\"Netflix Sans\",\"Helvetica Neue\",Helvetica,Arial,sans-serif',
        color: "#e8e8e8",
      }}
    >
      <Box
        className="row-header"
        sx={{
          position: "relative",
          zIndex: 2,
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
          <Box className="header-wrap" sx={{ display: "inline-flex", alignItems: "baseline", whiteSpace: "nowrap" }}>
            <Box className="label">{title}</Box>
            {linkTo ? (
              <Box
                className="browse"
                sx={{
                  ml: "8px",
                  overflow: "hidden",
                  opacity: showExplore ? 1 : 0,
                  maxWidth: showExplore ? "150px" : "0px",
                  transform: showExplore ? "translateX(0)" : "translateX(-6px)",
                  transition: "opacity .2s ease, max-width .25s ease, transform .25s ease",
                  color: "#54b9c5",
                  fontSize: "13px",
                  fontWeight: 700,
                }}
              >
                Sfoglia tutti ›
              </Box>
            ) : null}
          </Box>
        </NetflixNavigationLink>

        {pageCount > 1 ? (
          <Box
            className="tab-indicator"
            sx={{
              ml: "auto",
              display: { xs: "none", md: "flex" },
              gap: "2px",
              alignItems: "center",
              opacity: .9,
            }}
          >
            {Array.from({ length: pageCount }).map((_, index) => (
              <Box
                key={index}
                sx={{
                  width: "12px",
                  height: "2px",
                  bgcolor: index === activePage ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.28)",
                }}
              />
            ))}
          </Box>
        ) : null}
      </Box>

      <Box className="slider" sx={{ position: "relative", zIndex: 3, width: "100%", overflow: "visible" }}>
        <Box className="show-peek" sx={{ width: "100%", pr: 0, boxSizing: "border-box", overflow: "visible" }}>
          {waitingForFirstCards ? (
            <Box sx={{ display: "flex", gap: { xs: "4px", md: "7px" }, overflow: "hidden", width: "100%" }}>
              {Array.from({ length: Math.ceil(visibleTiles) + 1 }).map((_, index) => (
                <Box
                  key={index}
                  sx={{
                    flex: `0 0 ${100 / visibleTiles}%`,
                    maxWidth: `calc(${100 / visibleTiles}% - 4px)`,
                    aspectRatio: isMobile ? "2 / 3" : "342 / 192",
                    borderRadius: { xs: "5px", md: "4px" },
                    bgcolor: "#222",
                    opacity: .72,
                    animation: "flixPulse 1.15s ease-in-out infinite",
                  }}
                />
              ))}
            </Box>
          ) : (
            <RootStyle className="slider-content">
              <CustomNavigation
                isEnd={isEnd}
                arrowWidth={ARROW_MAX_WIDTH}
                onNext={handleNext}
                onPrevious={handlePrevious}
                activeSlideIndex={activeSlideIndex}
              >
                <StyledSlider ref={sliderRef} {...settings} theme={theme}>
                  {renderedItems.map((item, index) => {
                    const id = item?.id || item?.tmdbId || item?.tmdb_id;
                    const mediaType = item?.type === "tv" || item?.media_type === "tv"
                      ? MEDIA_TYPE.Tv
                      : MEDIA_TYPE.Movie;
                    return (
                      <Box
                        className="slider-item"
                        key={itemKey(item) || `item-${index}`}
                        sx={{
                          px: { xs: "2px", md: "3.5px" },
                          boxSizing: "border-box",
                          position: "relative",
                        }}
                      >
                        <VideoItemWithHover
                          video={{
                            ...item,
                            id,
                            title: item?.title || item?.name,
                            name: item?.title || item?.name,
                            genre_ids: item?.genre_ids || [],
                          }}
                          mediaType={mediaType}
                          watch={item?.watch}
                          suppressHover={isSliding}
                        />
                      </Box>
                    );
                  })}
                </StyledSlider>
              </CustomNavigation>
            </RootStyle>
          )}
        </Box>
      </Box>
    </Box>
  );
}
