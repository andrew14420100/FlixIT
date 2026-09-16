// @ts-nocheck
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import HomepageSlider from "src/components/HomepageSlider";
import TrailerPlayer from "src/components/TrailerPlayer";
import { useAuthModal } from "src/store/authModal";
import { userToken } from "src/hooks/useCurrentUser";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const TMDB_IMG = "https://image.tmdb.org/t/p/original";

const ctaSx = { height: 50, px: 3.5, borderRadius: "12px", border: "none", cursor: "pointer", color: "#fff", bgcolor: "#E50914", fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 1, transition: "background-color 200ms ease, transform 150ms ease", "&:hover": { bgcolor: "#F6121D" }, "&:active": { transform: "scale(0.98)" } };

export function Paywall({ page, reason, onLogin }) {
  const navigate = useNavigate();
  const loginNeeded = reason === "login_required";
  return (
    <Box data-testid="premium-paywall" sx={{ minHeight: "100vh", position: "relative", display: "flex", alignItems: "center", px: { xs: 2, sm: 4, md: 8 }, pt: 10, pb: 6, overflow: "hidden", bgcolor: "#050505" }}>
      {page?.hero?.image && <Box sx={{ position: "absolute", inset: 0, backgroundImage: `url(${page.hero.image})`, backgroundSize: "cover", backgroundPosition: "center", opacity: 0.25, filter: "blur(6px) saturate(120%)" }} />}
      <Box sx={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 20% 40%, rgba(229,9,20,0.22), transparent 55%)" }} />
      <Box sx={{ position: "relative", maxWidth: 640 }}>
        <Box sx={{ width: 64, height: 64, borderRadius: "18px", display: "grid", placeItems: "center", bgcolor: "rgba(229,9,20,0.15)", border: "1px solid rgba(229,9,20,0.35)", mb: 3 }}>
          <LockOutlinedIcon sx={{ fontSize: 30, color: "#ff5a63" }} />
        </Box>
        <Typography sx={{ color: "#ff5a63", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Sezione Premium</Typography>
        <Typography component="h1" data-testid="paywall-title" sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 800, fontSize: { xs: 32, sm: 44, lg: 56 }, lineHeight: 1.05, color: "#fff", mt: 1 }}>{page?.title || "Contenuto riservato"}</Typography>
        <Typography sx={{ color: "#A3A3A3", fontSize: { xs: 15, md: 17 }, mt: 2.5 }}>{page?.description}</Typography>
        <Typography data-testid="paywall-message" sx={{ color: "#fff", fontSize: 15, mt: 3, fontWeight: 600 }}>
          {loginNeeded ? "Accedi per verificare il tuo abbonamento oppure passa a Premium." : "Questa sezione è riservata agli abbonati Premium. Sblocca subito l'accesso completo."}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 3.5 }}>
          <Box component="button" type="button" onClick={() => navigate("/premium")} data-testid="paywall-upgrade-button" sx={ctaSx}><WorkspacePremiumIcon sx={{ fontSize: 20 }} /> Passa a Premium</Box>
          {loginNeeded && <Box component="button" type="button" onClick={onLogin} data-testid="paywall-login-button" sx={{ ...ctaSx, bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", "&:hover": { bgcolor: "rgba(255,255,255,0.12)" } }}>Accedi</Box>}
        </Stack>
      </Box>
    </Box>
  );
}

function PremiumHero({ page }) {
  const navigate = useNavigate();
  const hero = page.hero || {};
  const bg = hero.image || (page.sections?.[0]?.items?.[0]?.backdrop_path ? `${TMDB_IMG}${page.sections[0].items[0].backdrop_path}` : "");
  const goCta = () => { const l = hero.cta_link || "#sezioni"; l.startsWith("#") ? document.querySelector(l)?.scrollIntoView({ behavior: "smooth" }) : l.startsWith("http") ? window.open(l, "_blank") : navigate(l); };
  return (
    <Box data-testid="premium-hero" sx={{ position: "relative", height: { xs: "70vh", md: "82vh" }, minHeight: 420, overflow: "hidden", bgcolor: "#050505" }}>
      {hero.trailer_key ? <TrailerPlayer videoKey={hero.trailer_key} muted autoPlay /> : bg && <Box component="img" src={bg} alt="" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
      <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(5,5,5,0.92) 0%, rgba(5,5,5,0.55) 45%, rgba(5,5,5,0.1) 100%), linear-gradient(0deg, #050505 0%, transparent 40%)" }} />
      <Box sx={{ position: "absolute", left: { xs: 16, sm: 32, md: 64 }, right: 16, bottom: { xs: "14%", md: "20%" }, maxWidth: 680 }}>
        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.8, px: 1.4, py: 0.5, borderRadius: 999, bgcolor: "rgba(229,9,20,0.18)", border: "1px solid rgba(229,9,20,0.4)", color: "#ff5a63", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", mb: 2 }}>
          <WorkspacePremiumIcon sx={{ fontSize: 15 }} /> Esclusiva Premium
        </Box>
        <Typography component="h1" data-testid="premium-hero-title" sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 800, fontSize: { xs: 34, sm: 48, lg: 64 }, lineHeight: 1.02, color: "#fff", textShadow: "0 10px 40px rgba(0,0,0,0.6)" }}>{hero.title || page.title}</Typography>
        {hero.description && <Typography data-testid="premium-hero-description" sx={{ color: "rgba(255,255,255,0.85)", fontSize: { xs: 15, md: 17 }, mt: 2, maxWidth: 560 }}>{hero.description}</Typography>}
        {hero.cta_label && <Box component="button" type="button" onClick={goCta} data-testid="premium-hero-cta" sx={{ ...ctaSx, mt: 3.5, bgcolor: "#fff", color: "#000", "&:hover": { bgcolor: "#e6e6e6" } }}><PlayArrowRoundedIcon sx={{ fontSize: 24 }} /> {hero.cta_label}</Box>}
      </Box>
    </Box>
  );
}

export function Component() {
  const { slug } = useParams();
  const openAuthModal = useAuthModal((s) => s.openModal);
  const [page, setPage] = useState(undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    setPage(undefined); setError(null);
    const token = userToken();
    fetch(`${API_URL}/api/public/premium-pages/${slug}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 404 ? "Pagina non trovata" : "Errore di caricamento"); setPage(await r.json()); })
      .catch((e) => setError(e.message));
  }, [slug]);

  if (error) return <Box sx={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "#A3A3A3", pt: 12 }} data-testid="premium-page-error">{error}</Box>;
  if (page === undefined) return <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><CircularProgress sx={{ color: "#E50914" }} /></Box>;
  if (page.locked) return <Paywall page={page} reason={page.reason} onLogin={() => openAuthModal("login")} />;

  return (
    <Box data-testid="premium-page" sx={{ bgcolor: "#050505", minHeight: "100vh", pb: 8 }}>
      <PremiumHero page={page} />
      <Stack id="sezioni" spacing={{ xs: 4.5, md: 6 }} sx={{ mt: { xs: -6, md: -10 }, position: "relative", zIndex: 2 }}>
        {page.sections.filter((s) => s.items?.length).map((s) => <HomepageSlider key={s.id} title={s.title} items={s.items} />)}
        {!page.sections.some((s) => s.items?.length) && (
          <Typography data-testid="premium-page-empty" sx={{ color: "#666", textAlign: "center", px: 2 }}>La redazione sta preparando la selezione: torna presto.</Typography>
        )}
      </Stack>
    </Box>
  );
}

export default Component;
