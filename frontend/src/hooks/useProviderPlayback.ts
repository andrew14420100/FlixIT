import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MAIN_PATH } from "src/constant";

// Use the same origin in production so nginx/Emergent proxies /api correctly.
// An explicit backend base can still be supplied for local/split deployments.
const PLAYER_API_BASE = String(
  process.env.REACT_APP_PROVIDER_API_BASE ||
    process.env.REACT_APP_BACKEND_URL ||
    ""
).replace(/\/+$/, "");

const STREAM_CACHE_PREFIX = "watch_stream_cache:";

type MediaType = "movie" | "tv";

type StartPlaybackOptions = {
  contentTitle?: string;
  mediaType: MediaType | string;
  mediaId: number | string;
  season?: number;
  episode?: number;
  startTime?: number;
};

type PlayerPayload = {
  success?: boolean;
  stream?: string;
  streamUrl?: string;
  type?: string;
  source?: string;
  message?: string;
  detail?: string;
  error?: string;
  reason?: string;
};

function inferStreamType(streamUrl: string, explicitType?: string) {
  if (explicitType) return explicitType;
  const clean = String(streamUrl || "").split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8")) return "hls";
  if (clean.endsWith(".mp4")) return "mp4";
  return "hls";
}

function cachePlayerStream(
  mediaType: MediaType,
  mediaId: number,
  season: number,
  episode: number,
  streamUrl: string,
  type: string,
  source?: string
) {
  if (typeof window === "undefined") return;

  const s = mediaType === "tv" ? season : 0;
  const e = mediaType === "tv" ? episode : 0;
  const logicalKey = `${mediaType}:${mediaId}:${s}:${e}`;
  const now = Date.now();
  const normalized = {
    stream: streamUrl,
    type,
    source: source || "player-api",
    savedAt: now,
  };

  try {
    sessionStorage.setItem(
      STREAM_CACHE_PREFIX + logicalKey,
      JSON.stringify(normalized)
    );

    const legacyPayload = JSON.stringify({
      data: {
        success: true,
        stream: streamUrl,
        type,
        source: normalized.source,
      },
      ts: now,
      timestamp: now,
    });

    [
      `stream:${logicalKey}`,
      `stream_${mediaType}_${mediaId}_${s}_${e}`,
      `stream-${mediaType}-${mediaId}-${s}-${e}`,
    ].forEach((key) => sessionStorage.setItem(key, legacyPayload));

    // WatchPage supports the historical movie alias using 1:1 as well as 0:0.
    if (mediaType === "movie") {
      sessionStorage.setItem(
        `${STREAM_CACHE_PREFIX}movie:${mediaId}:1:1`,
        JSON.stringify(normalized)
      );
    }
  } catch {
    // If storage is unavailable, WatchPage can still resolve again after navigation.
  }
}

function playerErrorMessage(data: PlayerPayload | null, status?: number) {
  return (
    data?.message ||
    data?.detail ||
    data?.error ||
    (status
      ? `Il server ha risposto con errore ${status}`
      : "Sorgente video non disponibile")
  );
}

function buildRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  // Ngrok Free can return an interstitial page to browser requests unless this
  // header is present. Add it only for ngrok targets so normal deployments stay unchanged.
  if (/ngrok-free\.(app|dev)(?::\d+)?$/i.test(PLAYER_API_BASE.replace(/^https?:\/\//i, ""))) {
    headers["ngrok-skip-browser-warning"] = "1";
  }

  return headers;
}

export default function useProviderPlayback() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  const startPlayback = useCallback(
    async ({
      mediaType,
      mediaId,
      season = 1,
      episode = 1,
      startTime = 0,
    }: StartPlaybackOptions) => {
      if (controllerRef.current) return false;

      const normalizedType: MediaType = mediaType === "tv" ? "tv" : "movie";
      const numericId = Number(mediaId);
      const normalizedSeason = Math.max(1, Number(season) || 1);
      const normalizedEpisode = Math.max(1, Number(episode) || 1);

      if (!Number.isInteger(numericId) || numericId <= 0) {
        setError("Impossibile identificare correttamente il contenuto selezionato.");
        return false;
      }

      setError(null);
      setIsLoading(true);

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const endpoint =
          normalizedType === "tv"
            ? `${PLAYER_API_BASE}/api/player/tv/${numericId}/${normalizedSeason}/${normalizedEpisode}`
            : `${PLAYER_API_BASE}/api/player/movie/${numericId}`;

        const response = await fetch(endpoint, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: buildRequestHeaders(),
        });

        const data: PlayerPayload | null = await response
          .json()
          .catch(() => null);

        if (!response.ok) {
          throw new Error(playerErrorMessage(data, response.status));
        }

        const resolvedStream = data?.stream || data?.streamUrl;
        if (!data?.success || !resolvedStream) {
          throw new Error(playerErrorMessage(data));
        }

        const streamType = inferStreamType(resolvedStream, data.type);
        cachePlayerStream(
          normalizedType,
          numericId,
          normalizedSeason,
          normalizedEpisode,
          resolvedStream,
          streamType,
          data.source
        );

        let watchUrl = `/${MAIN_PATH.watch}/${normalizedType}/${numericId}`;
        const params = new URLSearchParams();

        if (normalizedType === "tv") {
          params.set("s", String(normalizedSeason));
          params.set("e", String(normalizedEpisode));
        }

        if (Number(startTime) > 30) {
          params.set("t", String(Math.floor(Number(startTime))));
        }

        const queryString = params.toString();
        if (queryString) watchUrl += `?${queryString}`;

        controllerRef.current = null;
        navigate(watchUrl);
        return true;
      } catch (requestError: any) {
        if (requestError?.name !== "AbortError") {
          const message =
            requestError?.message === "Failed to fetch"
              ? "Backend FlixIT non raggiungibile. Verifica che il servizio backend sia avviato."
              : requestError?.message ||
                "Impossibile preparare la sorgente video. Riprova tra poco.";
          setError(message);
        }
        return false;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        setIsLoading(false);
      }
    },
    [navigate]
  );

  return {
    isLoading,
    error,
    clearError,
    startPlayback,
  };
}
