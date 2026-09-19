// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import TrailerPlayer from "./TrailerPlayer";
import TrailerAudioButton from "./TrailerAudioButton";

const LOGO_ENTER_MS = 220;
const LOGO_VISIBLE_MS = 5000;
const LOGO_FADE_MS = 300;

/**
 * Netflix-style hover trailer.
 * - logo appears only when the video really fires `playing`;
 * - subtle entrance from the lower-left;
 * - after the entrance it stays fully visible for a real 5 seconds;
 * - then it dissolves for 300ms and stays hidden for that trailer session;
 * - when playback ends/fails the underlying artwork + logo returns immediately.
 */
export default function HoverTrailerOverlay({
  url,
  logoUrl,
  delay = 70,
  onOpen,
}: {
  url?: string;
  logoUrl?: string | null;
  delay?: number;
  onOpen?: (event?: any) => void;
}) {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [logoVisible, setLogoVisible] = useState(true);
  const [logoEntered, setLogoEntered] = useState(false);
  const logoTimerRef = useRef<number | null>(null);
  const entryFrameRef = useRef<number | null>(null);
  const logoTimerStartedRef = useRef(false);

  const clearTimers = () => {
    if (logoTimerRef.current !== null) {
      window.clearTimeout(logoTimerRef.current);
      logoTimerRef.current = null;
    }
    if (entryFrameRef.current !== null) {
      window.cancelAnimationFrame(entryFrameRef.current);
      entryFrameRef.current = null;
    }
  };

  useEffect(() => {
    setReady(false);
    setPlaying(false);
    setMuted(true);
    setFailed(false);
    setLogoVisible(true);
    setLogoEntered(false);
    logoTimerStartedRef.current = false;
    clearTimers();

    if (!url) return;
    const timer = window.setTimeout(() => setReady(true), delay);
    return () => {
      window.clearTimeout(timer);
      clearTimers();
    };
  }, [url, delay]);

  const handlePlaying = () => {
    setPlaying(true);
    if (logoTimerStartedRef.current) return;

    logoTimerStartedRef.current = true;
    setLogoVisible(true);
    setLogoEntered(false);
    entryFrameRef.current = window.requestAnimationFrame(() => {
      entryFrameRef.current = window.requestAnimationFrame(() => {
        setLogoEntered(true);
        entryFrameRef.current = null;
      });
    });
    // Entrance first, then a complete 5s hold, then the CSS 300ms fade-out.
    logoTimerRef.current = window.setTimeout(() => {
      setLogoVisible(false);
      logoTimerRef.current = null;
    }, LOGO_ENTER_MS + LOGO_VISIBLE_MS);
  };

  const handleEnded = () => {
    clearTimers();
    setPlaying(false);
    setLogoVisible(true);
    setLogoEntered(false);
  };

  const handleError = () => {
    clearTimers();
    setPlaying(false);
    setFailed(true);
    setLogoVisible(true);
    setLogoEntered(false);
  };

  if (!url || !ready || failed) return null;

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
        left: 0,
        right: 0,
        top: 0,
        aspectRatio: "16 / 9",
        overflow: "hidden",
        borderRadius: "6px 6px 0 0",
        background: playing ? "#000" : "transparent",
        zIndex: 8,
        opacity: playing ? 1 : 0,
        transition: "opacity 180ms ease",
        pointerEvents: playing ? "auto" : "none",
        cursor: onOpen ? "pointer" : "default",
      }}
    >
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
            opacity: showLogo && logoEntered ? 1 : 0,
            transform: showLogo && logoEntered
              ? "translate3d(0,0,0) scale(1)"
              : "translate3d(0,7px,0) scale(.985)",
            transition: `opacity ${logoVisible ? LOGO_ENTER_MS : LOGO_FADE_MS}ms ease, transform ${LOGO_ENTER_MS}ms cubic-bezier(.21,0,.07,1)`,
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
