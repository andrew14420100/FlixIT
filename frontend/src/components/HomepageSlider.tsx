// @ts-nocheck
import { useState, useRef } from "react";
import Slider, { Settings } from "react-slick";
import { motion } from "framer-motion";
import { styled, Theme, useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import CustomNavigation from "./slick-slider/CustomNavigation";
import VideoItemWithHover from "src/components/VideoItemWithHover";
import { ARROW_MAX_WIDTH } from "src/constant";
import NetflixNavigationLink from "src/components/NetflixNavigationLink";
import MotionContainer from "src/components/animate/MotionContainer";
import { varFadeIn } from "src/components/animate/variants/fade/FadeIn";
import { MEDIA_TYPE } from "src/types/Common";

const RootStyle = styled("div")(() => ({
  position: "relative",
  overflow: "inherit",
}));

const StyledSlider = styled(Slider)(
  ({ theme, padding }: { theme: Theme; padding: number }) => ({
    display: "flex !important",
    justifyContent: "center",
    overflow: "initial !important",
    "& > .slick-list": {
      overflow: "visible",
    },
    "& .slick-slide": {
      transition: "z-index 0s 0.3s",
      position: "relative",
    },
    "& .slick-slide:hover": {
      zIndex: "999 !important",
      transition: "z-index 0s 0s",
    },
    [theme.breakpoints.up("sm")]: {
      "& > .slick-list": {
        width: `calc(100% - ${2 * padding}px)`,
      },
      "& .slick-list > .slick-track": {
        margin: "0px !important",
      },
      "& .slick-list > .slick-track > .slick-current > div > .NetflixBox-root > .NetflixPaper-root:hover":
        {
          transformOrigin: "0% 50% !important",
        },
    },
    [theme.breakpoints.down("sm")]: {
      "& > .slick-list": {
        width: `calc(100% - ${padding}px)`,
      },
    },
  })
);

interface HomepageSliderProps {
  title: string;
  items: any[];
  linkTo?: string;
}

export default function HomepageSlider({ title, items, linkTo }: HomepageSliderProps) {
  const sliderRef = useRef<Slider>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [showExplore, setShowExplore] = useState(false);
  const [isEnd, setIsEnd] = useState(false);
  const theme = useTheme();

  const beforeChange = async (currentIndex: number, nextIndex: number) => {
    if (currentIndex < nextIndex) {
      setActiveSlideIndex(nextIndex);
    } else if (currentIndex > nextIndex) {
      setIsEnd(false);
    }
    setActiveSlideIndex(nextIndex);
  };

  const settings: Settings = {
    speed: 500,
    arrows: false,
    infinite: false,
    lazyLoad: "ondemand",
    slidesToShow: 6,
    slidesToScroll: 6,
    beforeChange,
    responsive: [
      {
        breakpoint: 1536,
        settings: { slidesToShow: 5, slidesToScroll: 5 },
      },
      {
        breakpoint: 1200,
        settings: { slidesToShow: 4, slidesToScroll: 4 },
      },
      {
        breakpoint: 900,
        settings: { slidesToShow: 3, slidesToScroll: 3 },
      },
      {
        breakpoint: 600,
        settings: { slidesToShow: 2, slidesToScroll: 2 },
      },
    ],
  };

  const handlePrevious = () => sliderRef.current?.slickPrev();
  const handleNext = () => sliderRef.current?.slickNext();

  if (!items || items.length === 0) return null;

  return (
    <Box sx={{ overflow: "visible", height: "100%", zIndex: 1, position: "relative", "&:hover": { zIndex: 20 } }} data-testid={`homepage-slider-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <Stack
        spacing={2}
        direction="row"
        alignItems="center"
        className="row-title"
        sx={{ mb: 2 }}
      >
        <NetflixNavigationLink
          variant="h5"
          to={linkTo || "#"}
          sx={{
            display: "inline-block",
            fontWeight: 700,
          }}
          onMouseOver={() => setShowExplore(true)}
          onMouseLeave={() => setShowExplore(false)}
        >
          {title}
          {linkTo && (
            <MotionContainer
              open={showExplore}
              initial="initial"
              sx={{ display: "inline", color: "success.main", ml: 1 }}
            >
              {"Sfoglia tutti".split("").map((letter, index) => (
                <motion.span key={index} variants={varFadeIn}>
                  {letter}
                </motion.span>
              ))}
            </MotionContainer>
          )}
        </NetflixNavigationLink>
      </Stack>

      <RootStyle>
        <CustomNavigation
          isEnd={isEnd}
          arrowWidth={ARROW_MAX_WIDTH}
          onNext={handleNext}
          onPrevious={handlePrevious}
          activeSlideIndex={activeSlideIndex}
        >
          <StyledSlider
            ref={sliderRef}
            {...settings}
            padding={ARROW_MAX_WIDTH}
            theme={theme}
          >
            {items
              .filter((i) => !!i.backdrop_path || !!i.poster_path)
              .map((item) => (
                <Box key={item.id || item.tmdbId} sx={{ px: 0.25 }}>
                  <VideoItemWithHover
                    video={{
                      ...item,
                      id: item.id || item.tmdbId,
                      title: item.title || item.name,
                      name: item.title || item.name,
                      genre_ids: item.genre_ids || [],
                    }}
                    mediaType={item.type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie}
                    watch={item.watch}
                  />
                </Box>
              ))}
          </StyledSlider>
        </CustomNavigation>
      </RootStyle>
    </Box>
  );
}
