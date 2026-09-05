// @ts-nocheck
import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import Player from "video.js/dist/types/player";
import videojs from "video.js";
import "videojs-youtube";
import "video.js/dist/video-js.css";

interface VideoJSPlayerRef {
  getPlayer: () => Player | null;
  toggleMute: () => boolean;
}

interface VideoJSPlayerProps {
  options: any;
  onReady?: (player: Player) => void;
  onMuteChange?: (muted: boolean) => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
}

const VideoJSPlayer = forwardRef<VideoJSPlayerRef, VideoJSPlayerProps>(({
  options,
  onReady,
  onMuteChange,
  onEnded,
  onTimeUpdate,
}, ref) => {
  const videoRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);

  useImperativeHandle(ref, () => ({
    getPlayer: () => playerRef.current,
    toggleMute: () => {
      if (playerRef.current) {
        const currentMuted = playerRef.current.muted();
        playerRef.current.muted(!currentMuted);
        onMuteChange?.(!currentMuted);
        return !currentMuted;
      }
      return true;
    }
  }));

  useEffect(() => {
    (async function handleVideojs() {
      // Make sure Video.js player is only initialized once
      if (!playerRef.current) {
        // The Video.js player needs to be _inside_ the component el for React 18 Strict Mode.
        const videoElement = document.createElement("video-js");
        videoElement.classList.add("vjs-fluid");

        videoRef.current?.appendChild(videoElement);
        const player = (playerRef.current = videojs(
          videoElement,
          { ...options, muted: options.muted ?? true },
          () => {
            onReady && onReady(player);
          }
        ));

        // Add event listeners for video lifecycle
        if (onEnded) {
          player.on('ended', onEnded);
        }
        if (onTimeUpdate) {
          player.on('timeupdate', () => {
            const currentTime = player.currentTime() || 0;
            const duration = player.duration() || 0;
            onTimeUpdate(currentTime, duration);
          });
        }

      } else {
        const player = playerRef.current;
        player.width(options.width);
        player.height(options.height);
      }
    })();
  }, [options, videoRef, onReady, onEnded, onTimeUpdate]);

  // Dispose the Video.js player when the functional component unmounts
  useEffect(() => {
    const player = playerRef.current;

    return () => {
      if (player && !player.isDisposed()) {
        player.dispose();
        playerRef.current = null;
      }
    };
  }, [playerRef]);

  return (
    <div data-vjs-player style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
      <div ref={videoRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
});

export default VideoJSPlayer;
export type { VideoJSPlayerRef };