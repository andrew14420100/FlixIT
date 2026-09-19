// @ts-nocheck
import React from "react";
import IconButton from "@mui/material/IconButton";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";

export function TrailerVolumeIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <VolumeOffIcon sx={{ fontSize: { xs: 24, md: 31 } }} />
  ) : (
    <VolumeUpIcon sx={{ fontSize: { xs: 24, md: 31 } }} />
  );
}

/** Exact visual language of the Home Hero audio control. */
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
        width: { xs: 46, md: 60 },
        height: { xs: 46, md: 60 },
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
      <TrailerVolumeIcon muted={muted} />
    </IconButton>
  );
}
