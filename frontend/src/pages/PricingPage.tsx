// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import CheckIcon from "@mui/icons-material/Check";
import MovieFilterOutlinedIcon from "@mui/icons-material/MovieFilterOutlined";
import HdOutlinedIcon from "@mui/icons-material/HdOutlined";
import DevicesOutlinedIcon from "@mui/icons-material/DevicesOutlined";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import BoltOutlinedIcon from "@mui/icons-material/BoltOutlined";
import CreditCardOutlinedIcon from "@mui/icons-material/CreditCardOutlined";
import WorkspacePremiumOutlinedIcon from "@mui/icons-material/WorkspacePremiumOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useAuthModal } from "src/store/authModal";
import { useCurrentUser, userToken, premiumLabel } from "src/hooks/useCurrentUser";
import { browserSafeArtworkUrl, tmdbImageUrl } from "src/hooks/useAutomaticMediaAssets";
import "./detail/detail-page.css";

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
    subtitle: "L'essenziale per entrare nel mondo FlixIT.",
    quality: "Fino a 720p",
    devices: "1",
    ads: "1 per contenuto",
    priority: "3",
    aliases: ["base", "basic"],
  },
  {
    key: "pro",
    name: "Pro",
    subtitle: "Più qualità e nessuna interruzione pubblicitaria.",
    quality: "Fino a 1080p",
    devices: "2",
    ads: "Nessuna",
    priority: "2",
    aliases: ["pro", "standard"],
    featured: true,
  },
  {
    key: "unlimited",
    name: "Unlimited",
    subtitle: "La massima libertà di visione su tutti i tuoi dispositivi.",
    quality: "Fino a 1080p",
    devices: "Illimitati",
    ads: "Nessuna",
    priority: "1",
    aliases: ["unlimited", "illimitato", "premium"],
  },
];

function normalizeName(value) {
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
    let backingIndex = source.findIndex((plan, index) => {
      if (used.has(index)) return false;
      const name = normalizeName(plan?.name);
      return spec.aliases.some((alias) => name === alias || name.includes(alias));
    });

    if (backingIndex < 0) {
      backingIndex = source.findIndex((_, index) => !used.has(index));
    }

    if (backingIndex >= 0) used.add(backingIndex);
    return { ...spec, adminPlan: backingIndex >= 0 ? source[backingIndex] : null };
  });
}

function resolveBackdrop(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("/api/") || raw.startsWith("/assets/") || raw.startsWith("/static/")) return raw;
  if (raw.startsWith("/")) return tmdbImageUrl(raw, "original") || raw;
  return browserSafeArtworkUrl(raw) || raw;
}

function PlanMetric({ icon: Icon, label, value }) {
  return (
    <div className="dp-info" style={{ minHeight: 62 }}>
      <span className="dp-info__icon"><Icon /></span>
      <span className="dp-info__text">
        <span className="dp-info__label">{label}</span>
        <span className="dp-info__value">{value}</span>
      </span>
    </div>
  );
}

