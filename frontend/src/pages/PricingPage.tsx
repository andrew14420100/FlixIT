// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
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
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
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
    subtitle: "L'essenziale per guardare tutto il catalogo FlixIT.",
    quality: "Fino a 720p",
    devices: "1 dispositivo",
    ads: "1 pubblicità a contenuto",
    priority: "Livello 3",
    aliases: ["base", "basic"],
  },
  {
    key: "pro",
    name: "Pro",
    subtitle: "Più qualità e nessuna interruzione pubblicitaria.",
    quality: "Fino a 1080p",
    devices: "2 dispositivi",
    ads: "Senza pubblicità",
    priority: "Livello 2",
    aliases: ["pro", "standard"],
    featured: true,
  },
  {
    key: "unlimited",
    name: "Unlimited",
    subtitle: "La massima libertà di visione su tutti i tuoi dispositivi.",
    quality: "Fino a 1080p",
    devices: "Dispositivi illimitati",
    ads: "Senza pubblicità",
    priority: "Livello 1",
    aliases: ["unlimited", "illimitato", "premium"],
  },
];

const DURATION_OPTIONS = [
  { key: "month", label: "Mensile", shortLabel: "1 mese", days: 30 },
  { key: "quarter", label: "3 mesi", shortLabel: "3 mesi", days: 90 },
  { key: "half", label: "6 mesi", shortLabel: "6 mesi", days: 180 },
  { key: "year", label: "Annuale", shortLabel: "12 mesi", days: 365 },
];

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function durationMatches(plan, durationKey) {
  const days = Number(plan?.duration_days || 0);
  const interval = String(plan?.interval || "").toLowerCase();
  const name = normalizeName(plan?.name);

  if (durationKey === "month") return interval === "month" || days === 30 || name.includes("mensile") || name.includes("1 mese");
  if (durationKey === "quarter") return days === 90 || name.includes("3 mesi") || name.includes("trimestrale") || name.includes("quarter");
  if (durationKey === "half") return days === 180 || name.includes("6 mesi") || name.includes("semestrale");
  if (durationKey === "year") return interval === "year" || days === 365 || name.includes("annuale") || name.includes("annual");
  return false;
}

function attachAdminPlans(plans, durationKey) {
  const source = [...(plans || [])]
    .filter((plan) => durationMatches(plan, durationKey))
    .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
  const used = new Set();

  return PLAN_SPECS.map((spec) => {
    let backingIndex = source.findIndex((plan, index) => {
      if (used.has(index)) return false;
      const name = normalizeName(plan?.name);
      return spec.aliases.some((alias) => name === alias || name.includes(alias));
    });
    if (backingIndex < 0) backingIndex = source.findIndex((_, index) => !used.has(index));
    if (backingIndex >= 0) used.add(backingIndex);
    return { ...spec, adminPlan: backingIndex >= 0 ? source[backingIndex] : null };
  });
}

function resolvePoster(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("/api/") || raw.startsWith("/assets/") || raw.startsWith("/static/")) return raw;
  if (raw.startsWith("/")) return tmdbImageUrl(raw, "original") || raw;
  return browserSafeArtworkUrl(raw) || raw;
}

function posterFromItem(item) {
  const artwork = item?.__artwork || item?.artwork || item?.assets || {};
  return resolvePoster(
    artwork?.poster_url ||
    artwork?.poster_path ||
    artwork?.boxartHighRes ||
    item?.poster_path ||
    item?.posterPath ||
    item?.poster_url ||
    item?.cover_path ||
    item?.image
  );
}

function premiumPosterScore(item, row, rowIndex, itemIndex) {
  const rowLabel = `${row?.name || ""} ${row?.section_type || ""}`.toLowerCase();
  let score = 120 - rowIndex * 4 - itemIndex * 0.2;
  if (/top\s*10|trend|tenden|popolar|novit|scelti|consigli|premi/.test(rowLabel)) score += 90;
  const vote = Number(item?.vote_average || item?.rating || 0);
  const popularity = Number(item?.popularity || 0);
  if (Number.isFinite(vote)) score += Math.min(30, vote * 3);
  if (Number.isFinite(popularity) && popularity > 0) score += Math.min(34, Math.log10(popularity + 1) * 12);
  if (item?.logo_path || item?.__artwork?.logo_url || item?.assets?.logo_path) score += 8;
  return score;
}

