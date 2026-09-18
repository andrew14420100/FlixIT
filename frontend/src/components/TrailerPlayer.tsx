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

function routeIdentity() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/browse\/(movie|tv)\/(\d+)/i);
  return match ? { mediaType: match[1].toLowerCase(), id: match[2] } : null;
}

function hdrSupported() {
  try { return !!window.matchMedia?.("(dynamic-range: high)")?.matches; } catch { return false; }
}

/**
 * Unified TRAILER player only. Direct MP4/HLS is used by TrailerResolver.
 *
 * DetailPage historically passes a YouTube key to this component. While the
 * new resolver is enabled we treat that key only as a legacy placeholder and
 * resolve the current /browse/{type}/{tmdbId} route through the central trailer
 * endpoint. This makes the Detail hero use the same cached trailer as Home,
 * hover and the Trailer tab without touching the movie/episode player.
 */
export default function TrailerPlayer({ videoKey, muted = true, playing = true, loop = true, zoom = 1.35, onEnded, onPlaying, onError }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const readyRef = useRef(false);
  const idRef = useRef(`flixit-${String(videoKey).slice(-24)}-${Math.random().toString(36).slice(2, 8)}`);

  const propDirect = isDirectUrl(videoKey);
  const [resolverEnabled, setResolverEnabled] = useState<boolean | null>(propDirect ? true : null);
  const [resolvedRouteUrl, setResolvedRouteUrl] = useState<string | null>(propDirect ? videoKey : null);

  useEffect(() => {
    if (propDirect) {
      setResolverEnabled(true);
      setResolvedRouteUrl(videoKey);
      return;
    }

    let cancelled = false;
    let timer = 0;

    const resolveCurrentRoute = async () => {
      try {
        const cfg = await fetch("/api/public/trailer-config", { cache: "no-store" }).then((r) => r.ok ? r.json() : { enabled: false });
        if (cancelled) return;
        const enabled = !!cfg?.enabled;
        setResolverEnabled(enabled);
        if (!enabled) {
          setResolvedRouteUrl(null);
          return;
        }

        const identity = routeIdentity();
        if (!identity) {
          setResolvedRouteUrl(null);
          return;
        }

        let attempts = 0;
        const fetchResolved = async () => {
          if (cancelled) return;
          attempts += 1;
          try {
            const response = await fetch(
              `/api/public/trailer/${identity.mediaType}/${identity.id}?hdr=${hdrSupported() ? "true" : "false"}`,
              { cache: "no-store" }
            );
            const data = response.ok ? await response.json() : null;
            if (cancelled) return;
            const url = data?.enabled && data?.available
              ? (data?.trailer_url || data?.trailer_key || data?.manifest_url || null)
              : null;
            setResolvedRouteUrl(url);
            // First visit may arrive while the background queue is finishing.
            // Poll briefly, then stop. Normal refreshes use the cached result on
            // the first request and do not contact external providers.
            if (!url && attempts < 7) {
              timer = window.setTimeout(fetchResolved, 1800);
            }
          } catch {
            if (!cancelled && attempts < 4) timer = window.setTimeout(fetchResolved, 2000);
          }
        };
        await fetchResolved();
      } catch {
        if (!cancelled) setResolverEnabled(false);
      }
    };

    resolveCurrentRoute();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [videoKey, propDirect]);

  const playbackKey = propDirect ? videoKey : (resolverEnabled ? resolvedRouteUrl : videoKey);
  const direct = isDirectUrl(playbackKey || "");

  const ytSrc = useMemo(() => {
    if (direct || resolverEnabled !== false || !playbackKey) return "";
    const origin = encodeURIComponent(window.location.origin);
    const params = [
      "autoplay=1", "mute=1", "controls=0", "rel=0", "iv_load_policy=3", "disablekb=1",
      "fs=0", "playsinline=1", "modestbranding=1", "enablejsapi=1", `origin=${origin}`,
    ];
    if (loop) params.push("loop=1", `playlist=${playbackKey}`);
    return `${YT_ORIGIN}/embed/${playbackKey}?${params.join("&")}`;
  }, [playbackKey, loop, direct, resolverEnabled]);

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
    if (!direct || !playbackKey) return;
    const video = videoRef.current;
    if (!video) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (isHlsUrl(playbackKey) && !video.canPlayType("application/vnd.apple.mpegurl") && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        startLevel: -1,
        capLevelToPlayerSize: false,
        maxBufferLength: 20,
        backBufferLength: 0,
      });
      hlsRef.current = hls;
      hls.loadSource(playbackKey);
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

    video.src = playbackKey;
    if (playing) video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [direct, playbackKey, playing, onError]);

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

  if (!playbackKey) return null;

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