function PlanCard({ slot, active, onSelect }) {
  const plan = slot.adminPlan;
  const available = Boolean(plan?.id);

  return (
    <section
      className="dp-card"
      data-testid={`premium-plan-${slot.key}`}
      onClick={() => available && onSelect(slot.key)}
      style={{
        position: "relative",
        overflow: "hidden",
        cursor: available ? "pointer" : "default",
        borderColor: active ? "rgba(229,9,20,.9)" : undefined,
        boxShadow: active ? "0 0 0 2px rgba(229,9,20,.18), 0 20px 55px rgba(0,0,0,.38)" : undefined,
        transition: "transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
      }}
    >
      {slot.featured ? (
        <div style={{ position: "absolute", top: 0, right: 0, padding: "8px 14px", borderBottomLeftRadius: 12, background: "#e50914", color: "#fff", fontSize: 12, fontWeight: 700 }}>
          PIÙ SCELTO
        </div>
      ) : null}

      <div style={{ padding: "clamp(22px,1.65vw,32px)" }}>
        <div style={{ minHeight: 86, paddingRight: slot.featured ? 84 : 0 }}>
          <p className="dp-section-sub" style={{ margin: 0, color: active ? "#ff4b55" : undefined, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", fontSize: 12 }}>
            Piano FlixIT
          </p>
          <h2 className="dp-h2" style={{ marginTop: 7, fontSize: "clamp(27px,1.9vw,38px)" }}>{slot.name}</h2>
          <p className="dp-section-sub" style={{ marginTop: 8, lineHeight: 1.45 }}>{slot.subtitle}</p>
        </div>

        <div className="dp-divider" style={{ margin: "20px 0" }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <PlanMetric icon={HdOutlinedIcon} label="Qualità" value={slot.quality} />
          <PlanMetric icon={DevicesOutlinedIcon} label="Dispositivi" value={slot.devices} />
          <PlanMetric icon={slot.ads === "Nessuna" ? BlockOutlinedIcon : PlayCircleOutlineIcon} label="Pubblicità" value={slot.ads} />
          <PlanMetric icon={BoltOutlinedIcon} label="Priorità" value={slot.priority} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, color: "rgba(255,255,255,.92)" }}>
          <CheckIcon style={{ color: "#e50914", fontSize: 20 }} />
          <span style={{ fontSize: 14 }}>Tutto il catalogo film e serie TV</span>
        </div>

        <div className="dp-divider" style={{ margin: "21px 0 18px" }} />

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minHeight: 42 }}>
          <strong data-testid={`premium-price-${slot.key}`} style={{ fontSize: "clamp(28px,2vw,38px)", lineHeight: 1, letterSpacing: "-.025em" }}>
            {available ? euro(plan.price_cents) : "—"}
          </strong>
          {available ? <span style={{ color: "rgba(255,255,255,.62)", fontSize: 14 }}>{durationLabel(plan)}</span> : null}
        </div>

        <button
          type="button"
          disabled={!available}
          onClick={(event) => { event.stopPropagation(); if (available) onSelect(slot.key); }}
          style={{
            width: "100%",
            height: 48,
            marginTop: 20,
            border: 0,
            borderRadius: 9,
            background: active ? "#fff" : "rgba(255,255,255,.10)",
            color: active ? "#111" : "#fff",
            fontWeight: 700,
            fontSize: 15,
            cursor: available ? "pointer" : "not-allowed",
            opacity: available ? 1 : .45,
          }}
        >
          {available ? (active ? "Piano selezionato" : `Scegli ${slot.name}`) : "Configura nell'admin"}
        </button>
      </div>
    </section>
  );
}

