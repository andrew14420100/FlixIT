// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import TheaterComedyOutlinedIcon from "@mui/icons-material/TheaterComedyOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";

import { useLazyGetAppendedVideosQuery, useLazyGetVideosByMediaTypeAndGenreIdQuery } from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useAvailableItems } from "src/hooks/useAvailability";
import useAutomaticMediaAssets, { tmdbImageUrl } from "src/hooks/useAutomaticMediaAssets";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import TrailerPlayer from "src/components/TrailerPlayer";
import TrailerAudioButton from "src/components/TrailerAudioButton";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const HERO_TRAILER_DELAY = 2200;
const TRAILER_LOOKUP_DELAY = 450;
const WATCH_STREAM_CACHE_PREFIX = "watch_stream_cache:";

const DETAIL_TABS = [
  { id: "overview", label: "Panoramica" },
  { id: "trailers", label: "Trailer & altro" },
  { id: "download", label: "Scarica" },
  { id: "similar", label: "Titoli simili" },
];

export async function loader() { return null; }

function imageUrl(...values: any[]) {
  for (const value of values) {
    const raw = typeof value === "string" ? value : value?.url;
    const text = String(raw || "").trim();
    if (!text) continue;
    if (/^https?:\/\//i.test(text) || text.startsWith("data:") || text.startsWith("blob:")) return text;
    if (text.startsWith("/")) return tmdbImageUrl(text, "original");
  }
  return null;
}

function yearFrom(detail: any) {
  const raw = detail?.release_date || detail?.first_air_date || "";
  return raw ? String(raw).slice(0, 4) : "";
}

function runtimeText(detail: any, isTV: boolean) {
  if (isTV) {
    const count = Number(detail?.number_of_seasons || 0);
    return count ? `${count} ${count === 1 ? "stagione" : "stagioni"}` : "Serie TV";
  }
  const minutes = Number(detail?.runtime || 0);
  if (!minutes) return "Film";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}min` : ""}` : `${minutes}min`;
}

function certificationText(detail: any) {
  const direct = detail?.certification || detail?.content_rating || detail?.contentRating;
  if (direct) {
    const text = String(direct).trim();
    return /^\d{1,2}$/.test(text) ? `${text}+` : text;
  }
  const ratings = detail?.content_ratings?.results;
  if (Array.isArray(ratings)) {
    const hit = ratings.find((x: any) => x?.iso_3166_1 === "IT") || ratings.find((x: any) => x?.iso_3166_1 === "US") || ratings.find((x: any) => x?.rating);
    if (hit?.rating) return /^\d{1,2}$/.test(String(hit.rating)) ? `${hit.rating}+` : String(hit.rating);
  }
  return "";
}

function secondsText(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  if (safe >= 3600) {
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    return `${h}h${m ? ` ${m}min` : ""}`;
  }
  return `${Math.max(1, Math.ceil(safe / 60))} min`;
}

function directTrailerUrl(value: any) {
  const raw = typeof value === "string" ? value : value?.url || value?.trailer_url || value?.manifest_url || value?.stream_url;
  const text = String(raw || "").trim();
  return /^https?:\/\//i.test(text) || text.startsWith("/") ? text : null;
}

function trailerLabel(item: any, index: number) {
  return String(item?.label || item?.title || item?.name || item?.kind || item?.type || (index === 0 ? "Trailer ufficiale" : `Trailer ${index + 1}`));
}

function cacheResolvedStream(typeSlug: string, id: number, season: number, episode: number, payload: any) {
  if (!payload?.success || !payload?.stream) return;
  try {
    sessionStorage.setItem(
      `${WATCH_STREAM_CACHE_PREFIX}${typeSlug}:${id}:${typeSlug === "tv" ? season || 1 : 0}:${typeSlug === "tv" ? episode || 1 : 0}`,
      JSON.stringify({ stream: payload.stream, type: payload.type || "hls", source: payload.source, savedAt: Date.now() })
    );
  } catch {}
}

