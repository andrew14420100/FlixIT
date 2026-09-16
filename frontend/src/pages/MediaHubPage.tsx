// @ts-nocheck
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import TuneIcon from "@mui/icons-material/Tune";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import HomepageSlider from "src/components/HomepageSlider";
import { MAIN_PATH } from "src/constant";
import { useQuery } from "@tanstack/react-query";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const TMDB_IMG = "https://image.tmdb.org/t/p/original";
const fetchJson = (url) => fetch(`${API_URL}${url}`).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));

const CONFIG = {
  movie: {
    label: "Cinema", eyebrow: "Sala grande", catalogPath: "/film", tagline: "Blockbuster, uscite recenti e i film più amati di sempre.",
    rows: [
      { title: "Di tendenza al cinema", url: "/api/public/tmdb/trending/movie" },
      { title: "Ora in sala", url: "/api/public/tmdb/now_playing" },
      { title: "I più popolari", url: "/api/public/tmdb/popular/movie" },
      { title: "Capolavori più votati", url: "/api/public/tmdb/top_rated/movie" },
      { title: "Azione ad alta tensione", url: "/api/public/tmdb/genre/28/movie" },
      { title: "Thriller da non perdere", url: "/api/public/tmdb/genre/53/movie" },
      { title: "Commedie", url: "/api/public/tmdb/genre/35/movie" },
      { title: "Fantascienza", url: "/api/public/tmdb/genre/878/movie" },
    ],
  },
  tv: {
    label: "Serie TV", eyebrow: "Binge night", catalogPath: "/serie-tv", tagline: "Le serie del momento, i cult e le stagioni appena arrivate.",
    rows: [
      { title: "Serie di tendenza", url: "/api/public/tmdb/trending/tv" },
      { title: "In onda ora", url: "/api/public/tmdb/on_the_air" },
      { title: "Le più popolari", url: "/api/public/tmdb/popular/tv" },
      { title: "Le più votate", url: "/api/public/tmdb/top_rated/tv" },
      { title: "Drama", url: "/api/public/tmdb/genre/18/tv" },
      { title: "Crime & Mistero", url: "/api/public/tmdb/genre/80/tv" },
      { title: "Sci-Fi & Fantasy", url: "/api/public/tmdb/genre/10765/tv" },
      { title: "Commedie", url: "/api/public/tmdb/genre/35/tv" },
    ],
  },
};

function HubHero({ item, cfg, onCatalog }) {
  const navigate = useNavigate();
  const bg = item?.backdrop_path ? `${TMDB_IMG}${item.backdrop_path}` : "";
  return (
    <Box data-testid="hub-hero" sx={{ position: "relative", height: { xs: "72vh", md: "84vh" }, minHeight: 440, overflow: "hidden", bgcolor: "#050505" }}>
      {bg && <Box component="img" src={bg} alt="" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", animation: "flixKen 18s ease-in-out infinite alternate", "@keyframes flixKen": { from: { transform: "scale(1)" }, to: { transform: "scale(1.06)" } } }} />}
      <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(5,5,5,0.95) 0%, rgba(5,5,5,0.6) 45%, rgba(5,5,5,0.15) 100%), linear-gradient(0deg, #050505 0%, transparent 45%)" }} />
      <Box sx={{ position: "absolute", left: { xs: 16, sm: 32, md: 64 }, right: 16, bottom: { xs: "14%", md: "22%" }, maxWidth: 700 }}>
        <Typography sx={{ color: "#ff5a63", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>{cfg.eyebrow}</Typography>
        <Typography component="h1" data-testid="hub-title" sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 800, fontSize: { xs: 40, sm: 56, lg: 72 }, lineHeight: 1, color: "#fff", mt: 1 }}>{cfg.label}</Typography>
        <Typography sx={{ color: "rgba(255,255,255,0.8)", fontSize: { xs: 15, md: 17 }, mt: 2, maxWidth: 520 }}>{cfg.tagline}</Typography>
        {item && (
          <Box sx={{ mt: 3, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
            <Typography sx={{ color: "#A3A3A3", fontSize: 13 }}>In evidenza: <span style={{ color: "#fff", fontWeight: 600 }}>{item.title}</span></Typography>
          </Box>
        )}
        <Stack direction="row" spacing={1.5} sx={{ mt: 2.5, flexWrap: "wrap", gap: 1 }}>
          {item && <Box component="button" type="button" data-testid="hub-hero-play" onClick={() => navigate(`/${MAIN_PATH.watch}/${item.type}/${item.tmdbId}`)} sx={{ height: 48, px: 3, borderRadius: "10px", border: "none", cursor: "pointer", bgcolor: "#fff", color: "#000", fontWeight: 700, fontSize: 15, display: "inline-flex", alignItems: "center", gap: 0.8, "&:hover": { bgcolor: "#e6e6e6" } }}><PlayArrowRoundedIcon /> Riproduci</Box>}
          {item && <Box component="button" type="button" data-testid="hub-hero-info" onClick={() => navigate(`/${MAIN_PATH.browse}/${item.type}/${item.tmdbId}`)} sx={{ height: 48, px: 3, borderRadius: "10px", border: "none", cursor: "pointer", bgcolor: "rgba(109,109,110,0.6)", color: "#fff", fontWeight: 600, fontSize: 15, display: "inline-flex", alignItems: "center", gap: 0.8, "&:hover": { bgcolor: "rgba(109,109,110,0.8)" } }}><InfoOutlinedIcon /> Dettagli</Box>}
          <Box component="button" type="button" data-testid="hub-catalog-link" onClick={onCatalog} sx={{ height: 48, px: 2.5, borderRadius: "10px", cursor: "pointer", bgcolor: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontWeight: 600, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 0.8, "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,0.06)" } }}><TuneIcon sx={{ fontSize: 19 }} /> Catalogo avanzato</Box>
        </Stack>
      </Box>
    </Box>
  );
}

function Row({ title, url }) {
  const { data } = useQuery({ queryKey: ["hub-row", url], queryFn: () => fetchJson(url), staleTime: 10 * 60 * 1000 });
  if (!data) return null;
  return <HomepageSlider title={title} items={data.items || []} />;
}

export default function MediaHubPage({ mediaType }) {
  const cfg = CONFIG[mediaType];
  const navigate = useNavigate();
  const [hero, setHero] = useState(undefined);
  useEffect(() => { fetchJson(cfg.rows[0].url).then((d) => setHero((d.items || []).find((i) => i.backdrop_path) || null)); }, [cfg]);

  return (
    <Box data-testid={`hub-page-${mediaType}`} sx={{ bgcolor: "#050505", minHeight: "100vh", pb: 8 }}>
      {hero === undefined ? <Box sx={{ height: "84vh", display: "grid", placeItems: "center" }}><CircularProgress sx={{ color: "#E50914" }} /></Box> : <HubHero item={hero} cfg={cfg} onCatalog={() => navigate(cfg.catalogPath)} />}
      <Stack spacing={{ xs: 4.5, md: 6 }} sx={{ mt: { xs: -8, md: -14 }, position: "relative", zIndex: 2 }}>
        {cfg.rows.map((r) => <Row key={r.url} title={r.title} url={r.url} />)}
      </Stack>
    </Box>
  );
}
