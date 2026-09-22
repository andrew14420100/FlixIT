// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import TrailerPlayer from "./TrailerPlayer";
import TrailerAudioButton from "./TrailerAudioButton";

const LOGO_VISIBLE_MS = 5000;
const LOGO_FADE_MS = 300;

/**
 * Netflix-style hover trailer.
 * Playback is allowed only after the caller-provided hover delay. The logo is
 * revealed on the same `playing` event as the video, so it never appears early
 * and never lags behind the first trailer frame.
 */
export default function HoverTrailerOverlay({
  url,
  logoUrl,
  delay = 0,
  onOpen,
}: {
  url?: string;
  logoUrl?: string | null;
  delay?: number;
  onOpen?: (event?: any) => void;
}) {
  const [ready, setReady] = useState(delay <= 0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [logoVisible, setLogoVisible] = useState(true);
  const logoTimerRef = useRef<number | null>(null);
  const logoTimerStartedRef = useRef(false);

  const clearTimers = () => {
    if (logoTimerRef.current !== null) {
      window.clearTimeout(logoTimerRef.current);
      logoTimerRef.current = null;
    }
  };

  useEffect(() => {
    setReady(delay <= 0);
    setPlaying(false);
    setMuted(true);
    setFailed(false);
    setLogoVisible(true);
    logoTimerStartedRef.current = false;
    clearTimers();

    if (!url || delay <= 0) return () => clearTimers();
    const timer = window.setTimeout(() => setReady(true), delay);
    return () => {
      window.clearTimeout(timer);
      clearTimers();
    };
  }, [url, delay]);

  const handlePlaying = () => {
    setPlaying(true);
    setLogoVisible(true);
    if (logoTimerStartedRef.current) return;

    logoTimerStartedRef.current = true;
    logoTimerRef.current = window.setTimeout(() => {
      setLogoVisible(false);
      logoTimerRef.current = null;
    }, LOGO_VISIBLE_MS);
  };

  const handleEnded = () => {
    clearTimers();
    setPlaying(false);
    setLogoVisible(true);
  };

  const handleError = () => {
    clearTimers();
    setPlaying(false);
    setFailed(true);
    setLogoVisible(true);
  };

  if (!url || failed) return null;

  const showLogo = playing && logoVisible;

  return (
    <div
      className="flixit-hover-trailer"
      role="button"
      tabIndex={0}
      aria-label="Apri contenuto"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onOpen?.(event);
      }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: "auto",
        width: "100%",
        height: "auto",
        aspectRatio: "1 / .563925",
        overflow: "hidden",
        borderRadius: "6px 6px 0 0",
        background: "#000",
        zIndex: 8,
        opacity: 1,
        pointerEvents: "auto",
        cursor: onOpen ? "pointer" : "default",
      }}
    >
      {ready ? (
        <TrailerPlayer
          videoKey={url}
          muted={muted}
          playing
          loop={false}
          zoom={1.02}
          onPlaying={handlePlaying}
          onEnded={handleEnded}
          onError={handleError}
        />
      ) : null}

      {logoUrl ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "5.5%",
            bottom: "7%",
            zIndex: 11,
            width: "42%",
            height: "29%",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-start",
            opacity: showLogo ? 1 : 0,
            transform: showLogo
              ? "translate3d(0,0,0) scale(1)"
              : "translate3d(0,5px,0) scale(.99)",
            transition: `opacity ${logoVisible ? 0 : LOGO_FADE_MS}ms ease, transform 120ms cubic-bezier(.21,0,.07,1)`,
            pointerEvents: "none",
          }}
        >
          <img
            src={logoUrl}
            alt=""
            draggable={false}
            decoding="async"
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "100%",
              width: "auto",
              height: "auto",
              objectFit: "contain",
              objectPosition: "left bottom",
              filter: "drop-shadow(0 2px 6px rgba(0,0,0,.84))",
            }}
          />
        </div>
      ) : null}

      {playing ? (
        <TrailerAudioButton
          muted={muted}
          onToggle={() => setMuted((value) => !value)}
          testId="hover-trailer-audio-toggle"
          style={{ position: "absolute", right: 10, bottom: 10, zIndex: 12 }}
        />
      ) : null}
    </div>
  );
}
