// @ts-nocheck
import { useEffect, useState } from "react";
import TrailerPlayer from "./TrailerPlayer";

function VolumeIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm11.5 3a3.5 3.5 0 0 0-2-3.16v6.32A3.5 3.5 0 0 0 15.5 12m-2-7.23v2.06a6 6 0 0 1 0 10.34v2.06a8 8 0 0 0 0-14.46"/></svg>
  );
}

/** Mounted only while the expanded card exists. Unmounting destroys HLS/video immediately. */
export default function HoverTrailerOverlay({
  url,
  logoUrl,
  delay = 160,
}: {
  url?: string;
  logoUrl?: string | null;
  delay?: number;
}) {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setReady(false);
    setPlaying(false);
    setMuted(true);
    setFailed(false);
    if (!url) return;
    const timer = window.setTimeout(() => setReady(true), delay);
    return () => window.clearTimeout(timer);
  }, [url, delay]);

  if (!url || !ready || failed) return null;

  return (
    <div
      className="flixit-hover-trailer"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        aspectRatio: "16 / 9",
        overflow: "hidden",
        borderRadius: "6px 6px 0 0",
        background: "#000",
        zIndex: 8,
      }}
    >
      <TrailerPlayer
        videoKey={url}
        muted={muted}
        playing
        loop={false}
        zoom={1.02}
        onPlaying={() => setPlaying(true)}
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
            maxHeight: 56,
            display: "flex",
            alignItems: "flex-end",
            opacity: playing ? 1 : 0,
            transform: playing ? "translateY(0)" : "translateY(4px)",
            transition: "opacity 220ms ease, transform 220ms ease",
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
              maxHeight: 54,
              width: "auto",
              height: "auto",
              objectFit: "contain",
              objectPosition: "left bottom",
              filter: "drop-shadow(0 2px 4px rgba(0,0,0,.7))",
            }}
          />
        </div>
      ) : null}

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
        }}
      >
        <VolumeIcon muted={muted} />
      </button>
    </div>
  );
}
