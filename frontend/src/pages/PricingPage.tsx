// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import CheckIcon from "@mui/icons-material/Check";
import MovieFilterOutlinedIcon from "@mui/icons-material/MovieFilterOutlined";
import HdOutlinedIcon from "@mui/icons-material/HdOutlined";
import DevicesOutlinedIcon from "@mui/icons-material/DevicesOutlined";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import BoltOutlinedIcon from "@mui/icons-material/BoltOutlined";
import CreditCardOutlinedIcon from "@mui/icons-material/CreditCardOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useAuthModal } from "src/store/authModal";
import { useCurrentUser, userToken, premiumLabel } from "src/hooks/useCurrentUser";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

export const euro = (cents) => {
  const value = Number(cents);
  if (!Number.isFinite(value)) return "—";
  return (value / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
};

const PLAN_SPECS = [
  {
    key: "base",
    name: "Base",
    tagline: "L'essenziale, sempre con te.",
    badge: "Essenziale",
    quality: "Qualità fino a 720p",
    devices: "Massimo dispositivi connessi: 1",
    ads: "Pubblicità a contenuto: 1",
    priority: "Livello di priorità: 3",
    aliases: ["base", "basic"],
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "Più qualità, senza interruzioni.",
    badge: "Più scelto",
    quality: "Qualità fino a 1080p",
    devices: "Massimo dispositivi connessi: 2",
    ads: "Senza pubblicità",
    priority: "Livello di priorità: 2",
    aliases: ["pro", "standard"],
    featured: true,
  },
  {
    key: "unlimited",
    name: "Unlimited",
    tagline: "Massima libertà, senza limiti.",
    badge: "Massima libertà",
    quality: "Qualità fino a 1080p",
    devices: "Massimo dispositivi connessi: Illimitato",
    ads: "Senza pubblicità",
    priority: "Livello di priorità: 1",
    aliases: ["unlimited", "illimitato", "premium"],
  },
];

function normalizePlanName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function durationLabel(plan) {
  if (!plan) return "";
  if (plan.interval === "month") return "/ mese";
  if (plan.interval === "year") return "/ anno";
  if (plan.interval === "lifetime") return "una volta";
  if (plan.duration_days) return `/ ${plan.duration_days} giorni`;
  return "";
}

function attachAdminPlans(plans) {
  const source = [...(plans || [])].sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
  const used = new Set();

  return PLAN_SPECS.map((spec, index) => {
    let backing = source.find((plan, sourceIndex) => {
      if (used.has(sourceIndex)) return false;
      const name = normalizePlanName(plan?.name);
      return spec.aliases.some((alias) => name === alias || name.includes(alias));
    });

    let backingIndex = backing ? source.indexOf(backing) : -1;
    if (!backing) {
      backingIndex = source.findIndex((_, sourceIndex) => !used.has(sourceIndex));
      backing = backingIndex >= 0 ? source[backingIndex] : null;
    }
    if (backingIndex >= 0) used.add(backingIndex);

    return { ...spec, adminPlan: backing || null };
  });
}

function FeatureLine({ icon: Icon, children, muted = false }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.2, minHeight: 29, color: muted ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.92)" }}>
      <Box sx={{ width: 24, height: 24, display: "grid", placeItems: "center", flexShrink: 0, color: "#ff2433" }}>
        <Icon sx={{ fontSize: 20 }} />
      </Box>
      <Typography sx={{ fontSize: { xs: 13.5, md: 14 }, lineHeight: 1.35 }}>{children}</Typography>
    </Box>
  );
}