async function warmPlayback(typeSlug: string, id: number, season = 1, episode = 1) {
  const path = typeSlug === "tv" ? `${API_URL}/api/player/tv/${id}/${season}/${episode}` : `${API_URL}/api/player/movie/${id}`;
  try {
    const response = await fetch(path, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const payload = await response.json();
    cacheResolvedStream(typeSlug, id, season, episode, payload);
  } catch {}
}

export function Component() {
  const { mediaType, id } = useParams<{ mediaType: string; id: string }>();
  const navigate = useNavigate();
  const mediaId = Number(id) || 0;
  const typeSlug = mediaType === "tv" ? "tv" : "movie";
  const type = typeSlug === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;
  const isTV = typeSlug === "tv";

  const [getVideoDetail, { data: detail }] = useLazyGetAppendedVideosQuery();
  const [getGenrePage] = useLazyGetVideosByMediaTypeAndGenreIdQuery();
  const automaticAssets = useAutomaticMediaAssets({ ...(detail || {}), id: mediaId, type: typeSlug }, type, !!mediaId);
  const { items: continueWatchingItems } = useContinueWatching();

  const [trailerLookupEnabled, setTrailerLookupEnabled] = useState(false);
  const resolvedTrailer = useResolvedTrailer(type, mediaId, trailerLookupEnabled && !!mediaId);
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [modalTrailerUrl, setModalTrailerUrl] = useState<string | null>(null);
  const [modalMuted, setModalMuted] = useState(false);
  const [relatedPool, setRelatedPool] = useState<any[]>([]);

  const progressItem = useMemo(
    () => continueWatchingItems.find((item: any) => Number(item.tmdb_id) === mediaId && item.media_type === typeSlug),
    [continueWatchingItems, mediaId, typeSlug]
  );
  const progressPercent = progressItem?.duration > 0 ? Math.min(100, Math.max(0, (progressItem.progress / progressItem.duration) * 100)) : 0;
  const remainingSeconds = progressItem?.duration > 0 ? Math.max(0, progressItem.duration - progressItem.progress) : 0;

  useEffect(() => {
    if (mediaId) getVideoDetail({ mediaType: type, id: mediaId });
  }, [getVideoDetail, mediaId, type]);

  useEffect(() => {
    setActiveTab("overview");
    setTrailerLookupEnabled(false);
    setShowTrailer(false);
    setTrailerPlaying(false);
    setMuted(true);
    setModalTrailerUrl(null);
    setRelatedPool([]);
    if (!mediaId) return;
    const timer = window.setTimeout(() => setTrailerLookupEnabled(true), TRAILER_LOOKUP_DELAY);
    return () => window.clearTimeout(timer);
  }, [mediaId, typeSlug]);

  useEffect(() => {
    if (!resolvedTrailer.url) return;
    const timer = window.setTimeout(() => setShowTrailer(true), HERO_TRAILER_DELAY);
    return () => window.clearTimeout(timer);
  }, [resolvedTrailer.url, mediaId]);

  useEffect(() => {
    const primaryGenre = Number(detail?.genres?.[0]?.id || 0);
    if (!primaryGenre) return;
    let cancelled = false;
    let timer = 0;
    let idleId: any = null;
    const load = () => {
      Promise.all([
        getGenrePage({ mediaType: type, genreId: primaryGenre, page: 1 }).unwrap().catch(() => null),
        getGenrePage({ mediaType: type, genreId: primaryGenre, page: 2 }).unwrap().catch(() => null),
      ]).then((pages) => {
        if (cancelled) return;
        const seen = new Set<number>();
        setRelatedPool(
          pages.flatMap((page: any) => page?.results || []).filter((item: any) => {
            const itemId = Number(item?.id || item?.tmdbId || 0);
            if (!itemId || itemId === mediaId || seen.has(itemId)) return false;
            seen.add(itemId);
            return true;
          }).slice(0, 24)
        );
      });
    };
    if ("requestIdleCallback" in window) idleId = (window as any).requestIdleCallback(load, { timeout: 2200 });
    else timer = window.setTimeout(load, 900);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (idleId != null && "cancelIdleCallback" in window) (window as any).cancelIdleCallback(idleId);
    };
  }, [detail?.genres, getGenrePage, mediaId, type]);

  const relatedItems = useAvailableItems(relatedPool, typeSlug);
  const title = detail?.title || detail?.name || automaticAssets?.title || "";
  const genres = (detail?.genres || []).map((genre: any) => genre?.name).filter(Boolean);
  const overview = String(detail?.overview || "").trim();
  const certification = certificationText(detail);
  const logoUrl = imageUrl(automaticAssets?.logo_path, automaticAssets?.logo, detail?.netflix_logo_url, detail?.logo_path);
  const backdropUrl = imageUrl(
    automaticAssets?.detail_backdrop_path,
    automaticAssets?.hero_backdrop_path,
    automaticAssets?.backdrop_path,
    detail?.netflix_artwork_url,
    detail?.backdrop_path
  );

  const goPlay = useCallback(() => {
    const season = isTV ? Number(progressItem?.season || 1) : 0;
    const episode = isTV ? Number(progressItem?.episode || 1) : 0;
    warmPlayback(typeSlug, mediaId, season || 1, episode || 1);
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${mediaId}${isTV ? `?s=${season || 1}&e=${episode || 1}` : ""}`);
  }, [isTV, mediaId, navigate, progressItem?.episode, progressItem?.season, typeSlug]);

  const trailerItems = useMemo(() => {
    const items: any[] = [];
    const seen = new Set<string>();
    const push = (value: any, label?: string, source?: string) => {
      const url = directTrailerUrl(value);
      if (!url || seen.has(url)) return;
      seen.add(url);
      items.push({ url, label: label || trailerLabel(value, items.length), source });
    };
    push(resolvedTrailer.url, "Trailer ufficiale", resolvedTrailer.source);
    [detail?.trailers, detail?.videos, detail?.trailer_alternatives, detail?.video_trailers, automaticAssets?.trailers, automaticAssets?.videos].forEach((array) => {
      if (Array.isArray(array)) array.forEach((item: any) => push(item, trailerLabel(item, items.length), item?.source));
    });
    return items.slice(0, 8);
  }, [automaticAssets?.trailers, automaticAssets?.videos, detail?.trailer_alternatives, detail?.trailers, detail?.video_trailers, detail?.videos, resolvedTrailer.source, resolvedTrailer.url]);

  if (!detail) {
    return <Box sx={{ minHeight: "82vh", bgcolor: "#010b15", display: "grid", placeItems: "center" }}><CircularProgress sx={{ color: "#e50914" }} /></Box>;
  }

  const heroLabel = progressItem ? "Continua a guardare" : isTV ? "Guarda S1:E1" : "Riproduci";
  const progressMeta = progressItem
    ? isTV
      ? `S${Number(progressItem.season || 1)}:E${Number(progressItem.episode || 1)} - ${secondsText(remainingSeconds)} rimanenti`
      : `${secondsText(remainingSeconds)} rimanenti`
    : "";
  const resumeTitle = progressItem && isTV
    ? `S${Number(progressItem.season || 1)}:E${Number(progressItem.episode || 1)}${progressItem?.episode_title || progressItem?.episode_name ? ` - ${progressItem?.episode_title || progressItem?.episode_name}` : ""}`
    : isTV ? "S1:E1" : title;
  const plot = overview.length > 285 ? `${overview.slice(0, 285).replace(/\s+\S*$/, "").trim()}… altro` : overview;
  const metaCards = [
    { label: "Genere", value: genres[0] || "—", icon: <TheaterComedyOutlinedIcon sx={{ fontSize: 32 }} /> },
    { label: "Anno", value: yearFrom(detail) || "—", icon: <CalendarMonthOutlinedIcon sx={{ fontSize: 31 }} /> },
    { label: isTV ? "Stagioni" : "Durata", value: isTV ? String(detail?.number_of_seasons || "—") : runtimeText(detail, false), icon: <LayersOutlinedIcon sx={{ fontSize: 31 }} /> },
    { label: "Classificazione", value: certification || "—", icon: <Box sx={{ border: "2px solid currentColor", borderRadius: "4px", px: .55, py: .05, fontSize: 16, fontWeight: 800, lineHeight: 1.35 }}>{certification || "—"}</Box> },
  ];

  const motion = {
    animation: "detailImageOneIn 220ms cubic-bezier(.22,.61,.36,1) both",
    "@keyframes detailImageOneIn": { from: { opacity: 0, transform: "translateY(10px)" }, to: { opacity: 1, transform: "translateY(0)" } },
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  };

  return (
    <Box data-testid="detail-page-image-one" sx={{ minHeight: "100vh", overflowX: "hidden", color: "#fff", bgcolor: "#010b15", fontFamily: '"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif', backgroundImage: "radial-gradient(circle at 55% 16%, rgba(15,53,76,.34) 0%, rgba(4,24,39,.20) 30%, transparent 52%), linear-gradient(180deg, #031321 0%, #010e1a 48%, #000711 100%)" }}>
      <Box sx={{ position: "relative", height: { xs: "clamp(560px,72vh,700px)", md: "clamp(500px,52.6vh,620px)" }, minHeight: { xs: 560, md: 500 }, overflow: "hidden", bgcolor: "#020b14" }}>
        {backdropUrl ? <Box component="img" src={backdropUrl} alt="" decoding="async" fetchPriority="high" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: { xs: "62% center", md: "center 24%" }, opacity: showTrailer && trailerPlaying ? 0 : 1, transition: "opacity 360ms ease" }} /> : null}
        {showTrailer && resolvedTrailer.url ? (
          <Box sx={{ position: "absolute", inset: 0, opacity: trailerPlaying ? 1 : 0, transition: "opacity 360ms ease", pointerEvents: "none" }}>
            <TrailerPlayer key={resolvedTrailer.url} videoKey={resolvedTrailer.url} muted={muted} playing loop={false} zoom={1} onPlaying={() => setTrailerPlaying(true)} onEnded={() => { setShowTrailer(false); setTrailerPlaying(false); }} onError={() => { setShowTrailer(false); setTrailerPlaying(false); }} />
          </Box>
        ) : null}
        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(0,5,10,.97) 0%, rgba(0,6,12,.84) 22%, rgba(0,8,15,.53) 38%, rgba(0,7,13,.10) 65%, rgba(0,7,13,.02) 100%)" }} />
        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, #031321 0%, rgba(3,19,33,.86) 5%, rgba(3,19,33,.28) 24%, rgba(3,19,33,0) 48%)" }} />

        <Box sx={{ position: "absolute", left: { xs: "5vw", md: "3.7vw" }, bottom: { xs: 34, md: 14 }, zIndex: 5, width: { xs: "90vw", sm: "70vw", md: "min(540px,39vw)" } }}>
          {logoUrl ? <Box component="img" src={logoUrl} alt={title} decoding="async" sx={{ display: "block", width: "auto", maxWidth: { xs: "min(78vw,440px)", md: "min(460px,33vw)" }, maxHeight: { xs: 170, md: 158 }, objectFit: "contain", objectPosition: "left center", mb: 1.8, filter: "drop-shadow(0 5px 18px rgba(0,0,0,.25))" }} /> : <Typography sx={{ fontSize: { xs: "clamp(46px,12vw,72px)", md: "clamp(48px,4.9vw,76px)" }, lineHeight: .88, fontWeight: 900, letterSpacing: "-.045em", mb: 1.8, textShadow: "0 4px 22px rgba(0,0,0,.48)" }}>{title}</Typography>}

          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1.05} sx={{ alignItems: "center", mb: 1.2, color: "rgba(255,255,255,.91)" }}>
            {[isTV ? "Serie" : "Film", genres[0], yearFrom(detail), runtimeText(detail, isTV)].filter(Boolean).map((value, index) => <Stack key={`${value}-${index}`} direction="row" spacing={1.05} sx={{ alignItems: "center" }}>{index ? <Box component="span" sx={{ color: "rgba(255,255,255,.78)", fontSize: 16 }}>•</Box> : null}<Typography component="span" sx={{ fontSize: { xs: 14.5, md: 16 }, fontWeight: 500, lineHeight: 1.1 }}>{value}</Typography></Stack>)}
            {certification ? <><Box component="span" sx={{ color: "rgba(255,255,255,.78)", fontSize: 16 }}>•</Box><Box component="span" sx={{ border: "1px solid rgba(255,255,255,.72)", borderRadius: "4px", px: .72, py: .12, fontSize: { xs: 13.5, md: 15 }, fontWeight: 650, lineHeight: 1.25 }}>{certification}</Box></> : null}
          </Stack>

          <Typography sx={{ fontWeight: 800, fontSize: { xs: 15.5, md: 17 }, mb: .55 }}>{heroLabel}</Typography>
          <Stack direction="row" spacing={1.45} sx={{ alignItems: "center", mb: 1.05, minHeight: 7 }}>
            <Box sx={{ width: { xs: 220, md: 264 }, maxWidth: "48vw", height: 6, borderRadius: 999, bgcolor: "rgba(255,255,255,.27)", overflow: "hidden" }}><Box sx={{ width: `${progressItem ? Math.max(4, progressPercent) : 0}%`, height: "100%", bgcolor: "#e50914", borderRadius: 999, transition: "width 250ms ease" }} /></Box>
            {progressItem ? <Typography sx={{ fontSize: { xs: 13.5, md: 15.5 }, color: "rgba(255,255,255,.91)", whiteSpace: "nowrap" }}>{progressMeta}</Typography> : null}
          </Stack>
          <Button data-testid="detail-play" onClick={goPlay} onMouseEnter={goPlay ? () => warmPlayback(typeSlug, mediaId, isTV ? Number(progressItem?.season || 1) : 1, isTV ? Number(progressItem?.episode || 1) : 1) : undefined} startIcon={<PlayArrowIcon sx={{ fontSize: { xs: 27, md: 30 } }} />} sx={{ minWidth: { xs: 230, md: 272 }, height: { xs: 44, md: 46 }, px: 2.6, borderRadius: "10px", bgcolor: "#fff", color: "#080808", fontSize: { xs: 15.5, md: 17 }, fontWeight: 800, textTransform: "none", boxShadow: "0 10px 26px rgba(0,0,0,.24)", transition: "background-color 160ms ease, transform 160ms ease", "&:hover": { bgcolor: "rgba(255,255,255,.88)", transform: "translateY(-1px)" } }}>{heroLabel}</Button>
        </Box>

        {showTrailer && resolvedTrailer.url && trailerPlaying ? <Box sx={{ position: "absolute", right: { xs: 18, md: 32 }, bottom: { xs: 28, md: 30 }, zIndex: 7 }}><TrailerAudioButton muted={muted} onToggle={() => setMuted((value) => !value)} testId="detail-hero-audio-toggle" /></Box> : null}
      </Box>

      <Box sx={{ position: "relative", zIndex: 12, mt: { xs: "-20px", md: "-23px" }, px: 2 }}>
        <Box role="tablist" aria-label="Sezioni dettaglio" sx={{ mx: "auto", width: { xs: "100%", sm: "fit-content" }, maxWidth: 680, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "24px", bgcolor: "rgba(4,20,32,.93)", border: "1px solid rgba(116,151,173,.32)", boxShadow: "0 14px 36px rgba(0,0,0,.22)", backdropFilter: "blur(18px)", overflowX: "auto" }}>
          {DETAIL_TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return <Button key={tab.id} role="tab" aria-selected={selected} data-testid={`detail-tab-${tab.id}`} onClick={() => setActiveTab(tab.id)} sx={{ position: "relative", minWidth: { xs: 132, md: 160 }, height: 46, px: 2.2, borderRadius: "22px", color: selected ? "#fff" : "rgba(255,255,255,.86)", bgcolor: selected ? "rgba(255,255,255,.045)" : "transparent", fontSize: { xs: 13.5, md: 15.5 }, fontWeight: selected ? 700 : 500, textTransform: "none", whiteSpace: "nowrap", "&:hover": { bgcolor: selected ? "rgba(255,255,255,.06)" : "rgba(255,255,255,.025)" }, "&::after": { content: '""', position: "absolute", left: "24%", right: "24%", bottom: 5, height: 4, borderRadius: 999, bgcolor: selected ? "#ed101a" : "transparent", boxShadow: selected ? "0 0 10px rgba(237,16,26,.48)" : "none" } }}>{tab.label}</Button>;
          })}
        </Box>
      </Box>

      <Box key={activeTab} sx={{ width: "min(1510px,91vw)", mx: "auto", pt: { xs: 3.2, md: 4.2 }, pb: 10, ...motion }}>
        {activeTab === "overview" ? (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1.9fr 1fr" }, gap: { xs: 2, md: 2.1 }, alignItems: "stretch" }}>
            <Box sx={{ minHeight: { md: 315 }, p: { xs: 2.4, md: "20px 38px 24px" }, borderRadius: "18px", border: "1px solid rgba(88,126,148,.34)", background: "linear-gradient(135deg, rgba(3,18,29,.94), rgba(4,23,37,.80))", boxShadow: "0 20px 60px rgba(0,0,0,.20)", backdropFilter: "blur(13px)" }}>
              <Typography sx={{ fontSize: { xs: 27, md: 32 }, fontWeight: 800, lineHeight: 1.1, mb: 1.35 }}>Panoramica</Typography>
              <Box sx={{ height: 1, bgcolor: "rgba(143,172,190,.22)", mb: 1.65 }} />
              <Typography sx={{ minHeight: { md: 102 }, fontSize: { xs: 16, md: 20 }, lineHeight: 1.55, color: "rgba(255,255,255,.90)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{plot || "Nessuna trama disponibile."}</Typography>
              <Box sx={{ height: 1, bgcolor: "rgba(143,172,190,.22)", mt: 1.25, mb: 2.05 }} />
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4,1fr)" }, gap: { xs: 1, md: 1.6 } }}>
                {metaCards.map((item) => <Box key={item.label} sx={{ minHeight: 78, px: { xs: 1.35, md: 1.7 }, py: 1.35, borderRadius: "14px", display: "flex", alignItems: "center", gap: 1.4, bgcolor: "rgba(7,25,38,.66)", border: "1px solid rgba(96,132,153,.28)" }}><Box sx={{ color: "rgba(255,255,255,.94)", display: "grid", placeItems: "center", flex: "0 0 35px" }}>{item.icon}</Box><Box sx={{ minWidth: 0 }}><Typography sx={{ fontSize: 12.5, color: "rgba(255,255,255,.59)", lineHeight: 1.15, mb: .35 }}>{item.label}</Typography><Typography sx={{ fontSize: { xs: 15.5, md: 17 }, fontWeight: 750, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.value}</Typography></Box></Box>)}
              </Box>
            </Box>

            <Box sx={{ minHeight: { md: 315 }, p: { xs: 2.4, md: "22px 28px 24px" }, borderRadius: "18px", border: "1px solid rgba(88,126,148,.34)", background: "linear-gradient(145deg, rgba(3,19,31,.95), rgba(3,18,29,.82))", boxShadow: "0 20px 60px rgba(0,0,0,.20)", backdropFilter: "blur(13px)" }}>
              <Typography sx={{ fontSize: { xs: 23, md: 26 }, fontWeight: 800, mb: 1.55 }}>Continua a guardare</Typography>
              <Box onClick={goPlay} sx={{ position: "relative", width: "100%", aspectRatio: { xs: "16 / 7", md: "3.25 / 1" }, maxHeight: 142, borderRadius: "10px", overflow: "hidden", bgcolor: "#06111b", border: "1px solid rgba(118,154,174,.34)", cursor: "pointer" }}>
                {backdropUrl ? <Box component="img" src={backdropUrl} alt="" loading="lazy" decoding="async" sx={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 28%" }} /> : null}
                <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(0,8,15,.20), rgba(0,8,15,.04))" }} />
                <Box sx={{ position: "absolute", left: 22, top: "50%", transform: "translateY(-50%)", width: 48, height: 48, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "rgba(18,45,67,.76)", border: "1px solid rgba(255,255,255,.82)", boxShadow: "0 5px 18px rgba(0,0,0,.24)" }}><PlayArrowIcon sx={{ fontSize: 30 }} /></Box>
              </Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ mt: 1.6 }}><Typography sx={{ fontSize: { xs: 14.5, md: 16 }, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resumeTitle}</Typography><Typography sx={{ fontSize: { xs: 13.5, md: 15.5 }, color: "rgba(255,255,255,.88)", whiteSpace: "nowrap" }}>{progressItem ? `${secondsText(remainingSeconds)} rimanenti` : "Inizia"}</Typography></Stack>
              <Box sx={{ height: 7, mt: 1.3, borderRadius: 999, bgcolor: "rgba(255,255,255,.15)", overflow: "hidden" }}><Box sx={{ width: `${progressItem ? Math.max(4, progressPercent) : 0}%`, height: "100%", bgcolor: "#e50914", borderRadius: 999 }} /></Box>
            </Box>
          </Box>
        ) : null}

        {activeTab === "trailers" ? (
          <Box><Typography sx={{ fontSize: { xs: 29, md: 37 }, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05, mb: .65 }}>Trailer & altro</Typography><Typography sx={{ fontSize: { xs: 15, md: 17 }, color: "rgba(255,255,255,.72)", mb: 2.6 }}>Scopri trailer, contenuti speciali e video disponibili per questo titolo.</Typography>{trailerItems.length ? <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,1fr)", xl: "repeat(4,1fr)" }, gap: 1.5 }}>{trailerItems.slice(0, 4).map((item: any, index: number) => <Box key={item.url} onClick={() => { setModalMuted(false); setModalTrailerUrl(item.url); }} sx={{ cursor: "pointer", overflow: "hidden", borderRadius: "14px", bgcolor: "rgba(4,20,32,.88)", border: "1px solid rgba(92,130,151,.36)", boxShadow: "0 18px 42px rgba(0,0,0,.20)", transition: "transform 180ms ease,border-color 180ms ease", "&:hover": { transform: "translateY(-3px)", borderColor: "rgba(152,181,198,.55)" } }}><Box sx={{ position: "relative", aspectRatio: "16 / 7.2", bgcolor: "#06111b", overflow: "hidden" }}>{backdropUrl ? <Box component="img" src={backdropUrl} alt="" loading="lazy" decoding="async" sx={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: index % 2 ? "60% center" : "center 26%", filter: index ? "brightness(.76) saturate(.92)" : "none" }} /> : null}<Box sx={{ position: "absolute", left: 18, bottom: 14, width: 46, height: 46, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "rgba(8,27,42,.80)", border: "1px solid rgba(255,255,255,.82)" }}><PlayArrowIcon sx={{ fontSize: 29 }} /></Box></Box><Box sx={{ p: "12px 16px 16px" }}><Typography sx={{ fontSize: 18, fontWeight: 800, mb: .45 }}>{item.label}</Typography><Typography sx={{ fontSize: 14.2, color: "rgba(255,255,255,.67)", lineHeight: 1.35 }}>{item.source ? `Fonte: ${item.source}` : "Riproduci il contenuto video"}</Typography></Box></Box>)}</Box> : <Box sx={{ minHeight: 260, borderRadius: "18px", border: "1px solid rgba(88,126,148,.30)", bgcolor: "rgba(3,18,29,.82)", display: "grid", placeItems: "center", textAlign: "center", px: 3 }}><Box><Typography sx={{ fontSize: 24, fontWeight: 800, mb: .7 }}>Trailer non disponibile</Typography><Typography sx={{ color: "rgba(255,255,255,.64)" }}>Il sistema continuerà a cercare automaticamente una sorgente disponibile.</Typography></Box></Box>}</Box>
        ) : null}

        {activeTab === "download" ? <Box sx={{ display: "grid", placeItems: "center", minHeight: 345 }}><Box sx={{ width: "min(910px,100%)", minHeight: 286, borderRadius: "18px", border: "1px solid rgba(88,126,148,.38)", bgcolor: "rgba(3,19,31,.84)", boxShadow: "0 24px 70px rgba(0,0,0,.20)", display: "grid", placeItems: "center", textAlign: "center", px: 4, py: 4.5 }}><Box><Box sx={{ width: 112, height: 112, mx: "auto", mb: 2.2, borderRadius: "50%", display: "grid", placeItems: "center", border: "1px solid rgba(86,153,211,.58)", bgcolor: "rgba(26,75,118,.16)" }}><DownloadRoundedIcon sx={{ fontSize: 55, color: "#9ecdf6" }} /></Box><Typography sx={{ fontSize: { xs: 27, md: 35 }, fontWeight: 850, mb: 1 }}>Download non ancora disponibile</Typography><Typography sx={{ fontSize: { xs: 15, md: 18 }, color: "rgba(255,255,255,.68)" }}>Stiamo lavorando per renderlo disponibile nelle prossime versioni.</Typography></Box></Box></Box> : null}

        {activeTab === "similar" ? <Box><Typography sx={{ fontSize: { xs: 29, md: 37 }, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05, mb: 2 }}>Titoli simili</Typography>{relatedItems.length ? <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", sm: "repeat(3,minmax(0,1fr))", lg: "repeat(6,minmax(0,1fr))" }, gap: 1.55 }}>{relatedItems.slice(0, 6).map((item: any) => { const itemId = Number(item?.id || item?.tmdbId || 0); const itemType = item?.media_type === "movie" || item?.type === "movie" ? "movie" : item?.media_type === "tv" || item?.type === "tv" ? "tv" : typeSlug; const itemTitle = item?.title || item?.name || "Titolo"; const itemYear = String(item?.release_date || item?.first_air_date || "").slice(0, 4); const poster = imageUrl(item?.poster_url, item?.image_url, item?.poster, item?.poster_path, item?.backdrop_path) || backdropUrl; return <Box key={itemId || itemTitle} onClick={() => itemId && navigate(`/${MAIN_PATH.browse}/${itemType}/${itemId}`)} sx={{ overflow: "hidden", borderRadius: "13px", bgcolor: "rgba(4,19,30,.92)", border: "1px solid rgba(92,130,151,.34)", cursor: itemId ? "pointer" : "default", transition: "transform 180ms ease,border-color 180ms ease", "&:hover": { transform: itemId ? "translateY(-4px)" : "none", borderColor: "rgba(152,181,198,.52)" } }}><Box sx={{ position: "relative", aspectRatio: "4 / 5", bgcolor: "#06111b", overflow: "hidden" }}>{poster ? <Box component="img" src={poster} alt={itemTitle} loading="lazy" decoding="async" sx={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}<Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,8,15,.96) 0%, rgba(0,8,15,.25) 35%, transparent 60%)" }} /><Typography sx={{ position: "absolute", left: 13, right: 13, bottom: 12, fontSize: { xs: 15.5, md: 19 }, fontWeight: 850, lineHeight: 1.05, textShadow: "0 2px 10px rgba(0,0,0,.6)" }}>{itemTitle}</Typography></Box><Box sx={{ px: 1.45, py: 1.2 }}><Typography sx={{ fontSize: 12.7, color: "rgba(255,255,255,.68)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{itemType === "tv" ? "Serie" : "Film"}{genres[0] ? ` · ${genres[0]}` : ""}</Typography><Typography sx={{ mt: .4, fontSize: 12.5, color: "rgba(255,255,255,.84)" }}>{itemYear || ""}{certification ? `  ·  ${certification}` : ""}</Typography></Box></Box>; })}</Box> : <Box sx={{ minHeight: 240, display: "grid", placeItems: "center", border: "1px solid rgba(88,126,148,.30)", borderRadius: "18px", bgcolor: "rgba(3,18,29,.82)" }}><Typography sx={{ color: "rgba(255,255,255,.64)" }}>Nessun titolo simile disponibile.</Typography></Box>}</Box> : null}
      </Box>

      {modalTrailerUrl ? <Box role="dialog" aria-modal="true" aria-label="Trailer" onClick={() => setModalTrailerUrl(null)} sx={{ position: "fixed", inset: 0, zIndex: 1500, bgcolor: "rgba(0,0,0,.88)", display: "grid", placeItems: "center", p: { xs: 1.5, md: 4 }, backdropFilter: "blur(12px)", animation: "detailModalIn 180ms ease-out", "@keyframes detailModalIn": { from: { opacity: 0 }, to: { opacity: 1 } } }}><Box onClick={(event) => event.stopPropagation()} sx={{ position: "relative", width: "min(1180px,96vw)", aspectRatio: "16 / 9", bgcolor: "#000", borderRadius: "16px", overflow: "hidden", boxShadow: "0 40px 110px rgba(0,0,0,.65)", border: "1px solid rgba(255,255,255,.18)" }}><TrailerPlayer videoKey={modalTrailerUrl} muted={modalMuted} playing loop={false} zoom={1} onEnded={() => setModalTrailerUrl(null)} onError={() => setModalTrailerUrl(null)} /><IconButton onClick={() => setModalTrailerUrl(null)} aria-label="Chiudi trailer" sx={{ position: "absolute", top: 14, right: 14, zIndex: 3, bgcolor: "rgba(0,0,0,.62)", color: "#fff", border: "1px solid rgba(255,255,255,.32)", "&:hover": { bgcolor: "rgba(0,0,0,.82)" } }}><CloseIcon /></IconButton><Box sx={{ position: "absolute", right: 14, bottom: 14, zIndex: 3 }}><TrailerAudioButton muted={modalMuted} onToggle={() => setModalMuted((value) => !value)} testId="detail-modal-trailer-audio-toggle" /></Box></Box></Box> : null}
    </Box>
  );
}

export default Component;
