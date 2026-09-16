// @ts-nocheck
import { useRef, useState, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import Slider from "react-slick";
import { styled, useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CustomNavigation from "./slick-slider/CustomNavigation";
import { ARROW_MAX_WIDTH, MAIN_PATH } from "src/constant";
import { MEDIA_TYPE } from "src/types/Common";
import { useHoverExpand, ExpandOverlay } from "src/hooks/useHoverExpand";
import ExpandedCard, { TMDB_IMG } from "./ExpandedCard";

const EXPANDED_WIDTH = 440;

const StyledSlider = styled(Slider)(({ theme, padding }) => ({
  display: "flex !important",
  justifyContent: "center",
  overflow: "initial !important",
  "& > .slick-list": { overflow: "visible" },
  "& .slick-slide": { position: "relative", transition: "z-index 0s 0.3s" },
  "& .slick-slide:hover": { zIndex: "999 !important", transition: "z-index 0s 0s" },
  [theme.breakpoints.up("sm")]: {
    "& > .slick-list": { width: `calc(100% - ${2 * padding}px)` },
    "& .slick-list > .slick-track": { margin: "0px !important" },
  },
  [theme.breakpoints.down("sm")]: {
    "& > .slick-list": { width: `calc(100% - ${padding}px)` },
  },
}));

// Ranking number rendered as SVG and measured so its glyph box is EXACTLY as tall as the poster.
// StreamingCommunity look: condensed geometric digits, opaque dark-grey gradient fill, high-contrast light edge.
function RankNumber({ n }) {
  const textRef = useRef<SVGTextElement>(null);
  const [fit, setFit] = useState({ transform: "", width: n >= 10 ? 96 : 52 });

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBBox();
      if (!box.height) return;
      const scale = 100 / box.height;
      setFit({ transform: `translate(0 ${-box.y * scale}) scale(${scale})`, width: Math.ceil(box.width * scale) + 8 });
    };
    measure();
    if (document.fonts?.ready) document.fonts.ready.then(measure);
  }, [n]);

  const gradId = `top10-fill-${n}`;
  return (
    <svg
      viewBox={`0 0 ${fit.width} 100`}
      preserveAspectRatio="xMinYMid meet"
      style={{ display: "block", overflow: "visible", flex: "0 0 auto", height: "100%", width: "auto", aspectRatio: `${fit.width} / 100` }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a4a4f" />
          <stop offset="55%" stopColor="#2a2a2e" />
          <stop offset="100%" stopColor="#141416" />
        </linearGradient>
      </defs>
      <text
        ref={textRef}
        x="0"
        y="100"
        transform={fit.transform}
        fontFamily="'Bebas Neue', Impact, 'Arial Narrow', sans-serif"
        fontWeight="400"
        fontSize="100"
        fill={`url(#${gradId})`}
        stroke="rgba(255,255,255,0.92)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        paintOrder="stroke fill"
        style={{ letterSpacing: n >= 10 ? "-0.06em" : "0", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.85))" }}
      >
        {n}
      </text>
    </svg>
  );
}

function Top10Card({ item, index }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const mType = item.type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;
  const { open, entered, align, width, onEnter, onLeave } = useHoverExpand(ref, () => EXPANDED_WIDTH);
  const posterUrl = item.poster_path ? `${TMDB_IMG}w342${item.poster_path}` : null;

  const goPlay = (e) => { e?.stopPropagation(); window.scrollTo(0, 0); navigate(`/${MAIN_PATH.watch}/${item.type}/${item.tmdbId}`); };
  const goDetail = (e) => { e?.stopPropagation?.(); window.scrollTo(0, 0); navigate(`/${MAIN_PATH.browse}/${item.type}/${item.tmdbId}`); };

  return (
    <Box
      data-testid={`top10-item-${index + 1}`}
      sx={{ width: "100%", height: "var(--top10-h)", position: "relative", zIndex: open ? 100 : 1, px: 0.25 }}
    >
      {/* Number sits on a layer BEHIND the poster, slightly overlapped by it (StreamingCommunity-style) */}
      <Stack direction="row" alignItems="stretch" justifyContent="center" sx={{ height: "100%" }}>
        <Box data-testid={`top10-rank-${index + 1}`} sx={{ height: "100%", display: "flex", alignItems: "stretch", mr: { xs: "-22px", md: "-38px" }, position: "relative", zIndex: 1, transition: "transform 300ms ease, opacity 300ms ease", opacity: open ? 0.35 : 1, transform: open ? "translateX(-8px)" : "none" }}>
          <RankNumber n={index + 1} />
        </Box>
        <div
          ref={ref}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          style={{ position: "relative", height: "100%", aspectRatio: "2/3", zIndex: 2, cursor: "pointer", flex: "0 0 auto" }}
        >
          <Box
            onClick={goDetail}
            sx={{ width: "100%", height: "100%", borderRadius: "8px", overflow: "hidden", bgcolor: "#141414", boxShadow: "-14px 0 30px rgba(0,0,0,0.75), 0 8px 24px rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            {posterUrl && (
              <img src={posterUrl} alt={item.title} loading="lazy" draggable={false}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            )}
          </Box>

          {open && (
            <ExpandOverlay align={align} width={width} entered={entered} initialScale={0.6} fade testId={`hover-overlay-top10-${item.tmdbId}`}>
              <ExpandedCard item={{ ...item, id: item.tmdbId }} mediaType={mType} onPlay={goPlay} onDetail={goDetail} entered={entered} />
            </ExpandOverlay>
          )}
        </div>
      </Stack>
    </Box>
  );
}

export default function Top10Slider({ title, items }) {
  const sliderRef = useRef<Slider>(null);
  const theme = useTheme();
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isEnd, setIsEnd] = useState(false);
  const list = (items || []).slice(0, 10);
  if (!list.length) return null;

  const settings = {
    speed: 500, arrows: false, infinite: false, slidesToShow: 6, slidesToScroll: 6,
    afterChange: (i) => { setActiveSlideIndex(i); setIsEnd(i + 7 >= list.length); },
    responsive: [
      { breakpoint: 1536, settings: { slidesToShow: 5, slidesToScroll: 5 } },
      { breakpoint: 1200, settings: { slidesToShow: 4, slidesToScroll: 4 } },
      { breakpoint: 900, settings: { slidesToShow: 3, slidesToScroll: 3 } },
      { breakpoint: 600, settings: { slidesToShow: 2, slidesToScroll: 2 } },
    ],
  };

  return (
    <Box data-testid="top10-slider" sx={{ position: "relative", zIndex: 1, "&:hover": { zIndex: 20 } }}>
      <Stack direction="row" alignItems="center" className="row-title" sx={{ mb: 1.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: "#fff" }}>{title}</Typography>
        <ChevronRightIcon sx={{ color: "rgba(255,255,255,0.6)", ml: 0.5 }} />
      </Stack>
      <Box sx={{ position: "relative" }}>
        <CustomNavigation
          isEnd={isEnd}
          arrowWidth={ARROW_MAX_WIDTH}
          onNext={() => sliderRef.current?.slickNext()}
          onPrevious={() => sliderRef.current?.slickPrev()}
          activeSlideIndex={activeSlideIndex}
        >
          <StyledSlider ref={sliderRef} {...settings} padding={ARROW_MAX_WIDTH} theme={theme}>
            {list.map((item, i) => (
              <div key={item.tmdbId}>
                <Top10Card item={item} index={i} />
              </div>
            ))}
          </StyledSlider>
        </CustomNavigation>
      </Box>
    </Box>
  );
}
