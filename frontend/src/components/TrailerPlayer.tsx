// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef } from "react";
import Hls from "hls.js";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";

const YT_ORIGIN = "https://www.youtube.com";
const RESOLVER_SENTINEL = "__flixit_resolver__";

interface Props {
  videoKey: string;
  muted?: boolean;
  playing?: boolean;
  loop?: boolean;
  zoom?: number;
  onEnded?: () => void;
  onPlaying?: () => void;
  onError?: (code: number) => void;
}

function isDirectUrl(value: string) {
  return /^https?:\/\//i.test(value || "") || String(value || "").startsWith("/");
}

function isHlsUrl(value: string) {
  return /\.m3u8(?:$|[?#])/i.test(value || "") || /\/hls\//i.test(value || "");
}

function isYouTubeKey(value: string) {
  return /^[A-Za-z0-9_-]{6,20}$/.test(String(value || ""));
}

function routeIdentity() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/browse\/(movie|tv)\/(\d+)/i);
  return match
    ? { mediaType: match[1].toLowerCase(), id: Number(match[2]) }
    : null;
}

/**
 * Unified trailer player.
 *
 * - Direct MP4/HLS URLs are played natively.
 * - TMDB/StreamingCommunity trailer keys are YouTube IDs and are rendered
 *   through the YouTube iframe player.
 * - The resolver sentinel still resolves the current DetailPage title through
 *   FLIX-IT's central trailer endpoint.
 *
 * This component is trailer-only and does not affect movie/episode playback.
 */
