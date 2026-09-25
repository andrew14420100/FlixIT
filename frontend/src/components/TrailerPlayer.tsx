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

function youtubeVideoId(value: string) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^[A-Za-z0-9_-]{6,20}$/.test(text)) return text;

  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return /^[A-Za-z0-9_-]{6,20}$/.test(id || "") ? id : null;
    }
    if (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    ) {
      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v");
        return /^[A-Za-z0-9_-]{6,20}$/.test(id || "") ? id : null;
      }
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{6,20})/);
      return match?.[1] || null;
    }
  } catch {}
  return null;
}

function youtubeEmbedUrl(id: string, muted: boolean, loop: boolean) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    rel: "0",
    playsinline: "1",
    enablejsapi: "1",
    iv_load_policy: "3",
    fs: "0",
    disablekb: "1",
    modestbranding: "1",
  });
  if (loop) {
    params.set("loop", "1");
    params.set("playlist", id);
  }
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

function youtubeCommand(frame: HTMLIFrameElement | null, func: string, args: any[] = []) {
  try {
    frame?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*"
    );
  } catch {}
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

/** Trailer player shared by Hero, hover cards and Detail.
 * StreamingCommunity trailers use the associated YouTube video inside the
 * existing FLIX-IT surface; manual direct MP4/HLS URLs keep native playback. */
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
  const youtubeRef = useRef<HTMLIFrameElement>(null);
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
  const youtubeId = useMemo(
    () => youtubeVideoId(playbackKey || ""),
    [playbackKey]
  );
  const youtubeSrc = useMemo(
    () => (youtubeId ? youtubeEmbedUrl(youtubeId, muted, loop) : null),
    // Keep the iframe stable when only mute changes; mute/unmute is sent through
    // the YouTube JS API below instead of reloading the trailer.
    [youtubeId, loop]
  );

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
    if (youtubeId) {
      youtubeCommand(youtubeRef.current, muted ? "mute" : "unMute");
      return;
    }
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
  }, [muted, youtubeId]);

  useEffect(() => {
    if (youtubeId) {
      youtubeCommand(youtubeRef.current, playing ? "playVideo" : "pauseVideo");
      youtubeCommand(youtubeRef.current, mutedRef.current ? "mute" : "unMute");
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    prepareInlineAutoplay(video, mutedRef.current);
    if (playing) tryPlay(video, mutedRef.current);
    else video.pause();
  }, [playing, playbackKey, youtubeId]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || !playingRef.current) return;
      if (youtubeRef.current) {
        youtubeCommand(youtubeRef.current, "playVideo");
      } else {
        tryPlay(videoRef.current, mutedRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!youtubeId) return;
    const listener = (event: MessageEvent) => {
      const frame = youtubeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (!String(event.origin || "").includes("youtube")) return;
      let payload: any = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (!payload || typeof payload !== "object") return;
      if (payload.event === "onStateChange") {
        if (Number(payload.info) === 1) onPlayingRef.current?.();
        if (Number(payload.info) === 0 && !loop) onEndedRef.current?.();
      }
      if (payload.event === "onError") {
        onErrorRef.current?.(Number(payload.info) || 500);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [youtubeId, loop]);

  useEffect(() => {
    if (!direct || !playbackKey || youtubeId) return;
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
  }, [direct, playbackKey, youtubeId]);

  if (!playbackKey || !direct) return null;

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
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#000",
      }}
    >
      {youtubeId && youtubeSrc ? (
        <iframe
          ref={youtubeRef}
          src={youtubeSrc}
          title="Trailer"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => {
            try {
              youtubeRef.current?.contentWindow?.postMessage(
                JSON.stringify({ event: "listening", id: "flixit-trailer" }),
                "*"
              );
            } catch {}
            youtubeCommand(youtubeRef.current, "addEventListener", ["onStateChange"]);
            youtubeCommand(youtubeRef.current, "addEventListener", ["onError"]);
            youtubeCommand(youtubeRef.current, mutedRef.current ? "mute" : "unMute");
            if (playingRef.current) youtubeCommand(youtubeRef.current, "playVideo");
          }}
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
