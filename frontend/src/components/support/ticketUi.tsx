// @ts-nocheck
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

export const STATUS_META = {
  open: { label: "Aperto", color: "#4ade80", bg: "rgba(34,197,94,0.14)" },
  in_progress: { label: "In lavorazione", color: "#fbbf24", bg: "rgba(251,191,36,0.14)" },
  closed: { label: "Chiuso", color: "rgba(255,255,255,0.55)", bg: "rgba(255,255,255,0.08)" },
};

export function StatusChip({ status, testId }) {
  const m = STATUS_META[status] || STATUS_META.open;
  return (
    <Box component="span" data-testid={testId} data-status={status} sx={{ display: "inline-flex", alignItems: "center", gap: 0.6, px: 1.1, py: 0.3, borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: m.color, bgcolor: m.bg, whiteSpace: "nowrap", letterSpacing: "0.02em" }}>
      <Box component="span" sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: m.color }} />{m.label}
    </Box>
  );
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

// Attachments live behind auth: fetch as blob so <img> never needs the token in the URL
export function AttachmentImage({ fileId, name, token }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    fetch(`${API_URL}/api/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b) { url = URL.createObjectURL(b); setSrc(url); } })
      .catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [fileId, token]);
  return (
    <Box component="a" href={src || undefined} target="_blank" rel="noreferrer" data-testid={`attachment-${fileId}`}
      sx={{ display: "block", width: 160, height: 100, borderRadius: "10px", overflow: "hidden", bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", position: "relative" }}>
      {src ? <img src={src} alt={name || "allegato"} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.4)", p: 1 }}>Caricamento…</Typography>}
    </Box>
  );
}

export function MessageBubble({ msg, mine, token }) {
  return (
    <Box data-testid={`ticket-message-${msg.id}`} data-sender={msg.sender} sx={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 0.6 }}>
      <Box sx={{ maxWidth: "78%", px: 2, py: 1.4, borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px", bgcolor: mine ? "#E50914" : "rgba(255,255,255,0.07)", border: mine ? "none" : "1px solid rgba(255,255,255,0.08)", color: "#fff" }}>
        <Typography sx={{ fontSize: 11.5, fontWeight: 700, opacity: 0.8, mb: 0.4 }}>{msg.sender_name}</Typography>
        {msg.text && <Typography sx={{ fontSize: 14.5, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{msg.text}</Typography>}
        {msg.attachments?.length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: msg.text ? 1.2 : 0 }}>
            {msg.attachments.map((a) => <AttachmentImage key={a.id} fileId={a.id} name={a.name} token={token} />)}
          </Box>
        )}
      </Box>
      <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{fmtDate(msg.created_at)}</Typography>
    </Box>
  );
}

export const panelSx = { bgcolor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 3 };
export const fieldSx = {
  width: "100%", px: 1.8, py: 1.4, borderRadius: "12px", color: "#fff", fontSize: 14.5, fontFamily: "'Inter', sans-serif", outline: "none", resize: "vertical",
  bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", transition: "border-color 200ms ease, box-shadow 200ms ease",
  "&::placeholder": { color: "#6b6b6b" }, "&:focus": { borderColor: "#E50914", boxShadow: "0 0 0 3px rgba(229,9,20,0.22)" },
  "& option": { bgcolor: "#141414" },
};
export const primaryBtnSx = {
  px: 2.6, height: 44, borderRadius: "12px", border: "none", cursor: "pointer", color: "#fff", bgcolor: "#E50914", fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 14,
  display: "inline-flex", alignItems: "center", gap: 1, transition: "background-color 200ms ease, opacity 200ms ease", "&:hover": { bgcolor: "#F6121D" }, "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
};
export const ghostBtnSx = { ...primaryBtnSx, bgcolor: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", "&:hover": { bgcolor: "rgba(255,255,255,0.13)" } };
