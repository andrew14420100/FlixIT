// @ts-nocheck
/**
 * WatchPage - native playback.
 * Reuses Hero/Detail stream warmup immediately, resolves only on a cold miss,
 * mounts the player as soon as a stream exists and persists Continue Watching.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Box, IconButton, Typography, CircularProgress, Button } from "@mui/material";
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
    return items.find((item) => item.tmdb_id === tmdbId) || null;
  } catch {
    return null;
  }
}

function normalizePrefetched(raw, cacheKey) {
  if (!raw) return null;
  try {
    const item = typeof raw === "string" ? JSON.parse(raw) : raw;
    const data = item?.data || item;
    const savedAt = Number(item?.savedAt || item?.ts || item?.timestamp || Date.now());
    if (Date.now() - savedAt > STREAM_CACHE_TTL_MS) return null;
    if (!data?.stream) return null;
    return {
      stream: data.stream,
      type: data.type || "hls",
      source: data.source,
      savedAt,
      cacheKey,
    };
  } catch {
    return null;
  }
}

function logicalParts(mediaType, tmdbId, season, episode) {
  return {
    type: mediaType === "tv" ? "tv" : "movie",
    id: String(tmdbId),
    season: mediaType === "tv" ? String(season || 1) : "0",
    episode: mediaType === "tv" ? String(episode || 1) : "0",
  };
}

function cacheKeyFor(mediaType, tmdbId, season, episode) {
  const p = logicalParts(mediaType, tmdbId, season, episode);
  return `${p.type}:${p.id}:${p.season}:${p.episode}`;
}

function readCachedStream(mediaType, tmdbId, season, episode) {
  try {
    const p = logicalParts(mediaType, tmdbId, season, episode);
    const logicalKey = `${p.type}:${p.id}:${p.season}:${p.episode}`;
    const candidates = [
      STREAM_CACHE_PREFIX + logicalKey,
      `stream:${logicalKey}`,
      `stream_${p.type}_${p.id}_${p.season}_${p.episode}`,
      `stream-${p.type}-${p.id}-${p.season}-${p.episode}`,
    ];

    // Older DetailPage versions warmed movies as 0:0 while WatchPage used its
    // router defaults 1:1. Always accept both aliases during the migration.
    if (p.type === "movie") {
      candidates.push(
        `${STREAM_CACHE_PREFIX}movie:${p.id}:1:1`,
        `stream:movie:${p.id}:1:1`,
        `stream_movie_${p.id}_1_1`,
        `stream-movie-${p.id}-1-1`
      );
    }

    for (const key of candidates) {
      const value = normalizePrefetched(sessionStorage.getItem(key), key);
      if (value) return value;
    }
    return null;
  } catch {
    return null;
  }
}

function cacheStream(mediaType, tmdbId, season, episode, data) {
  if (!data?.stream) return;
  try {
    const key = cacheKeyFor(mediaType, tmdbId, season, episode);
    sessionStorage.setItem(
      STREAM_CACHE_PREFIX + key,
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

  const [startAt, setStartAt] = useState<number | null>(() =>
    startTimeParam !== null ? Math.max(0, parseInt(startTimeParam, 10) || 0) : null
  );
  const [streamState, setStreamState] = useState<{
    status: string;
    stream?: string;
    type?: string;
    source?: string;
    message?: string;
  }>({ status: "resolving" });
  const [title, setTitle] = useState("");
  const [backdrop, setBackdrop] = useState("");
  const [episodeInfo, setEpisodeInfo] = useState({ name: "", hasNext: false });

  const metaRef = useRef({
    title: "",
    backdrop_path: "",
    poster_path: "",
    duration: isTv ? 2700 : 7200,
  });
  const playbackRef = useRef({
    currentTime: 0,
    duration: 0,
    hasEvents: false,
    lastSaved: 0,
  });
  const mountedAtRef = useRef(Date.now());

  const matchesEpisode = useCallback(
    (saved) =>
      !isTv ||
      ((saved.season ?? 1) === Number(season) &&
        (saved.episode ?? 1) === Number(episode)),
    [isTv, season, episode]
  );

  // Resume position is independent from stream resolution and therefore never
  // delays player mounting.
  useEffect(() => {
    if (!isValidTmdbId || startAt !== null) return;
    let cancelled = false;
    const local = readLocalProgress(tmdbId);
    const localProgress = local && matchesEpisode(local) ? Number(local.progress || 0) : 0;

    const finish = (progress) => {
      if (cancelled) return;
      const value = progress > 30
        ? Math.max(0, Math.floor(progress) - RESUME_REWIND_SECONDS)
        : 0;
      setStartAt(value);
    };

    const token = localStorage.getItem("user_token");
    if (!token) {
      finish(localProgress);
      return;
    }

    const fallback = window.setTimeout(
      () => finish(localProgress),
      RESUME_RESOLVE_TIMEOUT_MS
    );
    fetch(`/api/auth/watch-progress/${tmdbId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        window.clearTimeout(fallback);
        const remote = data && matchesEpisode(data) ? Number(data.progress || 0) : 0;
        if (data?.duration > 0) metaRef.current.duration = data.duration;
        finish(Math.max(localProgress, remote));
      })
      .catch(() => {
        window.clearTimeout(fallback);
        finish(localProgress);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, [tmdbId, startAt, matchesEpisode, isValidTmdbId]);

  // Stream resolution. A recent Hero/Detail prefetch is authoritative for this
  // short TTL and avoids a duplicate backend round-trip completely.
  useEffect(() => {
    if (!isValidTmdbId) return;

    const cached = readCachedStream(mediaType, tmdbId, season, episode);
    if (cached?.stream) {
      cacheStream(mediaType, tmdbId, season, episode, cached);
      setStreamState({
        status: "ready",
        stream: cached.stream,
        type: cached.type || "hls",
        source: cached.source,
      });
      return;
    }

    setStreamState({ status: "resolving" });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
    const url = isTv
      ? `/api/player/tv/${tmdbId}/${season}/${episode}`
      : `/api/player/movie/${tmdbId}`;

    fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.detail || `Errore ${response.status}`);
        return data;
      })
      .then((data) => {
        if (data?.success && data.stream) {
          cacheStream(mediaType, tmdbId, season, episode, data);
          setStreamState({
            status: "ready",
            stream: data.stream,
            type: data.type || "hls",
            source: data.source,
          });
        } else if (data?.reason === "temporary") {
          setStreamState({
            status: "error",
            message: data?.message || "Sorgente momentaneamente non raggiungibile",
          });
        } else {
          setStreamState({
            status: "unavailable",
            message: data?.message || "Stream non disponibile",
          });
        }
      })
      .catch((error) => {
        setStreamState({
          status: "error",
          message: controller.signal.aborted
            ? "Tempo di attesa esaurito durante la preparazione dello stream"
            : error?.message || "Impossibile contattare il server",
        });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [tmdbId, mediaType, isTv, season, episode, isValidTmdbId]);

  // Metadata/artwork load in parallel with stream resolution.
  useEffect(() => {
    if (!isValidTmdbId) return;
    const controller = new AbortController();
    fetch(`/api/public/media-assets/${isTv ? "tv" : "movie"}/${tmdbId}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((asset) => {
        if (!asset) return;
        metaRef.current.title = asset.title || metaRef.current.title;
        setTitle(asset.title || "");
        const backdropPath = asset.backdrop_path || asset.titled_backdrop_path || "";
        const posterPath = asset.poster_path || "";
        metaRef.current.backdrop_path = backdropPath;
        metaRef.current.poster_path = posterPath;
        if (backdropPath) {
          setBackdrop(
            /^https?:\/\//i.test(backdropPath)
              ? backdropPath
              : `https://image.tmdb.org/t/p/original${backdropPath}`
          );
        }
        if (asset.runtime > 0) metaRef.current.duration = asset.runtime * 60;
      })
      .catch(() => {});
    return () => controller.abort();
  }, [tmdbId, isTv, isValidTmdbId]);

  useEffect(() => {
    if (!isValidTmdbId || !isTv) return;
    const controller = new AbortController();
    fetch(`/api/public/tv/${tmdbId}/season/${season}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const episodes = data?.episodes || [];
        const current = episodes.find((item) => item.episode_number === Number(episode));
        const hasNext = episodes.some((item) => item.episode_number === Number(episode) + 1);
        setEpisodeInfo({ name: current?.name || "", hasNext });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [tmdbId, isTv, season, episode, isValidTmdbId]);

  const persist = useCallback(() => {
    if (!isValidTmdbId) return;
    const playback = playbackRef.current;
    if (!playback.hasEvents) return;
    const elapsed = (Date.now() - mountedAtRef.current) / 1000;
    if (elapsed < MIN_WATCH_SECONDS && playback.currentTime < MIN_WATCH_SECONDS) return;

    let progress = playback.currentTime;
    const duration = playback.duration || metaRef.current.duration;
    if (duration > 0) progress = Math.min(progress, duration);
    playback.lastSaved = progress;

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
  }, [tmdbId, isTv, season, episode, saveProgress, isValidTmdbId]);

  const handlePlayerProgress = useCallback((currentTime, duration) => {
    const playback = playbackRef.current;
    playback.currentTime = currentTime;
    if (duration > 0) playback.duration = duration;
    playback.hasEvents = true;
  }, []);

  useEffect(() => {
    const interval = window.setInterval(persist, SAVE_INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", onHide);
      persist();
    };
  }, [persist]);

  useEffect(() => {
    if (!isValidTmdbId || !mediaType) return;
    fetch("/api/public/record-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdb_id: tmdbId, media_type: mediaType }),
    }).catch(() => {});
  }, [tmdbId, mediaType, isValidTmdbId]);

  const goToNextEpisode = useCallback(() => {
    persist();
    navigate(
      `/${MAIN_PATH.watch}/tv/${tmdbId}?s=${season}&e=${Number(episode) + 1}`,
      { replace: true }
    );
  }, [persist, navigate, tmdbId, season, episode]);

  const handleEnded = useCallback(() => {
    persist();
    if (isTv && episodeInfo.hasNext) goToNextEpisode();
  }, [persist, isTv, episodeInfo.hasNext, goToNextEpisode]);

  const handleGoBack = useCallback(() => {
    persist();
    if (window.history.length > 1) navigate(-1);
    else navigate(`/${MAIN_PATH.browse}`, { replace: true });
  }, [persist, navigate]);

  const handleGoHome = () => navigate(`/${MAIN_PATH.browse}`);
  const handlePlayerError = useCallback(() => {
    // HLS recovery remains inside CustomVideoPlayer; do not replace the player
    // with a transient full-screen error on recoverable media events.
  }, []);

  if (!isValidTmdbId) {
    return (
      <Box
        sx={{
          width: "100vw",
          height: "100vh",
          bgcolor: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
        }}
      >
        <ErrorOutlineIcon sx={{ fontSize: 80, color: "#e50914", mb: 3 }} />
        <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>
          Contenuto non disponibile
        </Typography>
        <Button
          variant="contained"
          onClick={handleGoHome}
          startIcon={<ArrowBackIcon />}
          data-testid="go-home-button"
          sx={{
            bgcolor: "#e50914",
            color: "#fff",
            px: 4,
            py: 1.5,
            borderRadius: 1,
            fontWeight: 600,
            "&:hover": { bgcolor: "#c40812" },
          }}
        >
          Torna alla Home
        </Button>
      </Box>
    );
  }

  const subtitle = isTv
    ? `S${season}:E${episode}${episodeInfo.name ? ` ${episodeInfo.name}` : ""}`
    : "";
  const playerReady = streamState.status === "ready";
  const effectiveStartAt = startAt ?? 0;

  const backButton = (
    <Box sx={{ position: "absolute", top: 20, left: 20, zIndex: 100 }}>
      <IconButton
        onClick={handleGoBack}
        data-testid="back-button"
        aria-label="Indietro"
        sx={{
          bgcolor: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(10px)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          width: 48,
          height: 48,
          transition: "background-color 0.3s ease, transform 0.3s ease",
          "&:hover": {
            bgcolor: "#e50914",
            borderColor: "transparent",
            transform: "scale(1.1)",
          },
        }}
      >
        <ArrowBackIcon />
      </IconButton>
    </Box>
  );

  return (
    <Box
      data-testid="watch-page"
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        bgcolor: "#000",
        zIndex: 9999,
      }}
    >
      {streamState.status === "resolving" && (
        <Box
          data-testid="watch-loading"
          sx={{
            position: "absolute",
            inset: 0,
            bgcolor: "#0a0a0a",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
          }}
        >
          {backdrop && (
            <Box
              component="img"
              src={backdrop}
              alt=""
              data-testid="watch-loading-backdrop"
              decoding="async"
              sx={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.35,
                filter: "blur(2px)",
                animation: "flixFadeIn 600ms ease both",
              }}
            />
          )}
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(to top, rgba(10,10,10,0.95), rgba(10,10,10,0.4))",
            }}
          />
          {backButton}
          <CircularProgress
            sx={{ color: "#e50914", mb: 3, position: "relative" }}
            size={60}
          />
          <Typography variant="h6" sx={{ color: "#fff", mb: 1, position: "relative" }}>
            Preparazione riproduzione...
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: "rgba(255,255,255,0.5)", position: "relative" }}
          >
            {title ? `${title} - ` : ""}
            {isTv ? `Stagione ${season} - Episodio ${episode}` : "Film"}
          </Typography>
        </Box>
      )}

      {playerReady && (
        <CustomVideoPlayer
          key={`${storageKey}-${streamState.stream}`}
          src={streamState.stream}
          type={streamState.type}
          storageKey={storageKey}
          startAt={effectiveStartAt}
          autoPlay={true}
          title={title || (isTv ? "Serie TV" : "Film")}
          subtitle={subtitle}
          poster={
            metaRef.current.backdrop_path
              ? /^https?:\/\//i.test(metaRef.current.backdrop_path)
                ? metaRef.current.backdrop_path
                : `https://image.tmdb.org/t/p/original${metaRef.current.backdrop_path}`
              : undefined
          }
          hasNext={isTv && episodeInfo.hasNext}
          onNext={goToNextEpisode}
          onBack={handleGoBack}
          onProgress={handlePlayerProgress}
          onEnded={handleEnded}
          onError={handlePlayerError}
        />
      )}

      {(streamState.status === "unavailable" || streamState.status === "error") && (
        <Box
          data-testid="stream-unavailable"
          sx={{
            position: "absolute",
            inset: 0,
            bgcolor: "#0a0a0a",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            px: 3,
          }}
        >
          {backButton}
          <VideocamOffOutlinedIcon
            sx={{ fontSize: 84, color: "rgba(255,255,255,0.35)", mb: 3 }}
          />
          <Typography
            variant="h4"
            sx={{ color: "#fff", fontWeight: 700, mb: 1.5, textAlign: "center" }}
          >
            Stream non disponibile
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "rgba(255,255,255,0.6)",
              mb: 4,
              textAlign: "center",
              maxWidth: 520,
            }}
          >
            {streamState.message || "La sorgente non è disponibile in questo momento."}
          </Typography>
          <Button
            variant="contained"
            onClick={handleGoBack}
            startIcon={<ArrowBackIcon />}
            data-testid="unavailable-back-button"
            sx={{
              bgcolor: "#e50914",
              color: "#fff",
              px: 4,
              py: 1.5,
              borderRadius: 1,
              fontWeight: 600,
              "&:hover": { bgcolor: "#c40812" },
            }}
          >
            Indietro
          </Button>
        </Box>
      )}
    </Box>
  );
}

Component.displayName = "WatchPage";
