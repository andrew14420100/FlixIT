// @ts-nocheck
import { useEffect, useMemo, useRef, useCallback } from "react";

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

// Uniform trailer player: YouTube stream cropped to "cover" so letterbox bars,
// title bar and watermarks never show. Controlled via the IFrame postMessage API.
export default function TrailerPlayer({ videoKey, muted = true, playing = true, loop = true, zoom = 1.35, onEnded, onPlaying, onError }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const idRef = useRef(`flixit-${videoKey}-${Math.random().toString(36).slice(2, 8)}`);

  const src = useMemo(() => {
    const origin = encodeURIComponent(window.location.origin);
    const params = [
      "autoplay=1", "mute=1", "controls=0", "rel=0", "iv_load_policy=3", "disablekb=1",
      "fs=0", "playsinline=1", "modestbranding=1", "enablejsapi=1", `origin=${origin}`,
    ];
    if (loop) params.push("loop=1", `playlist=${videoKey}`);
    return `${YT_ORIGIN}/embed/${videoKey}?${params.join("&")}`;
  }, [videoKey, loop]);

  const post = useCallback((func: string, args: any[] = []) => {
    if (!readyRef.current) return;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args, id: idRef.current }), YT_ORIGIN
    );
  }, []);

  const applyAudio = useCallback(() => {
    post(muted ? "mute" : "unMute");
    if (!muted) post("setVolume", [100]);
  }, [muted, post]);

  useEffect(() => { applyAudio(); }, [applyAudio]);
  useEffect(() => { post(playing ? "playVideo" : "pauseVideo"); }, [playing, post]);

  useEffect(() => {
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
  }, [onEnded, onPlaying, onError, applyAudio, playing, post]);

  const handleLoad = () => {
    readyRef.current = true;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "listening", id: idRef.current, channel: "widget" }), YT_ORIGIN
    );
    applyAudio();
    if (playing) post("playVideo");
  };

  return (
    <div
      data-testid="trailer-player"
      style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000", containerType: "size" }}
    >
      <iframe
        ref={iframeRef}
        src={src}
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
