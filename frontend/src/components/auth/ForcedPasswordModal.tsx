// @ts-nocheck
import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import LockResetIcon from "@mui/icons-material/LockReset";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { authHeaders } from "src/hooks/useNotifications";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const inputSx = {
  width: "100%", height: 50, px: 2, borderRadius: "12px", color: "#fff", fontSize: 15, fontFamily: "'Inter', sans-serif", outline: "none",
  bgcolor: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", transition: "border-color 200ms ease, box-shadow 200ms ease",
  "&::placeholder": { color: "#6b6b6b" }, "&:focus": { borderColor: "#E50914", boxShadow: "0 0 0 3px rgba(229,9,20,0.28)" },
};
const RULES = [["Almeno 8 caratteri", (p) => p.length >= 8], ["Una lettera maiuscola", (p) => /[A-Z]/.test(p)], ["Un numero", (p) => /\d/.test(p)]];

// Blocking modal shown when the admin has required a password change: no close button, no backdrop click, no Escape.
export default function ForcedPasswordModal({ onDone }) {
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const valid = RULES.every(([, ok]) => ok(pwd)) && pwd === confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/forced-password`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ new_password: pwd }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Impossibile aggiornare la password");
      localStorage.setItem("user_token", data.token);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box data-testid="forced-password-modal" role="dialog" aria-modal="true" onKeyDown={(e) => e.key === "Escape" && e.stopPropagation()}
      sx={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", p: 2, bgcolor: "rgba(5,5,5,0.92)", backdropFilter: "blur(18px)" }}>
      <Box component="form" onSubmit={submit} sx={{ width: "100%", maxWidth: 440, p: { xs: 3, sm: 4.5 }, borderRadius: "20px", bgcolor: "rgba(18,18,22,0.95)", border: "1px solid rgba(229,9,20,0.35)", boxShadow: "0 32px 80px rgba(0,0,0,0.85)" }}>
        <Box sx={{ width: 56, height: 56, borderRadius: "16px", display: "grid", placeItems: "center", bgcolor: "rgba(229,9,20,0.15)", mb: 2.5 }}>
          <LockResetIcon sx={{ fontSize: 30, color: "#ff5a63" }} />
        </Box>
        <Typography data-testid="forced-password-title" sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: { xs: 20, sm: 24 }, color: "#fff", lineHeight: 1.15 }}>Reimposta la password</Typography>
        <Typography sx={{ color: "#A3A3A3", fontSize: 14, mt: 1, mb: 3 }}>L'amministratore ha richiesto il cambio della tua password. Per continuare a usare FlixIT devi sceglierne una nuova adesso.</Typography>

        {error && <Box data-testid="forced-password-error" role="alert" sx={{ mb: 2, px: 2, py: 1.3, borderRadius: "10px", fontSize: 14, color: "#ff6b72", bgcolor: "rgba(229,9,20,0.15)", border: "1px solid rgba(229,9,20,0.4)" }}>{error}</Box>}

        <Box sx={{ position: "relative", mb: 1.5 }}>
          <Box component="input" type={show ? "text" : "password"} placeholder="Nuova password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" data-testid="forced-password-input" sx={{ ...inputSx, pr: 6 }} />
          <Box component="button" type="button" onClick={() => setShow((s) => !s)} data-testid="forced-password-toggle" aria-label="Mostra password"
            sx={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9a9a9a", display: "flex", "&:hover": { color: "#fff" } }}>
            {show ? <VisibilityOffIcon sx={{ fontSize: 20 }} /> : <VisibilityIcon sx={{ fontSize: 20 }} />}
          </Box>
        </Box>
        <Box component="input" type={show ? "text" : "password"} placeholder="Conferma password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" data-testid="forced-password-confirm" sx={inputSx} />

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 2, mb: 3 }}>
          {RULES.map(([label, ok]) => (
            <Typography key={label} sx={{ fontSize: 12, px: 1.2, py: 0.4, borderRadius: 999, color: ok(pwd) ? "#4ade80" : "rgba(255,255,255,0.5)", bgcolor: ok(pwd) ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.05)", transition: "all 200ms ease" }}>{label}</Typography>
          ))}
          <Typography sx={{ fontSize: 12, px: 1.2, py: 0.4, borderRadius: 999, color: pwd && pwd === confirm ? "#4ade80" : "rgba(255,255,255,0.5)", bgcolor: pwd && pwd === confirm ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.05)" }}>Le password coincidono</Typography>
        </Box>

        <Box component="button" type="submit" disabled={!valid || saving} data-testid="forced-password-submit"
          sx={{ width: "100%", height: 50, borderRadius: "12px", border: "none", cursor: valid && !saving ? "pointer" : "not-allowed", color: "#fff", bgcolor: valid ? "#E50914" : "rgba(229,9,20,0.4)",
            fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", transition: "background-color 200ms ease", "&:hover": { bgcolor: valid ? "#F6121D" : undefined } }}>
          {saving ? <CircularProgress size={22} sx={{ color: "#fff" }} /> : "Salva la nuova password"}
        </Box>
      </Box>
    </Box>
  );
}
