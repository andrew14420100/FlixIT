// @ts-nocheck
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Box, IconButton, Typography, Stack, CircularProgress, Button } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ErrorOutlineIcon from "@mui/icons-material/Error";
import { MAIN_PATH } from "src/constant";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { PlayerInfoOverlay } from "src/components/watch/PlayerInfoOverlay";

const LOCAL_STORAGE_KEY = "netflix_continue_watching";
const MIN_WATCH_SECONDS = 10;
const SAVE_INTERVAL_MS = 15000;
const RESUME_RESOLVE_TIMEOUT_MS = 2500;

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

  // Resume position is resolved ONCE before the player mounts: the iframe src must never change
  // afterwards (a src change reloads the video and pollutes the browser history).
  const [startAt, setStartAt] = useState<number | null>(() =>
    startTimeParam !== null ? Math.max(0, parseInt(startTimeParam, 10) || 0) : null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [episodeInfo, setEpisodeInfo] = useState({ name: "", hasNext: false });

  const metaRef = useRef({ title: "", backdrop_path: "", poster_path: "", duration: isTv ? 2700 : 7200 });
  const playbackRef = useRef({ currentTime: 0, duration: 0, hasEvents: false });
  const startAtRef = useRef(0);
  const mountedAtRef = useRef(Date.now());
  const historyLenAtMount = useRef(window.history.length);

  const matchesEpisode = useCallback(
    (saved) => !isTv || ((saved.season ?? 1) === Number(season) && (saved.episode ?? 1) === Number(episode)),
    [isTv, season, episode]
  );

  // Resolve resume position (local + backend) with a hard timeout
  useEffect(() => {
    if (!tmdbId || startAt !== null) return;
    let cancelled = false;
    const local = readLocalProgress(tmdbId);
    const localProgress = local && matchesEpisode(local) ? local.progress || 0 : 0;
    const finish = (progress) => {
      if (cancelled) return;
      const value = progress > 30 ? Math.floor(progress) : 0;
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

  // Title / images for the "Continua a guardare" entry
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

  // Episode name + next-episode availability for the player overlay
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

  const goToNextEpisode = () => {
    persist();
    navigate(`/${MAIN_PATH.watch}/tv/${tmdbId}?s=${season}&e=${Number(episode) + 1}`, { replace: true });
  };

  const vixSrcUrl = useMemo(() => {
    if (!tmdbId || startAt === null) return null;
    const base = isTv ? `https://vixsrc.to/tv/${tmdbId}/${season}/${episode}` : `https://vixsrc.to/movie/${tmdbId}`;
    const params = new URLSearchParams({ primaryColor: "E50914", secondaryColor: "8B0000", autoplay: "true", lang: "it" });
    if (startAt > 30) params.set("startAt", String(startAt));
    return `${base}?${params.toString()}`;
  }, [tmdbId, isTv, season, episode, startAt]);

  const persist = useCallback(() => {
    if (!tmdbId) return;
    const elapsed = (Date.now() - mountedAtRef.current) / 1000;
    if (elapsed < MIN_WATCH_SECONDS) return;
    const p = playbackRef.current;
    const progress = p.hasEvents ? p.currentTime : startAtRef.current + elapsed;
    const duration = p.duration || metaRef.current.duration;
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

  // Real playback position from the VixSrc player (PLAYER_EVENT postMessage API)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== "PLAYER_EVENT" || !d.data) return;
      const { event: name, currentTime, duration } = d.data;
      const p = playbackRef.current;
      p.hasEvents = true;
      if (typeof currentTime === "number" && currentTime >= 0) p.currentTime = currentTime;
      if (typeof duration === "number" && duration > 0) p.duration = duration;
      if (name === "pause" || name === "ended") persist();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [persist]);

  // Periodic save + save on leave
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

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  // The embedded player may push its own entries into the joint browser history:
  // go back past all of them so "Indietro" always returns to the previous page.
  const handleGoBack = () => {
    persist();
    const extra = Math.max(0, window.history.length - historyLenAtMount.current);
    if (historyLenAtMount.current > 1) navigate(-(1 + extra));
    else navigate(`/${MAIN_PATH.browse}`, { replace: true });
  };

  const handleGoHome = () => navigate(`/${MAIN_PATH.browse}`);

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

  return (
    <Box data-testid="watch-page" sx={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", bgcolor: "#000", zIndex: 9999 }}>
      {isLoading && (
        <Box data-testid="watch-loading" sx={{ position: "absolute", inset: 0, bgcolor: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          <CircularProgress sx={{ color: "#e50914", mb: 3 }} size={60} />
          <Typography variant="h6" sx={{ color: "#fff", mb: 1 }}>Caricamento in corso...</Typography>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.5)" }}>
            {isTv ? `Stagione ${season} - Episodio ${episode}` : "Film"}
          </Typography>
        </Box>
      )}

      <Box sx={{ position: "absolute", top: 20, left: 20, zIndex: 100 }}>
        <IconButton onClick={handleGoBack} data-testid="back-button"
          sx={{ bgcolor: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", width: 48, height: 48,
            transition: "background-color 0.3s ease, transform 0.3s ease", "&:hover": { bgcolor: "#e50914", borderColor: "transparent", transform: "scale(1.1)" } }}>
          <ArrowBackIcon />
        </IconButton>
      </Box>

      {isTv && (
        <Box sx={{ position: "absolute", top: 20, right: 20, zIndex: 100, bgcolor: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)", px: 2, py: 1, borderRadius: 2, border: "1px solid rgba(255,255,255,0.2)" }}>
          <Typography variant="body2" sx={{ color: "#fff", fontWeight: 600 }}>S{season} E{episode}</Typography>
        </Box>
      )}

      {vixSrcUrl && !error && (
        <PlayerInfoOverlay
          title={title}
          isTv={isTv}
          season={season}
          episode={episode}
          episodeName={episodeInfo.name}
          hasNext={episodeInfo.hasNext}
          onNext={goToNextEpisode}
        />
      )}

      {vixSrcUrl && (
        <iframe
          key={vixSrcUrl}
          src={vixSrcUrl}
          style={{ width: "100%", height: "100%", border: "none" }}
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          data-testid="vixsrc-player"
          title={isTv ? `Serie TV - S${season}E${episode}` : "Film"}
          onLoad={() => setIsLoading(false)}
          onError={() => { setIsLoading(false); setError("Impossibile caricare il contenuto"); }}
        />
      )}

      {error && (
        <Box sx={{ position: "absolute", inset: 0, bgcolor: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          <Typography variant="h5" sx={{ color: "#e50914", mb: 2 }}>Errore</Typography>
          <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.6)", mb: 4 }}>{error}</Typography>
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
