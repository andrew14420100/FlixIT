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

function routeIdentity() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/browse\/(movie|tv)\/(\d+)/i);
  return match
    ? { mediaType: match[1].toLowerCase(), id: Number(match[2]) }
    : null;
}

function prepareInlineAutoplay(video: HTMLVideoElement | null, muted: boolean) {
  if (!video) return;
  try {
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.controls = false;
    video.muted = !!muted;
    video.defaultMuted = !!muted;
    if (muted) video.setAttribute("muted", "");
    else video.removeAttribute("muted");
  } catch {}
}

function tryPlay(video: HTMLVideoElement | null) {
  if (!video) return;
  prepareInlineAutoplay(video, true);
  const promise = video.play();
  if (promise?.catch) {
    promise.catch(() => {
      window.setTimeout(() => {
        prepareInlineAutoplay(video, true);
        video.play().catch(() => undefined);
      }, 120);
    });
  }
}

/** Direct MP4/HLS trailer player. Audio changes are purely imperative and never
 * rebuild HLS, replace src or reset currentTime. */
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
  const mutedRef = useRef(muted);
  const onErrorRef = useRef(onError);
  const onPlayingRef = useRef(onPlaying);
  const onEndedRef = useRef(onEnded);

  const propDirect = isDirectUrl(videoKey);
  const identity = useMemo(
    () => (propDirect ? null : routeIdentity()),
    [videoKey, propDirect]
  );
  const resolved = useResolvedTrailer(
    identity?.mediaType,
    identity?.id,
    !propDirect && !!identity
  );
  const playbackKey = propDirect ? videoKey : resolved.url;
  const direct = isDirectUrl(playbackKey || "");

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

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
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    prepareInlineAutoplay(video, !!muted);
    if (currentTime > 0 && Math.abs(video.currentTime - currentTime) > 0.25) {
      try {
        video.currentTime = currentTime;
      } catch {}
    }
    if (playingRef.current && video.paused) tryPlay(video);
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    prepareInlineAutoplay(video, mutedRef.current);
    if (playing) tryPlay(video);
    else video.pause();
  }, [playing, playbackKey]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || !playingRef.current) return;
      tryPlay(videoRef.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!direct || !playbackKey) return;
    const video = videoRef.current;
    if (!video) return;

    hlsRef.current?.destroy();
    hlsRef.current = null;
    prepareInlineAutoplay(video, mutedRef.current);

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

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        prepareInlineAutoplay(video, mutedRef.current);
        if (playingRef.current) tryPlay(video);
      });

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
        prepareInlineAutoplay(video, mutedRef.current);
        if (playingRef.current) tryPlay(video);
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
    prepareInlineAutoplay(video, mutedRef.current);
    if (playingRef.current) tryPlay(video);

    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [direct, playbackKey]);

  if (!playbackKey || !direct) return null;

  const onReadyToPlay = () => {
    prepareInlineAutoplay(videoRef.current, mutedRef.current);
    if (playingRef.current) tryPlay(videoRef.current);
  };

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
        controls={false}
        disablePictureInPicture
        disableRemotePlayback
        onLoadedMetadata={onReadyToPlay}
        onLoadedData={onReadyToPlay}
        onCanPlay={onReadyToPlay}
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