function PlanCard({ slot, selected, onSelect }) {
  const { adminPlan: plan } = slot;
  const available = Boolean(plan?.id);

  return (
    <Box
      data-testid={`premium-plan-${slot.key}`}
      sx={{
        position: "relative",
        minHeight: 470,
        p: { xs: 2.5, md: 3 },
        borderRadius: "18px",
        overflow: "hidden",
        bgcolor: slot.featured ? "rgba(36,7,10,0.96)" : "rgba(10,13,15,0.94)",
        border: selected
          ? "1.5px solid #ff1425"
          : slot.featured
            ? "1px solid rgba(229,9,20,0.72)"
            : "1px solid rgba(255,255,255,0.12)",
        boxShadow: selected
          ? "0 0 0 3px rgba(229,9,20,0.12), 0 28px 80px rgba(0,0,0,0.55)"
          : "0 24px 65px rgba(0,0,0,0.36)",
        transition: "transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease",
        "&:hover": { transform: "translateY(-5px)", borderColor: "rgba(229,9,20,0.9)" },
        "&::before": slot.featured ? {
          content: '""', position: "absolute", inset: 0,
          background: "radial-gradient(circle at 86% 10%, rgba(229,9,20,.20), transparent 42%)",
          pointerEvents: "none",
        } : {},
      }}
    >
      <Box sx={{ position: "relative", zIndex: 1, height: "100%", display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1.5 }}>
          <Box>
            <Typography sx={{ color: "#fff", fontWeight: 900, fontSize: { xs: 28, md: 31 }, letterSpacing: "-0.03em", textTransform: "uppercase" }}>
              {slot.name}
            </Typography>
            <Typography sx={{ color: "rgba(255,255,255,.72)", fontSize: 14, mt: 0.2 }}>{slot.tagline}</Typography>
          </Box>
          <Box sx={{ px: 1.25, py: 0.55, borderRadius: 99, bgcolor: slot.featured ? "#E50914" : "rgba(255,255,255,.08)", color: "#fff", fontWeight: 800, fontSize: 10.5, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: ".04em" }}>
            {slot.badge}
          </Box>
        </Box>

        <Box sx={{ mt: 3, display: "flex", flexDirection: "column", gap: 1.15 }}>
          <FeatureLine icon={MovieFilterOutlinedIcon}>Tutto il catalogo film e serie TV</FeatureLine>
          <FeatureLine icon={HdOutlinedIcon}>{slot.quality}</FeatureLine>
          <FeatureLine icon={DevicesOutlinedIcon}>{slot.devices}</FeatureLine>
          <FeatureLine icon={slot.ads === "Senza pubblicità" ? BlockOutlinedIcon : PlayCircleOutlineIcon}>{slot.ads}</FeatureLine>
          <FeatureLine icon={BoltOutlinedIcon}>{slot.priority}</FeatureLine>
        </Box>

        <Box sx={{ mt: 3, pt: 2.4, borderTop: "1px solid rgba(255,255,255,.12)" }}>
          <Typography sx={{ color: "rgba(255,255,255,.46)", fontSize: 12.5, mb: 0.5 }}>Prezzo impostato dall'admin</Typography>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minHeight: 43 }}>
            <Typography data-testid={`premium-price-${slot.key}`} sx={{ color: "#fff", fontWeight: 900, fontSize: 31, lineHeight: 1 }}>
              {available ? euro(plan.price_cents) : "—"}
            </Typography>
            {available && <Typography sx={{ color: "rgba(255,255,255,.62)", fontSize: 13 }}>{durationLabel(plan)}</Typography>}
          </Box>
        </Box>

        <Box
          component="button"
          type="button"
          disabled={!available}
          onClick={() => available && onSelect(slot)}
          sx={{
            mt: "auto", width: "100%", height: 49, border: "none", borderRadius: "9px", cursor: available ? "pointer" : "not-allowed",
            bgcolor: selected ? "#f20d1c" : "#E50914", color: "#fff", fontWeight: 800, fontSize: 14,
            opacity: available ? 1 : 0.42,
            transition: "background-color 180ms ease, transform 150ms ease",
            "&:hover": available ? { bgcolor: "#ff1726" } : {}, "&:active": available ? { transform: "scale(.985)" } : {},
          }}
        >
          {available ? `Scegli ${slot.name}` : "Configura il piano nell'admin"}
        </Box>
      </Box>
    </Box>
  );
}

const payButtonSx = (primary = false) => ({
  minHeight: 50, px: 2.5, borderRadius: "10px", cursor: "pointer",
  border: primary ? "none" : "1px solid rgba(255,255,255,.16)",
  bgcolor: primary ? "#E50914" : "rgba(255,255,255,.055)", color: "#fff", fontWeight: 800, fontSize: 13.5,
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 1,
  transition: "background-color 180ms ease, transform 150ms ease",
  "&:hover": { bgcolor: primary ? "#fa1725" : "rgba(255,255,255,.1)" },
  "&:active": { transform: "scale(.985)" },
  "&:disabled": { opacity: .5, cursor: "not-allowed" },
});

