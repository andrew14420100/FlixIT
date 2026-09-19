// @ts-nocheck
import React from "react";
import IconButton from "@mui/material/IconButton";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";

export function TrailerVolumeIcon({ muted }: { muted: boolean }) {
  return muted ? <VolumeOffIcon sx={{ fontSize: 24 }} /> : <VolumeUpIcon sx={{ fontSize: 24 }} />;
}

/**
 * Same audio control used visually by the Home Hero: circular MUI IconButton,
 * 2px translucent border, dark glass background and white Material volume icon.
 * The caller only toggles the live video's muted property; it never changes src.
 */
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
    <IconButton
      aria-label={muted ? "Attiva audio trailer" : "Disattiva audio trailer"}
      title={muted ? "Attiva audio" : "Disattiva audio"}
      data-testid={testId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle?.(event);
      }}
      sx={{
        border: "2px solid rgba(255,255,255,0.55)",
        color: "#fff",
        width: 46,
        height: 46,
        bgcolor: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        transition: "background-color 200ms ease, border-color 200ms ease, transform 200ms ease",
        pointerEvents: "auto",
        "&:hover": {
          borderColor: "#fff",
          color: "#fff",
          bgcolor: "rgba(255,255,255,0.15)",
          transform: "scale(1.06)",
        },
        ...(style || {}),
      }}
    >
      {!muted ? <VolumeUpIcon sx={{ fontSize: 24 }} /> : <VolumeOffIcon sx={{ fontSize: 24 }} />}
    </IconButton>
  );
}
