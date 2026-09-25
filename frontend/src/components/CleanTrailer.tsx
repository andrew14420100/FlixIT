// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import TrailerPlayer from "./TrailerPlayer";

const btnSx = {
  width: 52,
  height: 52,
  color: "#fff",
  bgcolor: "rgba(0,0,0,0.55)",
  border: "2px solid rgba(255,255,255,0.5)",
  backdropFilter: "blur(10px)",
  transition: "background-color 200ms ease, border-color 200ms ease, transform 200ms ease",
  "&:hover": {
    bgcolor: "rgba(255,255,255,0.18)",
    borderColor: "#fff",
    transform: "scale(1.06)",
  },
};

function routeIdentity() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/browse\/(movie|tv)\/(\d+)/i);
  return match ? { mediaType: match[1].toLowerCase(), id: Number(match[2]) } : null;
}

/** Detail trailer panel backed only by the StreamingCommunity resolver/cache. */
export default function CleanTrailer({ videoKey: _videoKey, poster, testId = "clean-trailer" }) {
  const identity = useMemo(() => routeIdentity(), []);
  const resolved = useResolvedTrailer(identity?.mediaType, identity?.id, !!identity);
  const playbackKey = resolved.url || null;

  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const playedRef = useRef(false);

  useEffect(() => {
    playedRef.current = false;
    setFailed(false);
    setStarted(false);
    setPlaying(true);
  }, [playbackKey]);

  useEffect(() => {
    if (!started || failed || !playbackKey) return;
    const timer = window.setTimeout(() => {
      if (!playedRef.current) setFailed(true);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [started, failed, playbackKey]);

  const waitingForResolver =
    !!identity &&
    !playbackKey &&
    (resolved.isFetching || (resolved.enabled && resolved.data?.available !== true));

  return (
    <Box
      data-testid={testId}
      sx={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/9",
        borderRadius: 3,
        overflow: "hidden",
        bgcolor: "#000",
        boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
      }}
    >
      {failed ? (
        <Box
          data-testid={`${testId}-unavailable`}
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            backgroundImage: poster
              ? `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.8)), url(${poster})`
              : "none",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>
            Trailer non disponibile
          </Typography>
          <Typography sx={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
            Nessun trailer StreamingCommunity disponibile.
          </Typography>
        </Box>
      ) : !started ? (
        <Box
          onClick={() => playbackKey && setStarted(true)}
          data-testid={`${testId}-start`}
          sx={{
            position: "absolute",
            inset: 0,
            cursor: playbackKey ? "pointer" : "default",
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
            alignItems: "center",
            justifyContent: "center",
            backgroundImage: poster
              ? `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.55)), url(${poster})`
              : "none",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {playbackKey ? (
            <IconButton
              sx={{
                ...btnSx,
                width: 84,
                height: 84,
                bgcolor: "rgba(229,9,20,0.9)",
                border: "none",
                "&:hover": { bgcolor: "#E50914", transform: "scale(1.08)" },
              }}
            >
              <PlayArrowIcon sx={{ fontSize: 48 }} />
            </IconButton>
          ) : waitingForResolver ? null : (
            <>
              <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>
                Trailer non disponibile
              </Typography>
              <Typography sx={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
                Nessun trailer StreamingCommunity disponibile.
              </Typography>
            </>
          )}
        </Box>
      ) : playbackKey ? (
        <>
          <TrailerPlayer
            key={playbackKey}
            videoKey={playbackKey}
            muted={muted}
            playing={playing}
            loop={false}
            zoom={1.02}
            onEnded={() => setPlaying(false)}
            onError={() => setFailed(true)}
            onPlaying={() => {
              playedRef.current = true;
            }}
          />
          <Box
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              p: 2.5,
              display: "flex",
              gap: 1.5,
              alignItems: "center",
              zIndex: 5,
              background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)",
            }}
          >
            <IconButton
              onClick={() => setPlaying((value) => !value)}
              sx={btnSx}
              data-testid={`${testId}-toggle-play`}
              aria-label={playing ? "Pausa" : "Riproduci"}
            >
              {playing ? <PauseIcon sx={{ fontSize: 28 }} /> : <PlayArrowIcon sx={{ fontSize: 30 }} />}
            </IconButton>
            <IconButton
              onClick={() => setMuted((value) => !value)}
              sx={btnSx}
              data-testid={`${testId}-toggle-mute`}
              aria-label={muted ? "Attiva audio" : "Disattiva audio"}
            >
              {muted ? <VolumeOffIcon sx={{ fontSize: 26 }} /> : <VolumeUpIcon sx={{ fontSize: 26 }} />}
            </IconButton>
          </Box>
        </>
      ) : null}
    </Box>
  );
}
