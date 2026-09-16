// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const MAX_POLLS = 8;

const ctaSx = { height: 48, px: 3, borderRadius: "12px", border: "none", cursor: "pointer", color: "#fff", bgcolor: "#E50914", fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 13.5, transition: "background-color 200ms ease", "&:hover": { bgcolor: "#F6121D" } };
const ghostSx = { ...ctaSx, bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", "&:hover": { bgcolor: "rgba(255,255,255,0.1)" } };

// Handles /premium/success (Stripe, polls status), /premium/paypal-return (captures order) and /premium/cancel.
export function Component() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState(pathname.endsWith("/cancel") ? "cancelled" : "checking");
  const [planName, setPlanName] = useState("");
  const [message, setMessage] = useState("");
  const polls = useRef(0);

  useEffect(() => {
    if (state !== "checking") return;
    const sessionId = params.get("session_id");
    const orderId = params.get("token");
    let timer;
    const done = (ok, data) => { setPlanName(data?.plan_name || ""); setState(ok ? "paid" : "failed"); };
    const run = async () => {
      try {
        if (sessionId) {
          const res = await fetch(`${API_URL}/api/payments/stripe/status/${sessionId}`);
          const data = await res.json();
          if (data.status === "paid") return done(true, data);
          if (data.status === "expired" || data.status === "failed") return done(false, data);
          if (++polls.current >= MAX_POLLS) { setMessage("Il pagamento è in elaborazione: lo stato verrà aggiornato automaticamente tra pochi istanti."); return setState("pending"); }
          timer = setTimeout(run, 2000);
        } else if (orderId) {
          const res = await fetch(`${API_URL}/api/payments/paypal/capture/${orderId}`, { method: "POST" });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.status === "paid") return done(true, data);
          setMessage(typeof data.detail === "string" ? data.detail : "PayPal non ha confermato il pagamento.");
          return done(false, data);
        } else {
          setMessage("Riferimento del pagamento mancante."); setState("failed");
        }
      } catch { setMessage("Errore di rete durante la verifica."); setState("failed"); }
    };
    run();
    return () => clearTimeout(timer);
  }, [state, params]);

  const view = {
    checking: { Icon: null, title: "Verifica del pagamento…", text: "Stiamo confermando la transazione con il provider.", color: "#fff" },
    pending: { Icon: HourglassEmptyIcon, title: "Pagamento in elaborazione", text: message, color: "#fbbf24" },
    paid: { Icon: CheckCircleOutlineIcon, title: "Benvenuto in Premium!", text: `Il piano ${planName || "Premium"} è attivo sul tuo account. Le sezioni esclusive sono sbloccate.`, color: "#4ade80" },
    failed: { Icon: ErrorOutlineIcon, title: "Pagamento non completato", text: message || "Nessun addebito effettuato. Puoi riprovare quando vuoi.", color: "#ff5a63" },
    cancelled: { Icon: ErrorOutlineIcon, title: "Pagamento annullato", text: "Hai interrotto il checkout: nessun addebito effettuato.", color: "#A3A3A3" },
  }[state];

  return (
    <Box data-testid={`payment-result-${state}`} sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", px: 2, bgcolor: "#050505" }}>
      <Box sx={{ width: "100%", maxWidth: 520, p: { xs: 3.5, sm: 5 }, borderRadius: "24px", bgcolor: "#0F0F12", border: `1px solid ${state === "paid" ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.08)"}`, boxShadow: "0 40px 100px rgba(0,0,0,0.7)", textAlign: "left" }}>
        <Box sx={{ width: 64, height: 64, borderRadius: "18px", display: "grid", placeItems: "center", bgcolor: "rgba(255,255,255,0.05)", mb: 3 }}>
          {view.Icon ? <view.Icon sx={{ fontSize: 34, color: view.color }} /> : <CircularProgress size={30} sx={{ color: "#E50914" }} />}
        </Box>
        <Typography data-testid="payment-result-title" sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 800, fontSize: { xs: 24, sm: 30 }, color: "#fff", lineHeight: 1.1 }}>{view.title}</Typography>
        <Typography data-testid="payment-result-text" sx={{ color: "#A3A3A3", fontSize: 15, mt: 1.5, mb: 4 }}>{view.text}</Typography>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          {state === "paid" ? (
            <>
              <Box component="button" type="button" onClick={() => navigate("/p/prime-visioni")} data-testid="payment-go-premium" sx={ctaSx}>Vai a Prime Visioni</Box>
              <Box component="button" type="button" onClick={() => navigate("/account")} data-testid="payment-go-account" sx={ghostSx}>Il mio account</Box>
            </>
          ) : state === "checking" ? null : (
            <>
              <Box component="button" type="button" onClick={() => navigate("/premium")} data-testid="payment-retry" sx={ctaSx}>{state === "pending" ? "Torna ai piani" : "Riprova"}</Box>
              <Box component="button" type="button" onClick={() => navigate("/browse")} data-testid="payment-go-home" sx={ghostSx}>Torna alla Home</Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default Component;
