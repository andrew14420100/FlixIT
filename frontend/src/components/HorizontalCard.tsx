// @ts-nocheck
import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import StarIcon from "@mui/icons-material/Star";
import { MAIN_PATH } from "src/constant";
import { useGetConfigurationQuery } from "src/store/slices/configuration";
import { getMediaImageUrl } from "src/hooks/useCDNImage";

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

interface HorizontalCardProps {
  content: Content;
  index: number;
  totalCards: number;
}

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

const getUserId = () => {
  let userId = localStorage.getItem("netflix_user_id");
  if (!userId) {
    userId = `user_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem("netflix_user_id", userId);
  }
  return userId;
};

export default function HorizontalCard({ content, index, totalCards }: HorizontalCardProps) {
  const navigate = useNavigate();
  const { data: configuration } = useGetConfigurationQuery(undefined);
  const [isHovered, setIsHovered] = useState(false);
  const [inMyList, setInMyList] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate expansion direction based on position
  const isFirstCard = index === 0;
  const isLastCard = index === totalCards - 1;
  
  // Get poster URL (backdrop for horizontal card look)
  const imageUrl = content.backdrop_path 
    ? getMediaImageUrl(
        content.tmdbId,
        'backdrop',
        content.backdrop_path,
        configuration?.images?.base_url,
        'w500'
      )
    : content.poster_path
    ? getMediaImageUrl(
        content.tmdbId,
        'poster',
        content.poster_path,
        configuration?.images?.base_url,
        'w342'
      )
    : null;

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsHovered(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsHovered(false);
  };

  // Check if in list on mount
  useEffect(() => {
    const checkInList = async () => {
      try {
        const userId = getUserId();
        const res = await fetch(`${API_URL}/user/list/check/${userId}/${content.type}/${content.tmdbId}`);
        if (res.ok) {
          const data = await res.json();
          setInMyList(data.in_list);
        }
      } catch {
        // Ignore errors
      }
    };
    checkInList();
  }, [content.tmdbId, content.type]);

  const handleToggleList = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const userId = getUserId();
    
    try {
      const endpoint = inMyList ? "/user/list/remove" : "/user/list/add";
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          media_id: content.tmdbId,
          media_type: content.type,
          title: content.title,
          poster_path: content.poster_path,
          backdrop_path: content.backdrop_path
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        setInMyList(data.in_list);
      }
    } catch {
      setInMyList(!inMyList);
    }
  };

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.scrollTo(0, 0);
    const watchPath = content.type === "tv" 
      ? `/${MAIN_PATH.watch}/tv/${content.tmdbId}?s=1&e=1`
      : `/${MAIN_PATH.watch}/movie/${content.tmdbId}`;
    navigate(watchPath);
  };

  const handleInfo = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.browse}/${content.type}/${content.tmdbId}`);
  };

  const handleCardClick = () => {
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.browse}/${content.type}/${content.tmdbId}`);
  };

  const year = content.release_date?.substring(0, 4);
  const rating = content.vote_average?.toFixed(1);
  const genreText = content.genres?.slice(0, 2).map(g => g.name).join(' • ');
  const seasonText = content.type === "tv" && content.number_of_seasons 
    ? `${content.number_of_seasons} stagion${content.number_of_seasons > 1 ? 'i' : 'e'}`
    : null;

  return (
    <Box
      ref={cardRef}
      data-testid={`horizontal-card-${content.tmdbId}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleCardClick}
      sx={{
        position: "relative",
        cursor: "pointer",
        aspectRatio: "16/9",
        borderRadius: "6px",
        overflow: "visible",
        flexShrink: 0,
        minWidth: { xs: "200px", sm: "240px", md: "280px", lg: "300px" },
        maxWidth: { xs: "200px", sm: "240px", md: "280px", lg: "300px" },
        transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), z-index 0s 0s",
        zIndex: isHovered ? 100 : 1,
        transformOrigin: "center center",
        transform: isHovered ? "scale(1.6)" : "scale(1)",
        "&:hover": {
          "& .card-expanded": {
            opacity: 1,
            visibility: "visible",
          },
        },
      }}
    >
      {/* Base Card Image */}
      <Box
        sx={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: "6px",
          overflow: "hidden",
          bgcolor: "#1a1a1a",
        }}
      >
        {imageUrl ? (
          <Box
            component="img"
            src={imageUrl}
            alt={content.title}
            loading="lazy"
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <Box
            sx={{
              width: "100%",
              height: "100%",
              bgcolor: "#2a2a2a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Typography variant="caption" color="grey.600">
              {content.title}
            </Typography>
          </Box>
        )}

        {/* Hover Overlay - appears on hover */}
        <Box
          className="card-expanded"
          sx={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.95) 100%)",
            opacity: isHovered ? 1 : 0,
            visibility: isHovered ? "visible" : "hidden",
            transition: "opacity 0.3s ease, visibility 0.3s ease",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            borderRadius: "6px",
          }}
        >
          {/* Content Info on hover */}
          <Box sx={{ p: 1.5 }}>
            {/* Title */}
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                color: "#fff",
                mb: 0.8,
                fontSize: "0.75rem",
                lineHeight: 1.2,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {content.title}
            </Typography>

            {/* Action Buttons Row */}
            <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mb: 1 }}>
              {/* Play Button */}
              <IconButton
                onClick={handlePlay}
                data-testid={`play-btn-${content.tmdbId}`}
                sx={{
                  bgcolor: "#fff",
                  width: 28,
                  height: 28,
                  transition: "all 0.2s ease",
                  "&:hover": {
                    bgcolor: "rgba(255,255,255,0.85)",
                    transform: "scale(1.1)",
                  },
                }}
              >
                <PlayArrowIcon sx={{ color: "#000", fontSize: 18 }} />
              </IconButton>

              {/* Add to List Button */}
              <IconButton
                onClick={handleToggleList}
                data-testid={`add-list-btn-${content.tmdbId}`}
                sx={{
                  bgcolor: inMyList ? "rgba(70, 211, 105, 0.3)" : "rgba(255,255,255,0.15)",
                  border: inMyList ? "2px solid #46d369" : "2px solid rgba(255,255,255,0.5)",
                  width: 28,
                  height: 28,
                  transition: "all 0.2s ease",
                  "&:hover": {
                    bgcolor: inMyList ? "rgba(70, 211, 105, 0.4)" : "rgba(255,255,255,0.25)",
                    borderColor: inMyList ? "#46d369" : "#fff",
                    transform: "scale(1.1)",
                  },
                }}
              >
                {inMyList ? (
                  <CheckIcon sx={{ color: "#46d369", fontSize: 16 }} />
                ) : (
                  <AddIcon sx={{ color: "#fff", fontSize: 16 }} />
                )}
              </IconButton>

              {/* Info Button */}
              <IconButton
                onClick={handleInfo}
                data-testid={`info-btn-${content.tmdbId}`}
                sx={{
                  bgcolor: "rgba(255,255,255,0.15)",
                  border: "2px solid rgba(255,255,255,0.5)",
                  width: 28,
                  height: 28,
                  transition: "all 0.2s ease",
                  "&:hover": {
                    bgcolor: "rgba(255,255,255,0.25)",
                    borderColor: "#fff",
                    transform: "scale(1.1)",
                  },
                }}
              >
                <InfoOutlinedIcon sx={{ color: "#fff", fontSize: 16 }} />
              </IconButton>

              {/* Rating Badge */}
              {rating && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.3,
                    bgcolor: "rgba(245, 197, 24, 0.2)",
                    borderRadius: "4px",
                    px: 0.6,
                    py: 0.2,
                    ml: "auto !important",
                  }}
                >
                  <StarIcon sx={{ fontSize: 12, color: "#f5c518" }} />
                  <Typography
                    variant="caption"
                    sx={{
                      color: "#f5c518",
                      fontWeight: 700,
                      fontSize: "0.65rem",
                    }}
                  >
                    {rating}
                  </Typography>
                </Box>
              )}
            </Stack>

            {/* Meta Info */}
            <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap">
              {/* Match percentage */}
              <Typography
                variant="caption"
                sx={{
                  color: "#46d369",
                  fontWeight: 700,
                  fontSize: "0.6rem",
                }}
              >
                {Math.floor(70 + Math.random() * 28)}% Match
              </Typography>

              {/* Year */}
              {year && (
                <Typography
                  variant="caption"
                  sx={{
                    color: "rgba(255,255,255,0.7)",
                    fontSize: "0.6rem",
                  }}
                >
                  {year}
                </Typography>
              )}

              {/* Seasons or Duration */}
              {seasonText && (
                <Typography
                  variant="caption"
                  sx={{
                    color: "rgba(255,255,255,0.7)",
                    fontSize: "0.6rem",
                  }}
                >
                  {seasonText}
                </Typography>
              )}
            </Stack>

            {/* Genres */}
            {genreText && (
              <Typography
                variant="caption"
                sx={{
                  color: "rgba(255,255,255,0.6)",
                  fontSize: "0.55rem",
                  display: "block",
                  mt: 0.5,
                }}
              >
                {genreText}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
