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

import {
  useLazyGetAppendedVideosQuery,
  useLazyGetVideosByMediaTypeAndGenreIdQuery,
} from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useAvailableItems } from "src/hooks/useAvailability";
import useAutomaticMediaAssets, { tmdbImageUrl } from "src/hooks/useAutomaticMediaAssets";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import TrailerPlayer from "src/components/TrailerPlayer";
import TrailerAudioButton from "src/components/TrailerAudioButton";
import VideoItemWithHover from "src/components/VideoItemWithHover";

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

export async function loader() {
  return null;
}

function mediaImage(...values: any[]) {
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
  }, [mediaId, typeSlug]);

  useEffect(() => {
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
          }).slice(0, 30)
        );
      });
    };
    if ("requestIdleCallback" in window) idleId = (window as any).requestIdleCallback(load, { timeout: 2200 });
    else timer = window.setTimeout(load, 1000);
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
  const logoUrl = mediaImage(automaticAssets?.logo_path, automaticAssets?.logo, detail?.netflix_logo_url, detail?.logo_path);
  const backdropUrl = mediaImage(
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

  const metadataItems = [
    isTV ? { text: "Serie" } : { text: "Film" },
    genres[0] ? { text: genres[0] } : null,
    yearFrom(detail) ? { text: yearFrom(detail) } : null,
    { text: runtimeText(detail, isTV) },
    certification ? { text: certification, badge: true } : null,
  ].filter(Boolean);

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
    return (
      <Box sx={{ minHeight: "82vh", bgcolor: "#05090d", display: "grid", placeItems: "center" }}>
        <CircularProgress sx={{ color: "#e50914" }} />
      </Box>
    );
  }

  return (
    <Box data-testid="detail-page-redesign-v3" sx={{ bgcolor: "#05090d", color: "#fff", minHeight: "100vh", overflowX: "hidden", fontFamily: 'Netflix Sans, "Helvetica Neue", Arial, sans-serif' }}>
      <Box sx={{ position: "relative", height: "clamp(650px, 61.2vh, 840px)", minHeight: 650, overflow: "hidden", bgcolor: "#03070b" }}>
        {backdropUrl ? (
          <Box component="img" src={backdropUrl} alt="" decoding="async" fetchPriority="high" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 24%", opacity: showTrailer && trailerPlaying ? 0 : 1, transition: "opacity 360ms ease" }} />
        ) : null}

        {showTrailer && resolvedTrailer.url ? (
          <Box sx={{ position: "absolute", inset: 0, opacity: trailerPlaying ? 1 : 0, transition: "opacity 360ms ease", pointerEvents: "none" }}>
            <TrailerPlayer key={resolvedTrailer.url} videoKey={resolvedTrailer.url} muted={muted} playing loop zoom={1} onPlaying={() => setTrailerPlaying(true)} onError={() => { setShowTrailer(false); setTrailerPlaying(false); }} />
          </Box>
        ) : null}

        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(3,7,11,.96) 0%, rgba(3,7,11,.74) 29%, rgba(3,7,11,.24) 56%, rgba(3,7,11,.08) 78%)" }} />
        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, #05090d 0%, rgba(5,9,13,.88) 7%, rgba(5,9,13,.06) 38%)" }} />

        <Box sx={{ position: "absolute", left: { xs: "5vw", md: "4vw" }, bottom: { xs: 94, md: 106 }, zIndex: 4, width: { xs: "90vw", sm: "70vw", md: "min(640px, 45vw)" } }}>
          {logoUrl ? (
            <Box component="img" src={logoUrl} alt={title} decoding="async" sx={{ display: "block", width: "auto", maxWidth: "min(540px, 42vw)", maxHeight: 190, objectFit: "contain", objectPosition: "left center", mb: 2.2 }} />
          ) : (
            <Typography sx={{ fontSize: "clamp(40px, 5.1vw, 74px)", fontWeight: 900, lineHeight: .94, letterSpacing: "-.045em", mb: 2.2, textShadow: "0 4px 24px rgba(0,0,0,.5)" }}>{title}</Typography>
          )}

          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1.15} sx={{ alignItems: "center", mb: 1.8, color: "rgba(255,255,255,.84)" }}>
            {metadataItems.map((item: any, index: number) => (
              <Stack key={`${item.text}-${index}`} direction="row" spacing={1.15} sx={{ alignItems: "center" }}>
                {index ? <Box component="span" sx={{ color: "rgba(255,255,255,.7)" }}>•</Box> : null}
                <Box component="span" sx={{ fontSize: 16.5, fontWeight: 580, px: item.badge ? 1 : 0, py: item.badge ? .15 : 0, border: item.badge ? "1px solid rgba(255,255,255,.5)" : "none", borderRadius: item.badge ? "4px" : 0 }}>{item.text}</Box>
              </Stack>
            ))}
          </Stack>

          <Typography sx={{ fontWeight: 800, fontSize: 17.5, mb: .65 }}>{progressItem ? "Continua a guardare" : isTV ? "Guarda S1:E1" : "Riproduci"}</Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1.4 }}>
            <Box sx={{ width: 250, maxWidth: "42vw", height: 5, borderRadius: 999, bgcolor: "rgba(255,255,255,.18)", overflow: "hidden" }}><Box sx={{ width: `${progressItem ? progressPercent : 0}%`, height: "100%", bgcolor: "#e50914", transition: "width 250ms ease" }} /></Box>
            {progressItem ? <Typography sx={{ fontSize: 15.5, color: "rgba(255,255,255,.76)" }}>{isTV ? `S${Number(progressItem.season || 1)}:E${Number(progressItem.episode || 1)} • ` : ""}{remainingSeconds ? `${secondsText(remainingSeconds)} rimanenti` : "Riprendi"}</Typography> : null}
          </Stack>

          <Button onClick={goPlay} onMouseEnter={() => warmPlayback(typeSlug, mediaId, isTV ? Number(progressItem?.season || 1) : 1, isTV ? Number(progressItem?.episode || 1) : 1)} startIcon={<PlayArrowIcon sx={{ fontSize: 32 }} />} sx={{ borderRadius: "8px", px: 2.6, py: 1.15, fontSize: 17.5, fontWeight: 850, bgcolor: "#fff", color: "#000", textTransform: "none", "&:hover": { bgcolor: "rgba(255,255,255,.86)", transform: "translateY(-1px)" } }}>
            {progressItem ? "Continua a guardare" : isTV ? "Guarda S1:E1" : "Riproduci"}
          </Button>
        </Box>

        {resolvedTrailer.url ? <Box sx={{ position: "absolute", right: { xs: 18, md: 44 }, bottom: 106, zIndex: 5 }}><TrailerAudioButton muted={muted} onToggle={() => setMuted((value) => !value)} testId="detail-hero-trailer-audio-toggle" /></Box> : null}
      </Box>

      <Box sx={{ position: "relative", mt: "-44px", zIndex: 10, pb: 10, background: "linear-gradient(180deg, #05090d 0%, #05090d 72%, #07101a 100%)" }}>
        <Box sx={{ position: "sticky", top: { xs: 56, md: 78 }, zIndex: 20, display: "flex", justifyContent: "center", px: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: .5, p: "5px 7px", borderRadius: "22px", bgcolor: "rgba(5,12,18,.94)", border: "1px solid rgba(255,255,255,.15)", boxShadow: "0 12px 32px rgba(0,0,0,.28)", backdropFilter: "blur(16px)" }}>
            {DETAIL_TABS.map((tab) => (
              <Button key={tab.id} onClick={() => setActiveTab(tab.id)} data-testid={`detail-tab-${tab.id}`} sx={{ color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,.72)", textTransform: "none", fontSize: { xs: 13, md: 15.5 }, fontWeight: activeTab === tab.id ? 750 : 500, borderRadius: "18px", height: 46, px: { xs: 1.8, md: 3.2 }, position: "relative", whiteSpace: "nowrap", bgcolor: activeTab === tab.id ? "rgba(255,255,255,.09)" : "transparent", "&:hover": { bgcolor: "rgba(255,255,255,.07)", color: "#fff" }, "&::after": { content: '""', position: "absolute", left: "20%", right: "20%", bottom: 5, height: 3, borderRadius: 999, bgcolor: activeTab === tab.id ? "#e50914" : "transparent", boxShadow: activeTab === tab.id ? "0 0 12px rgba(229,9,20,.55)" : "none" } }}>{tab.label}</Button>
            ))}
          </Box>
        </Box>

        <Box key={activeTab} sx={{ width: "min(1512px, 92vw)", maxWidth: 1512, mx: "auto", pt: 4.8, animation: "detailTabIn 220ms cubic-bezier(.22,.61,.36,1) both", "@keyframes detailTabIn": { from: { opacity: 0, transform: "translateY(14px)" }, to: { opacity: 1, transform: "translateY(0)" } } }}>
          {activeTab === "overview" ? (
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1.35fr .65fr" }, gap: 1.7 }}>
              <Box sx={{ borderRadius: "20px", border: "1px solid rgba(255,255,255,.11)", background: "linear-gradient(135deg, rgba(9,21,31,.92), rgba(5,15,22,.83))", boxShadow: "0 22px 70px rgba(0,0,0,.25)", p: { xs: 2.4, md: 3.4 } }}>
                <Typography sx={{ fontSize: "clamp(28px, 2.2vw, 38px)", fontWeight: 900, mb: 1.2 }}>Panoramica</Typography>
                {overview ? <Typography sx={{ fontSize: "clamp(16px, 1.35vw, 21px)", lineHeight: 1.52, color: "rgba(255,255,255,.84)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", mb: 2.1 }}>{overview}{overview.length > 260 ? " ... altro" : ""}</Typography> : <Typography sx={{ color: "rgba(255,255,255,.64)", mb: 2.1 }}>Trama non disponibile.</Typography>}
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 1.1 }}>
                  {[["Genere", genres[0] || "—"], ["Anno", yearFrom(detail) || "—"], [isTV ? "Stagioni" : "Durata", isTV ? String(detail?.number_of_seasons || "—") : runtimeText(detail, false)], ["Classificazione", certification || "—"]].map(([label, value]) => (
                    <Box key={label} sx={{ px: 1.5, py: 1.35, borderRadius: "13px", border: "1px solid rgba(255,255,255,.1)", bgcolor: "rgba(15,30,40,.48)", minHeight: 74 }}><Typography sx={{ fontSize: 12.5, color: "rgba(255,255,255,.54)", mb: .35 }}>{label}</Typography><Typography sx={{ fontSize: 16.5, fontWeight: 750 }}>{value}</Typography></Box>
                  ))}
                </Box>
              </Box>
              <Box sx={{ borderRadius: "20px", border: "1px solid rgba(255,255,255,.11)", background: "linear-gradient(135deg, rgba(10,25,36,.92), rgba(5,15,22,.85))", boxShadow: "0 22px 70px rgba(0,0,0,.25)", p: 2.5 }}><Typography sx={{ fontSize: 24, fontWeight: 850, mb: 1 }}>Dettagli</Typography><Typography sx={{ color: "rgba(255,255,255,.62)", mb: .7 }}>Tipo</Typography><Typography sx={{ fontWeight: 700, mb: 1.5 }}>{isTV ? "Serie TV" : "Film"}</Typography><Typography sx={{ color: "rgba(255,255,255,.62)", mb: .7 }}>Genere</Typography><Typography sx={{ fontWeight: 700, mb: 1.5 }}>{genres.slice(0, 3).join(", ") || "—"}</Typography><Typography sx={{ color: "rgba(255,255,255,.62)", mb: .7 }}>Titolo</Typography><Typography sx={{ fontWeight: 700 }}>{title || "—"}</Typography></Box>
            </Box>
          ) : null}

          {activeTab === "trailers" ? (
            <Box><Typography sx={{ fontSize: "clamp(28px, 2.4vw, 39px)", fontWeight: 900, letterSpacing: ".01em", textTransform: "uppercase", mb: .6 }}>Trailer & altro</Typography><Typography sx={{ fontSize: 17, color: "rgba(255,255,255,.68)", mb: 2.8 }}>Scopri trailer e contenuti video disponibili per questo titolo.</Typography>{trailerItems.length ? <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }, gap: 1.6 }}>{trailerItems.map((item: any, index: number) => <Box key={item.url} onClick={() => { setModalMuted(false); setModalTrailerUrl(item.url); }} sx={{ cursor: "pointer", borderRadius: "18px", overflow: "hidden", bgcolor: "rgba(9,21,31,.84)", border: "1px solid rgba(255,255,255,.13)", boxShadow: "0 18px 46px rgba(0,0,0,.24)", transition: "transform 180ms ease, border-color 180ms ease", "&:hover": { transform: "translateY(-3px)", borderColor: "rgba(255,255,255,.26)" } }}><Box sx={{ position: "relative", aspectRatio: "16 / 9", bgcolor: "#071018", overflow: "hidden" }}>{backdropUrl ? <Box component="img" src={backdropUrl} alt="" loading="lazy" decoding="async" sx={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: index % 2 ? "center" : "center 30%", filter: index ? "brightness(.78)" : "none" }} /> : null}<Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,.44), rgba(0,0,0,.03) 55%)" }} /><Box sx={{ position: "absolute", left: 18, bottom: 16, width: 48, height: 48, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "rgba(9,16,24,.62)", border: "1px solid rgba(255,255,255,.78)", backdropFilter: "blur(8px)" }}><PlayArrowIcon sx={{ fontSize: 30 }} /></Box></Box><Box sx={{ p: 2.1 }}><Typography sx={{ fontSize: 19, fontWeight: 850, mb: .35 }}>{item.label}</Typography><Typography sx={{ fontSize: 14.2, color: "rgba(255,255,255,.6)" }}>{item.source ? `Fonte: ${item.source}` : "Riproduci il trailer"}</Typography></Box></Box>)}</Box> : <Box sx={{ minHeight: 240, borderRadius: "20px", border: "1px solid rgba(255,255,255,.1)", bgcolor: "rgba(9,21,31,.7)", display: "grid", placeItems: "center", textAlign: "center", px: 3 }}><Box><Typography sx={{ fontSize: 24, fontWeight: 850, mb: .7 }}>Trailer non disponibile</Typography><Typography sx={{ color: "rgba(255,255,255,.62)" }}>Il sistema continuerà a cercare automaticamente una sorgente disponibile.</Typography></Box></Box>}</Box>
          ) : null}

          {activeTab === "download" ? <Box sx={{ display: "grid", placeItems: "center", minHeight: 360 }}><Box sx={{ width: "min(900px, 100%)", minHeight: 290, borderRadius: "22px", border: "1px solid rgba(255,255,255,.13)", bgcolor: "rgba(9,21,31,.78)", boxShadow: "0 24px 80px rgba(0,0,0,.25)", backdropFilter: "blur(16px)", display: "grid", placeItems: "center", textAlign: "center", px: 4, py: 5 }}><Box><Box sx={{ width: 112, height: 112, mx: "auto", mb: 2.4, borderRadius: "50%", display: "grid", placeItems: "center", border: "1px solid rgba(122,188,255,.46)", bgcolor: "rgba(27,80,126,.15)" }}><DownloadRoundedIcon sx={{ fontSize: 55, color: "#9fd0ff" }} /></Box><Typography sx={{ fontSize: "clamp(27px, 2.3vw, 38px)", fontWeight: 900, mb: 1 }}>Download non ancora disponibile</Typography><Typography sx={{ fontSize: "clamp(15px, 1.25vw, 19px)", color: "rgba(255,255,255,.66)" }}>Stiamo lavorando per renderlo disponibile nelle prossime versioni.</Typography></Box></Box></Box> : null}

          {activeTab === "similar" ? <Box><Typography sx={{ fontSize: "clamp(28px, 2.4vw, 39px)", fontWeight: 900, letterSpacing: ".01em", textTransform: "uppercase", mb: 2.2 }}>Titoli simili</Typography>{relatedItems.length ? <Box sx={{ display: "flex", gap: 1.45, overflowX: "auto", overflowY: "visible", pb: 4.5, scrollSnapType: "x proximity", "&::-webkit-scrollbar": { height: 5 }, "&::-webkit-scrollbar-thumb": { bgcolor: "rgba(255,255,255,.18)", borderRadius: 999 } }}>{relatedItems.slice(0, 30).map((item: any) => <Box key={item.id || item.tmdbId} sx={{ flex: "0 0 clamp(235px, 18vw, 305px)", scrollSnapAlign: "start" }}><VideoItemWithHover video={{ ...item, type: typeSlug, media_type: typeSlug }} mediaType={type} /></Box>)}</Box> : <Box sx={{ minHeight: 240, display: "grid", placeItems: "center", border: "1px solid rgba(255,255,255,.1)", borderRadius: "20px", bgcolor: "rgba(9,21,31,.7)" }}><Typography sx={{ color: "rgba(255,255,255,.62)" }}>Nessun titolo simile disponibile.</Typography></Box>}</Box> : null}
        </Box>
      </Box>

      {modalTrailerUrl ? <Box role="dialog" aria-modal="true" aria-label="Trailer" onClick={() => setModalTrailerUrl(null)} sx={{ position: "fixed", inset: 0, zIndex: 1500, bgcolor: "rgba(0,0,0,.86)", display: "grid", placeItems: "center", p: { xs: 1.5, md: 4 }, backdropFilter: "blur(12px)", animation: "detailModalIn 180ms ease-out", "@keyframes detailModalIn": { from: { opacity: 0 }, to: { opacity: 1 } } }}><Box onClick={(event) => event.stopPropagation()} sx={{ position: "relative", width: "min(1180px, 96vw)", aspectRatio: "16 / 9", bgcolor: "#000", borderRadius: "18px", overflow: "hidden", boxShadow: "0 40px 110px rgba(0,0,0,.65)", border: "1px solid rgba(255,255,255,.16)" }}><TrailerPlayer videoKey={modalTrailerUrl} muted={modalMuted} playing loop={false} zoom={1} onEnded={() => setModalTrailerUrl(null)} onError={() => setModalTrailerUrl(null)} /><IconButton onClick={() => setModalTrailerUrl(null)} aria-label="Chiudi trailer" sx={{ position: "absolute", top: 14, right: 14, zIndex: 3, bgcolor: "rgba(0,0,0,.62)", color: "#fff", border: "1px solid rgba(255,255,255,.32)", "&:hover": { bgcolor: "rgba(0,0,0,.82)" } }}><CloseIcon /></IconButton><Box sx={{ position: "absolute", right: 14, bottom: 14, zIndex: 3 }}><TrailerAudioButton muted={modalMuted} onToggle={() => setModalMuted((value) => !value)} testId="detail-modal-trailer-audio-toggle" /></Box></Box></Box> : null}
    </Box>
  );
}

export default Component;
