// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import TuneIcon from "@mui/icons-material/Tune";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import HomepageSlider from "src/components/HomepageSlider";
import VideoItemWithHover from "src/components/VideoItemWithHover";
import { MAIN_PATH } from "src/constant";
import { MEDIA_TYPE } from "src/types/Common";
import { useQuery } from "@tanstack/react-query";
import useAutomaticMediaAssets from "src/hooks/useAutomaticMediaAssets";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const DAY_MS = 24 * 60 * 60 * 1000;
const HUB_QUERY_VERSION = "hub-row-v3-lazy";
const fetchJson = (url) => fetch(`${API_URL}${url}`).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));

const MOVIE_GENRES = [
  ["", "Tutti i generi"], ["28", "Azione"], ["12", "Avventura"], ["16", "Animazione"], ["35", "Commedia"],
  ["80", "Crime"], ["18", "Drammatico"], ["14", "Fantasy"], ["27", "Horror"], ["9648", "Mistero"], ["878", "Fantascienza"], ["53", "Thriller"]
];
const TV_GENRES = [
  ["", "Tutti i generi"], ["10759", "Azione e avventura"], ["16", "Animazione"], ["35", "Commedia"], ["80", "Crime"],
  ["18", "Drammatico"], ["9648", "Mistero"], ["10765", "Sci-Fi & Fantasy"]
];

const CONFIG = {
  movie: {
    label: "Film", eyebrow: "Sala grande", catalogPath: "/film", tagline: "Blockbuster, uscite recenti e i film più amati di sempre.",
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

function HubHero({ item, cfg, onCatalog, mediaType }) {
  const navigate = useNavigate();
  const assets = useAutomaticMediaAssets(item || {}, mediaType, !!item);
  const bg = assets?.hero_backdrop_path || assets?.detail_backdrop_path || assets?.backdrop_path || "";
  const logo = assets?.logo_path || "";

  return (
    <Box data-testid="hub-hero" sx={{ position: "relative", height: { xs: "72vh", md: "84vh" }, minHeight: 440, overflow: "hidden", bgcolor: "#050505" }}>
      {bg && <Box component="img" src={bg} alt="" fetchPriority="high" decoding="async" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
      <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(5,5,5,0.82) 0%, rgba(5,5,5,.22) 55%, rgba(5,5,5,.05) 100%), linear-gradient(0deg, #050505 0%, transparent 50%)" }} />
      <Box sx={{ position: "absolute", left: { xs: 16, sm: 32, md: 64 }, right: 16, bottom: { xs: "14%", md: "22%" }, maxWidth: 700 }}>
        <Typography sx={{ color: "#ff5a63", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>{cfg.eyebrow}</Typography>
        <Typography component="h1" data-testid="hub-title" sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 800, fontSize: { xs: 40, sm: 56, lg: 72 }, lineHeight: 1, color: "#fff", mt: 1 }}>{cfg.label}</Typography>
        <Typography sx={{ color: "rgba(255,255,255,0.8)", fontSize: { xs: 15, md: 17 }, mt: 2, maxWidth: 520 }}>{cfg.tagline}</Typography>
        {item && <Box sx={{ mt: 3, minHeight: 52, display: "flex", alignItems: "flex-end" }}>{logo ? <Box component="img" src={logo} alt={item.title || item.name || ""} decoding="async" sx={{ maxWidth: { xs: 260, md: 360 }, maxHeight: 110, objectFit: "contain", objectPosition: "left bottom" }} /> : <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: { xs: 24, md: 34 } }}>{item.title || item.name}</Typography>}</Box>}
        <Stack direction="row" spacing={1.5} sx={{ mt: 2.5, flexWrap: "wrap", gap: 1 }}>
          {item && <Box component="button" type="button" data-testid="hub-hero-play" onClick={() => navigate(`/${MAIN_PATH.watch}/${item.type}/${item.tmdbId}`)} sx={{ height: 48, px: 3, borderRadius: "10px", border: "none", cursor: "pointer", bgcolor: "#fff", color: "#000", fontWeight: 700, fontSize: 15, display: "inline-flex", alignItems: "center", gap: .8 }}><PlayArrowRoundedIcon /> Riproduci</Box>}
          {item && <Box component="button" type="button" data-testid="hub-hero-info" onClick={() => navigate(`/${MAIN_PATH.browse}/${item.type}/${item.tmdbId}`)} sx={{ height: 48, px: 3, borderRadius: "10px", border: "none", cursor: "pointer", bgcolor: "rgba(109,109,110,.6)", color: "#fff", fontWeight: 600, fontSize: 15, display: "inline-flex", alignItems: "center", gap: .8 }}><InfoOutlinedIcon /> Dettagli</Box>}
          <Box component="button" type="button" data-testid="hub-catalog-link" onClick={onCatalog} sx={{ height: 48, px: 2.5, borderRadius: "10px", cursor: "pointer", bgcolor: "transparent", border: "1px solid rgba(255,255,255,.3)", color: "#fff", fontWeight: 600, fontSize: 14, display: "inline-flex", alignItems: "center", gap: .8 }}><TuneIcon sx={{ fontSize: 19 }} /> Catalogo avanzato</Box>
        </Stack>
      </Box>
    </Box>
  );
}

function HubRow({ title, url, eager = false }) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(eager);

  useEffect(() => {
    if (near) return;
    const node = anchorRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "1200px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  const { data } = useQuery({
    queryKey: [HUB_QUERY_VERSION, url],
    queryFn: () => fetchJson(url),
    enabled: near,
    staleTime: DAY_MS,
    gcTime: DAY_MS * 7,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return (
    <Box ref={anchorRef} sx={{ minHeight: data ? 0 : 180, contentVisibility: "auto", containIntrinsicSize: "180px" }}>
      {data ? <HomepageSlider title={title} items={data.items || []} /> : null}
    </Box>
  );
}

function MobileCatalog({ mediaType, cfg }) {
  const [genre, setGenre] = useState("");
  const genres = mediaType === "movie" ? MOVIE_GENRES : TV_GENRES;
  const url = genre ? `/api/public/tmdb/genre/${genre}/${mediaType}` : cfg.rows[0].url;
  const { data, isLoading } = useQuery({ queryKey: [HUB_QUERY_VERSION, url], queryFn: () => fetchJson(url), staleTime: DAY_MS });
  const items = useMemo(() => (data?.items || []).slice(0, 30), [data]);

  return (
    <Box data-testid={`mobile-${mediaType}-catalog`} sx={{ px: "14px", pt: 1.5, pb: 10 }}>
      <Typography sx={{ fontSize: 20, fontWeight: 800, mb: 1.2 }}>{cfg.label}</Typography>
      <Box component="select" value={genre} onChange={(e) => setGenre(e.target.value)} sx={{ height: 34, minWidth: 124, bgcolor: "#242424", color: "#fff", border: "1px solid rgba(255,255,255,.1)", borderRadius: "3px", px: 1, fontSize: 12, outline: "none", mb: 1.4 }}>
        {genres.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
      </Box>
      {isLoading ? <Box sx={{ py: 8, display: "grid", placeItems: "center" }}><CircularProgress size={30} sx={{ color: "#e50914" }} /></Box> : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "7px" }}>
          {items.map((item) => {
            const id = item.tmdbId || item.id;
            return <Box key={`${mediaType}-${id}`} sx={{ minWidth: 0, aspectRatio: "2/3", overflow: "hidden", borderRadius: "3px", contentVisibility: "auto", containIntrinsicSize: "120px 180px" }}><VideoItemWithHover video={{ ...item, id, tmdbId: id, type: mediaType }} mediaType={mediaType === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie} suppressHover /></Box>;
          })}
        </Box>
      )}
    </Box>
  );
}

