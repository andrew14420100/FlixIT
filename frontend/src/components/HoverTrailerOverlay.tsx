// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import TrailerPlayer from "./TrailerPlayer";

const LOGO_VISIBLE_MS = 5000;
const LOGO_FADE_MS = 300;

function VolumeIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm11.5 3a3.5 3.5 0 0 0-2-3.16v6.32A3.5 3.5 0 0 0 15.5 12m-2-7.23v2.06a6 6 0 0 1 0 10.34v2.06a8 8 0 0 0 0-14.46"/></svg>
  );
}

/**
 * Netflix-style hover trailer. The title treatment appears when playback really
 * starts, remains fully visible for exactly five seconds, then dissolves and
 * never reappears during the same hover session.
 */
export default function HoverTrailerOverlay({
  url,
  logoUrl,
  delay = 90,
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
  const logoTimerRef = useRef<number | null>(null);
  const logoTimerStartedRef = useRef(false);

  useEffect(() => {
    setReady(false);
    setPlaying(false);
    setMuted(true);
    setFailed(false);
    setLogoVisible(true);
    logoTimerStartedRef.current = false;

    if (logoTimerRef.current !== null) {
      window.clearTimeout(logoTimerRef.current);
      logoTimerRef.current = null;
    }

    if (!url) return;
    const timer = window.setTimeout(() => setReady(true), delay);
    return () => {
      window.clearTimeout(timer);
      if (logoTimerRef.current !== null) {
        window.clearTimeout(logoTimerRef.current);
        logoTimerRef.current = null;
      }
    };
  }, [url, delay]);

  const handlePlaying = () => {
    setPlaying(true);
    if (logoTimerStartedRef.current) return;

    logoTimerStartedRef.current = true;
    setLogoVisible(true);
    logoTimerRef.current = window.setTimeout(() => {
      setLogoVisible(false);
      logoTimerRef.current = null;
    }, LOGO_VISIBLE_MS);
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
        onError={() => setFailed(true)}
      />

      {logoUrl ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 14,
            bottom: 13,
            zIndex: 11,
            width: "43%",
            maxHeight: 58,
            display: "flex",
            alignItems: "flex-end",
            opacity: showLogo ? 1 : 0,
            transform: showLogo ? "translateY(0)" : "translateY(3px)",
            transition: `opacity ${LOGO_FADE_MS}ms ease, transform ${LOGO_FADE_MS}ms ease`,
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
              maxHeight: 56,
              width: "auto",
              height: "auto",
              objectFit: "contain",
              objectPosition: "left bottom",
              filter: "drop-shadow(0 2px 5px rgba(0,0,0,.78))",
            }}
          />
        </div>
      ) : null}

      {playing ? (
        <button
          type="button"
          aria-label={muted ? "Attiva audio trailer" : "Disattiva audio trailer"}
          title={muted ? "Attiva audio" : "Disattiva audio"}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMuted((value) => !value);
          }}
          style={{
            position: "absolute",
            right: 10,
            bottom: 10,
            zIndex: 12,
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,.68)",
            background: "rgba(24,24,24,.55)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            padding: 7,
            backdropFilter: "blur(3px)",
            pointerEvents: "auto",
          }}
        >
          <VolumeIcon muted={muted} />
        </button>
      ) : null}
    </div>
  );
}
