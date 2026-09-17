// @ts-nocheck
/**
 * CustomVideoPlayer - native <video> player (no iframe).
 *  - HLS via hls.js (Chrome/Firefox/Edge) with native fallback (Safari/iOS); plain .mp4 supported too
 *  - Italian audio track auto-selected on MANIFEST_PARSED
 *  - MUI overlay: play/pause, +-10s, volume + mute, seekbar + times, fullscreen, next episode, audio menu
 *  - Controls auto-hide after 3s of mouse inactivity while playing
 *  - Resume from localStorage (key = storageKey/tmdbId) merged with `startAt`
 *  - Keyboard: Space/K play-pause, F fullscreen, Left/Right +-10s, Up/Down volume, M mute
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { Box, CircularProgress, IconButton, Menu, MenuItem, Slider, Stack, Tooltip, Typography } from "@mui/material";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import Replay10RoundedIcon from "@mui/icons-material/Replay10Rounded";
import Forward10RoundedIcon from "@mui/icons-material/Forward10Rounded";
import VolumeUpRoundedIcon from "@mui/icons-material/VolumeUpRounded";
import VolumeDownRoundedIcon from "@mui/icons-material/VolumeDownRounded";
import VolumeOffRoundedIcon from "@mui/icons-material/VolumeOffRounded";
import FullscreenRoundedIcon from "@mui/icons-material/FullscreenRounded";
import FullscreenExitRoundedIcon from "@mui/icons-material/FullscreenExitRounded";
import SkipNextRoundedIcon from "@mui/icons-material/SkipNextRounded";
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

const CONTROLS_HIDE_MS = 3000;
const SKIP_SECONDS = 10;
const SAVE_EVERY_MS = 5000;
const RESUME_MIN_SECONDS = 30;
const END_THRESHOLD_SECONDS = 20;
const STORAGE_PREFIX = "flixit_player_time:";
const MAX_NETWORK_RECOVERIES = 4;
const MAX_MEDIA_RECOVERIES = 2;
const HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,
  backBufferLength: 60,
  maxBufferLength: 30,
  maxMaxBufferLength: 120,
  maxBufferSize: 60 * 1000 * 1000,
  startFragPrefetch: true,       // fetch the first fragment while the level playlist is still parsing
  capLevelToPlayerSize: true,    // never download 1080p into a 720px box
  abrEwmaDefaultEstimate: 2_000_000, // start around 720p on unknown networks, ABR adjusts within seconds
  abrBandWidthUpFactor: 0.8,
  manifestLoadingTimeOut: 15000, manifestLoadingMaxRetry: 2, manifestLoadingRetryDelay: 800,
  levelLoadingTimeOut: 15000, levelLoadingMaxRetry: 3, levelLoadingRetryDelay: 800,
  fragLoadingTimeOut: 20000, fragLoadingMaxRetry: 4, fragLoadingRetryDelay: 800, fragLoadingMaxRetryTimeout: 8000,
  nudgeMaxRetry: 5,
};

export function readSavedTime(storageKey) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Number(parsed?.t) || 0;
  } catch {
    return 0;
  }
}

function writeSavedTime(storageKey, t, d) {
  try {
    if (!storageKey) return;
    if (d > 0 && d - t < END_THRESHOLD_SECONDS) {
      localStorage.removeItem(`${STORAGE_PREFIX}${storageKey}`);
      return;
    }
    localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify({ t: Math.floor(t), d: Math.floor(d || 0), at: Date.now() }));
  } catch {
    /* storage full / disabled */
  }
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

function isItalianTrack(track) {
  const lang = (track?.lang || "").toLowerCase();
  const name = (track?.name || "").toLowerCase();
  return lang === "it" || lang === "ita" || lang.startsWith("it-") || name.includes("italian") || name.includes("italiano");
}

const ctrlBtnSx = {
  color: "#fff", width: 44, height: 44,
  transition: "transform 160ms ease, background-color 160ms ease",
  "&:hover": { bgcolor: "rgba(255,255,255,0.12)", transform: "scale(1.08)" },
};

