// @ts-nocheck
import { useLocation, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import HourglassEmptyRoundedIcon from "@mui/icons-material/HourglassEmptyRounded";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { APP_BAR_HEIGHT } from "src/constant";

export const PLACEHOLDER_SECTIONS = {
  "/serie-tv": "Serie TV",
  "/film": "Film",
  "/premium": "Premium",
  "/richiedi-un-titolo": "Richiedi un titolo",
};

export default function ComingSoonPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const label = PLACEHOLDER_SECTIONS[pathname] || "Sezione";

  return (
    <Box
      data-testid="coming-soon-page"
      sx={{
        minHeight: "100vh", pt: `${APP_BAR_HEIGHT}px`, display: "flex", alignItems: "center", justifyContent: "center",
        bgcolor: "#050505", color: "#fff", textAlign: "center", px: 3,
        backgroundImage: "radial-gradient(ellipse at 50% 30%, rgba(229,9,20,0.12) 0%, transparent 55%)",
      }}
    >
      <Stack spacing={2.5} alignItems="center" sx={{ maxWidth: 560 }}>
        <Box sx={{ width: 72, height: 72, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          bgcolor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <HourglassEmptyRoundedIcon sx={{ fontSize: 34, color: "#E50914" }} />
        </Box>
        <Typography data-testid="coming-soon-section-label"
          sx={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
          {label}
        </Typography>
        <Typography component="h1" data-testid="coming-soon-title"
          sx={{ fontSize: { xs: "1.8rem", md: "2.6rem" }, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.02em" }}>
          Sezione non disponibile
        </Typography>
        <Typography data-testid="coming-soon-subtitle" sx={{ fontSize: { xs: "1rem", md: "1.2rem" }, color: "rgba(255,255,255,0.7)" }}>
          In arrivo prossimamente
        </Typography>
        <Box component="button" onClick={() => navigate("/browse")} data-testid="coming-soon-home-button"
          sx={{ mt: 2, display: "inline-flex", alignItems: "center", gap: 1, px: 3, py: 1.2, borderRadius: "4px", border: "none", cursor: "pointer",
            bgcolor: "#fff", color: "#000", fontWeight: 700, fontSize: "0.95rem",
            transition: "background-color 0.2s ease, transform 0.2s ease", "&:hover": { bgcolor: "rgba(255,255,255,0.85)", transform: "scale(1.02)" } }}>
          <ArrowBackIcon sx={{ fontSize: 20 }} />
          Torna alla Home
        </Box>
      </Stack>
    </Box>
  );
}
