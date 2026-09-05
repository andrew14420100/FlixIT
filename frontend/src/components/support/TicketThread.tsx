// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import SendIcon from "@mui/icons-material/Send";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import AttachmentPicker from "./AttachmentPicker";
import { MessageBubble, StatusChip, fieldSx, primaryBtnSx, ghostBtnSx, fmtDate } from "./ticketUi";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

// Conversation view shared by user (mine="user") and admin (mine="admin").
export default function TicketThread({ ticketId, token, mine, endpoint, onBack, onChanged, categories = [], extraHeader = null, canAttach = false, closeAction = null, pollMs = 20000 }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const load = async () => {
    const res = await fetch(`${API_URL}${endpoint}/${ticketId}`, { headers });
    if (res.ok) setData(await res.json());
  };

  useEffect(() => { setData(null); load(); const id = setInterval(load, pollMs); return () => clearInterval(id); }, [ticketId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [data?.messages?.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() && !attachments.length) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}${endpoint}/${ticketId}/messages`, { method: "POST", headers, body: JSON.stringify({ text, attachment_ids: attachments.map((a) => a.id) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Invio non riuscito");
      setText("");
      setAttachments([]);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (!data) return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress sx={{ color: "#E50914" }} /></Box>;
  const { ticket, messages } = data;
  const cat = categories.find((c) => c.key === ticket.category)?.label || ticket.category;
  const closed = ticket.status === "closed";

  return (
    <Box data-testid="ticket-thread" sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 480 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, pb: 2, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {onBack && (
          <Box component="button" type="button" onClick={onBack} data-testid="ticket-back" aria-label="Indietro" sx={{ ...ghostBtnSx, px: 0, width: 40, height: 40, borderRadius: "10px", justifyContent: "center", flexShrink: 0 }}><ArrowBackIcon sx={{ fontSize: 20 }} /></Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography data-testid="ticket-subject" sx={{ color: "#fff", fontWeight: 700, fontSize: 18, lineHeight: 1.2, fontFamily: "'Unbounded', sans-serif" }}>{ticket.subject}</Typography>
          <Typography sx={{ color: "rgba(255,255,255,0.5)", fontSize: 12.5, mt: 0.5 }}>{cat} · aperto il {fmtDate(ticket.created_at)}{ticket.user_email && mine === "admin" ? ` · ${ticket.user_email}` : ""}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
          <StatusChip status={ticket.status} testId="ticket-status-chip" />
          {extraHeader?.(ticket)}
        </Box>
      </Box>

      <Box data-testid="ticket-messages" sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, py: 2.5, pr: 0.5, maxHeight: 520 }}>
        {messages.map((m) => <MessageBubble key={m.id} msg={m} mine={m.sender === mine} token={token} />)}
        <div ref={bottomRef} />
      </Box>

      {closed ? (
        <Box data-testid="ticket-closed-notice" sx={{ display: "flex", alignItems: "center", gap: 1, p: 2, borderRadius: "12px", bgcolor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)", fontSize: 13.5 }}>
          <LockOutlinedIcon sx={{ fontSize: 18 }} /> Ticket chiuso{ticket.closed_by ? ` da ${ticket.closed_by === "user" ? "te" : "l'assistenza"}` : ""}. Per un'altra richiesta apri un nuovo ticket.
        </Box>
      ) : (
        <Box component="form" onSubmit={send} sx={{ borderTop: "1px solid rgba(255,255,255,0.08)", pt: 2, display: "flex", flexDirection: "column", gap: 1.2 }}>
          {error && <Typography data-testid="ticket-reply-error" sx={{ fontSize: 13, color: "#ff6b72" }}>{error}</Typography>}
          <Box component="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Scrivi un messaggio…" data-testid="ticket-reply-input" sx={fieldSx}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e); }} />
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
            {canAttach ? <AttachmentPicker token={token} value={attachments} onChange={setAttachments} testId="reply-attachments" /> : <span />}
            <Box sx={{ display: "flex", gap: 1 }}>
              {closeAction}
              <Box component="button" type="submit" disabled={sending || (!text.trim() && !attachments.length)} data-testid="ticket-reply-send" sx={primaryBtnSx}>
                {sending ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : <><SendIcon sx={{ fontSize: 18 }} /> Invia</>}
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
