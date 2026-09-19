// @ts-nocheck
import { useEffect, useMemo, useRef } from "react";
import Hls from "hls.js";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";

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

const MAX_TRAILER_HEIGHT = 2160;

function isDirectUrl(value: string) {
  return /^https?:\/\//i.test(value || "") || String(value || "").startsWith("/");
}

function isHlsUrl(value: string) {
  return /\.m3u8(?:$|[?#])/i.test(value || "") || /\/hls\//i.test(value || "");
}

function isYouTubeId(value: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(String(value || "").trim());
}

function routeIdentity() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/browse\/(movie|tv)\/(\d+)/i);
  return match
    ? { mediaType: match[1].toLowerCase(), id: Number(match[2]) }
    : null;
}

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playingRef = useRef(playing);
  const onErrorRef = useRef(onError);
  const onPlayingRef = useRef(onPlaying);
  const onEndedRef = useRef(onEnded);

  const propDirect = isDirectUrl(videoKey);
  const propYouTube = isYouTubeId(videoKey);
  const identity = useMemo(
    () => (propDirect || propYouTube ? null : routeIdentity()),
    [videoKey, propDirect, propYouTube]
  );
  const resolved = useResolvedTrailer(
    identity?.mediaType,
    identity?.id,
    !propDirect && !propYouTube && !!identity
  );
  const playbackKey = propDirect || propYouTube ? videoKey : resolved.url;
  const direct = isDirectUrl(playbackKey || "");
  const youtube = isYouTubeId(playbackKey || "");

  const youtubeSrc = useMemo(() => {
    if (!youtube || !playbackKey) return null;
    const params = new URLSearchParams({
      autoplay: playing ? "1" : "0",
      mute: muted ? "1" : "0",
      controls: "0",
      rel: "0",
      playsinline: "1",
      modestbranding: "1",
      iv_load_policy: "3",
      fs: "0",
    });
    if (loop) {
      params.set("loop", "1");
      params.set("playlist", playbackKey);
    }
    return `https://www.youtube-nocookie.com/embed/${playbackKey}?${params.toString()}`;
  }, [youtube, playbackKey, muted, playing, loop]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onPlayingRef.current = onPlaying;
  }, [onPlaying]);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !!muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) video.play().catch(() => undefined);
    else video.pause();
  }, [playing, playbackKey]);

  useEffect(() => {
    if (!direct || !playbackKey) return;
    const video = videoRef.current;
    if (!video) return;

    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (isHlsUrl(playbackKey) && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        startLevel: -1,
        capLevelToPlayerSize: false,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        backBufferLength: 0,
        startFragPrefetch: true,
        abrEwmaDefaultEstimate: 12_000_000,
      });
      hlsRef.current = hls;
      hls.loadSource(playbackKey);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls.levels?.length) {
          const eligible = hls.levels
            .map((level, index) => ({ level, index }))
            .filter(({ level }) => {
              const height = Number(level?.height || 0);
              return height > 0 && height <= MAX_TRAILER_HEIGHT;
            });

          if (eligible.length) {
            let best = eligible[0];
            for (const candidate of eligible.slice(1)) {
              const currentHeight = Number(best.level?.height || 0);
              const candidateHeight = Number(candidate.level?.height || 0);
              const currentBitrate = Number(best.level?.bitrate || 0);
              const candidateBitrate = Number(candidate.level?.bitrate || 0);
              if (
                candidateHeight > currentHeight ||
                (candidateHeight === currentHeight && candidateBitrate > currentBitrate)
              ) {
                best = candidate;
              }
            }
            hls.autoLevelCapping = best.index;
            hls.startLevel = best.index;
            hls.currentLevel = best.index;
            hls.nextLevel = best.index;
          }
        }
        if (playingRef.current) video.play().catch(() => undefined);
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
        onErrorRef.current?.(500);
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
    if (playingRef.current) video.play().catch(() => undefined);

    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [direct, playbackKey]);

  if (!playbackKey || (!direct && !youtube)) return null;

  if (youtube && youtubeSrc) {
    return (
      <div
        data-testid="trailer-player"
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          background: "#000",
        }}
      >
        <iframe
          key={youtubeSrc}
          src={youtubeSrc}
          title="Trailer"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => onPlayingRef.current?.()}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "120%",
            height: "120%",
            border: 0,
            pointerEvents: "none",
            transform: `translate(-50%, -50%) scale(${zoom})`,
            background: "#000",
          }}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="trailer-player"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#000",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted={muted}
        loop={loop}
        playsInline
        preload="auto"
        disablePictureInPicture
        onPlaying={() => onPlayingRef.current?.()}
        onEnded={() => onEndedRef.current?.()}
        onError={() => {
          if (!hlsRef.current) onErrorRef.current?.(500);
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
