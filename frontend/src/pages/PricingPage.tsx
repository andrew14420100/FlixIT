// @ts-nocheck
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import CheckIcon from "@mui/icons-material/Check";
import { useAuthModal } from "src/store/authModal";
import { useCurrentUser, userToken, premiumLabel } from "src/hooks/useCurrentUser";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
export const euro = (cents) => (cents / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const INTERVAL_LABEL = { month: "/ mese", year: "/ anno", lifetime: "una volta", custom: "" };

function PlanCard({ plan, selected, onSelect }) {
  const hot = Boolean(plan.badge);
  return (
    <Box component="button" type="button" onClick={() => onSelect(plan)} data-testid={`plan-card-${plan.id}`} aria-pressed={selected}
      sx={{ position: "relative", textAlign: "left", cursor: "pointer", p: 3, borderRadius: "20px", bgcolor: selected ? "rgba(229,9,20,0.10)" : "#0F0F12",
        border: `1px solid ${selected ? "#E50914" : hot ? "rgba(229,9,20,0.4)" : "rgba(255,255,255,0.08)"}`, color: "#fff", fontFamily: "'Inter', sans-serif",
        transition: "transform 200ms ease, border-color 200ms ease, background-color 200ms ease", boxShadow: selected ? "0 0 0 4px rgba(229,9,20,0.18), 0 30px 60px rgba(0,0,0,0.5)" : "0 20px 50px rgba(0,0,0,0.35)",
        "&:hover": { transform: "translateY(-4px)", borderColor: "#E50914" } }}>
      {plan.badge && <Typography sx={{ position: "absolute", top: -12, left: 20, px: 1.4, py: 0.3, borderRadius: 999, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", bgcolor: "#E50914", color: "#fff" }}>{plan.badge}</Typography>}
      <Typography sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 18 }}>{plan.name}</Typography>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 1.5 }}>
        <Typography data-testid={`plan-price-${plan.id}`} sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 800, fontSize: 34, lineHeight: 1 }}>{euro(plan.price_cents)}</Typography>
        <Typography sx={{ color: "#A3A3A3", fontSize: 13 }}>{INTERVAL_LABEL[plan.interval] ?? ""}</Typography>
      </Box>
      <Typography sx={{ color: "#A3A3A3", fontSize: 13.5, mt: 1.5, minHeight: 40 }}>{plan.description}</Typography>
      <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 0.8 }}>
        {(plan.features || []).map((f) => (
          <Box key={f} sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 13.5, color: "rgba(255,255,255,0.85)" }}>
            <CheckIcon sx={{ fontSize: 16, color: "#E50914" }} />{f}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

const payBtn = (primary) => ({
  flex: 1, height: 52, borderRadius: "12px", border: primary ? "none" : "1px solid rgba(255,255,255,0.18)", cursor: "pointer", color: "#fff",
  bgcolor: primary ? "#E50914" : "rgba(255,255,255,0.05)", fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 1,
  transition: "background-color 200ms ease, transform 150ms ease", "&:hover": { bgcolor: primary ? "#F6121D" : "rgba(255,255,255,0.1)" }, "&:active": { transform: "scale(0.98)" }, "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
});

export function Component() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const openAuthModal = useAuthModal((s) => s.openModal);
  const [plans, setPlans] = useState(null);
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/api/public/plans`).then((r) => r.json()).then((d) => {
      setPlans(d.items || []); setPaypalEnabled(Boolean(d.paypal_enabled));
      setSelected((d.items || []).find((p) => p.badge) || d.items?.[0] || null);
    }).catch(() => setPlans([]));
  }, []);

  const pay = async (provider) => {
    if (!selected) return;
    if (!userToken()) { openAuthModal("login"); return; }
    setBusy(provider); setError(null);
    try {
      const path = provider === "stripe" ? "/api/payments/stripe/checkout" : "/api/payments/paypal/create-order";
      const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken()}` },
        body: JSON.stringify({ plan_id: selected.id, origin_url: window.location.origin }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Pagamento non avviato");
      const url = provider === "stripe" ? data.checkout_url : data.approve_url;
      if (!url) throw new Error("URL di pagamento mancante");
      window.location.href = url;
    } catch (e) { setError(e.message); setBusy(null); }
  };

  return (
    <Box data-testid="pricing-page" sx={{ minHeight: "100vh", pt: { xs: 12, md: 15 }, pb: 10, px: { xs: 2, sm: 4, md: 8 }, bgcolor: "#050505", position: "relative", overflow: "hidden" }}>
      <Box sx={{ position: "absolute", top: -200, left: "10%", width: 600, height: 600, borderRadius: "50%", bgcolor: "rgba(229,9,20,0.16)", filter: "blur(140px)", pointerEvents: "none" }} />
      <Box sx={{ maxWidth: 1100, position: "relative" }}>
        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1, px: 1.5, py: 0.6, borderRadius: 999, bgcolor: "rgba(229,9,20,0.14)", border: "1px solid rgba(229,9,20,0.35)", color: "#ff5a63", fontSize: 12.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          <WorkspacePremiumIcon sx={{ fontSize: 16 }} /> FlixIT Premium
        </Box>
        <Typography component="h1" data-testid="pricing-title" sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 800, fontSize: { xs: 34, sm: 46, lg: 58 }, lineHeight: 1.05, color: "#fff", mt: 2, maxWidth: 760 }}>
          Passa a Premium.<br />Il cinema che merita il posto in prima fila.
        </Typography>
        <Typography sx={{ color: "#A3A3A3", fontSize: { xs: 15, md: 17 }, mt: 2.5, maxWidth: 620 }}>
          Sblocca Prime Visioni, Cinema d'Autore e tutte le sezioni esclusive curate dalla redazione. Paghi una volta, nessun rinnovo automatico.
        </Typography>
        {user && user.is_premium && (
          <Box data-testid="pricing-current-status" sx={{ mt: 3, display: "inline-flex", alignItems: "center", gap: 1, px: 2, py: 1, borderRadius: "12px", bgcolor: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80", fontSize: 14, fontWeight: 600 }}>
            <CheckIcon sx={{ fontSize: 18 }} /> {premiumLabel(user)} — puoi estendere o passare a un altro piano.
          </Box>
        )}

        {plans === null ? <Box sx={{ py: 8, display: "flex", justifyContent: "center" }}><CircularProgress sx={{ color: "#E50914" }} /></Box> : (
          <Box data-testid="plans-grid" sx={{ mt: 6, display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", md: `repeat(${Math.min(plans.length, 3)}, 1fr)` } }}>
            {plans.map((p) => <PlanCard key={p.id} plan={p} selected={selected?.id === p.id} onSelect={setSelected} />)}
          </Box>
        )}

        <Box sx={{ mt: 5, p: { xs: 2.5, md: 3.5 }, borderRadius: "20px", bgcolor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", maxWidth: 720 }}>
          <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 16, mb: 0.5 }}>
            {selected ? <>Piano selezionato: <span data-testid="selected-plan-name" style={{ color: "#ff5a63" }}>{selected.name}</span> · {euro(selected.price_cents)}</> : "Seleziona un piano"}
          </Typography>
          <Typography sx={{ color: "#A3A3A3", fontSize: 13, mb: 2.5 }}>Pagamento sicuro. Nessun dato della carta viene salvato su FlixIT. L'accesso Premium si attiva automaticamente a pagamento riuscito.</Typography>
          {error && <Box role="alert" data-testid="pricing-error" sx={{ mb: 2, px: 2, py: 1.2, borderRadius: "10px", fontSize: 14, color: "#ff6b72", bgcolor: "rgba(229,9,20,0.15)", border: "1px solid rgba(229,9,20,0.4)" }}>{error}</Box>}
          <Box sx={{ display: "flex", gap: 1.5, flexDirection: { xs: "column", sm: "row" } }}>
            <Box component="button" type="button" disabled={!selected || Boolean(busy)} onClick={() => pay("stripe")} data-testid="pay-stripe-button" sx={payBtn(true)}>
              {busy === "stripe" ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : <><LockOutlinedIcon sx={{ fontSize: 18 }} /> Paga con carta (Stripe)</>}
            </Box>
            {paypalEnabled && (
              <Box component="button" type="button" disabled={!selected || Boolean(busy)} onClick={() => pay("paypal")} data-testid="pay-paypal-button" sx={payBtn(false)}>
                {busy === "paypal" ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Paga con PayPal"}
              </Box>
            )}
          </Box>
          {!userToken() && <Typography sx={{ color: "#666", fontSize: 12.5, mt: 1.5 }}>Ti chiederemo di accedere o registrarti prima del pagamento.</Typography>}
        </Box>
        <Typography component="button" type="button" onClick={() => navigate(-1)} data-testid="pricing-back" sx={{ mt: 3, background: "none", border: "none", color: "#A3A3A3", cursor: "pointer", fontSize: 14, "&:hover": { color: "#fff" } }}>← Torna indietro</Typography>
      </Box>
    </Box>
  );
}

export default Component;
