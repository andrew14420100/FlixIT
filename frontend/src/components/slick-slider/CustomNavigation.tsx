// @ts-nocheck
import { styled } from "@mui/material/styles";
import Box from "@mui/material/Box";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import { MouseEventHandler, ReactNode } from "react";

const ArrowStyle = styled(Box)(({ theme }) => ({
  top: 0,
  bottom: 0,
  position: "absolute",
  zIndex: 50,
  height: "100%",
  opacity: 0,
  display: "flex",
  cursor: "pointer",
  alignItems: "center",
  justifyContent: "center",
  color: theme.palette.common.white,
  background: "rgba(20,20,20,.52)",
  transition: "opacity 180ms ease, background-color 180ms ease",
  pointerEvents: "auto",
  userSelect: "none",
  WebkitTapHighlightColor: "transparent",

  ".slider-row:hover &": {
    opacity: 1,
  },

  "& svg": {
    fontSize: "clamp(25px, 2.25vw, 42px)",
    filter: "drop-shadow(0 1px 2px rgba(0,0,0,.65))",
    transform: "scale(1)",
    transition: "transform 180ms cubic-bezier(.5,0,.1,1)",
  },

  "&:hover": {
    opacity: "1 !important",
    background: "rgba(20,20,20,.72)",
  },

  "&:hover svg": {
    transform: "scale(1.22)",
  },

  [theme.breakpoints.down("sm")]: {
    display: "none",
  },
}));

interface CustomNaviationProps {
  isEnd: boolean;
  arrowWidth: number;
  children: ReactNode;
  activeSlideIndex: number;
  onNext: MouseEventHandler<HTMLDivElement>;
  onPrevious: MouseEventHandler<HTMLDivElement>;
}

export default function CustomNavigation({
  isEnd,
  onNext,
  children,
  onPrevious,
  arrowWidth,
  activeSlideIndex,
}: CustomNaviationProps) {
  const stopMouseDown = (event: any) => {
    // Prevent a navigation handle press from becoming a drag/click on the card
    // underneath it. This mirrors Netflix's edge-handle interaction.
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <>
      {activeSlideIndex > 0 && (
        <ArrowStyle
          data-testid="carousel-previous"
          data-navigation-handle="previous"
          onMouseDown={stopMouseDown}
          onClick={onPrevious}
          sx={{
            left: 0,
            width: { xs: arrowWidth / 2, sm: `clamp(42px, 4vw, ${Math.max(56, arrowWidth)}px)` },
            borderRadius: "0 4px 4px 0",
          }}
        >
          <ArrowBackIosNewIcon />
        </ArrowStyle>
      )}

      {children}

      {!isEnd && (
        <ArrowStyle
          data-testid="carousel-next"
          data-navigation-handle="next"
          onMouseDown={stopMouseDown}
          onClick={onNext}
          sx={{
            right: 0,
            width: { xs: arrowWidth / 2, sm: `clamp(42px, 4vw, ${Math.max(56, arrowWidth)}px)` },
            borderRadius: "4px 0 0 4px",
          }}
        >
          <ArrowForwardIosIcon />
        </ArrowStyle>
      )}
    </>
  );
}