export function Component() {
  const { user } = useCurrentUser();
  const openAuthModal = useAuthModal((s) => s.openModal);
  const [plans, setPlans] = useState(null);
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [selectedKey, setSelectedKey] = useState("pro");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [heroBackdrop, setHeroBackdrop] = useState(null);
  const plansRef = useRef(null);
  const paymentRef = useRef(null);

  useEffect(() => {
    fetch(`${API_URL}/api/public/plans`, { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((data) => {
        setPlans(Array.isArray(data?.items) ? data.items : []);
        setPaypalEnabled(Boolean(data?.paypal_enabled));
      })
      .catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      for (const path of ["/api/public/home-bootstrap-fast", "/api/public/home-bootstrap"]) {
        try {
          const response = await fetch(`${API_URL}${path}`, { cache: "no-store", headers: { Accept: "application/json" } });
          if (!response.ok) continue;
          const data = await response.json();
          const hero = data?.hero || {};
          const assets = hero?.assets || {};
          const backdrop = resolveBackdrop(hero?.customBackdrop || assets?.hero_backdrop_path || assets?.detail_backdrop_path || assets?.backdrop_path || hero?.detail?.backdrop_path);
          if (backdrop) {
            if (alive) setHeroBackdrop(backdrop);
            return;
          }
        } catch {}
      }
    };
    load();
    return () => { alive = false; };
  }, []);

  const slots = useMemo(() => attachAdminPlans(plans || []), [plans]);
  const selectedSlot = slots.find((slot) => slot.key === selectedKey) || slots[0] || null;
  const selectedPlan = selectedSlot?.adminPlan || null;

  useEffect(() => {
    if (plans === null || selectedPlan?.id) return;
    const first = slots.find((slot) => slot.adminPlan?.id);
    if (first) setSelectedKey(first.key);
  }, [plans, slots, selectedPlan?.id]);

  const selectPlan = (key) => {
    setSelectedKey(key);
    setError(null);
  };

  const scrollToPlans = () => plansRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  const scrollToPayment = () => paymentRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });

  const pay = async (provider) => {
    if (!selectedPlan?.id) return;
    if (!userToken()) { openAuthModal("login"); return; }
    setBusy(provider);
    setError(null);
    try {
      const path = provider === "stripe" ? "/api/payments/stripe/checkout" : "/api/payments/paypal/create-order";
      const response = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken()}` },
        body: JSON.stringify({ plan_id: selectedPlan.id, origin_url: window.location.origin }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Pagamento non avviato");
      const url = provider === "stripe" ? data.checkout_url : data.approve_url;
      if (!url) throw new Error("URL di pagamento mancante");
      window.location.href = url;
    } catch (e) {
      setError(e?.message || "Pagamento non avviato");
      setBusy(null);
    }
  };

  return (
    <Box component="main" className="dp-page" data-testid="pricing-page" sx={{ pt: { xs: 0, md: "80px" } }}>
      <section className="dp-hero" style={{ minHeight: 500 }}>
        <div className="dp-hero__media">
          {heroBackdrop ? <img className="dp-hero__backdrop" src={heroBackdrop} alt="" aria-hidden="true" /> : <div className="dp-hero__backdrop dp-hero__backdrop--empty" />}
          <div className="dp-hero__shade dp-hero__shade--left" />
          <div className="dp-hero__shade dp-hero__shade--top" />
          <div className="dp-hero__shade dp-hero__shade--bottom" />
        </div>

        <div className="dp-hero__content">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 12, color: "#e50914", fontWeight: 800, letterSpacing: ".08em", fontSize: 13, textTransform: "uppercase" }}>
            <WorkspacePremiumOutlinedIcon style={{ fontSize: 20 }} /> FlixIT Premium
          </div>
          <h1 className="dp-hero__title" style={{ textTransform: "none", maxWidth: "min(38vw,720px)" }}>
            Scegli come vivere FlixIT.
          </h1>
          <p style={{ margin: "0 0 22px", maxWidth: 660, color: "rgba(255,255,255,.92)", fontSize: "clamp(16px,1.14vw,22px)", lineHeight: 1.55, textShadow: "0 2px 8px rgba(0,0,0,.65)" }}>
            Tutto il catalogo film e serie TV. Cambiano qualità, dispositivi, pubblicità e livello di priorità. Il prezzo di ogni piano viene gestito direttamente dall'admin.
          </p>
          <div className="dp-hero__meta" style={{ marginBottom: 18 }}>
            <span className="dp-badge">FINO A 1080p</span>
            <span>Nessun rinnovo automatico</span>
            <span className="dp-hero__dot">•</span>
            <span>Attivazione immediata dopo il pagamento</span>
          </div>
          <button className="dp-play-btn" type="button" onClick={scrollToPlans} style={{ minWidth: 210 }}>
            <WorkspacePremiumOutlinedIcon /> Scopri i piani
          </button>
        </div>
      </section>

      <div className="dp-tabs-wrap" ref={plansRef}>
        <div className="dp-tabs" role="tablist" aria-label="Piani Premium">
          {slots.map((slot) => (
            <button
              key={slot.key}
              type="button"
              role="tab"
              className={`dp-tab ${selectedKey === slot.key ? "is-active" : ""}`}
              aria-selected={selectedKey === slot.key}
              onClick={() => selectPlan(slot.key)}
            >
              {slot.name}
            </button>
          ))}
        </div>
      </div>

      <div className="dp-content">
        <section className="dp-panel">
          <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 24, marginBottom: 22 }}>
            <div>
              <h2 className="dp-section-title" style={{ textTransform: "none" }}>Scegli il tuo piano</h2>
              <p className="dp-section-sub">Stesso catalogo, esperienza diversa. I prezzi vengono aggiornati dall'area admin.</p>
            </div>
            {user?.is_premium ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "#8ee6a9", fontSize: 14, fontWeight: 700 }}>
                <CheckIcon style={{ fontSize: 18 }} /> {premiumLabel(user)}
              </div>
            ) : null}
          </div>

          {plans === null ? (
            <div style={{ minHeight: 320, display: "grid", placeItems: "center" }}><CircularProgress sx={{ color: "#e50914" }} /></div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "clamp(14px,1.2vw,24px)" }} className="premium-plans-grid">
              {slots.map((slot) => <PlanCard key={slot.key} slot={slot} active={selectedKey === slot.key} onSelect={selectPlan} />)}
            </div>
          )}

          <section ref={paymentRef} className="dp-card" style={{ marginTop: 24, padding: "clamp(22px,1.8vw,34px)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(300px,.75fr)", gap: 28, alignItems: "center" }} className="premium-payment-grid">
              <div>
                <p className="dp-section-sub" style={{ margin: 0, color: "#e50914", fontWeight: 700 }}>PAGAMENTO E ATTIVAZIONE</p>
                <h2 className="dp-h2" style={{ marginTop: 7 }}>{selectedSlot ? `Piano ${selectedSlot.name}` : "Seleziona un piano"}</h2>
                <p className="dp-plot" style={{ marginTop: 12, fontSize: "clamp(15px,1vw,19px)", lineHeight: 1.55, WebkitLineClamp: "unset" }}>
                  {selectedPlan?.id ? <>Prezzo: <strong>{euro(selectedPlan.price_cents)} {durationLabel(selectedPlan)}</strong>. </> : null}
                  Dopo la conferma del pagamento il piano si attiva immediatamente sul tuo account. Alla scadenza termina senza rinnovo automatico.
                </p>
                {!userToken() ? <p className="dp-section-sub">Prima del pagamento ti verrà chiesto di accedere o registrarti.</p> : null}
                {error ? <div style={{ marginTop: 13, color: "#ff8b91", fontSize: 14 }}>{error}</div> : null}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button className="dp-play-btn" type="button" disabled={!selectedPlan?.id || Boolean(busy)} onClick={() => pay("stripe")} style={{ width: "100%", minWidth: 0 }}>
                  {busy === "stripe" ? <CircularProgress size={20} sx={{ color: "#111" }} /> : <><CreditCardOutlinedIcon /> Paga con carta</>}
                </button>
                {paypalEnabled ? (
                  <button type="button" disabled={!selectedPlan?.id || Boolean(busy)} onClick={() => pay("paypal")} style={{ width: "100%", height: 48, borderRadius: 9, border: "1px solid rgba(255,255,255,.28)", background: "rgba(255,255,255,.07)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                    {busy === "paypal" ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : <><LockOutlinedIcon style={{ fontSize: 18, verticalAlign: "middle", marginRight: 8 }} />Paga con PayPal</>}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <section style={{ marginTop: 34 }}>
            <h2 className="dp-section-title" style={{ textTransform: "none" }}>Come funziona</h2>
            <p className="dp-section-sub">Tre passaggi, senza rinnovi automatici.</p>
            <div className="dp-info-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
              <PlanMetric icon={WorkspacePremiumOutlinedIcon} label="1 · Scegli" value="Base, Pro o Unlimited" />
              <PlanMetric icon={CreditCardOutlinedIcon} label="2 · Paga" value="Completa il pagamento" />
              <PlanMetric icon={CheckIcon} label="3 · Guarda" value="Attivazione immediata" />
            </div>
          </section>
        </section>
      </div>

      <style>{`
        @media (max-width: 899px) {
          .premium-plans-grid { grid-template-columns: 1fr !important; }
          .premium-payment-grid { grid-template-columns: 1fr !important; }
          [data-testid="pricing-page"] .dp-hero__content { width: min(88vw, 680px); left: 6vw; bottom: 54px; }
          [data-testid="pricing-page"] .dp-hero__title { max-width: 88vw !important; font-size: clamp(38px, 12vw, 64px); }
          [data-testid="pricing-page"] .dp-info-grid { grid-template-columns: 1fr !important; }
        }
        @media (min-width: 900px) {
          [data-testid="pricing-page"] .dp-card:hover { transform: translateY(-3px); }
        }
      `}</style>
    </Box>
  );
}

export default Component;