function collectPremiumPosters(data) {
  const candidates = [];
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  rows.forEach((row, rowIndex) => {
    (row?.items || []).forEach((item, itemIndex) => {
      const src = posterFromItem(item);
      if (!src) return;
      candidates.push({ src, score: premiumPosterScore(item, row, rowIndex, itemIndex) });
    });
  });

  const hero = data?.hero || {};
  const heroAssets = hero?.assets || {};
  const heroPoster = resolvePoster(heroAssets?.poster_path || heroAssets?.poster_url || hero?.detail?.poster_path);
  if (heroPoster) candidates.push({ src: heroPoster, score: 500 });

  const seen = new Set();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((entry) => {
      if (!entry.src || seen.has(entry.src)) return false;
      seen.add(entry.src);
      return true;
    })
    .slice(0, 20)
    .map((entry) => entry.src);
}

function FeatureRow({ icon: Icon, label, value, highlight = false }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 49, padding: "10px 0", borderBottom: "1px solid rgba(170,195,215,.12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
        <span style={{ width: 27, height: 27, display: "grid", placeItems: "center", flexShrink: 0, color: "rgba(255,255,255,.78)" }}><Icon style={{ fontSize: 22 }} /></span>
        <span style={{ color: "rgba(255,255,255,.60)", fontSize: 13.5 }}>{label}</span>
      </div>
      <strong style={{ color: highlight ? "#fff" : "rgba(255,255,255,.92)", fontSize: 14, textAlign: "right", lineHeight: 1.25 }}>{value}</strong>
    </div>
  );
}

function PlanCard({ slot, duration, active, onSelect }) {
  const plan = slot.adminPlan;
  const available = Boolean(plan?.id);

  return (
    <section
      className="dp-card premium-plan-card"
      data-testid={`premium-plan-${slot.key}`}
      onClick={() => available && onSelect(slot.key)}
      style={{
        position: "relative",
        overflow: "hidden",
        cursor: available ? "pointer" : "default",
        borderColor: active ? "rgba(229,9,20,.92)" : undefined,
        boxShadow: active ? "0 0 0 2px rgba(229,9,20,.14), 0 22px 56px rgba(0,0,0,.38)" : undefined,
        transition: "transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
      }}
    >
      {slot.featured ? <div style={{ position: "absolute", top: 16, right: 16, padding: "6px 10px", borderRadius: 999, background: "#e50914", color: "#fff", fontSize: 10.5, fontWeight: 800, letterSpacing: ".05em" }}>PIÙ SCELTO</div> : null}

      <div className="premium-plan-card-body" style={{ padding: "clamp(22px,1.7vw,32px)" }}>
        <div style={{ paddingRight: slot.featured ? 92 : 0 }}>
          <div style={{ color: active ? "#ff4650" : "rgba(255,255,255,.54)", fontWeight: 700, fontSize: 11.5, letterSpacing: ".08em", textTransform: "uppercase" }}>{duration.label}</div>
          <h2 className="dp-h2" style={{ marginTop: 7, fontSize: "clamp(29px,2vw,40px)" }}>{slot.name}</h2>
          <p className="dp-section-sub" style={{ marginTop: 8, minHeight: 42, lineHeight: 1.45 }}>{slot.subtitle}</p>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginTop: 20, minHeight: 48 }}>
          <strong data-testid={`premium-price-${slot.key}`} style={{ fontSize: "clamp(31px,2.15vw,42px)", lineHeight: 1, letterSpacing: "-.03em" }}>{available ? euro(plan.price_cents) : "—"}</strong>
          <span style={{ color: "rgba(255,255,255,.54)", fontSize: 13.5 }}>/ {duration.shortLabel}</span>
        </div>

        <div className="dp-divider" style={{ margin: "19px 0 3px" }} />
        <FeatureRow icon={MovieFilterOutlinedIcon} label="Catalogo" value="Film e Serie TV" highlight />
        <FeatureRow icon={HdOutlinedIcon} label="Qualità" value={slot.quality} />
        <FeatureRow icon={DevicesOutlinedIcon} label="Dispositivi" value={slot.devices} />
        <FeatureRow icon={slot.ads === "Senza pubblicità" ? BlockOutlinedIcon : PlayCircleOutlineIcon} label="Pubblicità" value={slot.ads} />
        <FeatureRow icon={BoltOutlinedIcon} label="Priorità" value={slot.priority} />

        <button
          type="button"
          disabled={!available}
          onClick={(event) => { event.stopPropagation(); if (available) onSelect(slot.key); }}
          style={{
            width: "100%", height: 50, marginTop: 22,
            border: active ? 0 : "1px solid rgba(255,255,255,.20)", borderRadius: 9,
            background: active ? "#fff" : "rgba(255,255,255,.06)", color: active ? "#0b0b0b" : "#fff",
            fontWeight: 700, fontSize: 15, cursor: available ? "pointer" : "not-allowed", opacity: available ? 1 : .46,
          }}
        >
          {available ? (active ? "Piano selezionato" : `Scegli ${slot.name}`) : `Configura ${slot.name} · ${duration.label} nell'admin`}
        </button>
      </div>
    </section>
  );
}

