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
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import { useAuthModal } from "src/store/authModal";
import { useCurrentUser, userToken, premiumLabel } from "src/hooks/useCurrentUser";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const FONT = '"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const euro = (cents) => {
  const value = Number(cents);
  if (!Number.isFinite(value)) return "—";
  return (value / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
};

const PLAN_SPECS = [
  {
    key: "base",
    name: "Base",
    eyebrow: "Essenziale",
    tagline: "Tutto FlixIT, senza extra.",
    quality: "Qualità fino a 720p",
    devices: "1 dispositivo connesso",
    ads: "1 pubblicità a contenuto",
    priority: "Livello priorità 3",
    aliases: ["base", "basic"],
  },
  {
    key: "pro",
    name: "Pro",
    eyebrow: "Più scelto",
    tagline: "Più qualità, zero pubblicità.",
    quality: "Qualità fino a 1080p",
    devices: "2 dispositivi connessi",
    ads: "Senza pubblicità",
    priority: "Livello priorità 2",
    aliases: ["pro", "standard"],
    featured: true,
  },
  {
    key: "unlimited",
    name: "Unlimited",
    eyebrow: "Senza limiti",
    tagline: "La massima libertà di visione.",
    quality: "Qualità fino a 1080p",
    devices: "Dispositivi connessi illimitati",
    ads: "Senza pubblicità",
    priority: "Livello priorità 1",
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

  return PLAN_SPECS.map((spec) => {
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

function FeatureLine({ icon: Icon, children }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.15, minHeight: 31 }}>
      <Box sx={{ width: 23, height: 23, display: "grid", placeItems: "center", color: "rgba(255,255,255,.68)", flexShrink: 0 }}>
        <Icon sx={{ fontSize: 19 }} />
      </Box>
      <Typography sx={{ fontFamily: FONT, color: "rgba(255,255,255,.86)", fontSize: { xs: 13.5, md: 14 }, lineHeight: 1.35 }}>
        {children}
      </Typography>
    </Box>
  );
}

function PlanCard({ slot, selected, onSelect }) {
  const { adminPlan: plan } = slot;
  const available = Boolean(plan?.id);

  return (
    <Box
      component="article"
      data-testid={`premium-plan-${slot.key}`}
      onClick={() => available && onSelect(slot)}
      sx={{
        position: "relative",
        minHeight: { xs: 414, md: 430 },
        overflow: "hidden",
        borderRadius: "8px",
        cursor: available ? "pointer" : "default",
        bgcolor: "#181818",
        border: selected ? "2px solid #e50914" : "1px solid rgba(255,255,255,.08)",
        boxShadow: selected ? "0 18px 50px rgba(0,0,0,.58)" : "0 10px 28px rgba(0,0,0,.30)",
        transform: selected ? "translateY(-5px)" : "none",
        transition: "transform .24s cubic-bezier(.2,.8,.2,1), border-color .2s ease, box-shadow .2s ease",
        "&:hover": available ? {
          transform: "translateY(-7px) scale(1.006)",
          borderColor: slot.featured ? "rgba(229,9,20,.9)" : "rgba(255,255,255,.24)",
          boxShadow: "0 22px 58px rgba(0,0,0,.58)",
        } : {},
      }}
    >
      <Box
        sx={{
          height: 102,
          px: 2.5,
          pt: 2.3,
          position: "relative",
          background: slot.featured
            ? "linear-gradient(115deg, #4b070c 0%, #260608 54%, #181818 100%)"
            : slot.key === "unlimited"
              ? "linear-gradient(115deg, #252525 0%, #1b1b1b 58%, #181818 100%)"
              : "linear-gradient(115deg, #242424 0%, #191919 65%, #181818 100%)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography sx={{ fontFamily: FONT, color: slot.featured ? "#ff6771" : "rgba(255,255,255,.52)", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".10em" }}>
            {slot.eyebrow}
          </Typography>
          {selected && (
            <Box sx={{ width: 24, height: 24, borderRadius: "50%", bgcolor: "#e50914", display: "grid", placeItems: "center" }}>
              <CheckIcon sx={{ fontSize: 17 }} />
            </Box>
          )}
        </Box>
        <Typography sx={{ mt: .5, fontFamily: FONT, color: "#fff", fontSize: { xs: 29, md: 32 }, fontWeight: 800, letterSpacing: "-.025em", lineHeight: 1 }}>
          {slot.name}
        </Typography>
        <Typography sx={{ mt: .55, fontFamily: FONT, color: "rgba(255,255,255,.66)", fontSize: 13 }}>{slot.tagline}</Typography>
      </Box>

      <Box sx={{ p: 2.5, pt: 2.25 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: .8, minHeight: 49 }}>
          <Typography data-testid={`premium-price-${slot.key}`} sx={{ fontFamily: FONT, color: "#fff", fontWeight: 800, fontSize: { xs: 31, md: 35 }, letterSpacing: "-.035em", lineHeight: 1 }}>
            {available ? euro(plan.price_cents) : "—"}
          </Typography>
          {available && <Typography sx={{ fontFamily: FONT, color: "rgba(255,255,255,.48)", fontSize: 12.5 }}>{durationLabel(plan)}</Typography>}
        </Box>

        <Box sx={{ mt: 2.15, display: "flex", flexDirection: "column", gap: .7 }}>
          <FeatureLine icon={MovieFilterOutlinedIcon}>Tutto il catalogo film e serie TV</FeatureLine>
          <FeatureLine icon={HdOutlinedIcon}>{slot.quality}</FeatureLine>
          <FeatureLine icon={DevicesOutlinedIcon}>{slot.devices}</FeatureLine>
          <FeatureLine icon={slot.ads === "Senza pubblicità" ? BlockOutlinedIcon : PlayCircleOutlineIcon}>{slot.ads}</FeatureLine>
          <FeatureLine icon={BoltOutlinedIcon}>{slot.priority}</FeatureLine>
        </Box>

        <Box
          component="button"
          type="button"
          disabled={!available}
          onClick={(event) => { event.stopPropagation(); if (available) onSelect(slot); }}
          sx={{
            mt: 2.6,
            width: "100%",
            height: 43,
            borderRadius: "4px",
            border: selected ? "none" : "1px solid rgba(255,255,255,.20)",
            bgcolor: selected ? "#fff" : "rgba(255,255,255,.08)",
            color: selected ? "#111" : "#fff",
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 13.5,
            cursor: available ? "pointer" : "not-allowed",
            opacity: available ? 1 : .4,
            transition: "background-color .16s ease, transform .14s ease",
            "&:hover": available ? { bgcolor: selected ? "#e6e6e6" : "rgba(255,255,255,.15)" } : {},
            "&:active": available ? { transform: "scale(.985)" } : {},
          }}
        >
          {available ? (selected ? "Piano selezionato" : `Scegli ${slot.name}`) : "Piano non configurato"}
        </Box>
      </Box>
    </Box>
  );
}

const payButtonSx = (primary = false) => ({
  minHeight: 46,
  px: 2.4,
  borderRadius: "4px",
  cursor: "pointer",
  border: primary ? "none" : "1px solid rgba(255,255,255,.18)",
  bgcolor: primary ? "#E50914" : "rgba(255,255,255,.09)",
  color: "#fff",
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 13.5,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 1,
  transition: "background-color .17s ease, transform .14s ease",
  "&:hover": { bgcolor: primary ? "#f6121d" : "rgba(255,255,255,.15)" },
  "&:active": { transform: "scale(.985)" },
  "&:disabled": { opacity: .45, cursor: "not-allowed" },
});

export function Component() {
  const { user } = useCurrentUser();
  const openAuthModal = useAuthModal((s) => s.openModal);
  const [plans, setPlans] = useState(null);
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [selectedKey, setSelectedKey] = useState("pro");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const plansRef = useRef(null);
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
    if (plans === null || selectedPlan?.id) return;
    const firstAvailable = slots.find((slot) => slot.adminPlan?.id);
    if (firstAvailable) setSelectedKey(firstAvailable.key);
  }, [plans, slots, selectedPlan?.id]);

  const selectPlan = (slot) => {
    setSelectedKey(slot.key);
    setError(null);
    window.setTimeout(() => paymentRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 90);
  };

  const pay = async (provider) => {
    if (!selectedPlan?.id) return;
    if (!userToken()) { openAuthModal("login"); return; }
    setBusy(provider);
    setError(null);
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
    <Box data-testid="pricing-page" sx={{ minHeight: "100vh", bgcolor: "#141414", color: "#fff", overflowX: "clip", fontFamily: FONT }}>
      <Box
        component="section"
        sx={{
          position: "relative",
          minHeight: { xs: "610px", sm: "620px", md: "680px" },
          px: { xs: "4vw", sm: "4.5vw", md: "4vw" },
          pt: { xs: "118px", sm: "126px", md: "145px" },
          overflow: "hidden",
          bgcolor: "#080808",
          backgroundImage: [
            "radial-gradient(ellipse at 76% 24%, rgba(229,9,20,.30) 0%, rgba(87,5,12,.16) 24%, transparent 52%)",
            "radial-gradient(ellipse at 92% 42%, rgba(28,55,74,.32) 0%, transparent 44%)",
            "linear-gradient(90deg, #080808 0%, #080808 43%, rgba(8,8,8,.86) 58%, rgba(8,8,8,.54) 78%, #080808 100%)",
          ].join(","),
        }}
      >
        <Box sx={{ position: "absolute", right: { xs: "-34%", md: "1.5%" }, top: { xs: 135, md: 78 }, width: { xs: 520, md: 690 }, height: { xs: 360, md: 500 }, opacity: { xs: .36, md: .62 }, pointerEvents: "none" }}>
          {[0,1,2,3,4].map((i) => (
            <Box key={i} sx={{ position: "absolute", top: i * 7, right: i * 72, width: { xs: 118, md: 145 }, height: { xs: 300, md: 430 }, borderRadius: "12px", transform: "skewX(-8deg)", background: i % 2 === 0 ? "linear-gradient(180deg, rgba(229,9,20,.80), rgba(44,4,8,.14))" : "linear-gradient(180deg, rgba(71,92,107,.72), rgba(10,12,15,.12))", boxShadow: "0 30px 80px rgba(0,0,0,.55)", border: "1px solid rgba(255,255,255,.05)" }} />
          ))}
        </Box>

        <Box sx={{ position: "relative", zIndex: 2, maxWidth: 660 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: .9 }}>
            <WorkspacePremiumIcon sx={{ color: "#E50914", fontSize: 23 }} />
            <Typography sx={{ color: "#fff", fontFamily: FONT, fontSize: 13, fontWeight: 700, letterSpacing: ".13em", textTransform: "uppercase" }}>
              FlixIT Premium
            </Typography>
          </Box>

          <Typography component="h1" sx={{ mt: 1.5, color: "#fff", fontFamily: FONT, fontWeight: 800, fontSize: { xs: 40, sm: 52, md: 64 }, lineHeight: .99, letterSpacing: "-.045em", textShadow: "0 4px 22px rgba(0,0,0,.42)" }}>
            Guarda di più.<br />Scegli <Box component="span" sx={{ color: "#E50914" }}>come viverlo.</Box>
          </Typography>

          <Typography sx={{ mt: 2.2, maxWidth: 590, color: "rgba(255,255,255,.78)", fontFamily: FONT, fontSize: { xs: 15, md: 17 }, lineHeight: 1.5 }}>
            Un solo catalogo di film e serie TV, tre modi diversi di viverlo. Scegli il piano che si adatta meglio ai tuoi dispositivi e alla qualità che vuoi.
          </Typography>

          <Box sx={{ mt: 2.1, display: "flex", flexWrap: "wrap", gap: 1 }}>
            {["Fino a 1080p", "Attivazione immediata", "Nessun rinnovo automatico"].map((label) => (
              <Box key={label} sx={{ px: 1.25, py: .62, borderRadius: "3px", bgcolor: "rgba(255,255,255,.10)", backdropFilter: "blur(8px)", color: "rgba(255,255,255,.88)", fontSize: 12.5, fontWeight: 600 }}>
                {label}
              </Box>
            ))}
          </Box>

          <Box sx={{ mt: 3, display: "flex", flexWrap: "wrap", gap: 1.2 }}>
            <Box component="button" type="button" onClick={() => plansRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })} sx={{ height: 48, px: 2.25, border: "none", borderRadius: "4px", bgcolor: "#fff", color: "#111", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: .8, fontFamily: FONT, fontSize: 14.5, fontWeight: 700, "&:hover": { bgcolor: "rgba(255,255,255,.84)" } }}>
              Scopri i piani <ArrowForwardRoundedIcon sx={{ fontSize: 20 }} />
            </Box>
          </Box>

          {user?.is_premium && (
            <Box sx={{ mt: 2.2, display: "inline-flex", alignItems: "center", gap: .85, color: "#a9efbf", fontSize: 13.5, fontWeight: 600 }}>
              <VerifiedRoundedIcon sx={{ fontSize: 19 }} /> {premiumLabel(user)}
            </Box>
          )}
        </Box>

        <Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: { xs: 180, md: 230 }, background: "linear-gradient(180deg, transparent 0%, rgba(20,20,20,.55) 52%, #141414 100%)", pointerEvents: "none" }} />
      </Box>

      <Box ref={plansRef} component="section" sx={{ position: "relative", zIndex: 4, mt: { xs: -8, md: -12 }, px: { xs: "4vw", sm: "4.5vw", md: "4vw" }, pb: { xs: 8, md: 10 } }}>
        <Box sx={{ maxWidth: 1500, mx: "auto" }}>
          <Box sx={{ mb: 2.4 }}>
            <Typography sx={{ fontFamily: FONT, color: "#fff", fontWeight: 700, fontSize: { xs: 23, md: 28 }, letterSpacing: "-.015em" }}>
              Scegli il tuo piano
            </Typography>
            <Typography sx={{ mt: .55, fontFamily: FONT, color: "rgba(255,255,255,.52)", fontSize: 13.5 }}>
              I prezzi e la durata vengono gestiti dall'admin. Le caratteristiche del livello restano quelle indicate qui sotto.
            </Typography>
          </Box>

          {plans === null ? (
            <Box sx={{ height: 360, display: "grid", placeItems: "center" }}><CircularProgress size={32} sx={{ color: "#E50914" }} /></Box>
          ) : (
            <Box data-testid="plans-grid" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3,minmax(0,1fr))" }, gap: { xs: 1.5, md: 1.2, lg: 1.5 } }}>
              {slots.map((slot) => <PlanCard key={slot.key} slot={slot} selected={selectedKey === slot.key} onSelect={selectPlan} />)}
            </Box>
          )}

          <Box ref={paymentRef} sx={{ mt: { xs: 3, md: 3.5 }, bgcolor: "#181818", borderRadius: "8px", border: "1px solid rgba(255,255,255,.07)", overflow: "hidden" }}>
            <Box sx={{ p: { xs: 2.2, sm: 2.6, md: 3 }, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.35fr .75fr" }, gap: { xs: 2.2, md: 3 }, alignItems: "center" }}>
              <Box>
                <Typography sx={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: "#fff" }}>
                  {selectedSlot ? <>Hai scelto <Box component="span" sx={{ color: "#E50914" }}>{selectedSlot.name}</Box></> : "Scegli un piano"}
                </Typography>
                <Typography sx={{ mt: .7, maxWidth: 760, fontFamily: FONT, color: "rgba(255,255,255,.57)", fontSize: 13.5, lineHeight: 1.5 }}>
                  {selectedPlan?.id ? <>Prezzo: <Box component="span" sx={{ color: "rgba(255,255,255,.9)", fontWeight: 700 }}>{euro(selectedPlan.price_cents)} {durationLabel(selectedPlan)}</Box>. </> : ""}
                  Il piano viene attivato immediatamente quando il pagamento viene confermato. Alla scadenza termina senza rinnovi automatici.
                </Typography>
                {!userToken() && <Typography sx={{ mt: .8, color: "rgba(255,255,255,.38)", fontSize: 12.3 }}>Prima del checkout ti verrà chiesto di accedere o registrarti.</Typography>}
                {error && <Box role="alert" sx={{ mt: 1.3, px: 1.3, py: .9, display: "inline-block", borderRadius: "4px", bgcolor: "rgba(229,9,20,.12)", color: "#ff8088", fontSize: 12.8 }}>{error}</Box>}
              </Box>

              <Box sx={{ display: "flex", flexDirection: "column", gap: .9 }}>
                <Box component="button" type="button" disabled={!selectedPlan?.id || Boolean(busy)} onClick={() => pay("stripe")} data-testid="pay-stripe-button" sx={payButtonSx(true)}>
                  {busy === "stripe" ? <CircularProgress size={19} sx={{ color: "#fff" }} /> : <><CreditCardOutlinedIcon sx={{ fontSize: 18 }} /> Paga con carta</>}
                </Box>
                {paypalEnabled && (
                  <Box component="button" type="button" disabled={!selectedPlan?.id || Boolean(busy)} onClick={() => pay("paypal")} data-testid="pay-paypal-button" sx={payButtonSx(false)}>
                    {busy === "paypal" ? <CircularProgress size={19} sx={{ color: "#fff" }} /> : <><LockOutlinedIcon sx={{ fontSize: 17 }} /> Paga con PayPal</>}
                  </Box>
                )}
              </Box>
            </Box>
          </Box>

          <Box sx={{ mt: { xs: 4.5, md: 5.5 } }}>
            <Typography sx={{ fontFamily: FONT, color: "#fff", fontWeight: 700, fontSize: { xs: 21, md: 24 } }}>Come funziona</Typography>
            <Box sx={{ mt: 1.6, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3,1fr)" }, gap: 1.2 }}>
              {[
                ["01", "Scegli", "Base, Pro o Unlimited: seleziona il livello più adatto a te."],
                ["02", "Paga", "Completa il pagamento con uno dei metodi disponibili."],
                ["03", "Guarda", "Il piano si attiva appena il pagamento è confermato e non si rinnova da solo."],
              ].map(([num, title, text]) => (
                <Box key={num} sx={{ p: 2.2, minHeight: 122, borderRadius: "6px", bgcolor: "rgba(255,255,255,.035)", border: "1px solid rgba(255,255,255,.055)" }}>
                  <Typography sx={{ fontFamily: FONT, color: "#E50914", fontSize: 11, fontWeight: 800, letterSpacing: ".12em" }}>{num}</Typography>
                  <Typography sx={{ mt: .75, fontFamily: FONT, color: "#fff", fontWeight: 700, fontSize: 15 }}>{title}</Typography>
                  <Typography sx={{ mt: .45, fontFamily: FONT, color: "rgba(255,255,255,.48)", fontSize: 12.5, lineHeight: 1.45 }}>{text}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default Component;