export function Component() {
  const { user } = useCurrentUser();
  const openAuthModal = useAuthModal((s) => s.openModal);
  const [plans, setPlans] = useState(null);
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [selectedKey, setSelectedKey] = useState("pro");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const paymentRef = useRef(null);

  useEffect(() => {
    fetch(`${API_URL}/api/public/plans`, { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((d) => {
        setPlans(Array.isArray(d?.items) ? d.items : []);
        setPaypalEnabled(Boolean(d?.paypal_enabled));
      })
      .catch(() => setPlans([]));
  }, []);

  const slots = useMemo(() => attachAdminPlans(plans || []), [plans]);
  const selectedSlot = slots.find((slot) => slot.key === selectedKey) || slots[1] || slots[0] || null;
  const selectedPlan = selectedSlot?.adminPlan || null;

  useEffect(() => {
    if (plans === null) return;
    if (selectedPlan?.id) return;
    const firstAvailable = slots.find((slot) => slot.adminPlan?.id);
    if (firstAvailable) setSelectedKey(firstAvailable.key);
  }, [plans, slots, selectedPlan?.id]);

  const selectPlan = (slot) => {
    setSelectedKey(slot.key);
    setError(null);
    window.setTimeout(() => paymentRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 80);
  };

  const pay = async (provider) => {
    if (!selectedPlan?.id) return;
    if (!userToken()) { openAuthModal("login"); return; }
    setBusy(provider); setError(null);
    try {
      const path = provider === "stripe" ? "/api/payments/stripe/checkout" : "/api/payments/paypal/create-order";
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken()}` },
        body: JSON.stringify({ plan_id: selectedPlan.id, origin_url: window.location.origin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Pagamento non avviato");
      const url = provider === "stripe" ? data.checkout_url : data.approve_url;
      if (!url) throw new Error("URL di pagamento mancante");
      window.location.href = url;
    } catch (e) {
      setError(e?.message || "Pagamento non avviato");
      setBusy(null);
    }
  };

  return (
    <Box data-testid="pricing-page" sx={{ minHeight: "100vh", bgcolor: "#050505", color: "#fff", overflow: "hidden", pb: { xs: 8, md: 10 } }}>
      <Box
        sx={{
          position: "relative", pt: { xs: 12, sm: 13, md: 15 }, pb: { xs: 4.5, md: 6 }, px: { xs: 2, sm: 4, md: 6, lg: 8 },
          background: "radial-gradient(circle at 76% 5%, rgba(229,9,20,.16), transparent 28%), radial-gradient(circle at 38% 8%, rgba(60,80,110,.10), transparent 24%), #050505",
        }}
      >
        <Box sx={{ position: "absolute", inset: 0, opacity: .32, pointerEvents: "none", backgroundImage: "linear-gradient(110deg, transparent 0 54%, rgba(255,255,255,.025) 54% 55%, transparent 55% 66%, rgba(229,9,20,.04) 66% 67%, transparent 67%)" }} />
        <Box sx={{ position: "relative", maxWidth: 1480, mx: "auto" }}>
          <Box sx={{ display: "inline-flex", alignItems: "center", gap: .8, color: "#ff2635", fontSize: 12.5, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>
            <WorkspacePremiumIcon sx={{ fontSize: 18 }} /> FlixIT Premium
          </Box>
          <Typography component="h1" sx={{ mt: 1.3, maxWidth: 760, fontWeight: 900, fontSize: { xs: 38, sm: 52, md: 66 }, lineHeight: .99, letterSpacing: "-.045em" }}>
            Più intrattenimento,<br /><Box component="span" sx={{ color: "#E50914" }}>il piano giusto per te.</Box>
          </Typography>
          <Typography sx={{ mt: 2.2, maxWidth: 700, color: "rgba(255,255,255,.76)", fontSize: { xs: 15, md: 17 }, lineHeight: 1.55 }}>
            Tutti i piani includono l'intero catalogo di film e serie TV. Scegli qualità, numero di dispositivi e livello di priorità più adatti alle tue esigenze.
          </Typography>
          <Typography sx={{ mt: 1.2, maxWidth: 700, color: "rgba(255,255,255,.5)", fontSize: 13.5 }}>
            L'abbonamento non si rinnova automaticamente. Dopo un pagamento riuscito il piano viene attivato immediatamente sul tuo account.
          </Typography>

          {user?.is_premium && (
            <Box sx={{ mt: 2.5, display: "inline-flex", alignItems: "center", gap: 1, px: 1.5, py: .9, borderRadius: "10px", bgcolor: "rgba(34,197,94,.09)", border: "1px solid rgba(34,197,94,.24)", color: "#72e69a", fontSize: 13.5, fontWeight: 700 }}>
              <CheckIcon sx={{ fontSize: 17 }} /> {premiumLabel(user)}
            </Box>
          )}
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1480, mx: "auto", px: { xs: 2, sm: 4, md: 6, lg: 8 } }}>
        {plans === null ? (
          <Box sx={{ py: 10, display: "flex", justifyContent: "center" }}><CircularProgress sx={{ color: "#E50914" }} /></Box>
        ) : (
          <Box data-testid="plans-grid" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0,1fr))" }, gap: { xs: 2, lg: 2.3 } }}>
            {slots.map((slot) => (
              <PlanCard key={slot.key} slot={slot} selected={selectedKey === slot.key} onSelect={selectPlan} />
            ))}
          </Box>
        )}

        <Box sx={{ mt: { xs: 5, md: 6 }, display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4,1fr)" }, borderTop: "1px solid rgba(255,255,255,.08)", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          {[
            [MovieFilterOutlinedIcon, "Catalogo completo", "Film e serie TV nello stesso piano."],
            [HdOutlinedIcon, "Fino a 1080p", "La massima qualità attualmente disponibile."],
            [DevicesOutlinedIcon, "Più dispositivi", "Il limite dipende dal piano scelto."],
            [BoltOutlinedIcon, "Priorità", "Un livello più basso indica priorità maggiore."],
          ].map(([Icon, title, text], index) => (
            <Box key={title} sx={{ py: 3, px: { xs: 1.2, sm: 2 }, display: "flex", gap: 1.4, borderRight: { md: index < 3 ? "1px solid rgba(255,255,255,.08)" : "none" } }}>
              <Box sx={{ width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "rgba(229,9,20,.09)", border: "1px solid rgba(229,9,20,.2)", color: "#ff2433", flexShrink: 0 }}><Icon sx={{ fontSize: 21 }} /></Box>
              <Box><Typography sx={{ fontWeight: 800, fontSize: 13.5 }}>{title}</Typography><Typography sx={{ mt: .35, color: "rgba(255,255,255,.52)", fontSize: 12.2, lineHeight: 1.45 }}>{text}</Typography></Box>
            </Box>
          ))}
        </Box>

        <Box ref={paymentRef} sx={{ mt: 4, p: { xs: 2.4, md: 3 }, borderRadius: "16px", bgcolor: "rgba(255,255,255,.027)", border: "1px solid rgba(255,255,255,.095)", display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.35fr .9fr" }, gap: 3, alignItems: "center" }}>
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><InfoOutlinedIcon sx={{ color: "#ff2635", fontSize: 22 }} /><Typography sx={{ fontWeight: 900, fontSize: 18 }}>Pagamento e attivazione</Typography></Box>
            <Typography sx={{ mt: 1, color: "rgba(255,255,255,.66)", fontSize: 13.5, lineHeight: 1.55 }}>
              {selectedSlot ? <>Hai selezionato <Box component="span" sx={{ color: "#fff", fontWeight: 800 }}>{selectedSlot.name}</Box>{selectedPlan?.id ? <> a <Box component="span" sx={{ color: "#fff", fontWeight: 800 }}>{euro(selectedPlan.price_cents)}</Box></> : ""}. </> : ""}
              Il piano si attiva immediatamente non appena il provider conferma il pagamento. Alla scadenza si interrompe: non effettuiamo rinnovi automatici.
            </Typography>
            {!userToken() && <Typography sx={{ mt: 1, color: "rgba(255,255,255,.42)", fontSize: 12.5 }}>Prima del pagamento ti verrà chiesto di accedere o registrarti.</Typography>}
            {error && <Box role="alert" sx={{ mt: 1.5, px: 1.5, py: 1, borderRadius: "9px", bgcolor: "rgba(229,9,20,.11)", border: "1px solid rgba(229,9,20,.26)", color: "#ff7b83", fontSize: 13 }}>{error}</Box>}
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.1 }}>
            <Box component="button" type="button" disabled={!selectedPlan?.id || Boolean(busy)} onClick={() => pay("stripe")} data-testid="pay-stripe-button" sx={payButtonSx(true)}>
              {busy === "stripe" ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : <><CreditCardOutlinedIcon sx={{ fontSize: 19 }} /> Paga con carta</>}
            </Box>
            {paypalEnabled && (
              <Box component="button" type="button" disabled={!selectedPlan?.id || Boolean(busy)} onClick={() => pay("paypal")} data-testid="pay-paypal-button" sx={payButtonSx(false)}>
                {busy === "paypal" ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : <><LockOutlinedIcon sx={{ fontSize: 18 }} /> Paga con PayPal</>}
              </Box>
            )}
          </Box>
        </Box>

        <Box sx={{ mt: 3, p: { xs: 2.2, md: 2.8 }, borderRadius: "15px", bgcolor: "rgba(229,9,20,.035)", border: "1px solid rgba(229,9,20,.14)" }}>
          <Typography sx={{ color: "#ff2635", fontWeight: 900, fontSize: 15 }}>Come funziona</Typography>
          <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3,1fr)" }, gap: 2 }}>
            {[
              ["1", "Scegli il piano", "Seleziona Base, Pro oppure Unlimited."],
              ["2", "Completa il pagamento", "Paga tramite uno dei metodi disponibili."],
              ["3", "Attivazione immediata", "Appena il pagamento è confermato, il piano è attivo. Nessun rinnovo automatico."],
            ].map(([num, title, text]) => (
              <Box key={num} sx={{ display: "flex", gap: 1.2 }}>
                <Box sx={{ width: 31, height: 31, borderRadius: "50%", bgcolor: "rgba(255,255,255,.07)", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 13, flexShrink: 0 }}>{num}</Box>
                <Box><Typography sx={{ fontWeight: 800, fontSize: 13.5 }}>{title}</Typography><Typography sx={{ mt: .3, color: "rgba(255,255,255,.5)", fontSize: 12.3, lineHeight: 1.45 }}>{text}</Typography></Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default Component;
