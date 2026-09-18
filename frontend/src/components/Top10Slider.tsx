// @ts-nocheck
import { useRef, useState } from "react";
import Slider from "react-slick";
import { styled, useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CustomNavigation from "./slick-slider/CustomNavigation";
import { ARROW_MAX_WIDTH } from "src/constant";
import { MEDIA_TYPE } from "src/types/Common";
import NetflixRankedCardWithHover from "./NetflixRankedCardWithHover";

const StyledSlider = styled(Slider)(({ theme, padding }) => ({
  display: "flex !important",
  justifyContent: "center",
  overflow: "visible !important",

  "& > .slick-list": {
    overflow: "visible",
  },

  "& .slick-slide": {
    position: "relative",
    zIndex: 1,
  },

  "& .slick-slide > div": {
    height: "100%",
  },

  [theme.breakpoints.up("sm")]: {
    "& > .slick-list": {
      width: `calc(100% - ${2 * padding}px)`,
    },
    "& .slick-list > .slick-track": {
      margin: "0 !important",
    },
  },

  [theme.breakpoints.down("sm")]: {
    "& > .slick-list": {
      width: `calc(100% - ${padding}px)`,
    },
  },
}));

export default function Top10Slider({ title, items }) {
  const sliderRef = useRef<Slider>(null);
  const theme = useTheme();
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isEnd, setIsEnd] = useState(false);

  const list = (items || []).slice(0, 10);
  if (!list.length) return null;

  const settings = {
    speed: 500,
    arrows: false,
    dots: false,
    infinite: false,
    slidesToShow: 6,
    slidesToScroll: 6,
    afterChange: (index) => {
      setActiveSlideIndex(index);
      setIsEnd(index + 7 >= list.length);
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
      sx={{
        position: "relative",
        zIndex: 1,
        fontSize: "1vw",
        lineHeight: 1.5,
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

        <ChevronRightIcon
          sx={{
            color: "rgba(255,255,255,0.6)",
            ml: 0.5,
          }}
        />
      </Stack>

      <Box
        className="slider"
        sx={{
          position: "relative",
          px: "4%",
          overflow: "visible",
        }}
      >
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
            {list.map((item, index) => {
              const id = item.id || item.tmdbId || item.tmdb_id;
              const mediaType =
                item.type === "tv" || item.media_type === "tv"
                  ? MEDIA_TYPE.Tv
                  : MEDIA_TYPE.Movie;

              return (
                <div key={id}>
                  <NetflixRankedCardWithHover
                    item={{
                      ...item,
                      id,
                      title: item.title || item.name,
                      name: item.title || item.name,
                    }}
                    rank={index + 1}
                    mediaType={mediaType}
                    watch={item.watch}
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
