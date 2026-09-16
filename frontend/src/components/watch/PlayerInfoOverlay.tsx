// @ts-nocheck
import { useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import SkipNextIcon from "@mui/icons-material/SkipNext";

const HIDE_DELAY_MS = 5000;

export function PlayerInfoOverlay({ title, isTv, season, episode, episodeName, hasNext, onNext }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let timer = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    const wake = () => {
      setVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    };
    const onPlayerEvent = (e) => {
      const name = e.data?.type === "PLAYER_EVENT" ? e.data.data?.event : null;
      if (name === "play" || name === "pause" || name === "seeked") wake();
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    window.addEventListener("blur", wake);
    window.addEventListener("message", onPlayerEvent);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
      window.removeEventListener("blur", wake);
      window.removeEventListener("message", onPlayerEvent);
    };
  }, []);

  const label = isTv ? `S${season}:E${episode}${episodeName ? ` ${episodeName}` : ""}` : "";

  return (
    <Box
      data-testid="player-info-overlay"
      data-state={visible ? "visible" : "hidden"}
      sx={{
        position: "absolute", left: 0, right: 0, bottom: 0, px: { xs: 2, md: 5 }, pb: { xs: 9, md: 11 }, pt: 10,
        display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 3, pointerEvents: "none",
        background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)",
        opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(12px)",
        transition: "opacity 320ms ease, transform 320ms ease", zIndex: 50,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography data-testid="player-title" noWrap sx={{ color: "#fff", fontWeight: 700, fontSize: { xs: 18, md: 26 }, lineHeight: 1.15, textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
          {title || (isTv ? "Serie TV" : "Film")}
        </Typography>
        {isTv && (
          <Typography data-testid="player-episode" noWrap sx={{ color: "rgba(255,255,255,0.85)", fontSize: { xs: 14, md: 18 }, mt: 0.5, textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
            {label}
          </Typography>
        )}
      </Box>
      {isTv && hasNext && (
        <Button
          data-testid="next-episode-button"
          onClick={onNext}
          endIcon={<SkipNextIcon />}
          sx={{
            pointerEvents: "auto", flexShrink: 0, color: "#fff", fontWeight: 700, textTransform: "none", fontSize: { xs: 14, md: 16 },
            px: 2.5, py: 1, borderRadius: 999, border: "1px solid rgba(255,255,255,0.35)", bgcolor: "rgba(0,0,0,0.55)", backdropFilter: "blur(12px)",
            transition: "background-color 240ms ease, transform 240ms ease", "&:hover": { bgcolor: "#e50914", borderColor: "transparent", transform: "scale(1.04)" },
          }}
        >
          Prossimo episodio
        </Button>
      )}
    </Box>
  );
}
