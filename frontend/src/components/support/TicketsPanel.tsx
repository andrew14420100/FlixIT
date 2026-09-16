// @ts-nocheck
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import AddIcon from "@mui/icons-material/Add";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import TicketThread from "./TicketThread";
import AttachmentPicker from "./AttachmentPicker";
import { StatusChip, panelSx, fieldSx, primaryBtnSx, ghostBtnSx, fmtDate } from "./ticketUi";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

function NewTicketForm({ token, categories, onCreated, onCancel }) {
  const [category, setCategory] = useState(categories[0]?.key || "assistenza");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/tickets`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ category, subject, message, attachment_ids: attachments.map((a) => a.id) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Impossibile aprire il ticket");
      onCreated(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit} data-testid="new-ticket-form" sx={{ display: "flex", flexDirection: "column", gap: 1.6 }}>
      <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 18, fontFamily: "'Unbounded', sans-serif" }}>Nuovo ticket</Typography>
      {error && <Typography data-testid="new-ticket-error" sx={{ fontSize: 13.5, color: "#ff6b72" }}>{error}</Typography>}
      <Box>
        <Typography sx={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)", mb: 0.6 }}>Categoria</Typography>
        <Box component="select" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="new-ticket-category" sx={{ ...fieldSx, py: 1.3, cursor: "pointer" }}>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </Box>
      </Box>
      <Box component="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Oggetto (es. Il player non parte su Fight Club)" required minLength={3} maxLength={120} data-testid="new-ticket-subject" sx={fieldSx} />
      <Box component="textarea" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Descrivi la richiesta o il problema…" data-testid="new-ticket-message" sx={fieldSx} />
      <AttachmentPicker token={token} value={attachments} onChange={setAttachments} testId="new-ticket-attachments" />
      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
        <Box component="button" type="button" onClick={onCancel} data-testid="new-ticket-cancel" sx={ghostBtnSx}>Annulla</Box>
        <Box component="button" type="submit" disabled={saving} data-testid="new-ticket-submit" sx={primaryBtnSx}>{saving ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Apri ticket"}</Box>
      </Box>
    </Box>
  );
}

export default function TicketsPanel({ token }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get("ticket");
  const [tickets, setTickets] = useState(null);
  const [categories, setCategories] = useState([]);
  const [creating, setCreating] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const load = async () => {
    const res = await fetch(`${API_URL}/api/tickets`, { headers });
    if (res.ok) setTickets((await res.json()).items);
  };
  useEffect(() => {
    load();
    fetch(`${API_URL}/api/tickets/categories`).then((r) => r.json()).then((d) => setCategories(d.categories || [])).catch(() => {});
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  const select = (id) => { const next = new URLSearchParams(params); if (id) next.set("ticket", id); else next.delete("ticket"); next.set("section", "support"); setParams(next, { replace: true }); };

  const closeTicket = async (id) => {
    if (!window.confirm("Chiudere il ticket? La chiusura è definitiva.")) return;
    await fetch(`${API_URL}/api/tickets/${id}/close`, { method: "POST", headers });
    load();
  };

  if (selected) {
    return (
      <Box sx={{ ...panelSx, p: { xs: 2, md: 3 } }}>
        <TicketThread key={selected} ticketId={selected} token={token} mine="user" endpoint="/api/tickets" categories={categories} canAttach onBack={() => select(null)} onChanged={load}
          closeAction={<Box component="button" type="button" onClick={() => closeTicket(selected)} data-testid="ticket-close-button" sx={ghostBtnSx}>Chiudi ticket</Box>} />
      </Box>
    );
  }

  return (
    <Box sx={{ ...panelSx, p: { xs: 2, md: 3 } }} data-testid="tickets-panel">
      {creating ? (
        <NewTicketForm token={token} categories={categories} onCancel={() => setCreating(false)} onCreated={(t) => { setCreating(false); load(); select(t.id); }} />
      ) : (
        <>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 2.5, flexWrap: "wrap" }}>
            <Box>
              <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 20, fontFamily: "'Unbounded', sans-serif" }}>Assistenza</Typography>
              <Typography sx={{ color: "rgba(255,255,255,0.55)", fontSize: 13.5, mt: 0.4 }}>Apri un ticket e dialoga con il team: ti avvisiamo con la campanella a ogni risposta.</Typography>
            </Box>
            <Box component="button" type="button" onClick={() => setCreating(true)} data-testid="open-new-ticket" sx={primaryBtnSx}><AddIcon sx={{ fontSize: 20 }} /> Nuovo ticket</Box>
          </Box>

          {tickets === null ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress sx={{ color: "#E50914" }} /></Box>
          ) : tickets.length === 0 ? (
            <Box data-testid="tickets-empty" sx={{ textAlign: "center", py: 6, color: "rgba(255,255,255,0.5)" }}>
              <SupportAgentOutlinedIcon sx={{ fontSize: 44, mb: 1, color: "rgba(255,255,255,0.3)" }} />
              <Typography sx={{ fontSize: 15 }}>Nessun ticket aperto. Hai bisogno di aiuto? Crea il primo.</Typography>
            </Box>
          ) : (
            <Box data-testid="tickets-list" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {tickets.map((t) => (
                <Box key={t.id} component="button" type="button" onClick={() => select(t.id)} data-testid={`ticket-row-${t.id}`}
                  sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%", textAlign: "left", p: 2, borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", bgcolor: "rgba(255,255,255,0.03)", color: "#fff", cursor: "pointer", fontFamily: "'Inter', sans-serif",
                    transition: "background-color 160ms ease, transform 160ms ease, border-color 160ms ease", "&:hover": { bgcolor: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.16)", transform: "translateX(2px)" } }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography noWrap sx={{ fontWeight: 700, fontSize: 15 }}>{t.subject}</Typography>
                      {t.unread > 0 && <Box data-testid={`ticket-unread-${t.id}`} sx={{ px: 0.9, py: 0.1, borderRadius: 999, bgcolor: "#E50914", fontSize: 11, fontWeight: 800 }}>{t.unread}</Box>}
                    </Box>
                    <Typography noWrap sx={{ fontSize: 13, color: "rgba(255,255,255,0.55)", mt: 0.3 }}>{categories.find((c) => c.key === t.category)?.label || t.category} · {t.last_sender === "admin" ? "Assistenza" : "Tu"}: {t.last_preview}</Typography>
                  </Box>
                  <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                    <StatusChip status={t.status} />
                    <Typography sx={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)", mt: 0.6 }}>{fmtDate(t.updated_at)}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
