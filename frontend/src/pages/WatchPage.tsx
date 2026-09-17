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
const RESUME_RESOLVE_TIMEOUT_MS = 500;
const RESUME_REWIND_SECONDS = 10;
const STREAM_TIMEOUT_MS = 30000;
const STREAM_CACHE_TTL_MS = 2 * 60 * 1000;
const STREAM_CACHE_PREFIX = "watch_stream_cache:";

function readLocalProgress(tmdbId) {
  try {
    const items = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "[]");
    return items.find((i) => i.tmdb_id === tmdbId) || null;
  } catch {
    return null;
  }
}

function readCachedStream(cacheKey) {
  try {
    const raw = sessionStorage.getItem(STREAM_CACHE_PREFIX + cacheKey);
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (!item?.stream || Date.now() - item.savedAt > STREAM_CACHE_TTL_MS) {
      sessionStorage.removeItem(STREAM_CACHE_PREFIX + cacheKey);
      return null;
    }
    return item;
  } catch {
    return null;
  }
}

function cacheStream(cacheKey, data) {
  try {
    sessionStorage.setItem(
      STREAM_CACHE_PREFIX + cacheKey,
      JSON.stringify({
        stream: data.stream,
        type: data.type || "hls",
        source: data.source,
        savedAt: Date.now(),
      })
    );
  } catch {}
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
  const isValidTmdbId = Number.isInteger(tmdbId) && tmdbId > 0;
  const isTv = mediaType === "tv";
  const season = searchParams.get("s") || "1";
  const episode = searchParams.get("e") || "1";
  const startTimeParam = searchParams.get("t");
  const storageKey = isTv ? `${tmdbId}:s${season}e${episode}` : String(tmdbId);

  // Resume position is resolved independently so it never blocks player startup
  const [startAt, setStartAt] = useState<number | null>(() =>
    startTimeParam !== null ? Math.max(0, parseInt(startTimeParam, 10) || 0) : null
  );
  // Stream resolution: resolving | ready | unavailable | error
  const [streamState, setStreamState] = useState<{ status: string; stream?: string; type?: string; source?: string; message?: string }>({ status: "resolving" });
  const [title, setTitle] = useState("");
  const [backdrop, setBackdrop] = useState("");
  const [attempt, setAttempt] = useState(0);
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
  }, [tmdbId, startAt, matchesEpisode, isValidTmdbId]);

  useEffect(() => { if (startAt !== null) startAtRef.current = startAt; }, [startAt]);

  // ---- stream resolution from the backend
  useEffect(() => {
    if (!isValidTmdbId) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
    const url = isTv ? `/api/player/tv/${tmdbId}/${season}/${episode}` : `/api/player/movie/${tmdbId}`;
    if (playerErrorTimerRef.current) {
      clearTimeout(playerErrorTimerRef.current);
      playerErrorTimerRef.current = null;
    }
    const cacheKey = `${isTv ? "tv" : "movie"}:${tmdbId}:${season}:${episode}`;
    const cached = readCachedStream(cacheKey);

    // Use a very recent resolved stream immediately. This removes the resolver
    // round-trip when the user returns to the same title/episode.
    if (cached?.stream) {
      setStreamState({
        status: "ready",
        stream: cached.stream,
        type: cached.type || "hls",
        source: cached.source,
      });
    } else {
      setStreamState({ status: "resolving" });
    }

    const request = () => fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(async (r) => {
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.detail || `Errore ${r.status}`);
      return data;
    });

    // One resolver request only. Retrying here can duplicate an expensive
    // backend resolution and make "Guarda" feel slower when the first call fails.
    request()
      .then((data) => {
        if (data?.success && data.stream) {
          cacheStream(cacheKey, data);
          setStreamState({
            status: "ready",
            stream: data.stream,
            type: data.type || "hls",
            source: data.source,
          });
        } else if (data?.reason === "temporary") {
          setStreamState({ status: "error", message: data?.message || "Sorgente momentaneamente non raggiungibile" });
        } else {
          setStreamState({ status: "unavailable", message: data?.message || "Stream non disponibile" });
        }
      })
      .catch((e) => {
        if (controller.signal.aborted) setStreamState({ status: "error", message: "Tempo di attesa esaurito durante la ricerca dello stream" });
        else setStreamState({ status: "error", message: e?.message || "Impossibile contattare il server" });
      })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [tmdbId, isTv, season, episode, attempt, isValidTmdbId]);

  // ---- title / images for "Continua a guardare"
  useEffect(() => {
    if (!isValidTmdbId) return;
    fetch(`/api/public/media-assets/${isTv ? "tv" : "movie"}/${tmdbId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => {
        if (!a) return;
        metaRef.current.title = a.title || metaRef.current.title;
        setTitle(a.title || "");
        const backdropPath = a.titled_backdrop_path || a.backdrop_path || "";
        const posterPath = a.poster_path || "";
        metaRef.current.backdrop_path = backdropPath;
        metaRef.current.poster_path = posterPath;
        if (backdropPath) {
          setBackdrop(
            /^https?:\/\//i.test(backdropPath)
              ? backdropPath
              : `https://image.tmdb.org/t/p/w1280${backdropPath}`
          );
        }
        if (a.runtime > 0) metaRef.current.duration = a.runtime * 60;
      })
      .catch(() => {});
  }, [tmdbId, isTv, isValidTmdbId]);

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
  }, [tmdbId, isTv, season, episode, isValidTmdbId]);

  // ---- progress persistence ("Continua a guardare": localStorage + backend when logged in)
  const persist = useCallback(() => {
    if (!isValidTmdbId) return;
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
      progress: Math.max(0, Math.floor(progress)),
      duration: Math.floor(duration),
      title: metaRef.current.title || `${isTv ? "Serie TV" : "Film"} ${tmdbId}`,
      backdrop_path: metaRef.current.backdrop_path,
      poster_path: metaRef.current.poster_path,
      ...(isTv && { season: Number(season), episode: Number(episode) }),
    });
  }, [tmdbId, isTv, season, episode, saveProgress]);

  const handlePlayerProgress = useCallback((currentTime, duration) => {
    if (playerErrorTimerRef.current) {
      clearTimeout(playerErrorTimerRef.current);
      playerErrorTimerRef.current = null;
    }
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
  }, [tmdbId, mediaType, isValidTmdbId]);

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
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(`/${MAIN_PATH.browse}`, { replace: true });
    }
  }, [persist, navigate]);

  const handleGoHome = () => navigate(`/${MAIN_PATH.browse}`);
  const playerErrorTimerRef = useRef(null);

  const handlePlayerError = useCallback((_msg) => {
    // Playback/HLS errors are handled entirely by CustomVideoPlayer.
    // Never switch the WatchPage into its full-screen error state.
  }, []);


  if (!isValidTmdbId) {
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
  // Mount the player as soon as the stream is ready.
  // Resume resolution runs independently in the background.
  const playerReady = streamState.status === "ready";
  const effectiveStartAt = startAt ?? 0;
  const posterUrl = metaRef.current.backdrop_path
    ? (/^https?:\/\//i.test(metaRef.current.backdrop_path)
        ? metaRef.current.backdrop_path
        : `https://image.tmdb.org/t/p/w1280${metaRef.current.backdrop_path}`)
    : undefined;
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
      {streamState.status === "resolving" && (
        <Box data-testid="watch-loading" sx={{ position: "absolute", inset: 0, bgcolor: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          {backdrop && (
            <Box component="img" src={backdrop} alt="" data-testid="watch-loading-backdrop"
              sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.35, filter: "blur(2px)", animation: "flixFadeIn 600ms ease both" }} />
          )}
          <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(10,10,10,0.95), rgba(10,10,10,0.4))" }} />
          {backButton}
          <CircularProgress sx={{ color: "#e50914", mb: 3, position: "relative" }} size={60} />
          <Typography variant="h6" sx={{ color: "#fff", mb: 1, position: "relative" }}>Ricerca dello stream in corso...</Typography>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.5)", position: "relative" }}>
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
          autoPlay={true}
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


    </Box>
  );
}

Component.displayName = "WatchPage";
