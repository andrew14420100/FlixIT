// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";

interface ContentItem {
  id?: number;
  tmdbId?: number;
  type?: string;
  media_type?: string;
  title?: string;
  name?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
}

interface DynamicSliderProps {
  title: string;
  items: ContentItem[];
  mediaType: MEDIA_TYPE;
}

export default function DynamicSlider({ title, items, mediaType }: DynamicSliderProps) {
  const navigate = useNavigate();
  const sliderRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  const [visibleEdges, setVisibleEdges] = useState({ first: 0, last: Math.max(0, items.length - 1) });

  const syncRail = useCallback(() => {
    const slider = sliderRef.current;
    if (!slider) return;

    const { scrollLeft, scrollWidth, clientWidth } = slider;
    setShowLeftArrow(scrollLeft > 0);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);

    const viewport = slider.getBoundingClientRect();
    const cards = Array.from(slider.querySelectorAll("[data-dynamic-card-index]")) as HTMLElement[];
    const visible = cards
      .map((node) => ({
        index: Number(node.dataset.dynamicCardIndex),
        rect: node.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.right > viewport.left + 2 && rect.left < viewport.right - 2)
      .sort((a, b) => a.rect.left - b.rect.left);

    if (visible.length) {
      setVisibleEdges({ first: visible[0].index, last: visible[visible.length - 1].index });
    }
  }, []);

  useEffect(() => {
    syncRail();
    const slider = sliderRef.current;
    if (!slider) return;
    window.addEventListener("resize", syncRail);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncRail) : null;
    observer?.observe(slider);
    return () => {
      window.removeEventListener("resize", syncRail);
      observer?.disconnect();
    };
  }, [items.length, syncRail]);

  const scroll = (direction: 'left' | 'right') => {
    if (sliderRef.current) {
      const scrollAmount = sliderRef.current.clientWidth * 0.8;
      sliderRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const handleItemClick = (item: ContentItem) => {
    const itemId = item.tmdbId || item.id;
    const itemType = item.media_type || item.type || mediaType;
    navigate(`/${MAIN_PATH.browse}/${itemType}/${itemId}`);
  };

  if (!items || items.length === 0) return null;

  return (
    <Box sx={{ position: 'relative', mb: 4, px: { xs: 2, md: 6 } }}>
      <Typography
        variant="h6"
        sx={{ mb: 1.5, fontWeight: 700, color: '#fff', fontSize: { xs: '1rem', md: '1.25rem' } }}
        data-testid={`section-title-${title.replace(/\s+/g, '-').toLowerCase()}`}
      >
        {title}
      </Typography>

      <Box sx={{ position: 'relative' }}>
        {showLeftArrow && (
          <IconButton
            onClick={() => scroll('left')}
            sx={{
              position: 'absolute', left: -20, top: '50%', transform: 'translateY(-50%)', zIndex: 10,
              bgcolor: 'rgba(0,0,0,0.7)', color: '#fff', width: 40, height: 80, borderRadius: 1,
              '&:hover': { bgcolor: 'rgba(0,0,0,0.9)' }
            }}
            data-testid="slider-left-arrow"
          >
            <ArrowBackIosNewIcon />
          </IconButton>
        )}

        <Box
          ref={sliderRef}
          onScroll={() => window.requestAnimationFrame(syncRail)}
          sx={{
            display: 'flex', gap: 1, overflowX: 'auto', scrollBehavior: 'smooth',
            '&::-webkit-scrollbar': { display: 'none' }, msOverflowStyle: 'none', scrollbarWidth: 'none',
          }}
        >
          {items.map((item, index) => {
            const itemId = item.tmdbId || item.id;
            const itemTitle = item.title || item.name || '';
            const posterPath = item.poster_path;
            const edge = index === visibleEdges.first ? 'left' : index === visibleEdges.last ? 'right' : 'center';

            return (
              <Box
                key={`${itemId}-${index}`}
                data-dynamic-card-index={index}
                onClick={() => handleItemClick(item)}
                sx={{
                  flexShrink: 0,
                  width: { xs: 120, sm: 150, md: 180 },
                  cursor: 'pointer',
                  borderRadius: 1,
                  overflow: 'hidden',
                  transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                  position: 'relative',
                  transformOrigin: edge === 'left' ? '0% 50%' : edge === 'right' ? '100% 50%' : '50% 50%',
                  '&:hover': {
                    transform: 'scale(1.08)',
                    zIndex: 10,
                    boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
                    '& .item-overlay': { opacity: 1 }
                  }
                }}
                data-testid={`content-item-${itemId}`}
              >
                {posterPath ? (
                  <Box
                    component="img"
                    src={`https://image.tmdb.org/t/p/w342${posterPath}`}
                    alt={itemTitle}
                    sx={{
                      width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block', bgcolor: '#1a1a1a'
                    }}
                    onError={(e: any) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: '100%', aspectRatio: '2/3', bgcolor: '#2a2a2a', display: 'flex',
                      alignItems: 'center', justifyContent: 'center'
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', px: 1 }}>
                      {itemTitle}
                    </Typography>
                  </Box>
                )}

                <Box
                  className="item-overlay"
                  sx={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.9))', p: 1,
                    opacity: 0, transition: 'opacity 0.3s ease'
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: '#fff', fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3, fontSize: '0.7rem'
                    }}
                  >
                    {itemTitle}
                  </Typography>
                  {item.vote_average && item.vote_average > 0 && (
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#f5c518' }} />
                      <Typography variant="caption" sx={{ color: '#f5c518', fontSize: '0.65rem' }}>
                        {item.vote_average.toFixed(1)}
                      </Typography>
                    </Stack>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>

        {showRightArrow && items.length > 5 && (
          <IconButton
            onClick={() => scroll('right')}
            sx={{
              position: 'absolute', right: -20, top: '50%', transform: 'translateY(-50%)', zIndex: 10,
              bgcolor: 'rgba(0,0,0,0.7)', color: '#fff', width: 40, height: 80, borderRadius: 1,
              '&:hover': { bgcolor: 'rgba(0,0,0,0.9)' }
            }}
            data-testid="slider-right-arrow"
          >
            <ArrowForwardIosIcon />
          </IconButton>
        )}
      </Box>
    </Box>
  );
}