export default function TrailerPlayer({
  videoKey,
  muted = true,
  playing = true,
  loop = true,
  zoom = 1.35,
  onEnded,
  onPlaying,
  onError,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const readyRef = useRef(false);
  const idRef = useRef(
    `flixit-${String(videoKey || "trailer").slice(-24)}-${Math.random().toString(36).slice(2, 8)}`
  );

  const propDirect = isDirectUrl(videoKey);
  const propYouTube = isYouTubeKey(videoKey) && videoKey !== RESOLVER_SENTINEL;
  const shouldResolve = !propDirect && !propYouTube;

  const identity = useMemo(
    () => (shouldResolve ? routeIdentity() : null),
    [videoKey, shouldResolve]
  );

  const resolved = useResolvedTrailer(
    identity?.mediaType,
    identity?.id,
    shouldResolve && !!identity
  );

  const playbackKey = propDirect || propYouTube
    ? videoKey
    : (resolved.url || null);

  const direct = isDirectUrl(playbackKey || "");
  const youtubeKey = !direct && isYouTubeKey(playbackKey || "")
    ? String(playbackKey)
    : "";

  const ytSrc = useMemo(() => {
    if (!youtubeKey || typeof window === "undefined") return "";
    const origin = encodeURIComponent(window.location.origin);
    const params = [
      "autoplay=1",
      `mute=${muted ? "1" : "0"}`,
      "controls=0",
      "rel=0",
      "iv_load_policy=3",
      "disablekb=1",
      "fs=0",
      "playsinline=1",
      "modestbranding=1",
      "enablejsapi=1",
      `origin=${origin}`,
    ];
    if (loop) params.push("loop=1", `playlist=${youtubeKey}`);
    return `${YT_ORIGIN}/embed/${youtubeKey}?${params.join("&")}`;
  }, [youtubeKey, loop, muted]);

  const post = useCallback((func: string, args: any[] = []) => {
    if (!readyRef.current || !youtubeKey) return;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args, id: idRef.current }),
      YT_ORIGIN
    );
  }, [youtubeKey]);

  const applyAudio = useCallback(() => {
    if (direct) {
      if (videoRef.current) videoRef.current.muted = !!muted;
      return;
    }
    if (!youtubeKey) return;
    post(muted ? "mute" : "unMute");
    if (!muted) post("setVolume", [100]);
  }, [muted, post, direct, youtubeKey]);

  useEffect(() => {
    applyAudio();
  }, [applyAudio]);

  useEffect(() => {
    if (direct) {
      const video = videoRef.current;
      if (!video) return;
      if (playing) video.play().catch(() => undefined);
      else video.pause();
      return;
    }
    if (youtubeKey) post(playing ? "playVideo" : "pauseVideo");
  }, [playing, post, direct, youtubeKey, playbackKey]);

  useEffect(() => {
    if (!direct || !playbackKey) return;
    const video = videoRef.current;
    if (!video) return;

    hlsRef.current?.destroy();
    hlsRef.current = null;

    const nativeHls = !!video.canPlayType("application/vnd.apple.mpegurl");
    if (isHlsUrl(playbackKey) && !nativeHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        startLevel: -1,
        capLevelToPlayerSize: false,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        backBufferLength: 0,
        startFragPrefetch: true,
        abrEwmaDefaultEstimate: 6_000_000,
      });
      hlsRef.current = hls;
      hls.loadSource(playbackKey);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls.levels?.length) {
          let best = 0;
          for (let i = 1; i < hls.levels.length; i += 1) {
            const current = hls.levels[best];
            const candidate = hls.levels[i];
            if (
              (candidate.height || 0) > (current.height || 0) ||
              ((candidate.height || 0) === (current.height || 0) &&
                (candidate.bitrate || 0) > (current.bitrate || 0))
            ) {
              best = i;
            }
          }
          hls.startLevel = best;
          hls.currentLevel = best;
          hls.nextLevel = best;
        }
        if (playing) video.play().catch(() => undefined);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          try {
            hls.startLoad();
            return;
          } catch {}
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError();
            return;
          } catch {}
        }
        onError?.(500);
      });

      return () => {
        hls.destroy();
        if (hlsRef.current === hls) hlsRef.current = null;
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }

    video.src = playbackKey;
    video.load();
    if (playing) video.play().catch(() => undefined);

    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [direct, playbackKey, playing, onError]);

  useEffect(() => {
    if (!youtubeKey) return;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== YT_ORIGIN || event.source !== iframeRef.current?.contentWindow) return;

      let data: any;
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }

      if (data?.event === "onReady") {
        readyRef.current = true;
        applyAudio();
        if (playing) post("playVideo");
        return;
      }

      if (data?.event === "onError") {
        onError?.(Number(data.info) || 500);
        return;
      }

      const state = data?.event === "onStateChange"
        ? data.info
        : data?.info?.playerState;

      if (state === 1) onPlaying?.();
      if (state === 0) onEnded?.();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [youtubeKey, onEnded, onPlaying, onError, applyAudio, playing, post]);

  if (!playbackKey || playbackKey === RESOLVER_SENTINEL) return null;

  if (direct) {
    return (
      <div
        data-testid="trailer-player"
        style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted={muted}
          loop={loop}
          playsInline
          preload="auto"
          disablePictureInPicture
          onPlaying={onPlaying}
          onEnded={onEnded}
          onError={() => {
            if (!hlsRef.current) onError?.(500);
          }}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `translate(-50%, -50%) scale(${zoom})`,
            background: "#000",
          }}
        />
      </div>
    );
  }

  if (!youtubeKey || !ytSrc) return null;

  const handleLoad = () => {
    readyRef.current = true;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "listening", id: idRef.current, channel: "widget" }),
      YT_ORIGIN
    );
    applyAudio();
    if (playing) post("playVideo");
  };

  return (
    <div
      data-testid="trailer-player"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#000",
        containerType: "size",
      }}
    >
      <iframe
        ref={iframeRef}
        src={ytSrc}
        onLoad={handleLoad}
        title="Trailer"
        allow="autoplay; encrypted-media; picture-in-picture"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          border: 0,
          pointerEvents: "none",
          width: "max(100cqw, calc(100cqh * 16 / 9))",
          height: "max(100cqh, calc(100cqw * 9 / 16))",
          transform: `translate(-50%, -50%) scale(${zoom})`,
        }}
      />
    </div>
  );
}
