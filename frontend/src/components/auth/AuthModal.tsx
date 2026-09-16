// @ts-nocheck
import { useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthModal } from "src/store/authModal";
import { Wordmark } from "src/components/Logo";
import { AuthForm } from "./AuthForm";

const BG = "https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=srgb&fm=jpg&q=85&w=1920";

export default function AuthModal() {
  const { open, mode, close, setMode } = useAuthModal();
  const isRegister = mode === "register";

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, close]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="auth-overlay"
          data-testid="auth-modal-overlay"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
          style={{ position: "fixed", inset: 0, zIndex: 1400, display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
            backgroundImage: `radial-gradient(circle at center, rgba(5,5,5,0.78) 0%, rgba(5,5,5,0.96) 100%), url(${BG})`,
            backgroundSize: "cover", backgroundPosition: "center", backdropFilter: "blur(20px)" }}
        >
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.25, 0.1, 0, 1] }}
            style={{ width: "100%", maxWidth: 450, position: "relative", borderRadius: 20, padding: "40px 40px 36px",
              background: "rgba(18,18,22,0.88)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(24px)",
              boxShadow: "0 32px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.05) inset" }}
          >
            <IconButton onClick={close} data-testid="auth-modal-close-button" aria-label="Chiudi"
              sx={{ position: "absolute", top: 16, right: 16, color: "#fff", bgcolor: "rgba(255,255,255,0.1)", width: 38, height: 38,
                transition: "background-color 200ms ease, transform 200ms ease", "&:hover": { bgcolor: "rgba(255,255,255,0.2)", transform: "scale(1.05)" } }}>
              <CloseIcon sx={{ fontSize: 20 }} />
            </IconButton>

            <Box sx={{ mb: 3.5 }}><Wordmark height={40} testId="modal-logo-svg" /></Box>
            <Typography data-testid="auth-modal-title" sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: { xs: 22, sm: 26 }, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.15 }}>
              {isRegister ? "Crea il tuo account" : "Bentornato"}
            </Typography>
            <Typography sx={{ color: "#A3A3A3", fontSize: 14, mt: 1, mb: 3.5 }}>
              {isRegister ? "Salva la tua lista e riprendi da dove hai lasciato." : "Accedi per continuare a guardare i tuoi titoli."}
            </Typography>

            <AuthForm key={mode} mode={mode} onSuccess={() => { close(); window.location.reload(); }} />

            <Typography component="button" type="button" data-testid="auth-modal-mode-switch" onClick={() => setMode(isRegister ? "login" : "register")}
              sx={{ display: "block", mx: "auto", mt: 3, background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500,
                color: "#A3A3A3", transition: "color 200ms ease", "&:hover": { color: "#fff" } }}>
              {isRegister ? "Hai già un account? Accedi" : "Non hai un account? Registrati ora"}
            </Typography>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
