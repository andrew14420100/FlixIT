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

function isYouTubeUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host.endsWith(".youtu.be") ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    );
  } catch {
    return false;
  }
}

function isVixcloudEmbedUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!(host === "vixcloud.co" || host.endsWith(".vixcloud.co"))) return false;
    return /^\/embed\/\d+\/?$/i.test(url.pathname || "");
  } catch {
    return false;
  }
}

function routeIdentity() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/browse\/(movie|tv)\/(\d+)/i);
  return match
    ? { mediaType: match[1].toLowerCase(), id: Number(match[2]) }
    : null;
}

function isItalianAudioTrack(track: any) {
  const lang = String(track?.lang || track?.language || "").trim().toLowerCase().replace("_", "-");
  const name = String(track?.name || track?.label || "").trim().toLowerCase();
  return (
    lang === "it" ||
    lang === "ita" ||
    lang.startsWith("it-") ||
    lang.startsWith("ita-") ||
    name.includes("italiano") ||
    name.includes("italian") ||
    /(^|\W)ita($|\W)/.test(name)
  );
}

function preferItalianAudio(hls: Hls | null) {
  if (!hls) return false;
  const tracks = Array.isArray(hls.audioTracks) ? hls.audioTracks : [];
  if (!tracks.length) return false;
  const italianIndex = tracks.findIndex(isItalianAudioTrack);
  if (italianIndex < 0) return false;
  try {
    hls.audioTrack = italianIndex;
    return true;
  } catch {
    return false;
  }
}

function chooseBestTrailerLevel(hls: Hls | null) {
  if (!hls?.levels?.length) return null;
  const eligible = hls.levels
    .map((level, index) => ({ level, index }))
    .filter(({ level }) => {
      const height = Number(level?.height || 0);
      return height > 0 && height <= MAX_TRAILER_HEIGHT;
    });

  if (!eligible.length) return null;

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

  try {
    hls.autoLevelCapping = best.index;
    hls.startLevel = best.index;
    hls.currentLevel = best.index;
    hls.nextLevel = best.index;
  } catch {}
  return best;
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

function tryPlay(video: HTMLVideoElement | null, muted: boolean) {
  if (!video) return;
  prepareInlineAutoplay(video, muted);
  const promise = video.play();
  if (promise?.catch) {
    promise.catch(() => {
      window.setTimeout(() => {
        prepareInlineAutoplay(video, muted);
        video.play().catch(() => undefined);
      }, 120);
    });
  }
}

/** Shared trailer player for Hero, hover cards and Detail.
 *
 * Automatic policy:
 * - StreamingCommunity Vixcloud trailer embeds are rendered as the iframe URL
 *   published by SC, without extracting the underlying media stream;
 * - direct SC MP4/HLS trailers keep native playback;
 * - YouTube is rejected completely.
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

  const rawPlaybackKey = propDirect ? videoKey : resolved.url;
  const playbackKey = rawPlaybackKey && !isYouTubeUrl(rawPlaybackKey) ? rawPlaybackKey : null;
  const direct = isDirectUrl(playbackKey || "");
  const vixcloudEmbed = isVixcloudEmbedUrl(playbackKey || "");

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
    if (vixcloudEmbed) return;
    const video = videoRef.current;
    if (!video) return;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    prepareInlineAutoplay(video, !!muted);
    if (currentTime > 0 && Math.abs(video.currentTime - currentTime) > 0.25) {
      try {
        video.currentTime = currentTime;
      } catch {}
    }
    if (playingRef.current && video.paused) tryPlay(video, !!muted);
  }, [muted, vixcloudEmbed]);

  useEffect(() => {
    if (vixcloudEmbed) return;
    const video = videoRef.current;
    if (!video) return;
    prepareInlineAutoplay(video, mutedRef.current);
    if (playing) tryPlay(video, mutedRef.current);
    else video.pause();
  }, [playing, playbackKey, vixcloudEmbed]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || !playingRef.current || vixcloudEmbed) return;
      tryPlay(videoRef.current, mutedRef.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, [vixcloudEmbed]);

  useEffect(() => {
    if (!direct || !playbackKey || vixcloudEmbed) return;
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
        abrEwmaDefaultEstimate: 20_000_000,
      });
      hlsRef.current = hls;
      hls.loadSource(playbackKey);
      hls.attachMedia(video);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        prepareInlineAutoplay(video, mutedRef.current);
        if (playingRef.current) tryPlay(video, mutedRef.current);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        preferItalianAudio(hls);
        chooseBestTrailerLevel(hls);
        window.setTimeout(() => preferItalianAudio(hls), 0);
        window.setTimeout(() => preferItalianAudio(hls), 250);
        prepareInlineAutoplay(video, mutedRef.current);
        if (playingRef.current) tryPlay(video, mutedRef.current);
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
    if (playingRef.current) tryPlay(video, mutedRef.current);

    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [direct, playbackKey, vixcloudEmbed]);

  if (!playbackKey || !direct) return null;
  if (vixcloudEmbed && !playing) return null;

  const onReadyToPlay = () => {
    prepareInlineAutoplay(videoRef.current, mutedRef.current);
    if (playingRef.current) tryPlay(videoRef.current, mutedRef.current);
  };

  const frameStyle = {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    width: "100%",
    height: "100%",
    border: 0,
    transform: `translate(-50%, -50%) scale(${zoom})`,
    background: "#000",
    pointerEvents: "none" as const,
  };

  return (
    <div
      data-testid="trailer-player"
      data-trailer-provider={vixcloudEmbed ? "vixcloud" : "direct"}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#000",
      }}
    >
      {vixcloudEmbed ? (
        <iframe
          src={playbackKey}
          title="Trailer StreamingCommunity"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => onPlayingRef.current?.()}
          style={frameStyle}
        />
      ) : (
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
      )}
    </div>
  );
}
