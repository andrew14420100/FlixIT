// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import TrailerPlayer from "./TrailerPlayer";

const btnSx = {
  width: 52, height: 52, color: "#fff", bgcolor: "rgba(0,0,0,0.55)", border: "2px solid rgba(255,255,255,0.5)", backdropFilter: "blur(10px)",
  transition: "background-color 200ms ease, border-color 200ms ease, transform 200ms ease",
  "&:hover": { bgcolor: "rgba(255,255,255,0.18)", borderColor: "#fff", transform: "scale(1.06)" },
};

function routeIdentity() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/browse\/(movie|tv)\/(\d+)/i);
  return match ? { mediaType: match[1].toLowerCase(), id: match[2] } : null;
}

function hdrSupported() {
  try { return !!window.matchMedia?.("(dynamic-range: high)")?.matches; } catch { return false; }
}

/**
 * Trailer detail player. The central resolver is authoritative when enabled;
 * the legacy YouTube key is used only when MULTI_PROVIDER_TRAILERS_ENABLED is
 * disabled. The old "Altri video" YouTube strip is hidden while the resolver
 * is active so the Detail trailer area has a single source of truth.
 */
export default function CleanTrailer({ videoKey, poster, testId = "clean-trailer" }) {
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resolverEnabled, setResolverEnabled] = useState<boolean | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const playedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const identity = routeIdentity();
    const load = async () => {
      try {
        if (identity) {
          const res = await fetch(`/api/public/trailer/${identity.mediaType}/${identity.id}?hdr=${hdrSupported() ? "true" : "false"}`, { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            if (cancelled) return;
            setResolverEnabled(!!data?.enabled);
            setResolvedUrl(data?.enabled && data?.available ? (data?.trailer_url || data?.trailer_key || null) : null);
            return;
          }
        }
        const cfg = await fetch("/api/public/trailer-config", { cache: "no-store" }).then((r) => r.ok ? r.json() : { enabled: false });
        if (!cancelled) setResolverEnabled(!!cfg?.enabled);
      } catch {
        if (!cancelled) setResolverEnabled(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [videoKey]);

  useEffect(() => {
    if (resolverEnabled !== true || typeof document === "undefined") return;
    const node = document.querySelector(`[data-testid="${testId}"]`);
    const wrapper = node?.parentElement;
    const legacyOtherVideos = wrapper?.nextElementSibling as HTMLElement | null;
    if (!legacyOtherVideos) return;
    const previous = legacyOtherVideos.style.display;
    legacyOtherVideos.style.display = "none";
    return () => { legacyOtherVideos.style.display = previous; };
  }, [resolverEnabled, testId]);

  const playbackKey = resolverEnabled ? resolvedUrl : videoKey;

  useEffect(() => {
    playedRef.current = false;
    setFailed(false);
    setStarted(false);
    setPlaying(true);
  }, [playbackKey]);

  useEffect(() => {
    if (!started || failed || !playbackKey) return;
    const t = setTimeout(() => { if (!playedRef.current) setFailed(true); }, 12000);
    return () => clearTimeout(t);
  }, [started, failed, playbackKey]);

  const unavailable = resolverEnabled === true && !resolvedUrl;

  return (
    <Box data-testid={testId} sx={{ position: "relative", width: "100%", aspectRatio: "16/9", borderRadius: 3, overflow: "hidden", bgcolor: "#000", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
      {failed || unavailable ? (
        <Box data-testid={`${testId}-unavailable`} sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
          backgroundImage: poster ? `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.8)), url(${poster})` : "none", backgroundSize: "cover", backgroundPosition: "center" }}>
          <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>Trailer non disponibile</Typography>
          <Typography sx={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>Nessun trailer verificato almeno Full HD disponibile.</Typography>
        </Box>
      ) : !started ? (
        <Box onClick={() => playbackKey && setStarted(true)} data-testid={`${testId}-start`}
          sx={{ position: "absolute", inset: 0, cursor: playbackKey ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center",
            backgroundImage: poster ? `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.55)), url(${poster})` : "none", backgroundSize: "cover", backgroundPosition: "center" }}>
          {playbackKey && <IconButton sx={{ ...btnSx, width: 84, height: 84, bgcolor: "rgba(229,9,20,0.9)", border: "none", "&:hover": { bgcolor: "#E50914", transform: "scale(1.08)" } }}><PlayArrowIcon sx={{ fontSize: 48 }} /></IconButton>}
        </Box>
      ) : playbackKey ? (
        <>
          <TrailerPlayer key={playbackKey} videoKey={playbackKey} muted={muted} playing={playing} loop={false} zoom={1.02} onEnded={() => setPlaying(false)} onError={() => setFailed(true)} onPlaying={() => { playedRef.current = true; }} />
          <Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, p: 2.5, display: "flex", gap: 1.5, alignItems: "center", zIndex: 5,
            background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)" }}>
            <IconButton onClick={() => setPlaying((p) => !p)} sx={btnSx} data-testid={`${testId}-toggle-play`} aria-label={playing ? "Pausa" : "Riproduci"}>
              {playing ? <PauseIcon sx={{ fontSize: 28 }} /> : <PlayArrowIcon sx={{ fontSize: 30 }} />}
            </IconButton>
            <IconButton onClick={() => setMuted((m) => !m)} sx={btnSx} data-testid={`${testId}-toggle-mute`} aria-label={muted ? "Attiva audio" : "Disattiva audio"}>
              {muted ? <VolumeOffIcon sx={{ fontSize: 26 }} /> : <VolumeUpIcon sx={{ fontSize: 26 }} />}
            </IconButton>
          </Box>
        </>
      ) : null}
    </Box>
  );
}
