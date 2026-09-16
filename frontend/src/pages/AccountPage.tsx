// @ts-nocheck
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import CircularProgress from "@mui/material/CircularProgress";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TicketsPanel from "src/components/support/TicketsPanel";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { useAuthModal } from "src/store/authModal";
import { useCurrentUser, userToken, premiumLabel, fmtDate } from "src/hooks/useCurrentUser";
import { AVATARS, avatarSrc } from "src/config/avatars";
import { MAIN_PATH } from "src/constant";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const authHeaders = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${userToken()}` });
const NAV = [
  { id: "profile", label: "Il mio profilo", hint: "Avatar e dati", Icon: PersonOutlineIcon },
  { id: "list", label: "La mia lista", hint: "Titoli salvati", Icon: BookmarkBorderIcon },
  { id: "watching", label: "Continua a guardare", hint: "Riprendi da dove eri", Icon: PlayCircleOutlineIcon },
  { id: "settings", label: "Impostazioni account", hint: "Nome e password", Icon: SettingsOutlinedIcon },
  { id: "notifications", label: "Notifiche", hint: "Preferenze e avvisi", Icon: NotificationsNoneIcon },
  { id: "subscription", label: "Abbonamento", hint: "Stato Premium e pagamenti", Icon: WorkspacePremiumIcon },
  { id: "support", label: "Assistenza", hint: "I tuoi ticket", Icon: SupportAgentOutlinedIcon },
];

export const cardSx = { p: { xs: 2.5, md: 3.5 }, borderRadius: "20px", bgcolor: "rgba(15,15,18,0.9)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(24px)" };
export const inputSx = { width: "100%", height: 48, px: 2, borderRadius: "12px", color: "#fff", fontSize: 15, fontFamily: "'Inter', sans-serif", outline: "none", bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", transition: "border-color 200ms ease, box-shadow 200ms ease", "&::placeholder": { color: "#666" }, "&:focus": { borderColor: "#E50914", boxShadow: "0 0 0 3px rgba(229,9,20,0.25)" } };
export const btnSx = { height: 46, px: 3, borderRadius: "12px", border: "none", cursor: "pointer", color: "#fff", bgcolor: "#E50914", fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 13, transition: "background-color 200ms ease, transform 150ms ease", "&:hover": { bgcolor: "#F6121D" }, "&:active": { transform: "scale(0.98)" }, "&:disabled": { opacity: 0.5, cursor: "not-allowed" } };
const rowSx = { display: "flex", alignItems: "center", gap: 1.5, width: "100%", px: 1.5, py: 1.2, border: "none", borderRadius: "12px", cursor: "pointer", textAlign: "left", bgcolor: "transparent", color: "#fff", fontFamily: "'Inter', sans-serif", transition: "background-color 160ms ease, transform 160ms ease", "&:hover": { bgcolor: "rgba(255,255,255,0.07)", transform: "translateX(2px)" } };

function SectionTitle({ children, sub }) {
  return (<Box sx={{ mb: 3 }}><Typography sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: { xs: 20, md: 24 }, color: "#fff" }}>{children}</Typography>{sub && <Typography sx={{ color: "#A3A3A3", fontSize: 14, mt: 0.5 }}>{sub}</Typography>}</Box>);
}

function Notice({ kind, text }) {
  if (!text) return null;
  const ok = kind === "success";
  return <Box role="alert" data-testid={`account-${kind}`} sx={{ mb: 2, px: 2, py: 1.2, borderRadius: "10px", fontSize: 14, color: ok ? "#4ade80" : "#ff6b72", bgcolor: ok ? "rgba(34,197,94,0.12)" : "rgba(229,9,20,0.15)", border: `1px solid ${ok ? "rgba(34,197,94,0.3)" : "rgba(229,9,20,0.4)"}` }}>{text}</Box>;
}

function PosterGrid({ items, empty, onOpen, progress }) {
  if (!items.length) return <Typography data-testid="account-empty" sx={{ color: "#666", fontSize: 14 }}>{empty}</Typography>;
  return (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", md: "repeat(4, 1fr)", lg: "repeat(5, 1fr)" } }}>
      {items.map((it) => (
        <Box key={`${it.media_type}-${it.media_id}`} onClick={() => onOpen(it)} data-testid={`account-item-${it.media_id}`}
          sx={{ position: "relative", aspectRatio: progress ? "16/9" : "2/3", borderRadius: "10px", overflow: "hidden", bgcolor: "#141414", cursor: "pointer", transition: "transform 200ms ease, box-shadow 200ms ease", "&:hover": { transform: "scale(1.04)", boxShadow: "0 16px 40px rgba(0,0,0,0.6)" } }}>
          {(progress ? it.backdrop_path : it.poster_path) && <img src={`${TMDB_IMG}${progress ? it.backdrop_path : it.poster_path}`} alt={it.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
          <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.85) 0%, transparent 55%)" }} />
          <Typography noWrap sx={{ position: "absolute", left: 10, right: 10, bottom: progress ? 12 : 8, color: "#fff", fontSize: 13, fontWeight: 600 }}>{it.title}</Typography>
          {progress && it.duration > 0 && <Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, bgcolor: "rgba(255,255,255,0.2)" }}><Box sx={{ width: `${Math.min(100, (it.progress / it.duration) * 100)}%`, height: "100%", bgcolor: "#E50914" }} /></Box>}
        </Box>
      ))}
    </Box>
  );
}

function ProfileSection({ user, onSaved }) {
  const [avatar, setAvatar] = useState(user.profileImage);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const save = async () => {
    setSaving(true);
    const res = await fetch(`${API_URL}/api/auth/profile`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ profileImage: avatar }) });
    setSaving(false);
    setMsg(res.ok ? ["success", "Avatar aggiornato"] : ["error", "Salvataggio non riuscito"]);
    if (res.ok) onSaved();
  };
  return (
    <Box sx={cardSx} data-testid="account-section-profile">
      <SectionTitle sub="Scegli l'avatar che ti rappresenta.">Il mio profilo</SectionTitle>
      <Notice kind={msg?.[0]} text={msg?.[1]} />
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        {AVATARS.map((a) => (
          <Box key={a.id} component="button" type="button" onClick={() => setAvatar(a.id)} data-testid={`avatar-option-${a.id}`} aria-pressed={avatar === a.id}
            sx={{ p: 0.4, borderRadius: "14px", cursor: "pointer", bgcolor: "transparent", border: `2px solid ${avatar === a.id ? "#E50914" : "transparent"}`, transition: "transform 150ms ease, border-color 150ms ease", "&:hover": { transform: "scale(1.06)" } }}>
            <Avatar variant="rounded" src={a.src} sx={{ width: 64, height: 64, borderRadius: "11px" }} />
          </Box>
        ))}
      </Box>
      <Box component="button" type="button" onClick={save} disabled={saving || avatar === user.profileImage} data-testid="avatar-save" sx={{ ...btnSx, mt: 3 }}>{saving ? "Salvataggio…" : "Salva avatar"}</Box>
    </Box>
  );
}

function SettingsSection({ user, onSaved }) {
  const [name, setName] = useState(user.name || "");
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const submit = async (body, okText) => {
    setSaving(true); setMsg(null);
    const res = await fetch(`${API_URL}/api/auth/profile`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setMsg(["error", typeof data.detail === "string" ? data.detail : "Operazione non riuscita"]);
    if (data.token) localStorage.setItem("user_token", data.token);
    setMsg(["success", okText]); onSaved();
  };
  return (
    <Box sx={cardSx} data-testid="account-section-settings">
      <SectionTitle sub="Aggiorna il nome visualizzato o cambia la password.">Impostazioni account</SectionTitle>
      <Notice kind={msg?.[0]} text={msg?.[1]} />
      <Typography sx={{ color: "#A3A3A3", fontSize: 12.5, mb: 1, textTransform: "uppercase", letterSpacing: "0.08em" }}>Nome</Typography>
      <Box sx={{ display: "flex", gap: 1.5, flexDirection: { xs: "column", sm: "row" } }}>
        <Box component="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Il tuo nome" data-testid="settings-name-input" sx={inputSx} />
        <Box component="button" type="button" disabled={saving || !name.trim() || name === user.name} onClick={() => submit({ name: name.trim() }, "Nome aggiornato")} data-testid="settings-name-save" sx={{ ...btnSx, flexShrink: 0 }}>Salva nome</Box>
      </Box>
      <Typography sx={{ color: "#A3A3A3", fontSize: 12.5, mt: 4, mb: 1, textTransform: "uppercase", letterSpacing: "0.08em" }}>Cambia password</Typography>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
        <Box component="input" type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} placeholder="Nuova password (min 6)" data-testid="settings-password-input" sx={inputSx} />
        <Box component="input" type="password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} placeholder="Conferma nuova password" data-testid="settings-password-confirm" sx={inputSx} />
      </Box>
      <Box component="button" type="button" disabled={saving || pwd.next.length < 6 || pwd.next !== pwd.confirm} onClick={() => submit({ password: pwd.next }, "Password aggiornata").then(() => setPwd({ current: "", next: "", confirm: "" }))} data-testid="settings-password-save" sx={{ ...btnSx, mt: 2 }}>Aggiorna password</Box>
      <Typography sx={{ color: "#666", fontSize: 12.5, mt: 1 }}>Email: {user.email}</Typography>
    </Box>
  );
}

function NotificationsSection() {
  const [prefs, setPrefs] = useState(() => JSON.parse(localStorage.getItem("flixit_notif_prefs") || '{"news":true,"premium":true,"tickets":true}'));
  const [items, setItems] = useState([]);
  useEffect(() => { fetch(`${API_URL}/api/notifications`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setItems(d.items || [])).catch(() => {}); }, []);
  const toggle = (k) => { const n = { ...prefs, [k]: !prefs[k] }; setPrefs(n); localStorage.setItem("flixit_notif_prefs", JSON.stringify(n)); };
  const OPTS = [["news", "Novità e uscite", "Nuovi titoli e sezioni consigliate"], ["premium", "Abbonamento", "Scadenze, rinnovi e ricevute"], ["tickets", "Assistenza", "Risposte ai tuoi ticket"]];
  return (
    <Box sx={cardSx} data-testid="account-section-notifications">
      <SectionTitle sub="Scegli cosa vuoi ricevere nella campanella.">Notifiche e preferenze</SectionTitle>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {OPTS.map(([k, l, h]) => (
          <Box key={k} component="button" type="button" onClick={() => toggle(k)} data-testid={`notif-pref-${k}`} aria-pressed={prefs[k]} sx={{ ...rowSx, border: "1px solid rgba(255,255,255,0.06)", bgcolor: "rgba(255,255,255,0.02)" }}>
            <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>{l}</Typography><Typography sx={{ fontSize: 12.5, color: "#A3A3A3" }}>{h}</Typography></Box>
            <Box sx={{ width: 44, height: 24, borderRadius: 999, position: "relative", bgcolor: prefs[k] ? "#E50914" : "rgba(255,255,255,0.15)", transition: "background-color 200ms ease" }}>
              <Box sx={{ position: "absolute", top: 3, left: prefs[k] ? 23 : 3, width: 18, height: 18, borderRadius: "50%", bgcolor: "#fff", transition: "left 200ms ease" }} />
            </Box>
          </Box>
        ))}
      </Box>
      <Typography sx={{ color: "#A3A3A3", fontSize: 12.5, mt: 4, mb: 1, textTransform: "uppercase", letterSpacing: "0.08em" }}>Ultime notifiche</Typography>
      {items.length === 0 ? <Typography sx={{ color: "#666", fontSize: 14 }}>Nessuna notifica.</Typography> : items.slice(0, 8).map((n) => (
        <Box key={n.id} sx={{ py: 1.2, borderBottom: "1px solid rgba(255,255,255,0.06)" }}><Typography sx={{ fontSize: 14, fontWeight: 600, color: n.read ? "#A3A3A3" : "#fff" }}>{n.title}</Typography><Typography sx={{ fontSize: 12.5, color: "#777" }}>{n.body}</Typography></Box>
      ))}
    </Box>
  );
}

const STATUS_IT = { paid: "Pagato", pending: "In attesa", refunded: "Rimborsato", failed: "Fallito", expired: "Scaduto" };

function SubscriptionSection({ user }) {
  const navigate = useNavigate();
  const [payments, setPayments] = useState([]);
  useEffect(() => { fetch(`${API_URL}/api/premium/payments`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setPayments(d.items || [])).catch(() => {}); }, []);
  const active = user.is_premium;
  return (
    <Box sx={cardSx} data-testid="account-section-subscription">
      <SectionTitle sub="Il tuo piano e lo storico dei pagamenti.">Abbonamento</SectionTitle>
      <Box sx={{ p: 2.5, borderRadius: "16px", background: active ? "linear-gradient(135deg, rgba(229,9,20,0.3), rgba(229,9,20,0.05))" : "rgba(255,255,255,0.03)", border: `1px solid ${active ? "rgba(229,9,20,0.4)" : "rgba(255,255,255,0.08)"}`, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <Box sx={{ width: 52, height: 52, borderRadius: "14px", display: "grid", placeItems: "center", bgcolor: active ? "#E50914" : "rgba(255,255,255,0.08)" }}><WorkspacePremiumIcon sx={{ color: "#fff", fontSize: 28 }} /></Box>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography data-testid="subscription-status" sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 16, color: "#fff" }}>{premiumLabel(user)}</Typography>
          <Typography sx={{ color: "#A3A3A3", fontSize: 13, mt: 0.3 }}>{active ? (user.premium?.plan_name ? `Piano ${user.premium.plan_name}` : "Accesso completo alle sezioni Premium") : "Sblocca Prime Visioni e Cinema d'Autore."}</Typography>
        </Box>
        {user.role !== "superadmin" && <Box component="button" type="button" onClick={() => navigate("/premium")} data-testid="subscription-upgrade" sx={btnSx}>{active ? "Estendi / cambia piano" : "Passa a Premium"}</Box>}
      </Box>
      <Typography sx={{ color: "#A3A3A3", fontSize: 12.5, mt: 4, mb: 1, textTransform: "uppercase", letterSpacing: "0.08em" }}>Storico pagamenti</Typography>
      {payments.length === 0 ? <Typography sx={{ color: "#666", fontSize: 14 }} data-testid="payments-empty">Nessun pagamento registrato.</Typography> : payments.map((p) => (
        <Box key={p.id} data-testid={`payment-row-${p.id}`} sx={{ display: "flex", alignItems: "center", gap: 2, py: 1.4, borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap" }}>
          <Box sx={{ flex: 1, minWidth: 160 }}><Typography sx={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{p.plan_name}</Typography><Typography sx={{ fontSize: 12.5, color: "#777" }}>{fmtDate(p.created_at)} · {p.provider === "stripe" ? "Carta (Stripe)" : "PayPal"} · Rif. {p.id.slice(0, 8)}</Typography></Box>
          <Typography sx={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>{(p.amount_cents / 100).toLocaleString("it-IT", { style: "currency", currency: p.currency || "EUR" })}</Typography>
          <Typography sx={{ fontSize: 12, px: 1.2, py: 0.3, borderRadius: 999, fontWeight: 600, color: p.status === "paid" ? "#4ade80" : p.status === "refunded" ? "#fbbf24" : "#A3A3A3", bgcolor: "rgba(255,255,255,0.06)" }}>{STATUS_IT[p.status] || p.status}</Typography>
        </Box>
      ))}
    </Box>
  );
}

export function Component() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const openAuthModal = useAuthModal((s) => s.openModal);
  const { user, refresh } = useCurrentUser();
  const { items: watchItems } = useContinueWatching();
  const [list, setList] = useState([]);
  const [section, setSection] = useState(params.get("ticket") || params.get("section") === "support" ? "support" : params.get("section") || "profile");

  useEffect(() => { if (params.get("ticket")) setSection("support"); }, [params]);
  useEffect(() => {
    if (!user?.id) return;
    fetch(`${API_URL}/api/user/list/${user.id}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setList(d.items || [])).catch(() => {});
  }, [user?.id]);

  if (user === undefined) return <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><CircularProgress sx={{ color: "#E50914" }} /></Box>;
  if (!user) return (
    <Box data-testid="account-login-prompt" sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2, bgcolor: "#050505" }}>
      <Box sx={{ ...cardSx, maxWidth: 440, textAlign: "left" }}>
        <Typography sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 24, color: "#fff" }}>Accedi al tuo account</Typography>
        <Typography sx={{ color: "#A3A3A3", fontSize: 14, mt: 1, mb: 3 }}>Per gestire profilo, lista e abbonamento devi essere loggato.</Typography>
        <Box component="button" type="button" onClick={() => openAuthModal("login")} data-testid="account-login-button" sx={btnSx}>Accedi</Box>
      </Box>
    </Box>
  );

  const logout = () => { localStorage.removeItem("user_token"); localStorage.removeItem("admin_token"); window.location.href = "/browse"; };
  const goAdmin = () => { localStorage.setItem("admin_token", userToken()); navigate("/admin"); };
  const openItem = (it) => navigate(`/${MAIN_PATH.browse}/${it.media_type}/${it.media_id}`);
  const resume = (it) => navigate(`/${MAIN_PATH.watch}/${it.media_type}/${it.tmdb_id}${it.season ? `?season=${it.season}&episode=${it.episode}` : ""}`);

  return (
    <Box data-testid="account-page" sx={{ minHeight: "100vh", bgcolor: "#050505", pt: { xs: 11, md: 14 }, pb: 10, px: { xs: 2, sm: 4, md: 8 }, position: "relative", overflow: "hidden" }}>
      <Box sx={{ position: "absolute", top: -120, right: "-5%", width: 500, height: 500, borderRadius: "50%", bgcolor: "rgba(229,9,20,0.12)", filter: "blur(120px)", pointerEvents: "none" }} />
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", md: "320px 1fr" }, alignItems: "start", position: "relative" }}>
        <Box sx={{ ...cardSx, p: 1.5, position: { md: "sticky" }, top: { md: 96 } }} data-testid="account-sidebar">
          <Box data-testid="account-header" sx={{ position: "relative", p: 2.5, borderRadius: "16px", overflow: "hidden", background: "linear-gradient(135deg, rgba(229,9,20,0.3) 0%, rgba(229,9,20,0.06) 60%, transparent 100%)", border: "1px solid rgba(229,9,20,0.2)" }}>
            <Box sx={{ position: "absolute", right: -30, top: -30, width: 120, height: 120, borderRadius: "50%", bgcolor: "rgba(229,9,20,0.3)", filter: "blur(30px)" }} />
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.8, position: "relative" }}>
              <Avatar variant="rounded" src={avatarSrc(user.profileImage)} data-testid="account-avatar" sx={{ width: 60, height: 60, borderRadius: "14px", bgcolor: "#222", boxShadow: "0 8px 22px rgba(0,0,0,0.5)" }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap data-testid="account-name" sx={{ color: "#fff", fontWeight: 700, fontSize: 17, fontFamily: "'Unbounded', sans-serif", lineHeight: 1.2 }}>{user.name || "Profilo"}</Typography>
                <Typography noWrap data-testid="account-email" sx={{ color: "rgba(255,255,255,0.6)", fontSize: 12.5, mt: 0.3 }}>{user.email}</Typography>
                <Typography data-testid="account-premium-badge" sx={{ display: "inline-block", mt: 0.8, px: 1, py: 0.2, borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: user.is_premium ? "#fff" : "#A3A3A3", bgcolor: user.is_premium ? "#E50914" : "rgba(255,255,255,0.08)" }}>{user.role === "superadmin" ? "Superadmin" : user.role === "admin" ? "Admin" : user.is_premium ? "Premium" : "Free"}</Typography>
              </Box>
            </Box>
          </Box>
          <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 0.25 }}>
            {NAV.map(({ id, label, hint, Icon }) => (
              <Box key={id} component="button" type="button" onClick={() => setSection(id)} data-testid={`account-nav-${id}`} aria-current={section === id} sx={{ ...rowSx, bgcolor: section === id ? "rgba(255,255,255,0.08)" : "transparent" }}>
                <Box sx={{ width: 36, height: 36, borderRadius: "10px", display: "grid", placeItems: "center", bgcolor: section === id ? "rgba(229,9,20,0.2)" : "rgba(255,255,255,0.06)", flexShrink: 0 }}><Icon sx={{ fontSize: 20, color: section === id ? "#ff5a63" : "rgba(255,255,255,0.85)" }} /></Box>
                <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{label}</Typography><Typography noWrap sx={{ fontSize: 12, color: "rgba(255,255,255,0.45)", mt: 0.2 }}>{hint}</Typography></Box>
                <ChevronRightIcon sx={{ fontSize: 18, color: "rgba(255,255,255,0.3)", opacity: section === id ? 1 : 0 }} />
              </Box>
            ))}
            {user.is_admin && (
              <Box component="button" type="button" onClick={goAdmin} data-testid="account-nav-admin" sx={{ ...rowSx, color: "#fbbf24" }}>
                <Box sx={{ width: 36, height: 36, borderRadius: "10px", display: "grid", placeItems: "center", bgcolor: "rgba(251,191,36,0.14)", flexShrink: 0 }}><AdminPanelSettingsOutlinedIcon sx={{ fontSize: 20, color: "#fbbf24" }} /></Box>
                <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 14, fontWeight: 600 }}>Pannello admin</Typography><Typography sx={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Gestione piattaforma</Typography></Box>
              </Box>
            )}
          </Box>
          <Box sx={{ height: "1px", bgcolor: "rgba(255,255,255,0.07)", mx: 1.5, my: 1 }} />
          <Box component="button" type="button" onClick={logout} data-testid="account-logout" sx={{ ...rowSx, color: "#ff5a63", "&:hover": { bgcolor: "rgba(229,9,20,0.12)" } }}>
            <Box sx={{ width: 36, height: 36, borderRadius: "10px", display: "grid", placeItems: "center", bgcolor: "rgba(229,9,20,0.15)", flexShrink: 0 }}><LogoutIcon sx={{ fontSize: 19, color: "#ff5a63" }} /></Box>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Esci</Typography>
          </Box>
        </Box>

        <Box sx={{ minWidth: 0 }}>
          {section === "profile" && <ProfileSection user={user} onSaved={refresh} />}
          {section === "list" && <Box sx={cardSx} data-testid="account-section-list"><SectionTitle sub={`${list.length} titoli salvati`}>La mia lista</SectionTitle><PosterGrid items={list} empty="Non hai ancora salvato nessun titolo." onOpen={openItem} /></Box>}
          {section === "watching" && <Box sx={cardSx} data-testid="account-section-watching"><SectionTitle sub="Riprendi la visione da dove l'avevi lasciata.">Continua a guardare</SectionTitle><PosterGrid progress items={(watchItems || []).map((w) => ({ ...w, media_id: w.tmdb_id }))} empty="Nessuna visione in corso." onOpen={resume} /></Box>}
          {section === "settings" && <SettingsSection user={user} onSaved={refresh} />}
          {section === "notifications" && <NotificationsSection />}
          {section === "subscription" && <SubscriptionSection user={user} />}
          {section === "support" && <Box sx={cardSx} data-testid="account-section-support"><SectionTitle sub="Apri un ticket o segui le risposte dell'assistenza.">Assistenza</SectionTitle><TicketsPanel token={userToken()} /></Box>}
        </Box>
      </Box>
    </Box>
  );
}

export default Component;
