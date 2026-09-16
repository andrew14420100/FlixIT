// @ts-nocheck
/**
 * WatchPage - native playback.
 *  1. Reads tmdbId / season / episode from the router
 *  2. Resolves the stream from the backend (/api/player/movie/:id or /api/player/tv/:id/:s/:e)
 *     while showing a CircularProgress
 *  3. Renders CustomVideoPlayer (hls.js / native), or "Stream non disponibile" + Indietro
 *  Progress keeps flowing into "Continua a guardare" (localStorage + backend for logged users).
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Box, IconButton, Typography, Stack, CircularProgress, Button } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ErrorOutlineIcon from "@mui/icons-material/Error";
import VideocamOffOutlinedIcon from "@mui/icons-material/VideocamOffOutlined";
import { MAIN_PATH } from "src/constant";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import CustomVideoPlayer from "src/components/watch/CustomVideoPlayer";

const LOCAL_STORAGE_KEY = "netflix_continue_watching";
const MIN_WATCH_SECONDS = 10;
const SAVE_INTERVAL_MS = 15000;
const RESUME_RESOLVE_TIMEOUT_MS = 2500;
const RESUME_REWIND_SECONDS = 10;
const STREAM_TIMEOUT_MS = 45000;

function readLocalProgress(tmdbId) {
  try {
    const items = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "[]");
    return items.find((i) => i.tmdb_id === tmdbId) || null;
  } catch {
    return null;
  }
}

export function Component() {
  const { mediaType, id } = useParams();
  const [searchParams] = useSearchParams();
  const playerKey = `${mediaType}-${id}-${searchParams.get("s") || "1"}-${searchParams.get("e") || "1"}`;
  return <WatchPlayer key={playerKey} />;
}

function WatchPlayer() {
  const navigate = useNavigate();
  const { mediaType, id } = useParams<{ mediaType: string; id: string }>();
  const [searchParams] = useSearchParams();
  const { saveProgress } = useContinueWatching();

  const tmdbId = Number(id);
  const isTv = mediaType === "tv";
  const season = searchParams.get("s") || "1";
  const episode = searchParams.get("e") || "1";
  const startTimeParam = searchParams.get("t");
  const storageKey = isTv ? `${tmdbId}:s${season}e${episode}` : String(tmdbId);

  // Resume position resolved ONCE before the player mounts (local + backend, hard timeout)
  const [startAt, setStartAt] = useState<number | null>(() =>
    startTimeParam !== null ? Math.max(0, parseInt(startTimeParam, 10) || 0) : null
  );
  // Stream resolution: resolving | ready | unavailable | error
  const [streamState, setStreamState] = useState<{ status: string; stream?: string; type?: string; source?: string; message?: string }>({ status: "resolving" });
  const [title, setTitle] = useState("");
  const [episodeInfo, setEpisodeInfo] = useState({ name: "", hasNext: false });

  const metaRef = useRef({ title: "", backdrop_path: "", poster_path: "", duration: isTv ? 2700 : 7200 });
  const playbackRef = useRef({ currentTime: 0, duration: 0, hasEvents: false, lastSaved: 0 });
  const startAtRef = useRef(0);
  const mountedAtRef = useRef(Date.now());
  const historyLenAtMount = useRef(window.history.length);

  const matchesEpisode = useCallback(
    (saved) => !isTv || ((saved.season ?? 1) === Number(season) && (saved.episode ?? 1) === Number(episode)),
    [isTv, season, episode]
  );

  // ---- resume position (local + backend)
  useEffect(() => {
    if (!tmdbId || startAt !== null) return;
    let cancelled = false;
    const local = readLocalProgress(tmdbId);
    const localProgress = local && matchesEpisode(local) ? local.progress || 0 : 0;
    const finish = (progress) => {
      if (cancelled) return;
      const value = progress > 30 ? Math.max(0, Math.floor(progress) - RESUME_REWIND_SECONDS) : 0;
      startAtRef.current = value;
      setStartAt(value);
    };
    const token = localStorage.getItem("user_token");
    if (!token) { finish(localProgress); return; }
    const timeout = setTimeout(() => finish(localProgress), RESUME_RESOLVE_TIMEOUT_MS);
    fetch(`/api/auth/watch-progress/${tmdbId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        clearTimeout(timeout);
        const remote = data && matchesEpisode(data) ? data.progress || 0 : 0;
        if (data?.duration > 0) metaRef.current.duration = data.duration;
        finish(Math.max(localProgress, remote));
      })
      .catch(() => { clearTimeout(timeout); finish(localProgress); });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [tmdbId, startAt, matchesEpisode]);

  useEffect(() => { if (startAt !== null) startAtRef.current = startAt; }, [startAt]);

  // ---- stream resolution from the backend
  useEffect(() => {
    if (!tmdbId) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
    const url = isTv ? `/api/player/tv/${tmdbId}/${season}/${episode}` : `/api/player/movie/${tmdbId}`;
    setStreamState({ status: "resolving" });
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.detail || `Errore ${r.status}`);
        return data;
      })
      .then((data) => {
        if (data?.success && data.stream) setStreamState({ status: "ready", stream: data.stream, type: data.type || "hls", source: data.source });
        else setStreamState({ status: "unavailable", message: data?.message || "Stream non disponibile" });
      })
      .catch((e) => {
        if (controller.signal.aborted) setStreamState({ status: "error", message: "Tempo di attesa esaurito durante la ricerca dello stream" });
        else setStreamState({ status: "error", message: e?.message || "Impossibile contattare il server" });
      })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [tmdbId, isTv, season, episode]);

  // ---- title / images for "Continua a guardare"
  useEffect(() => {
    if (!tmdbId) return;
    fetch(`/api/public/media-assets/${isTv ? "tv" : "movie"}/${tmdbId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => {
        if (!a) return;
        metaRef.current.title = a.title || metaRef.current.title;
        setTitle(a.title || "");
        metaRef.current.backdrop_path = a.titled_backdrop_path || a.backdrop_path || "";
        metaRef.current.poster_path = a.poster_path || "";
        if (a.runtime > 0) metaRef.current.duration = a.runtime * 60;
      })
      .catch(() => {});
  }, [tmdbId, isTv]);

  // ---- episode name + next-episode availability
  useEffect(() => {
    if (!tmdbId || !isTv) return;
    fetch(`/api/public/tv/${tmdbId}/season/${season}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const eps = data?.episodes || [];
        const current = eps.find((e) => e.episode_number === Number(episode));
        const hasNext = eps.some((e) => e.episode_number === Number(episode) + 1);
        setEpisodeInfo({ name: current?.name || "", hasNext });
      })
      .catch(() => {});
  }, [tmdbId, isTv, season, episode]);

  // ---- progress persistence ("Continua a guardare": localStorage + backend when logged in)
  const persist = useCallback(() => {
    if (!tmdbId) return;
    const p = playbackRef.current;
    if (!p.hasEvents) return; // the native player reports real timeupdate events
    const elapsed = (Date.now() - mountedAtRef.current) / 1000;
    if (elapsed < MIN_WATCH_SECONDS && p.currentTime < MIN_WATCH_SECONDS) return;
    let progress = p.currentTime;
    const duration = p.duration || metaRef.current.duration;
    if (duration > 0) progress = Math.min(progress, duration);
    p.lastSaved = progress;
    saveProgress({
      tmdb_id: tmdbId,
      media_type: isTv ? "tv" : "movie",
      progress: Math.max(MIN_WATCH_SECONDS, Math.floor(progress)),
      duration: Math.floor(duration),
      title: metaRef.current.title || `${isTv ? "Serie TV" : "Film"} ${tmdbId}`,
      backdrop_path: metaRef.current.backdrop_path,
      poster_path: metaRef.current.poster_path,
      ...(isTv && { season: Number(season), episode: Number(episode) }),
    });
  }, [tmdbId, isTv, season, episode, saveProgress]);

  const handlePlayerProgress = useCallback((currentTime, duration) => {
    const p = playbackRef.current;
    p.currentTime = currentTime;
    if (duration > 0) p.duration = duration;
    p.hasEvents = true;
  }, []);

  useEffect(() => {
    const interval = setInterval(persist, SAVE_INTERVAL_MS);
    const onHide = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", onHide);
      persist();
    };
  }, [persist]);

  useEffect(() => {
    if (!tmdbId || !mediaType) return;
    fetch("/api/public/record-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdb_id: tmdbId, media_type: mediaType }),
    }).catch(() => {});
  }, [tmdbId, mediaType]);

  const goToNextEpisode = useCallback(() => {
    persist();
    navigate(`/${MAIN_PATH.watch}/tv/${tmdbId}?s=${season}&e=${Number(episode) + 1}`, { replace: true });
  }, [persist, navigate, tmdbId, season, episode]);

  const handleEnded = useCallback(() => {
    persist();
    if (isTv && episodeInfo.hasNext) goToNextEpisode();
  }, [persist, isTv, episodeInfo.hasNext, goToNextEpisode]);

  const handleGoBack = useCallback(() => {
    persist();
    const extra = Math.max(0, window.history.length - historyLenAtMount.current);
    if (historyLenAtMount.current > 1) navigate(-(1 + extra));
    else navigate(`/${MAIN_PATH.browse}`, { replace: true });
  }, [persist, navigate]);

  const handleGoHome = () => navigate(`/${MAIN_PATH.browse}`);
  const handlePlayerError = useCallback((msg) => setStreamState({ status: "error", message: msg }), []);

  if (!tmdbId) {
    return (
      <Box sx={{ width: "100vw", height: "100vh", bgcolor: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff" }}>
        <ErrorOutlineIcon sx={{ fontSize: 80, color: "#e50914", mb: 3 }} />
        <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>Contenuto non disponibile</Typography>
        <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.6)", mb: 4, textAlign: "center", maxWidth: 400 }}>
          Il contenuto richiesto non è attualmente disponibile.
        </Typography>
        <Button variant="contained" onClick={handleGoHome} startIcon={<ArrowBackIcon />} data-testid="go-home-button"
          sx={{ bgcolor: "#e50914", color: "#fff", px: 4, py: 1.5, borderRadius: 1, fontWeight: 600, "&:hover": { bgcolor: "#c40812" } }}>
          Torna alla Home
        </Button>
      </Box>
    );
  }

  const subtitle = isTv ? `S${season}:E${episode}${episodeInfo.name ? ` ${episodeInfo.name}` : ""}` : "";
  const playerReady = streamState.status === "ready" && startAt !== null;
  const backButton = (
    <Box sx={{ position: "absolute", top: 20, left: 20, zIndex: 100 }}>
      <IconButton onClick={handleGoBack} data-testid="back-button" aria-label="Indietro"
        sx={{ bgcolor: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", width: 48, height: 48,
          transition: "background-color 0.3s ease, transform 0.3s ease", "&:hover": { bgcolor: "#e50914", borderColor: "transparent", transform: "scale(1.1)" } }}>
        <ArrowBackIcon />
      </IconButton>
    </Box>
  );

  return (
    <Box data-testid="watch-page" sx={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", bgcolor: "#000", zIndex: 9999 }}>
      {/* Resolving the stream */}
      {(streamState.status === "resolving" || (streamState.status === "ready" && startAt === null)) && (
        <Box data-testid="watch-loading" sx={{ position: "absolute", inset: 0, bgcolor: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          {backButton}
          <CircularProgress sx={{ color: "#e50914", mb: 3 }} size={60} />
          <Typography variant="h6" sx={{ color: "#fff", mb: 1 }}>Ricerca dello stream in corso...</Typography>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.5)" }}>
            {title ? `${title} - ` : ""}{isTv ? `Stagione ${season} - Episodio ${episode}` : "Film"}
          </Typography>
        </Box>
      )}

      {/* Player */}
      {playerReady && (
        <CustomVideoPlayer
          key={`${storageKey}-${streamState.stream}`}
          src={streamState.stream}
          type={streamState.type}
          storageKey={storageKey}
          startAt={startAt}
          title={title || (isTv ? "Serie TV" : "Film")}
          subtitle={subtitle}
          poster={metaRef.current.backdrop_path ? `https://image.tmdb.org/t/p/w1280${metaRef.current.backdrop_path}` : undefined}
          hasNext={isTv && episodeInfo.hasNext}
          onNext={goToNextEpisode}
          onBack={handleGoBack}
          onProgress={handlePlayerProgress}
          onEnded={handleEnded}
          onError={handlePlayerError}
        />
      )}

      {/* Stream not available */}
      {streamState.status === "unavailable" && (
        <Box data-testid="stream-unavailable" sx={{ position: "absolute", inset: 0, bgcolor: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10, px: 3 }}>
          {backButton}
          <VideocamOffOutlinedIcon sx={{ fontSize: 84, color: "rgba(255,255,255,0.35)", mb: 3 }} />
          <Typography variant="h4" sx={{ color: "#fff", fontWeight: 700, mb: 1.5, textAlign: "center" }}>Stream non disponibile</Typography>
          <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.6)", mb: 1, textAlign: "center", maxWidth: 520 }}>
            {title ? `"${title}"` : "Questo titolo"}{isTv ? ` (S${season}E${episode})` : ""} non ha ancora una sorgente video configurata.
          </Typography>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.4)", mb: 4, textAlign: "center", maxWidth: 520 }}>
            Un amministratore può aggiungere lo stream da Admin &gt; Contenuti.
          </Typography>
          <Button variant="contained" onClick={handleGoBack} startIcon={<ArrowBackIcon />} data-testid="unavailable-back-button"
            sx={{ bgcolor: "#e50914", color: "#fff", px: 4, py: 1.5, borderRadius: 1, fontWeight: 600, "&:hover": { bgcolor: "#c40812" } }}>
            Indietro
          </Button>
        </Box>
      )}

      {/* Error */}
      {streamState.status === "error" && (
        <Box data-testid="stream-error" sx={{ position: "absolute", inset: 0, bgcolor: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10, px: 3 }}>
          {backButton}
          <ErrorOutlineIcon sx={{ fontSize: 72, color: "#e50914", mb: 3 }} />
          <Typography variant="h5" sx={{ color: "#fff", fontWeight: 700, mb: 1.5 }}>Errore di riproduzione</Typography>
          <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.6)", mb: 4, textAlign: "center", maxWidth: 480 }}>{streamState.message}</Typography>
          <Stack direction="row" spacing={2}>
            <Button variant="contained" onClick={() => window.location.reload()} sx={{ bgcolor: "#e50914", "&:hover": { bgcolor: "#c40812" } }}>Riprova</Button>
            <Button variant="outlined" onClick={handleGoBack} sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)", "&:hover": { bgcolor: "rgba(255,255,255,0.1)" } }}>Indietro</Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

Component.displayName = "WatchPage";