export default function MediaHubPage({ mediaType }) {
  const cfg = CONFIG[mediaType];
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width:899px)");
  const { data: heroData, isPending: heroPending } = useQuery({
    queryKey: [HUB_QUERY_VERSION, cfg.rows[0].url],
    queryFn: () => fetchJson(cfg.rows[0].url),
    staleTime: DAY_MS,
    gcTime: DAY_MS * 7,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const hero = useMemo(() => {
    const first = (heroData?.items || [])[0] || null;
    return first ? { ...first, tmdbId: first.tmdbId || first.id, type: mediaType } : null;
  }, [heroData, mediaType]);

  return (
    <Box data-testid={`hub-page-${mediaType}`} sx={{ bgcolor: "#050505", minHeight: "100vh", pb: 8 }}>
      {heroPending ? <Box sx={{ height: "84vh", bgcolor: "#0b0b0b" }} /> : <HubHero item={hero} cfg={cfg} mediaType={mediaType} onCatalog={() => navigate(cfg.catalogPath)} />}
      {isMobile ? <MobileCatalog mediaType={mediaType} cfg={cfg} /> : (
        <Stack spacing={{ xs: 4.5, md: 6 }} sx={{ mt: { xs: -8, md: -14 }, position: "relative", zIndex: 2 }}>
          {cfg.rows.map((r, index) => <HubRow key={r.url} title={r.title} url={r.url} eager={index === 0} />)}
        </Stack>
      )}
    </Box>
  );
}
