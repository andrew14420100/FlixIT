// @ts-nocheck
import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import Hls from "hls.js";

const YT_ORIGIN = "https://www.youtube.com";

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
  return /\.m3u8(?:$|[?#])/i.test(value || "");
}

/**
 * Unified TRAILER player only. Direct MP4/HLS is used by TrailerResolver.
 * The old YouTube iframe remains solely as rollback when the new resolver is
 * disabled server-side. Main movie/episode playback is not involved here.
 */
export default function TrailerPlayer({ videoKey, muted = true, playing = true, loop = true, zoom = 1.35, onEnded, onPlaying, onError }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const readyRef = useRef(false);
  const idRef = useRef(`flixit-${String(videoKey).slice(-24)}-${Math.random().toString(36).slice(2, 8)}`);
  const direct = isDirectUrl(videoKey);
  const [resolverEnabled, setResolverEnabled] = useState<boolean | null>(direct ? true : null);

  useEffect(() => {
    if (direct) {
      setResolverEnabled(true);
      return;
    }
    let cancelled = false;
    fetch("/api/public/trailer-config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((cfg) => { if (!cancelled) setResolverEnabled(!!cfg?.enabled); })
      .catch(() => { if (!cancelled) setResolverEnabled(false); });
    return () => { cancelled = true; };
  }, [direct]);

  const ytSrc = useMemo(() => {
    if (direct || resolverEnabled !== false) return "";
    const origin = encodeURIComponent(window.location.origin);
    const params = [
      "autoplay=1", "mute=1", "controls=0", "rel=0", "iv_load_policy=3", "disablekb=1",
      "fs=0", "playsinline=1", "modestbranding=1", "enablejsapi=1", `origin=${origin}`,
    ];
    if (loop) params.push("loop=1", `playlist=${videoKey}`);
    return `${YT_ORIGIN}/embed/${videoKey}?${params.join("&")}`;
  }, [videoKey, loop, direct, resolverEnabled]);

  const post = useCallback((func: string, args: any[] = []) => {
    if (!readyRef.current || direct || resolverEnabled !== false) return;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args, id: idRef.current }), YT_ORIGIN
    );
  }, [direct, resolverEnabled]);

  const applyAudio = useCallback(() => {
    if (direct) {
      if (videoRef.current) videoRef.current.muted = !!muted;
      return;
    }
    post(muted ? "mute" : "unMute");
    if (!muted) post("setVolume", [100]);
  }, [muted, post, direct]);

  useEffect(() => { applyAudio(); }, [applyAudio]);
  useEffect(() => {
    if (direct) {
      const video = videoRef.current;
      if (!video) return;
      if (playing) video.play().catch(() => undefined);
      else video.pause();
      return;
    }
    post(playing ? "playVideo" : "pauseVideo");
  }, [playing, post, direct]);

  useEffect(() => {
    if (!direct || !videoKey) return;
    const video = videoRef.current;
    if (!video) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (isHlsUrl(videoKey) && !video.canPlayType("application/vnd.apple.mpegurl") && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        startLevel: -1,
        capLevelToPlayerSize: false,
        maxBufferLength: 20,
        backBufferLength: 0,
      });
      hlsRef.current = hls;
      hls.loadSource(videoKey);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls.levels?.length) {
          let best = 0;
          for (let i = 1; i < hls.levels.length; i += 1) {
            const a = hls.levels[best];
            const b = hls.levels[i];
            if ((b.height || 0) > (a.height || 0) || ((b.height || 0) === (a.height || 0) && (b.bitrate || 0) > (a.bitrate || 0))) best = i;
          }
          hls.currentLevel = best;
          hls.nextLevel = best;
        }
        if (playing) video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data?.fatal) onError?.(500);
      });
      return () => {
        hls.destroy();
        if (hlsRef.current === hls) hlsRef.current = null;
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }

    video.src = videoKey;
    if (playing) video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [direct, videoKey, playing, onError]);

  useEffect(() => {
    if (direct || resolverEnabled !== false) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== iframeRef.current?.contentWindow) return;
      let data: any;
      try { data = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
      if (data?.event === "onReady") { applyAudio(); if (playing) post("playVideo"); return; }
      if (data?.event === "onError") { onError?.(Number(data.info)); return; }
      const state = data?.event === "onStateChange" ? data.info : data?.info?.playerState;
      if (state === 1) onPlaying?.();
      if (state === 0) onEnded?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onEnded, onPlaying, onError, applyAudio, playing, post, direct, resolverEnabled]);

  if (!videoKey) return null;

  if (direct) {
    return (
      <div data-testid="trailer-player" style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}>
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
          onError={() => onError?.(500)}
          style={{
            position: "absolute", top: "50%", left: "50%", width: "100%", height: "100%",
            objectFit: "cover", transform: `translate(-50%, -50%) scale(${zoom})`, background: "#000",
          }}
        />
      </div>
    );
  }

  // New resolver ON means a legacy YouTube key must never be rendered.
  if (resolverEnabled !== false || !ytSrc) return null;

  const handleLoad = () => {
    readyRef.current = true;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "listening", id: idRef.current, channel: "widget" }), YT_ORIGIN
    );
    applyAudio();
    if (playing) post("playVideo");
  };

  return (
    <div data-testid="trailer-player" style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000", containerType: "size" }}>
      <iframe
        ref={iframeRef}
        src={ytSrc}
        onLoad={handleLoad}
        title="Trailer"
        allow="autoplay; encrypted-media"
        style={{
          position: "absolute", top: "50%", left: "50%", border: 0, pointerEvents: "none",
          width: "max(100cqw, calc(100cqh * 16 / 9))",
          height: "max(100cqh, calc(100cqw * 9 / 16))",
          transform: `translate(-50%, -50%) scale(${zoom})`,
        }}
      />
    </div>
  );
}
