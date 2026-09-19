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

/**
 * Unified native trailer player.
 *
 * A direct MP4/HLS URL is played as-is. Any legacy key/sentinel is treated only
 * as a request to resolve the current DetailPage title through FLIX-IT's central
 * trailer endpoint. There is deliberately no YouTube iframe or YouTube fallback.
 * HLS playback prefers the highest native rendition available up to 2160p/4K.
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

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
        abrEwmaDefaultEstimate: 12_000_000,
      });
      hlsRef.current = hls;
      hls.loadSource(playbackKey);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Pick the highest declared native rendition that does not exceed 4K.
        // The same index is also used as the ABR cap so an 8K rendition present
        // in the master can never be selected later by adaptation.
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

  if (!playbackKey || !direct) return null;

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
