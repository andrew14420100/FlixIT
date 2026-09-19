// @ts-nocheck
import React from "react";
import "./TrailerAudioButton.css";

export function TrailerVolumeIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "100%", height: "100%", display: "block" }}>
      <path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "100%", height: "100%", display: "block" }}>
      <path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm11.5 3a3.5 3.5 0 0 0-2-3.16v6.32A3.5 3.5 0 0 0 15.5 12m-2-7.23v2.06a6 6 0 0 1 0 10.34v2.06a8 8 0 0 0 0-14.46" />
    </svg>
  );
}

export default function TrailerAudioButton({
  muted,
  onToggle,
  testId,
  style,
}: {
  muted: boolean;
  onToggle: (event?: any) => void;
  testId?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={muted ? "Attiva audio trailer" : "Disattiva audio trailer"}
      title={muted ? "Attiva audio" : "Disattiva audio"}
      data-testid={testId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle?.(event);
      }}
      style={{
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
        WebkitBackdropFilter: "blur(3px)",
        pointerEvents: "auto",
        lineHeight: 1,
        ...style,
      }}
    >
      <TrailerVolumeIcon muted={muted} />
    </button>
  );
}
