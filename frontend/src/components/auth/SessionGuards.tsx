// @ts-nocheck
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import BlockIcon from "@mui/icons-material/Block";
import ForcedPasswordModal from "./ForcedPasswordModal";
import { fetchNotificationsShared, POLL_MS } from "src/hooks/useNotifications";

// Session-level guards reuse the same notification payload already needed by
// the header, so the shell never opens a second identical request in parallel.
export default function SessionGuards() {
  const [mustReset, setMustReset] = useState(false);
  const [banned, setBanned] = useState(() => sessionStorage.getItem("flixit_banned_reason"));

  useEffect(() => {
    if (!localStorage.getItem("user_token")) return;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      const data = await fetchNotificationsShared(false);
      if (data) setMustReset(Boolean(data.must_reset_password));
    };
    check();
    const id = window.setInterval(check, POLL_MS);
    const onVisibility = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
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
