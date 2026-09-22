// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import HorizontalCard from "./HorizontalCard";

interface Content {
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  vote_average?: number;
  genres?: Array<{ id: number; name: string }>;
  number_of_seasons?: number;
}

interface HorizontalSliderProps {
  title: string;
  contents: Content[];
  sectionId?: string;
}

export default function HorizontalSlider({ title, contents, sectionId }: HorizontalSliderProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  const [isHovering, setIsHovering] = useState(false);
  const [visibleEdges, setVisibleEdges] = useState({ first: 0, last: Math.max(0, contents.length - 1) });

  const syncRail = useCallback(() => {
    const slider = sliderRef.current;
    const row = rowRef.current;
    if (!slider || !row) return;

    const { scrollLeft, scrollWidth, clientWidth } = slider;
    setShowLeftArrow(scrollLeft > 10);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);

    const viewport = slider.getBoundingClientRect();
    const cards = Array.from(slider.querySelectorAll("[data-horizontal-card-index]")) as HTMLElement[];
    const visible = cards
      .map((node) => ({
        node,
        index: Number(node.dataset.horizontalCardIndex),
        rect: node.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.right > viewport.left + 2 && rect.left < viewport.right - 2)
      .sort((a, b) => a.rect.left - b.rect.left);

    if (visible.length) {
      setVisibleEdges({ first: visible[0].index, last: visible[visible.length - 1].index });
      const rowRect = row.getBoundingClientRect();
      const axis = Math.max(0, Math.round((visible[0].rect.left - rowRect.left) * 100) / 100);
      row.style.setProperty("--flix-row-axis", `${axis}px`);
    }
  }, []);

  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;

    syncRail();
    const onScroll = () => window.requestAnimationFrame(syncRail);
    slider.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", syncRail);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncRail) : null;
    observer?.observe(slider);

    return () => {
      slider.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", syncRail);
      observer?.disconnect();
    };
  }, [contents.length, syncRail]);

  const scroll = (direction: "left" | "right") => {
    if (!sliderRef.current) return;
    const scrollAmount = sliderRef.current.clientWidth * 0.8;
    sliderRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  if (!contents || contents.length === 0) return null;

  return (
    <Box
      ref={rowRef}
      className="site-horizontal-row"
      data-sc-row="true"
      sx={{ mb: 4, position: "relative", "&:hover": { zIndex: 20 } }}
      data-testid={sectionId ? `section-${sectionId}` : `section-${title.toLowerCase().replace(/\s+/g, '-')}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <Typography
        className="row-header"
        variant="h6"
        sx={{
          color: "#fff",
          fontWeight: 700,
          mb: 1.5,
          pl: { xs: 2, md: 4 },
          fontSize: { xs: "1rem", md: "1.25rem" },
          letterSpacing: "-0.01em",
          transition: "color 0.2s ease",
          "&:hover": { color: "#e50914" },
        }}
      >
        {title}
      </Typography>

      <Box sx={{ position: "relative" }}>
        <Box
          sx={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: "60px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(90deg, rgba(20,20,20,0.95) 0%, transparent 100%)",
            zIndex: 50, opacity: showLeftArrow && isHovering ? 1 : 0,
            visibility: showLeftArrow ? "visible" : "hidden",
            transition: "opacity 0.3s ease", pointerEvents: showLeftArrow ? "auto" : "none",
          }}
        >
          <IconButton
            onClick={() => scroll("left")}
            data-testid="slider-left-arrow"
            sx={{
              bgcolor: "rgba(0,0,0,0.7)", color: "#fff", width: 44, height: 44,
              transition: "all 0.2s ease",
              "&:hover": { bgcolor: "rgba(229, 9, 20, 0.9)", transform: "scale(1.1)" },
            }}
          >
            <ChevronLeftIcon sx={{ fontSize: 32 }} />
          </IconButton>
        </Box>

        <Box
          ref={sliderRef}
          data-sc-track="true"
          sx={{
            display: "flex", gap: { xs: 1.5, md: 2 }, overflowX: "auto", overflowY: "visible",
            scrollBehavior: "smooth", px: { xs: 2, md: 4 }, py: 4,
            scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" }, pb: 6, pt: 4,
          }}
        >
          {contents.map((content, index) => {
            const edge = index === visibleEdges.first ? "left" : index === visibleEdges.last ? "right" : "center";
            return (
              <Box
                key={content.tmdbId}
                data-horizontal-card-index={index}
                className={`horizontal-card-slot edge-${edge}`}
                sx={{ flexShrink: 0 }}
              >
                <HorizontalCard content={content} index={index} totalCards={contents.length} />
              </Box>
            );
          })}
        </Box>

        <Box
          sx={{
            position: "absolute", right: 0, top: 0, bottom: 0, width: "60px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(270deg, rgba(20,20,20,0.95) 0%, transparent 100%)",
            zIndex: 50, opacity: showRightArrow && isHovering ? 1 : 0,
            visibility: showRightArrow ? "visible" : "hidden",
            transition: "opacity 0.3s ease", pointerEvents: showRightArrow ? "auto" : "none",
          }}
        >
          <IconButton
            onClick={() => scroll("right")}
            data-testid="slider-right-arrow"
            sx={{
              bgcolor: "rgba(0,0,0,0.7)", color: "#fff", width: 44, height: 44,
              transition: "all 0.2s ease",
              "&:hover": { bgcolor: "rgba(229, 9, 20, 0.9)", transform: "scale(1.1)" },
            }}
          >
            <ChevronRightIcon sx={{ fontSize: 32 }} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
