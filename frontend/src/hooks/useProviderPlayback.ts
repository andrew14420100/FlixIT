import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MAIN_PATH } from "src/constant";

const PROVIDER_API_BASE = String(
  process.env.REACT_APP_PROVIDER_API_BASE || "http://localhost:8000"
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

type ProviderPayload = {
  success?: boolean;
  streamUrl?: string;
  type?: string;
  source?: string;
  message?: string;
  detail?: string;
  error?: string;
};

function inferStreamType(streamUrl: string, explicitType?: string) {
  if (explicitType) return explicitType;
  const clean = String(streamUrl || "").split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8")) return "hls";
  if (clean.endsWith(".mp4")) return "mp4";
  return "hls";
}

function cacheProviderStream(
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
    source: source || "provider-play",
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

    // WatchPage historically accepted movie aliases using 1:1 as well as 0:0.
    if (mediaType === "movie") {
      sessionStorage.setItem(
        `${STREAM_CACHE_PREFIX}movie:${mediaId}:1:1`,
        JSON.stringify(normalized)
      );
    }
  } catch {
    // Playback can still continue through navigation if browser storage is disabled.
  }
}

function providerErrorMessage(data: ProviderPayload | null, status?: number) {
  return (
    data?.message ||
    data?.detail ||
    data?.error ||
    (status ? `Il server ha risposto con errore ${status}` : "Sorgente video non disponibile")
  );
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
      contentTitle,
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
      const query = String(contentTitle || mediaId || "").trim();

      if (!Number.isInteger(numericId) || numericId <= 0 || !query) {
        setError("Impossibile identificare correttamente il contenuto selezionato.");
        return false;
      }

      setError(null);
      setIsLoading(true);

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const response = await fetch(
          `${PROVIDER_API_BASE}/api/provider/play?q=${encodeURIComponent(query)}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        const data: ProviderPayload | null = await response
          .json()
          .catch(() => null);

        if (!response.ok) {
          throw new Error(providerErrorMessage(data, response.status));
        }

        if (!data?.success || !data.streamUrl) {
          throw new Error(providerErrorMessage(data));
        }

        const streamType = inferStreamType(data.streamUrl, data.type);
        cacheProviderStream(
          normalizedType,
          numericId,
          normalizedSeason,
          normalizedEpisode,
          data.streamUrl,
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

        setIsLoading(false);
        controllerRef.current = null;
        navigate(watchUrl);
        return true;
      } catch (requestError: any) {
        if (requestError?.name !== "AbortError") {
          setError(
            requestError?.message ||
              "Impossibile preparare la sorgente video. Riprova tra poco."
          );
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