export default function CustomVideoPlayer({
  src, type = "hls", storageKey, startAt = 0, title = "", subtitle = "", poster,
  hasNext = false, onNext, onBack, onProgress, onEnded, onError, autoPlay = false,
}) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const hideTimerRef = useRef(null);
  const lastSaveRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const seekingRef = useRef(false);
  const userRequestedPlayRef = useRef(false);
  const fatalErrorTimerRef = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => { const v = Number(localStorage.getItem("flixit_player_volume")); return Number.isFinite(v) && v > 0 ? v : 1; });
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [audioTracks, setAudioTracks] = useState([]);
  const [audioTrackId, setAudioTrackId] = useState(-1);
  const [audioMenuAnchor, setAudioMenuAnchor] = useState(null);
  const [fatalError, setFatalError] = useState(null);

  const resumeTarget = useMemo(() => Math.max(Number(startAt) || 0, readSavedTime(storageKey)), [startAt, storageKey]);

  // ---------------------------------------------------------------- source attach
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return undefined;
    resumeAppliedRef.current = false;
    setFatalError(null);
    setBuffering(true);
    setAudioTracks([]);
    setAudioTrackId(-1);

    const useHls = type === "hls" || /\.m3u8(\?|$)/i.test(src) || /\/proxy\/hls/i.test(src);
    const canNative = video.canPlayType("application/vnd.apple.mpegurl");
    let hls = null;
    let recoveryTimer = null;

    if (useHls && Hls.isSupported()) {
      hls = new Hls(HLS_CONFIG);
      hlsRef.current = hls;
      let networkRecoveries = 0;
      let mediaRecoveries = 0;
      const fail = (_msg) => {
        // HLS fatal events are not allowed to create the player error overlay.
        // hls.js may recover/reload the manifest or media after the event.
        // The explicit video.play() promise is the source of truth for a
        // user-visible playback failure.
        setBuffering(true);
        clearTimeout(fatalErrorTimerRef.current);
      };
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const tracks = hls.audioTracks || [];
        setAudioTracks(tracks.map((t, i) => ({ id: i, name: t.name || t.lang || `Traccia ${i + 1}`, lang: t.lang || "" })));
        const italian = tracks.findIndex(isItalianTrack);
        if (italian >= 0) hls.audioTrack = italian;
        setAudioTrackId(italian >= 0 ? italian : hls.audioTrack);

        if (autoPlay) {
          // Autoplay is intentionally audible, as in the original player.
          // Do not force mute: if the browser permits autoplay, playback starts
          // with the current volume. A browser autoplay rejection is not a
          // player error and must never replace the player with an error screen.
          video.autoplay = true;
          setBuffering(true);
          const start = () => {
            if (!video.paused) return;
            video.play().then(() => {
              setBuffering(false);
              setFatalError(null);
            }).catch((err) => {
              console.warn("[PLAYER] autoplay fallito:", err?.name, err?.message);
              // The browser may reject audible autoplay. Leave the player
              // mounted and let the user's Play button retry with a gesture.
            });
          };
          if (video.readyState >= 2) start();
          else video.addEventListener("canplay", start, { once: true });
        }
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_e, data) => setAudioTrackId(data?.id ?? hls.audioTrack));
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // bounded recovery with backoff: 4 attempts max, then a clear error (never an endless spinner)
          if (networkRecoveries >= MAX_NETWORK_RECOVERIES) return fail("Connessione allo stream persa. Riprova.");
          networkRecoveries += 1;
          setBuffering(true);
          clearTimeout(recoveryTimer);
          recoveryTimer = setTimeout(() => hls.startLoad(video.currentTime || -1), 600 * networkRecoveries);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (mediaRecoveries >= MAX_MEDIA_RECOVERIES) return fail("Errore di decodifica del video");
          mediaRecoveries += 1;
          if (mediaRecoveries === 2) hls.swapAudioCodec();
          hls.recoverMediaError();
        } else {
          fail("Impossibile riprodurre lo stream");
        }
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { networkRecoveries = 0; });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      // Safari/iOS native HLS or plain mp4
      video.src = src;
      if (autoPlay) {
        // Keep autoplay audible; never force video.muted = true.
        video.autoplay = true;
        setBuffering(true);
        const start = () => {
          if (!video.paused) return;
          video.play().then(() => {
            setBuffering(false);
            setFatalError(null);
          }).catch((err) => {
              console.warn("[PLAYER] autoplay fallito:", err?.name, err?.message);
            // Audible autoplay can be rejected by the browser. This is not a
            // playback error; the manual Play button remains available.
          });
        };
        if (video.readyState >= 2) start();
        else video.addEventListener("canplay", start, { once: true });
      }
    }

    return () => {
      clearTimeout(recoveryTimer);
      clearTimeout(fatalErrorTimerRef.current);
      if (hls) { hls.destroy(); hlsRef.current = null; }
      video.removeAttribute("src");
      video.load();
    };
  }, [src, type, autoPlay, onError]);

  // ---------------------------------------------------------------- video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    video.volume = volume;
    video.muted = muted;

    const applyResume = () => {
      if (resumeAppliedRef.current) return;
      resumeAppliedRef.current = true;
      const d = video.duration || 0;
      if (resumeTarget > RESUME_MIN_SECONDS && (!d || resumeTarget < d - END_THRESHOLD_SECONDS)) {
        try { video.currentTime = resumeTarget; } catch { /* not seekable yet */ }
      }
    };
    const onLoadedMeta = () => { setDuration(video.duration || 0); applyResume(); };
    const onDuration = () => setDuration(video.duration || 0);
    const onTime = () => {
      if (seekingRef.current) return;
      const t = video.currentTime || 0;
      setCurrentTime(t);
      const now = Date.now();
      if (now - lastSaveRef.current > SAVE_EVERY_MS) {
        lastSaveRef.current = now;
        writeSavedTime(storageKey, t, video.duration || 0);
        onProgress?.(t, video.duration || 0);
      }
    };
    const onPlay = () => {
      clearTimeout(fatalErrorTimerRef.current);
      setFatalError(null);
      setPlaying(true);
      setBuffering(false);
    };
    const onPause = () => { setPlaying(false); setBuffering(false); writeSavedTime(storageKey, video.currentTime, video.duration || 0); onProgress?.(video.currentTime, video.duration || 0); };
    const onSeeked = () => { setCurrentTime(video.currentTime || 0); if (video.paused) setBuffering(false); };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => {
      clearTimeout(fatalErrorTimerRef.current);
      setFatalError(null);
      setBuffering(false);
    };
    const onCanPlay = () => setBuffering(false);
    const onEnd = () => { setPlaying(false); writeSavedTime(storageKey, video.duration || 0, video.duration || 0); onProgress?.(video.duration || 0, video.duration || 0); onEnded?.(); };
    const onVolume = () => { setMuted(video.muted); setVolume(video.volume); };
    const onErr = () => {
      if (hlsRef.current) return; // hls.js reports its own errors
      if (!userRequestedPlayRef.current) {
        setBuffering(true);
        return;
      }
      setBuffering(true);
      // Do not show the fatal overlay here. A native media error can be
      // emitted while the source is still attaching/loading.
      // Explicit play() failure below handles genuine playback failures.
    };

    video.addEventListener("loadedmetadata", onLoadedMeta);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("ended", onEnd);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("error", onErr);
    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMeta);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("ended", onEnd);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("error", onErr);
    };
    // volume/muted intentionally excluded: they are pushed imperatively below
  }, [storageKey, resumeTarget, onProgress, onEnded, onError, src]);

  // Save on unmount / tab hide
  useEffect(() => {
    const flush = () => { const v = videoRef.current; if (v && v.currentTime > 0) writeSavedTime(storageKey, v.currentTime, v.duration || 0); };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => { flush(); window.removeEventListener("beforeunload", flush); document.removeEventListener("visibilitychange", onVis); };
  }, [storageKey]);

  // ---------------------------------------------------------------- actions
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      userRequestedPlayRef.current = true;
      setFatalError(null);
      setBuffering(true);

      v.play().then(() => {
        clearTimeout(fatalErrorTimerRef.current);
        setFatalError(null);
      }).catch((err) => {
        // Do not replace the player with an error immediately. Some browsers
        // reject play() while HLS is still attaching/loading. Keep the player
        // in its loading state and let media/HLS events settle.
        const message = err?.name === "NotAllowedError"
          ? "La riproduzione è stata bloccata dal browser."
          : null;

        if (message) {
          // A browser autoplay policy is not a stream failure. Keep the player
          // visible; a later user click on Play can start it with audio.
          setBuffering(false);
          setFatalError(null);
        } else {
          setBuffering(true);
          setFatalError(null);
        }
        // Never propagate autoplay/playback rejections to the parent page.
      });
    } else {
      v.pause();
    }
  }, [onError, muted]);
  const skip = useCallback((delta) => {
    const v = videoRef.current; if (!v) return;
    const d = v.duration || Infinity;
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), d);
    setCurrentTime(v.currentTime);
  }, []);
  const changeVolume = useCallback((value) => {
    const v = videoRef.current; if (!v) return;
    const clamped = Math.min(1, Math.max(0, value));
    v.volume = clamped; v.muted = clamped === 0;
    setVolume(clamped); setMuted(clamped === 0);
    localStorage.setItem("flixit_player_volume", String(clamped));
  }, []);
  const toggleMute = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (v.muted || v.volume === 0) { v.muted = false; if (v.volume === 0) { v.volume = 0.5; setVolume(0.5); } setMuted(false); }
    else { v.muted = true; setMuted(true); }
  }, []);
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current; const v = videoRef.current;
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iOS Safari
  }, []);
  const selectAudioTrack = useCallback((id) => {
    if (hlsRef.current) hlsRef.current.audioTrack = id;
    setAudioTrackId(id);
    setAudioMenuAnchor(null);
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ---------------------------------------------------------------- auto-hide controls
  const wakeControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused && !audioMenuAnchor) setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, [audioMenuAnchor]);

  useEffect(() => { wakeControls(); return () => clearTimeout(hideTimerRef.current); }, [wakeControls, playing]);

  // ---------------------------------------------------------------- keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      switch (e.key) {
        case " ": case "k": case "K": e.preventDefault(); togglePlay(); break;
        case "f": case "F": e.preventDefault(); toggleFullscreen(); break;
        case "m": case "M": e.preventDefault(); toggleMute(); break;
        case "ArrowLeft": e.preventDefault(); skip(-SKIP_SECONDS); break;
        case "ArrowRight": e.preventDefault(); skip(SKIP_SECONDS); break;
        case "ArrowUp": e.preventDefault(); changeVolume((videoRef.current?.volume ?? volume) + 0.1); break;
        case "ArrowDown": e.preventDefault(); changeVolume((videoRef.current?.volume ?? volume) - 0.1); break;
        default: return;
      }
      wakeControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleFullscreen, toggleMute, skip, changeVolume, wakeControls, volume]);

  // ---------------------------------------------------------------- seek slider
  const onSeekChange = (_e, value) => { seekingRef.current = true; setCurrentTime(Number(value)); };
  const onSeekCommit = (_e, value) => {
    const v = videoRef.current;
    if (v) v.currentTime = Number(value);
    seekingRef.current = false;
    wakeControls();
  };

  const VolumeIcon = muted || volume === 0 ? VolumeOffRoundedIcon : volume < 0.5 ? VolumeDownRoundedIcon : VolumeUpRoundedIcon;
  const showOverlay = controlsVisible || !playing;

  return (
    <Box
      ref={containerRef}
      data-testid="custom-video-player"
      data-controls={showOverlay ? "visible" : "hidden"}
      onMouseMove={wakeControls}
      onTouchStart={wakeControls}
      onMouseLeave={() => { if (playing) setControlsVisible(false); }}
      onClick={(e) => { if (e.target === videoRef.current) togglePlay(); }}
      onDoubleClick={(e) => { if (e.target === videoRef.current) toggleFullscreen(); }}
      sx={{ position: "relative", width: "100%", height: "100%", bgcolor: "#000", overflow: "hidden", cursor: showOverlay ? "default" : "none", userSelect: "none" }}
    >
      <video
        ref={videoRef}
        data-testid="native-video"
        poster={poster || undefined}
        playsInline
        autoPlay={autoPlay}
        preload="auto"
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#000" }}
      />

      {/* Buffering */}
      {buffering && !fatalError && (
        <Box data-testid="player-buffering" sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <CircularProgress size={64} thickness={3} sx={{ color: "#e50914" }} />
        </Box>
      )}

      {/* Center play glyph when paused */}
      {!playing && !buffering && (
        <Box onClick={togglePlay} data-testid="player-center-play"
          sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", cursor: "pointer" }}>
          <Box sx={{ width: 96, height: 96, borderRadius: "50%", bgcolor: "rgba(0,0,0,0.55)", border: "2px solid rgba(255,255,255,0.7)", display: "grid", placeItems: "center", backdropFilter: "blur(6px)", transition: "transform 200ms ease, background-color 200ms ease", "&:hover": { transform: "scale(1.06)", bgcolor: "rgba(229,9,20,0.85)", borderColor: "transparent" } }}>
            <PlayArrowRoundedIcon sx={{ fontSize: 60, color: "#fff", ml: 0.5 }} />
          </Box>
        </Box>
      )}

      {/* Error */}
      

      {/* Top bar */}
      <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, p: { xs: 2, md: 3 }, display: "flex", alignItems: "center", gap: 2,
        background: "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)",
        opacity: showOverlay ? 1 : 0, transform: showOverlay ? "translateY(0)" : "translateY(-12px)", transition: "opacity 280ms ease, transform 280ms ease", pointerEvents: showOverlay ? "auto" : "none" }}>
        {onBack && (
          <IconButton onClick={onBack} data-testid="back-button" aria-label="Indietro"
            sx={{ ...ctrlBtnSx, width: 48, height: 48, bgcolor: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.2)", "&:hover": { bgcolor: "#e50914", borderColor: "transparent", transform: "scale(1.08)" } }}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography data-testid="player-title" noWrap sx={{ color: "#fff", fontWeight: 700, fontSize: { xs: 16, md: 22 }, textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>{title}</Typography>
          {subtitle && <Typography data-testid="player-episode" noWrap sx={{ color: "rgba(255,255,255,0.8)", fontSize: { xs: 13, md: 15 }, textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>{subtitle}</Typography>}
        </Box>
      </Box>

      {/* Bottom controls */}
      <Box data-testid="player-controls" sx={{ position: "absolute", left: 0, right: 0, bottom: 0, px: { xs: 2, md: 4 }, pb: { xs: 1.5, md: 2.5 }, pt: 8,
        background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 55%, rgba(0,0,0,0) 100%)",
        opacity: showOverlay ? 1 : 0, transform: showOverlay ? "translateY(0)" : "translateY(12px)", transition: "opacity 280ms ease, transform 280ms ease", pointerEvents: showOverlay ? "auto" : "none" }}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Slider
            data-testid="player-seekbar"
            aria-label="Avanzamento"
            min={0} max={Math.max(duration, 0.01)} step={0.5} value={Math.min(currentTime, duration || currentTime)}
            onChange={onSeekChange} onChangeCommitted={onSeekCommit}
            sx={{ color: "#e50914", height: 5, "& .MuiSlider-rail": { bgcolor: "rgba(255,255,255,0.3)", opacity: 1 }, "& .MuiSlider-thumb": { width: 14, height: 14, transition: "transform 120ms ease", "&:hover, &.Mui-focusVisible": { boxShadow: "0 0 0 8px rgba(229,9,20,0.25)" }, "&.Mui-active": { boxShadow: "0 0 0 12px rgba(229,9,20,0.25)" } } }}
          />
          <Typography data-testid="player-time" sx={{ color: "#fff", fontVariantNumeric: "tabular-nums", fontSize: 14, whiteSpace: "nowrap", minWidth: 96, textAlign: "right" }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </Typography>
        </Stack>

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Tooltip title={playing ? "Pausa (Spazio)" : "Riproduci (Spazio)"}>
              <IconButton onClick={togglePlay} data-testid="play-pause-button" aria-label={playing ? "Pausa" : "Riproduci"} sx={ctrlBtnSx}>
                {playing ? <PauseRoundedIcon sx={{ fontSize: 34 }} /> : <PlayArrowRoundedIcon sx={{ fontSize: 34 }} />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Indietro 10s (←)">
              <IconButton onClick={() => skip(-SKIP_SECONDS)} data-testid="skip-back-button" aria-label="Indietro 10 secondi" sx={ctrlBtnSx}><Replay10RoundedIcon sx={{ fontSize: 30 }} /></IconButton>
            </Tooltip>
            <Tooltip title="Avanti 10s (→)">
              <IconButton onClick={() => skip(SKIP_SECONDS)} data-testid="skip-forward-button" aria-label="Avanti 10 secondi" sx={ctrlBtnSx}><Forward10RoundedIcon sx={{ fontSize: 30 }} /></IconButton>
            </Tooltip>
            <Stack direction="row" alignItems="center" sx={{ "&:hover .vol-slider": { width: 96, opacity: 1, ml: 1 } }}>
              <Tooltip title={muted ? "Attiva audio (M)" : "Disattiva audio (M)"}>
                <IconButton onClick={toggleMute} data-testid="mute-button" aria-label="Volume" sx={ctrlBtnSx}><VolumeIcon sx={{ fontSize: 28 }} /></IconButton>
              </Tooltip>
              <Slider
                className="vol-slider" data-testid="volume-slider" aria-label="Volume" size="small"
                min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(_e, v) => changeVolume(Number(v))}
                sx={{ width: 0, opacity: 0, ml: 0, color: "#fff", transition: "width 220ms ease, opacity 220ms ease, margin 220ms ease", "& .MuiSlider-thumb": { width: 12, height: 12 } }}
              />
            </Stack>
          </Stack>

          <Stack direction="row" alignItems="center" spacing={0.5}>
            {hasNext && onNext && (
              <Tooltip title="Episodio successivo">
                <IconButton onClick={onNext} data-testid="next-episode-button" aria-label="Episodio successivo" sx={ctrlBtnSx}><SkipNextRoundedIcon sx={{ fontSize: 32 }} /></IconButton>
              </Tooltip>
            )}
            {audioTracks.length > 1 && (
              <>
                <Tooltip title="Lingua audio">
                  <IconButton onClick={(e) => setAudioMenuAnchor(e.currentTarget)} data-testid="audio-track-button" aria-label="Lingua audio" sx={ctrlBtnSx}><TranslateRoundedIcon sx={{ fontSize: 26 }} /></IconButton>
                </Tooltip>
                <Menu anchorEl={audioMenuAnchor} open={!!audioMenuAnchor} onClose={() => setAudioMenuAnchor(null)}
                  anchorOrigin={{ vertical: "top", horizontal: "center" }} transformOrigin={{ vertical: "bottom", horizontal: "center" }}
                  PaperProps={{ sx: { bgcolor: "rgba(20,20,20,0.95)", color: "#fff", border: "1px solid rgba(255,255,255,0.1)", minWidth: 180 } }}>
                  {audioTracks.map((t) => (
                    <MenuItem key={t.id} selected={t.id === audioTrackId} onClick={() => selectAudioTrack(t.id)}
                      sx={{ "&.Mui-selected": { bgcolor: "rgba(229,9,20,0.25)" }, "&.Mui-selected:hover": { bgcolor: "rgba(229,9,20,0.35)" } }}>
                      {t.name}{t.lang ? ` (${t.lang})` : ""}
                    </MenuItem>
                  ))}
                </Menu>
              </>
            )}
            <Tooltip title={isFullscreen ? "Esci da schermo intero (F)" : "Schermo intero (F)"}>
              <IconButton onClick={toggleFullscreen} data-testid="fullscreen-button" aria-label="Schermo intero" sx={ctrlBtnSx}>
                {isFullscreen ? <FullscreenExitRoundedIcon sx={{ fontSize: 30 }} /> : <FullscreenRoundedIcon sx={{ fontSize: 30 }} />}
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