function HowStep({ icon: Icon, label, value }) {
  return (
    <div className="dp-info" style={{ minHeight: 72 }}>
      <span className="dp-info__icon"><Icon /></span>
      <span className="dp-info__text"><span className="dp-info__label">{label}</span><span className="dp-info__value">{value}</span></span>
    </div>
  );
}

export function Component() {
  const { user } = useCurrentUser();
  const openAuthModal = useAuthModal((s) => s.openModal);
  const [plans, setPlans] = useState(null);
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [durationKey, setDurationKey] = useState("month");
  const [selectedKey, setSelectedKey] = useState("pro");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [heroPosters, setHeroPosters] = useState([]);
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
      const collected = [];
      const seen = new Set();
      for (const path of ["/api/public/home-bootstrap-fast", "/api/public/home-bootstrap"]) {
        try {
          const response = await fetch(`${API_URL}${path}`, { cache: "no-store", headers: { Accept: "application/json" } });
          if (!response.ok) continue;
          const data = await response.json();
          collectPremiumPosters(data).forEach((poster) => {
            if (!poster || seen.has(poster)) return;
            seen.add(poster);
            collected.push(poster);
          });
          if (alive) setHeroPosters(collected.slice(0, 20));
          if (collected.length >= 16) break;
        } catch {}
      }
    };
    load();
    return () => { alive = false; };
  }, []);

  const heroColumns = useMemo(() => {
    const columns = [[], [], [], []];
    heroPosters.forEach((poster, index) => columns[index % 4].push(poster));
    return columns.map((column, columnIndex) => {
      const filled = [...column];
      if (!heroPosters.length) return filled;
      let guard = 0;
      while (filled.length < 4 && guard < 20) {
        const candidate = heroPosters[(columnIndex + filled.length * 4) % heroPosters.length];
        if (candidate) filled.push(candidate);
        guard += 1;
      }
      return filled;
    });
  }, [heroPosters]);

  const duration = DURATION_OPTIONS.find((item) => item.key === durationKey) || DURATION_OPTIONS[0];
  const slots = useMemo(() => attachAdminPlans(plans || [], durationKey), [plans, durationKey]);
  const selectedSlot = slots.find((slot) => slot.key === selectedKey) || slots[0] || null;
  const selectedPlan = selectedSlot?.adminPlan || null;

  useEffect(() => {
    if (plans === null || selectedPlan?.id) return;
    const first = slots.find((slot) => slot.adminPlan?.id);
    if (first) setSelectedKey(first.key);
  }, [plans, slots, selectedPlan?.id]);

  const selectDuration = (key) => { setDurationKey(key); setError(null); };
  const selectPlan = (key) => { setSelectedKey(key); setError(null); };
  const scrollToPlans = () => plansRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });

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
      <section className="dp-hero premium-elevator-hero" style={{ minHeight: 500 }}>
        <div className="dp-hero__media premium-elevator-media">
          <div className="premium-poster-stage" aria-hidden="true">
            <div className="premium-poster-tilt">
              {heroColumns.map((column, columnIndex) => (
                <div
                  key={columnIndex}
                  className={`premium-poster-column premium-poster-column-${columnIndex + 1}`}
                  style={{
                    "--premium-duration": `${23 + columnIndex * 3.5}s`,
                    "--premium-delay": `${-columnIndex * 4.7}s`,
                  }}
                >
                  <div className="premium-poster-track">
                    {[0, 1].map((copyIndex) => (
                      <div className="premium-poster-sequence" key={copyIndex}>
                        {column.map((poster, posterIndex) => (
                          <div className="premium-poster-card" key={`${copyIndex}-${posterIndex}-${poster}`}>
                            <img src={poster} alt="" loading={copyIndex === 0 && posterIndex < 2 ? "eager" : "lazy"} decoding="async" />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="premium-poster-vignette" />
          <div className="dp-hero__shade dp-hero__shade--left" />
          <div className="dp-hero__shade dp-hero__shade--top" />
          <div className="dp-hero__shade dp-hero__shade--bottom" />
        </div>

        <div className="dp-hero__content">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 12, color: "#e50914", fontWeight: 800, letterSpacing: ".08em", fontSize: 13, textTransform: "uppercase" }}>
            <WorkspacePremiumOutlinedIcon style={{ fontSize: 20 }} /> FlixIT Premium
          </div>
          <h1 className="dp-hero__title" style={{ textTransform: "none", maxWidth: "min(38vw,720px)" }}>Scegli il piano. Decidi la durata.</h1>
          <p style={{ margin: "0 0 22px", maxWidth: 670, color: "rgba(255,255,255,.92)", fontSize: "clamp(16px,1.14vw,22px)", lineHeight: 1.55, textShadow: "0 2px 8px rgba(0,0,0,.65)" }}>
            Tutto il catalogo film e serie TV. Prima scegli per quanto tempo vuoi Premium, poi confronta Base, Pro e Unlimited in modo semplice e immediato.
          </p>
          <div className="dp-hero__meta" style={{ marginBottom: 18 }}>
            <span className="dp-badge">FINO A 1080p</span>
            <span>Nessun rinnovo automatico</span>
            <span className="dp-hero__dot">•</span>
            <span>Attivazione immediata</span>
          </div>
          <button className="dp-play-btn" type="button" onClick={scrollToPlans} style={{ minWidth: 225 }}>
            <WorkspacePremiumOutlinedIcon /> Scegli l'abbonamento
          </button>
        </div>
      </section>

      <div className="dp-tabs-wrap" ref={plansRef}>
        <div className="dp-tabs premium-duration-tabs" role="tablist" aria-label="Durata abbonamento Premium">
          {DURATION_OPTIONS.map((item) => (
            <button key={item.key} type="button" role="tab" className={`dp-tab ${durationKey === item.key ? "is-active" : ""}`} aria-selected={durationKey === item.key} onClick={() => selectDuration(item.key)}>{item.label}</button>
          ))}
        </div>
      </div>

      <div className="dp-content">
        <section className="dp-panel">
          <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 24, marginBottom: 22 }} className="premium-heading-row">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,.58)", fontSize: 13, marginBottom: 7 }}>
                <CalendarMonthOutlinedIcon style={{ fontSize: 18 }} /> Durata selezionata: <strong style={{ color: "#fff" }}>{duration.label}</strong>
              </div>
              <h2 className="dp-section-title" style={{ textTransform: "none" }}>Scegli il livello Premium</h2>
              <p className="dp-section-sub">Le differenze sono mostrate riga per riga. Il prezzo cambia in base alla durata scelta sopra.</p>
            </div>
            {user?.is_premium ? <div style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "#8ee6a9", fontSize: 14, fontWeight: 700 }}><CheckIcon style={{ fontSize: 18 }} /> {premiumLabel(user)}</div> : null}
          </div>

          {plans === null ? (
            <div style={{ minHeight: 320, display: "grid", placeItems: "center" }}><CircularProgress sx={{ color: "#e50914" }} /></div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "clamp(14px,1.2vw,24px)" }} className="premium-plans-grid">
              {slots.map((slot) => <PlanCard key={`${durationKey}-${slot.key}`} slot={slot} duration={duration} active={selectedKey === slot.key} onSelect={selectPlan} />)}
            </div>
          )}

          <section ref={paymentRef} className="dp-card" style={{ marginTop: 24, padding: "clamp(22px,1.8vw,34px)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(300px,.75fr)", gap: 28, alignItems: "center" }} className="premium-payment-grid">
              <div>
                <p className="dp-section-sub" style={{ margin: 0, color: "#e50914", fontWeight: 700 }}>RIEPILOGO</p>
                <h2 className="dp-h2" style={{ marginTop: 7 }}>{selectedSlot ? `${selectedSlot.name} · ${duration.label}` : "Seleziona un piano"}</h2>
                <p className="dp-plot" style={{ marginTop: 12, fontSize: "clamp(15px,1vw,19px)", lineHeight: 1.55, WebkitLineClamp: "unset" }}>
                  {selectedPlan?.id ? <>Totale: <strong>{euro(selectedPlan.price_cents)}</strong>. </> : <>Questa combinazione non è ancora configurata nell'admin. </>}
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
            <p className="dp-section-sub">Quattro passaggi chiari, senza rinnovo automatico.</p>
            <div className="dp-info-grid premium-how-grid" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
              <HowStep icon={CalendarMonthOutlinedIcon} label="1 · Durata" value="Mensile, 3, 6 o 12 mesi" />
              <HowStep icon={WorkspacePremiumOutlinedIcon} label="2 · Piano" value="Base, Pro o Unlimited" />
              <HowStep icon={CreditCardOutlinedIcon} label="3 · Pagamento" value="Completa il pagamento" />
              <HowStep icon={CheckIcon} label="4 · Attivazione" value="Immediata dopo la conferma" />
            </div>
          </section>
        </section>
      </div>

      <style>{`
        [data-testid="pricing-page"],
        [data-testid="pricing-page"] *,
        [data-testid="pricing-page"] button,
        [data-testid="pricing-page"] input,
        [data-testid="pricing-page"] textarea,
        [data-testid="pricing-page"] select {
          font-family: "Netflix Sans Local", "Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif !important;
        }
        .premium-elevator-hero { overflow: hidden; background: #010912; }
        .premium-elevator-media {
          background:
            radial-gradient(circle at 16% 46%, rgba(229,9,20,.14), transparent 34%),
            radial-gradient(circle at 78% 42%, rgba(40,72,105,.28), transparent 44%),
            #010912;
        }
        .premium-poster-stage {
          position: absolute;
          z-index: 1;
          top: -24%;
          right: -5%;
          width: min(72vw, 1180px);
          height: 155%;
          overflow: hidden;
          opacity: .98;
          -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 9%, #000 91%, transparent 100%);
          mask-image: linear-gradient(180deg, transparent 0%, #000 9%, #000 91%, transparent 100%);
        }
        .premium-poster-tilt {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: clamp(10px, 1vw, 18px);
          transform: rotate(-10.5deg) translate3d(4%, -1%, 0);
          transform-origin: 56% 50%;
        }
        .premium-poster-column {
          min-width: 0;
          height: 122%;
          overflow: hidden;
          border-radius: 14px;
          will-change: transform;
        }
        .premium-poster-column-1 { transform: translateY(6%); opacity: .64; }
        .premium-poster-column-2 { transform: translateY(-2%) scale(1.035); opacity: .94; z-index: 2; }
        .premium-poster-column-3 { transform: translateY(9%) scale(1.075); opacity: 1; z-index: 3; }
        .premium-poster-column-4 { transform: translateY(-5%); opacity: .72; }
        .premium-poster-track {
          display: flex;
          flex-direction: column;
          animation: premium-elevator-up var(--premium-duration) linear infinite;
          animation-delay: var(--premium-delay);
          will-change: transform;
        }
        .premium-poster-sequence {
          display: flex;
          flex-direction: column;
          gap: clamp(10px, .9vw, 16px);
          padding-bottom: clamp(10px, .9vw, 16px);
        }
        .premium-poster-card {
          position: relative;
          width: 100%;
          aspect-ratio: 2 / 3;
          overflow: hidden;
          border-radius: clamp(9px, .75vw, 14px);
          background: #091522;
          border: 1px solid rgba(170,195,215,.22);
          box-shadow: 0 16px 36px rgba(0,0,0,.42);
        }
        .premium-poster-card img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          transform: scale(1.015);
        }
        .premium-poster-card::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,.035), rgba(0,0,0,.14));
          pointer-events: none;
        }
        .premium-poster-vignette {
          position: absolute;
          z-index: 2;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(90deg, #010912 0%, rgba(1,9,18,.97) 22%, rgba(1,9,18,.73) 39%, rgba(1,9,18,.17) 61%, rgba(1,9,18,.02) 78%),
            linear-gradient(0deg, #030c16 0%, rgba(3,12,22,.76) 11%, rgba(3,12,22,.08) 36%, transparent 58%);
        }
        .premium-plans-grid { align-items: stretch; }
        .premium-plan-card { height: 100%; }
        .premium-plan-card-body {
          display: flex;
          flex-direction: column;
          height: 100%;
          box-sizing: border-box;
        }
        .premium-plan-card-body > button { margin-top: auto !important; }
        @keyframes premium-elevator-up {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(0, -50%, 0); }
        }
        @media (max-width: 899px) {
          .premium-duration-tabs { width: min(94vw, 620px); justify-content: flex-start; }
          .premium-plans-grid { grid-template-columns: 1fr !important; }
          .premium-payment-grid { grid-template-columns: 1fr !important; }
          .premium-heading-row { align-items: flex-start !important; flex-direction: column; }
          .premium-how-grid { grid-template-columns: 1fr !important; }
          [data-testid="pricing-page"] .dp-hero__content { width: min(88vw, 680px); left: 6vw; bottom: 54px; }
          [data-testid="pricing-page"] .dp-hero__title { max-width: 88vw !important; font-size: clamp(38px, 12vw, 64px); }
          .premium-poster-stage { top: -15%; right: -32%; width: 115vw; height: 145%; opacity: .52; }
          .premium-poster-tilt { grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; transform: rotate(-11deg) translate3d(0,0,0); }
          .premium-poster-column-4 { display: none; }
          .premium-poster-vignette { background: linear-gradient(90deg, rgba(1,9,18,.88) 0%, rgba(1,9,18,.76) 42%, rgba(1,9,18,.30) 100%), linear-gradient(0deg, #030c16 0%, rgba(3,12,22,.72) 16%, transparent 54%); }
        }
        @media (min-width: 900px) {
          [data-testid="pricing-page"] .premium-plan-card:hover { transform: translateY(-3px); }
          .premium-poster-stage { right: -6%; width: min(88vw, 1420px); }
          .premium-poster-vignette {
            background:
              linear-gradient(90deg, rgba(1,9,18,.82) 0%, rgba(1,9,18,.72) 18%, rgba(1,9,18,.50) 35%, rgba(1,9,18,.16) 59%, rgba(1,9,18,.02) 80%),
              linear-gradient(0deg, #030c16 0%, rgba(3,12,22,.76) 11%, rgba(3,12,22,.08) 36%, transparent 58%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .premium-poster-track { animation-play-state: paused !important; }
        }
      `}</style>
    </Box>
  );
}

export default Component;
