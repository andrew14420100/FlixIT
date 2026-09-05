// @ts-nocheck
import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

const inputSx = {
  width: "100%", height: 50, px: 2, borderRadius: "12px", color: "#fff", fontSize: 15, fontFamily: "'Inter', sans-serif",
  bgcolor: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", outline: "none",
  transition: "border-color 200ms ease, box-shadow 200ms ease, background-color 200ms ease",
  "&::placeholder": { color: "#6b6b6b" },
  "&:hover": { bgcolor: "rgba(255,255,255,0.09)" },
  "&:focus": { borderColor: "#E50914", boxShadow: "0 0 0 3px rgba(229,9,20,0.28)", bgcolor: "rgba(255,255,255,0.05)" },
};

export function AuthForm({ mode, onSuccess }) {
  const isRegister = mode === "register";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/${isRegister ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRegister ? { email, password, name } : { email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || (isRegister ? "Errore nella registrazione" : "Credenziali non valide"));
      localStorage.setItem("user_token", data.token);
      setAlert({ type: "success", text: isRegister ? "Account creato, benvenuto!" : "Accesso effettuato" });
      setTimeout(() => onSuccess?.(data), 600);
    } catch (err) {
      setAlert({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ display: "flex", flexDirection: "column", gap: 2 }} data-testid="auth-modal-form">
      {alert && (
        <Box data-testid="auth-modal-alert" role="alert" sx={{
          px: 2, py: 1.4, borderRadius: "10px", fontSize: 14, fontWeight: 500,
          color: alert.type === "error" ? "#ff6b72" : "#4ade80",
          bgcolor: alert.type === "error" ? "rgba(229,9,20,0.15)" : "rgba(34,197,94,0.15)",
          border: `1px solid ${alert.type === "error" ? "rgba(229,9,20,0.4)" : "rgba(34,197,94,0.4)"}`,
        }}>
          {alert.text}
        </Box>
      )}
      {isRegister && (
        <Box component="input" type="text" placeholder="Nome" value={name} required onChange={(e) => setName(e.target.value)} sx={inputSx} data-testid="auth-modal-name-input" />
      )}
      <Box component="input" type="email" placeholder="Email" value={email} required autoComplete="email" onChange={(e) => setEmail(e.target.value)} sx={inputSx} data-testid="auth-modal-email-input" />
      <Box sx={{ position: "relative" }}>
        <Box component="input" type={showPassword ? "text" : "password"} placeholder="Password" value={password} required minLength={4}
          autoComplete={isRegister ? "new-password" : "current-password"} onChange={(e) => setPassword(e.target.value)} sx={{ ...inputSx, pr: 6 }} data-testid="auth-modal-password-input" />
        <Box component="button" type="button" onClick={() => setShowPassword((s) => !s)} aria-label="Mostra password" data-testid="auth-modal-password-toggle"
          sx={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer",
            color: "#9a9a9a", display: "flex", transition: "color 200ms ease", "&:hover": { color: "#fff" } }}>
          {showPassword ? <VisibilityOffIcon sx={{ fontSize: 20 }} /> : <VisibilityIcon sx={{ fontSize: 20 }} />}
        </Box>
      </Box>
      <Box component="button" type="submit" disabled={saving} data-testid="auth-modal-submit-button"
        sx={{ mt: 1, height: 50, borderRadius: "12px", border: "none", cursor: saving ? "default" : "pointer", color: "#fff",
          bgcolor: "#E50914", fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "0.04em",
          boxShadow: "0 12px 30px rgba(229,9,20,0.28)", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background-color 200ms ease, transform 150ms ease, box-shadow 200ms ease",
          "&:hover": { bgcolor: "#F6121D", boxShadow: "0 14px 36px rgba(229,9,20,0.42)" }, "&:active": { transform: "scale(0.99)" } }}>
        {saving ? <CircularProgress size={22} sx={{ color: "#fff" }} /> : isRegister ? "Crea account" : "Accedi"}
      </Box>
      <Typography sx={{ fontSize: 12, color: "#666", textAlign: "center", mt: 0.5 }}>
        Continuando accetti i termini di utilizzo di FlixIT.
      </Typography>
    </Box>
  );
}
