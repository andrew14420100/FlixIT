// @ts-nocheck
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import BlockIcon from "@mui/icons-material/Block";
import ForcedPasswordModal from "./ForcedPasswordModal";
import { authHeaders, POLL_MS, handleBanned } from "src/hooks/useNotifications";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

// Session-level guards: blocking forced-password modal (polled every 20s) and the "account suspended" banner after a ban.
export default function SessionGuards() {
  const [mustReset, setMustReset] = useState(false);
  const [banned, setBanned] = useState(() => sessionStorage.getItem("flixit_banned_reason"));

  useEffect(() => {
    if (!localStorage.getItem("user_token")) return;
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/api/notifications`, { headers: authHeaders() });
        if (res.status === 403) { await handleBanned(res); return; }
        if (res.ok) setMustReset(Boolean((await res.json()).must_reset_password));
      } catch {}
    };
    check();
    const id = setInterval(check, POLL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {mustReset && <ForcedPasswordModal onDone={() => setMustReset(false)} />}
      {banned !== null && (
        <Box data-testid="banned-banner" sx={{ position: "fixed", top: 90, left: "50%", transform: "translateX(-50%)", zIndex: 1500, display: "flex", alignItems: "center", gap: 1.5, px: 2.5, py: 1.5, maxWidth: "calc(100vw - 32px)",
          borderRadius: "14px", bgcolor: "rgba(20,10,10,0.95)", border: "1px solid rgba(229,9,20,0.5)", boxShadow: "0 20px 50px rgba(0,0,0,0.6)", backdropFilter: "blur(16px)" }}>
          <BlockIcon sx={{ color: "#ff5a63" }} />
          <Box>
            <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 14.5 }}>Account sospeso</Typography>
            <Typography sx={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>{banned ? `Motivo: ${banned}` : "Il tuo account è stato sospeso dall'amministratore."} Contatta l'assistenza.</Typography>
          </Box>
          <IconButton size="small" onClick={() => { sessionStorage.removeItem("flixit_banned_reason"); setBanned(null); }} data-testid="banned-banner-close" sx={{ color: "rgba(255,255,255,0.6)" }}><CloseIcon fontSize="small" /></IconButton>
        </Box>
      )}
    </>
  );
}
