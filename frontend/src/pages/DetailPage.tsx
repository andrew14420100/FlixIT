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

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const HERO_TRAILER_DELAY = 3000;
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
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}min` : ""}` : `${minutes}min`;
}

function certificationText(detail: any) {
  const direct = detail?.certification || detail?.content_rating || detail?.contentRating;
  if (direct) {
    const text = String(direct).trim();
    return /^\d{1,2}$/.test(text) ? `${text}+` : text;
  }
  const ratings = detail?.content_ratings?.results;
  if (Array.isArray(ratings)) {
    const hit = ratings.find((item: any) => item?.iso_3166_1 === "IT")
      || ratings.find((item: any) => item?.iso_3166_1 === "US")
      || ratings.find((item: any) => item?.rating);
    if (hit?.rating) {
      const text = String(hit.rating).trim();
      return /^\d{1,2}$/.test(text) ? `${text}+` : text;
    }
  }
  return "";
}

function secondsText(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  if (safe >= 3600) {
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    return `${hours}h${minutes ? ` ${minutes}min` : ""}`;
  }
  return `${Math.max(1, Math.ceil(safe / 60))} min`;
}

function directTrailerUrl(value: any) {
  const raw = typeof value === "string"
    ? value
    : value?.url || value?.trailer_url || value?.manifest_url || value?.stream_url;
  const text = String(raw || "").trim();
  return /^https?:\/\//i.test(text) || text.startsWith("/") ? text : null;
}

function cacheResolvedStream(typeSlug: string, id: number, season: number, episode: number, payload: any) {
  if (!payload?.success || !payload?.stream) return;
  try {
    sessionStorage.setItem(
      `${WATCH_STREAM_CACHE_PREFIX}${typeSlug}:${id}:${typeSlug === "tv" ? season || 1 : 0}:${typeSlug === "tv" ? episode || 1 : 0}`,
      JSON.stringify({
        stream: payload.stream,
        type: payload.type || "hls",
        source: payload.source,
        savedAt: Date.now(),
      })
    );
  } catch {}
}

async function warmPlayback(typeSlug: string, id: number, season = 1, episode = 1) {
  const path = typeSlug === "tv"
    ? `${API_URL}/api/player/tv/${id}/${season}/${episode}`
    : `${API_URL}/api/player/movie/${id}`;
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
  const automaticAssets = useAutomaticMediaAssets(
    { ...(detail || {}), id: mediaId, type: typeSlug },
    type,
    !!mediaId
  );
  const { items: continueWatchingItems } = useContinueWatching();
  const resolvedTrailer = useResolvedTrailer(type, mediaId, !!mediaId);

  const [activeTab, setActiveTab] = useState("overview");
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [modalTrailerUrl, setModalTrailerUrl] = useState<string | null>(null);
  const [modalMuted, setModalMuted] = useState(false);
  const [relatedPool, setRelatedPool] = useState<any[]>([]);

  const progressItem = useMemo(
    () => continueWatchingItems.find(
      (item: any) => Number(item?.tmdb_id) === mediaId && item?.media_type === typeSlug
    ),
    [continueWatchingItems, mediaId, typeSlug]
  );

  const progressPercent = progressItem?.duration > 0
    ? Math.min(100, Math.max(0, (Number(progressItem.progress || 0) / Number(progressItem.duration)) * 100))
    : 0;
  const remainingSeconds = progressItem?.duration > 0
    ? Math.max(0, Number(progressItem.duration) - Number(progressItem.progress || 0))
    : 0;

  useEffect(() => {
    if (mediaId) getVideoDetail({ mediaType: type, id: mediaId });
  }, [getVideoDetail, mediaId, type]);

  useEffect(() => {
    setActiveTab("overview");
    setShowTrailer(false);
    setTrailerPlaying(false);
    setMuted(true);
    setModalTrailerUrl(null);
    setRelatedPool([]);
  }, [mediaId, typeSlug]);

  useEffect(() => {
    if (!resolvedTrailer.url) return;
    const timer = window.setTimeout(() => setShowTrailer(true), HERO_TRAILER_DELAY);
    return () => window.clearTimeout(timer);
  }, [resolvedTrailer.url, mediaId]);

  useEffect(() => {
    const genreId = Number(detail?.genres?.[0]?.id || 0);
    if (!genreId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      Promise.all([
        getGenrePage({ mediaType: type, genreId, page: 1 }).unwrap().catch(() => null),
        getGenrePage({ mediaType: type, genreId, page: 2 }).unwrap().catch(() => null),
      ]).then((pages) => {
        if (cancelled) return;
        const seen = new Set<number>();
        const next = pages
          .flatMap((page: any) => page?.results || [])
          .filter((item: any) => {
            const itemId = Number(item?.id || item?.tmdbId || 0);
            if (!itemId || itemId === mediaId || seen.has(itemId)) return false;
            seen.add(itemId);
            return true;
          })
          .slice(0, 18);
        setRelatedPool(next);
      });
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [detail?.genres, getGenrePage, mediaId, type]);

  const relatedItems = useAvailableItems(relatedPool, typeSlug);
  const title = detail?.title || detail?.name || automaticAssets?.title || "";
  const genres = (detail?.genres || []).map((genre: any) => genre?.name).filter(Boolean);
  const overview = String(detail?.overview || "").trim();
  const certification = certificationText(detail);
  const logoUrl = imageUrl(
    automaticAssets?.logo_path,
    automaticAssets?.logo,
    detail?.netflix_logo_url,
    detail?.logo_path
  );
  const backdropUrl = imageUrl(
    automaticAssets?.detail_backdrop_path,
    automaticAssets?.hero_backdrop_path,
    automaticAssets?.backdrop_path,
    detail?.netflix_artwork_url,
    detail?.backdrop_path
  );

  const goPlay = useCallback(() => {
    const season = isTV ? Number(progressItem?.season || 1) : 1;
    const episode = isTV ? Number(progressItem?.episode || 1) : 1;
    warmPlayback(typeSlug, mediaId, season, episode);
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${mediaId}${isTV ? `?s=${season}&e=${episode}` : ""}`);
  }, [isTV, mediaId, navigate, progressItem?.episode, progressItem?.season, typeSlug]);

  const trailerItems = useMemo(() => {
    const result: any[] = [];
    const seen = new Set<string>();
    const add = (value: any, label: string, source?: string) => {
      const url = directTrailerUrl(value);
      if (!url || seen.has(url)) return;
      seen.add(url);
      result.push({ url, label, source });
    };
    add(resolvedTrailer.url, "Trailer ufficiale", resolvedTrailer.source);
    [detail?.trailers, detail?.videos, detail?.trailer_alternatives, automaticAssets?.trailers, automaticAssets?.videos]
      .forEach((items) => {
        if (!Array.isArray(items)) return;
        items.forEach((item: any, index: number) => {
          add(item, String(item?.label || item?.title || item?.name || `Video ${index + 1}`), item?.source);
        });
      });
    return result.slice(0, 8);
  }, [automaticAssets?.trailers, automaticAssets?.videos, detail?.trailer_alternatives, detail?.trailers, detail?.videos, resolvedTrailer.source, resolvedTrailer.url]);

  if (!detail) {
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#00101c", display: "grid", placeItems: "center" }}>
        <CircularProgress sx={{ color: "#e50914" }} />
      </Box>
    );
  }

  const heroLabel = progressItem ? "Continua a guardare" : isTV ? "Guarda S1:E1" : "Riproduci";
  const progressMeta = progressItem
    ? `${isTV ? `S${Number(progressItem.season || 1)}:E${Number(progressItem.episode || 1)} - ` : ""}${secondsText(remainingSeconds)} rimanenti`
    : "";
  const episodeTitle = progressItem?.episode_title || progressItem?.episode_name || progressItem?.name || "";
  const resumeTitle = progressItem
    ? `${isTV ? `S${Number(progressItem.season || 1)}:E${Number(progressItem.episode || 1)}` : title}${episodeTitle ? ` - ${episodeTitle}` : ""}`
    : isTV ? "S1:E1" : title;
  const plot = overview.length > 300
    ? `${overview.slice(0, 300).replace(/\s+\S*$/, "").trim()}… altro`
    : overview;

  const infoCards = [
    {
      label: "Genere",
      value: genres[0] || "—",
      icon: <TheaterComedyOutlinedIcon sx={{ fontSize: { xs: 27, md: 32 } }} />,
    },
    {
      label: "Anno",
      value: yearFrom(detail) || "—",
      icon: <CalendarMonthOutlinedIcon sx={{ fontSize: { xs: 27, md: 32 } }} />,
    },
    {
      label: isTV ? "Stagioni" : "Durata",
      value: isTV ? String(detail?.number_of_seasons || "—") : runtimeText(detail, false),
      icon: <LayersOutlinedIcon sx={{ fontSize: { xs: 27, md: 32 } }} />,
    },
    {
      label: "Classificazione",
      value: certification || "—",
      icon: (
        <Box sx={{ border: "2px solid currentColor", borderRadius: "4px", px: .55, py: .08, fontSize: 16, fontWeight: 850, lineHeight: 1.3 }}>
          {certification || "—"}
        </Box>
      ),
    },
  ];

  const panelStyle = {
    border: "1px solid rgba(94,132,154,.34)",
    background: "linear-gradient(145deg, rgba(2,22,36,.94), rgba(1,17,29,.90))",
    boxShadow: "0 20px 54px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.018)",
    backdropFilter: "blur(14px)",
  };

  const tabMotion = {
    animation: "detailFreshTabIn 210ms cubic-bezier(.22,.61,.36,1) both",
    "@keyframes detailFreshTabIn": {
      from: { opacity: 0, transform: "translateY(10px)" },
      to: { opacity: 1, transform: "translateY(0)" },
    },
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  };

  return (
    <Box
      data-testid="detail-page-fresh-rebuild"
      sx={{
        minHeight: "100vh",
        position: "relative",
        overflowX: "hidden",
        color: "#fff",
        bgcolor: "#00101c",
        fontFamily: '"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
        background: "radial-gradient(ellipse at 51% 43%, rgba(0,55,84,.30) 0%, rgba(0,27,44,.24) 34%, transparent 62%), linear-gradient(180deg,#00111f 0%,#00101d 45%,#000812 100%)",
      }}
    >
      <Box
        sx={{
          position: "relative",
          height: { xs: "clamp(585px,74vh,720px)", md: "clamp(510px,54.4vh,640px)" },
          minHeight: { xs: 585, md: 510 },
          overflow: "hidden",
          bgcolor: "#010b12",
        }}
      >
        {backdropUrl ? (
          <Box
            component="img"
            src={backdropUrl}
            alt=""
            decoding="async"
            fetchPriority="high"
            sx={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: { xs: "61% center", md: "center 29%" },
              opacity: showTrailer && trailerPlaying ? 0 : 1,
              transition: "opacity 380ms ease",
            }}
          />
        ) : null}

        {showTrailer && resolvedTrailer.url ? (
          <Box sx={{ position: "absolute", inset: 0, opacity: trailerPlaying ? 1 : 0, transition: "opacity 380ms ease", pointerEvents: "none" }}>
            <TrailerPlayer
              key={resolvedTrailer.url}
              videoKey={resolvedTrailer.url}
              muted={muted}
              playing
              loop={false}
              zoom={1}
              onPlaying={() => setTrailerPlaying(true)}
              onEnded={() => {
                setShowTrailer(false);
                setTrailerPlaying(false);
              }}
              onError={() => {
                setShowTrailer(false);
                setTrailerPlaying(false);
              }}
            />
          </Box>
        ) : null}

        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(0,5,10,.98) 0%, rgba(0,6,11,.90) 16%, rgba(0,8,14,.64) 31%, rgba(0,8,14,.24) 47%, rgba(0,8,14,.03) 67%)" }} />
        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, #00121f 0%, rgba(0,18,31,.90) 4%, rgba(0,15,27,.40) 17%, rgba(0,10,18,0) 39%)" }} />
        <Box sx={{ position: "absolute", inset: 0, boxShadow: "inset 0 -48px 80px rgba(0,13,24,.20)" }} />

        <Box
          sx={{
            position: "absolute",
            left: { xs: "5vw", md: "3.75vw" },
            bottom: { xs: 48, md: 42 },
            zIndex: 5,
            width: { xs: "90vw", sm: "68vw", md: "min(520px,36vw)" },
          }}
        >
          {logoUrl ? (
            <Box
              component="img"
              src={logoUrl}
              alt={title}
              decoding="async"
              sx={{
                display: "block",
                width: "auto",
                maxWidth: { xs: "min(80vw,460px)", md: "min(460px,31vw)" },
                maxHeight: { xs: 178, md: 164 },
                objectFit: "contain",
                objectPosition: "left center",
                mb: { xs: 1.6, md: 1.45 },
                filter: "drop-shadow(0 7px 20px rgba(0,0,0,.32))",
              }}
            />
          ) : (
            <Typography
              sx={{
                fontSize: { xs: "clamp(45px,12vw,72px)", md: "clamp(48px,5.1vw,78px)" },
                lineHeight: .87,
                fontWeight: 900,
                letterSpacing: "-.045em",
                mb: 1.5,
                textShadow: "0 6px 24px rgba(0,0,0,.50)",
              }}
            >
              {title}
            </Typography>
          )}

          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1.05} sx={{ alignItems: "center", mb: 1.3 }}>
            {[isTV ? "Serie" : "Film", genres[0], yearFrom(detail), runtimeText(detail, isTV)]
              .filter(Boolean)
              .map((value, index) => (
                <Stack key={`${value}-${index}`} direction="row" spacing={1.05} sx={{ alignItems: "center" }}>
                  {index ? <Box component="span" sx={{ color: "rgba(255,255,255,.88)", fontSize: 16 }}>•</Box> : null}
                  <Typography component="span" sx={{ fontSize: { xs: 14.5, md: 16 }, fontWeight: 500, color: "rgba(255,255,255,.94)" }}>
                    {value}
                  </Typography>
                </Stack>
              ))}
            {certification ? (
              <>
                <Box component="span" sx={{ color: "rgba(255,255,255,.88)", fontSize: 16 }}>•</Box>
                <Box component="span" sx={{ border: "1px solid rgba(255,255,255,.84)", borderRadius: "4px", px: .65, py: .08, fontSize: { xs: 13.5, md: 15 }, fontWeight: 650, lineHeight: 1.35 }}>
                  {certification}
                </Box>
              </>
            ) : null}
          </Stack>

          <Typography sx={{ fontSize: { xs: 15.5, md: 17 }, fontWeight: 800, lineHeight: 1.1, mb: .72 }}>
            {heroLabel}
          </Typography>

          <Stack direction="row" spacing={1.55} sx={{ alignItems: "center", mb: 1.25 }}>
            <Box sx={{ width: { xs: 220, md: 266 }, maxWidth: "49vw", height: 7, borderRadius: 999, bgcolor: "rgba(255,255,255,.34)", overflow: "hidden" }}>
              <Box sx={{ width: `${progressItem ? Math.max(4, progressPercent) : 0}%`, height: "100%", bgcolor: "#ff111b", borderRadius: 999, transition: "width 220ms ease" }} />
            </Box>
            {progressItem ? (
              <Typography sx={{ fontSize: { xs: 13.5, md: 15.5 }, color: "rgba(255,255,255,.95)", whiteSpace: "nowrap" }}>
                {progressMeta}
              </Typography>
            ) : null}
          </Stack>

          <Button
            data-testid="detail-play"
            onClick={goPlay}
            onMouseEnter={() => warmPlayback(typeSlug, mediaId, Number(progressItem?.season || 1), Number(progressItem?.episode || 1))}
            startIcon={<PlayArrowIcon sx={{ fontSize: { xs: 28, md: 31 } }} />}
            sx={{
              minWidth: { xs: 240, md: 274 },
              height: { xs: 46, md: 48 },
              px: 2.7,
              borderRadius: "10px",
              bgcolor: "#fff",
              color: "#080808",
              fontSize: { xs: 15.5, md: 17 },
              fontWeight: 850,
              textTransform: "none",
              boxShadow: "0 9px 28px rgba(0,0,0,.30)",
              transition: "transform 150ms ease, background-color 150ms ease",
              "&:hover": { bgcolor: "rgba(255,255,255,.88)", transform: "translateY(-1px)" },
            }}
          >
            {heroLabel}
          </Button>
        </Box>

        {showTrailer && resolvedTrailer.url && trailerPlaying ? (
          <Box sx={{ position: "absolute", right: { xs: 18, md: 30 }, bottom: { xs: 44, md: 36 }, zIndex: 8 }}>
            <TrailerAudioButton muted={muted} onToggle={() => setMuted((value) => !value)} testId="detail-hero-audio-toggle" />
          </Box>
        ) : null}
      </Box>

      <Box sx={{ position: "relative", zIndex: 20, mt: { xs: "-24px", md: "-25px" }, px: 2 }}>
        <Box
          role="tablist"
          aria-label="Sezioni dettaglio"
          sx={{
            mx: "auto",
            width: { xs: "100%", sm: "fit-content" },
            maxWidth: 680,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: 52,
            borderRadius: "28px",
            bgcolor: "rgba(2,21,34,.94)",
            border: "1px solid rgba(101,140,163,.38)",
            boxShadow: "0 14px 40px rgba(0,0,0,.24)",
            backdropFilter: "blur(18px)",
            overflowX: "auto",
          }}
        >
          {DETAIL_TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <Button
                key={tab.id}
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                data-testid={`detail-tab-${tab.id}`}
                sx={{
                  position: "relative",
                  minWidth: { xs: 132, md: 164 },
                  height: 50,
                  px: { xs: 1.8, md: 2.6 },
                  borderRadius: "25px",
                  color: selected ? "#fff" : "rgba(255,255,255,.88)",
                  bgcolor: selected ? "rgba(255,255,255,.035)" : "transparent",
                  fontSize: { xs: 13.5, md: 15.5 },
                  fontWeight: selected ? 700 : 500,
                  textTransform: "none",
                  whiteSpace: "nowrap",
                  "&:hover": { bgcolor: "rgba(255,255,255,.045)" },
                  "&::after": {
                    content: '""',
                    position: "absolute",
                    left: "25%",
                    right: "25%",
                    bottom: 5,
                    height: 4,
                    borderRadius: 999,
                    bgcolor: selected ? "#ff101a" : "transparent",
                    boxShadow: selected ? "0 0 11px rgba(255,16,26,.50)" : "none",
                  },
                }}
              >
                {tab.label}
              </Button>
            );
          })}
        </Box>
      </Box>

      <Box sx={{ position: "relative", minHeight: 390, pb: 10 }}>
        {backdropUrl ? (
          <Box
            component="img"
            src={backdropUrl}
            alt=""
            aria-hidden="true"
            sx={{
              position: "absolute",
              left: "-3vw",
              right: "-3vw",
              top: -80,
              width: "106vw",
              height: 520,
              objectFit: "cover",
              objectPosition: "center 66%",
              opacity: .10,
              filter: "blur(2px) saturate(.85) brightness(.62)",
              pointerEvents: "none",
              WebkitMaskImage: "linear-gradient(180deg, rgba(0,0,0,.90) 0%, rgba(0,0,0,.45) 52%, transparent 100%)",
              maskImage: "linear-gradient(180deg, rgba(0,0,0,.90) 0%, rgba(0,0,0,.45) 52%, transparent 100%)",
            }}
          />
        ) : null}
        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,16,28,.22) 0%, rgba(0,8,15,.72) 70%, rgba(0,7,13,.96) 100%)", pointerEvents: "none" }} />

        <Box
          key={activeTab}
          sx={{
            position: "relative",
            zIndex: 2,
            width: "min(1504px,90vw)",
            mx: "auto",
            pt: { xs: 3.2, md: 4.15 },
            ...tabMotion,
          }}
        >
          {activeTab === "overview" ? (
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1.96fr 1.04fr" }, gap: { xs: 2, md: 2.15 }, alignItems: "stretch" }}>
              <Box
                sx={{
                  ...panelStyle,
                  minHeight: { md: 315 },
                  p: { xs: 2.5, md: "20px 38px 24px" },
                  borderRadius: "18px",
                }}
              >
                <Typography sx={{ fontSize: { xs: 27, md: 32 }, fontWeight: 850, lineHeight: 1.1, mb: 1.35 }}>
                  Panoramica
                </Typography>
                <Box sx={{ height: 1, bgcolor: "rgba(150,179,197,.23)", mb: 1.6 }} />
                <Typography
                  sx={{
                    minHeight: { md: 103 },
                    fontSize: { xs: 16, md: 20 },
                    lineHeight: 1.62,
                    color: "rgba(255,255,255,.92)",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {plot || "Nessuna trama disponibile."}
                </Typography>
                <Box sx={{ height: 1, bgcolor: "rgba(150,179,197,.23)", mt: 1.2, mb: 2.0 }} />
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4,1fr)" }, gap: { xs: 1, md: 1.55 } }}>
                  {infoCards.map((item) => (
                    <Box
                      key={item.label}
                      sx={{
                        minHeight: 78,
                        px: { xs: 1.25, md: 1.55 },
                        py: 1.25,
                        borderRadius: "13px",
                        display: "flex",
                        alignItems: "center",
                        gap: 1.35,
                        bgcolor: "rgba(5,24,38,.72)",
                        border: "1px solid rgba(98,136,158,.34)",
                      }}
                    >
                      <Box sx={{ width: 38, flex: "0 0 38px", display: "grid", placeItems: "center", color: "#fff" }}>
                        {item.icon}
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: 12.5, lineHeight: 1.15, color: "rgba(255,255,255,.61)", mb: .32 }}>
                          {item.label}
                        </Typography>
                        <Typography sx={{ fontSize: { xs: 15.5, md: 17 }, fontWeight: 800, lineHeight: 1.08, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {item.value}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>

              <Box
                sx={{
                  ...panelStyle,
                  minHeight: { md: 315 },
                  p: { xs: 2.5, md: "21px 29px 24px" },
                  borderRadius: "18px",
                }}
              >
                <Typography sx={{ fontSize: { xs: 23, md: 26 }, fontWeight: 850, lineHeight: 1.1, mb: 1.55 }}>
                  Continua a guardare
                </Typography>
                <Box
                  onClick={goPlay}
                  sx={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: { xs: "16 / 7", md: "3.22 / 1" },
                    maxHeight: 143,
                    overflow: "hidden",
                    borderRadius: "10px",
                    bgcolor: "#07131e",
                    border: "1px solid rgba(116,155,177,.38)",
                    cursor: "pointer",
                  }}
                >
                  {backdropUrl ? (
                    <Box component="img" src={backdropUrl} alt="" loading="lazy" decoding="async" sx={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 29%" }} />
                  ) : null}
                  <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,rgba(0,12,20,.18),rgba(0,8,14,.02))" }} />
                  <Box sx={{ position: "absolute", left: 22, top: "50%", transform: "translateY(-50%)", width: 48, height: 48, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "rgba(28,64,94,.80)", border: "1px solid rgba(255,255,255,.92)", boxShadow: "0 6px 18px rgba(0,0,0,.28)" }}>
                    <PlayArrowIcon sx={{ fontSize: 30 }} />
                  </Box>
                </Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ mt: 1.55 }}>
                  <Typography sx={{ fontSize: { xs: 14.5, md: 16 }, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {resumeTitle}
                  </Typography>
                  <Typography sx={{ fontSize: { xs: 13.5, md: 15.5 }, color: "rgba(255,255,255,.91)", whiteSpace: "nowrap" }}>
                    {progressItem ? `${secondsText(remainingSeconds)} rimanenti` : "Inizia"}
                  </Typography>
                </Stack>
                <Box sx={{ height: 7, mt: 1.25, borderRadius: 999, bgcolor: "rgba(255,255,255,.17)", overflow: "hidden" }}>
                  <Box sx={{ width: `${progressItem ? Math.max(4, progressPercent) : 0}%`, height: "100%", bgcolor: "#ff111b", borderRadius: 999 }} />
                </Box>
              </Box>
            </Box>
          ) : null}

          {activeTab === "trailers" ? (
            <Box sx={{ ...panelStyle, borderRadius: "18px", p: { xs: 2.5, md: 3.4 } }}>
              <Typography sx={{ fontSize: { xs: 27, md: 32 }, fontWeight: 850, mb: .55 }}>Trailer & altro</Typography>
              <Typography sx={{ fontSize: 16, color: "rgba(255,255,255,.68)", mb: 2.4 }}>Trailer e contenuti video disponibili per questo titolo.</Typography>
              {trailerItems.length ? (
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,1fr)", xl: "repeat(4,1fr)" }, gap: 1.5 }}>
                  {trailerItems.slice(0, 4).map((item: any, index: number) => (
                    <Box
                      key={item.url}
                      onClick={() => {
                        setModalMuted(false);
                        setModalTrailerUrl(item.url);
                      }}
                      sx={{ borderRadius: "13px", overflow: "hidden", bgcolor: "rgba(5,24,38,.72)", border: "1px solid rgba(98,136,158,.34)", cursor: "pointer", transition: "transform 160ms ease,border-color 160ms ease", "&:hover": { transform: "translateY(-3px)", borderColor: "rgba(154,184,202,.58)" } }}
                    >
                      <Box sx={{ position: "relative", aspectRatio: "16 / 8.1", overflow: "hidden", bgcolor: "#07131e" }}>
                        {backdropUrl ? <Box component="img" src={backdropUrl} alt="" loading="lazy" decoding="async" sx={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: index % 2 ? "58% center" : "center 29%", filter: index ? "brightness(.78)" : "none" }} /> : null}
                        <Box sx={{ position: "absolute", left: 17, bottom: 14, width: 44, height: 44, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "rgba(20,52,77,.84)", border: "1px solid rgba(255,255,255,.9)" }}>
                          <PlayArrowIcon sx={{ fontSize: 27 }} />
                        </Box>
                      </Box>
                      <Box sx={{ px: 1.7, py: 1.45 }}>
                        <Typography sx={{ fontSize: 17.5, fontWeight: 800 }}>{item.label}</Typography>
                        <Typography sx={{ mt: .35, fontSize: 13.5, color: "rgba(255,255,255,.62)" }}>{item.source || "Riproduci video"}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Box sx={{ minHeight: 220, display: "grid", placeItems: "center", textAlign: "center" }}>
                  <Typography sx={{ color: "rgba(255,255,255,.66)" }}>Trailer non disponibile.</Typography>
                </Box>
              )}
            </Box>
          ) : null}

          {activeTab === "download" ? (
            <Box sx={{ ...panelStyle, minHeight: 315, borderRadius: "18px", display: "grid", placeItems: "center", textAlign: "center", px: 3 }}>
              <Box>
                <Box sx={{ width: 100, height: 100, mx: "auto", mb: 2, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "rgba(26,78,118,.17)", border: "1px solid rgba(102,161,205,.52)" }}>
                  <DownloadRoundedIcon sx={{ fontSize: 50, color: "#a9d6f7" }} />
                </Box>
                <Typography sx={{ fontSize: { xs: 26, md: 34 }, fontWeight: 850, mb: .8 }}>Download non ancora disponibile</Typography>
                <Typography sx={{ fontSize: { xs: 15, md: 18 }, color: "rgba(255,255,255,.66)" }}>Stiamo lavorando per renderlo disponibile nelle prossime versioni.</Typography>
              </Box>
            </Box>
          ) : null}

          {activeTab === "similar" ? (
            <Box sx={{ ...panelStyle, borderRadius: "18px", p: { xs: 2.5, md: 3.4 } }}>
              <Typography sx={{ fontSize: { xs: 27, md: 32 }, fontWeight: 850, mb: 2 }}>Titoli simili</Typography>
              {relatedItems.length ? (
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,1fr)", md: "repeat(3,1fr)", xl: "repeat(6,1fr)" }, gap: 1.35 }}>
                  {relatedItems.slice(0, 6).map((item: any) => {
                    const itemId = Number(item?.id || item?.tmdbId || 0);
                    const itemType = item?.media_type === "movie" || item?.type === "movie" ? "movie" : item?.media_type === "tv" || item?.type === "tv" ? "tv" : typeSlug;
                    const itemTitle = item?.title || item?.name || "Titolo";
                    const art = imageUrl(item?.backdrop_url, item?.backdrop_path, item?.image_url, item?.poster_path) || backdropUrl;
                    return (
                      <Box
                        key={itemId || itemTitle}
                        onClick={() => itemId && navigate(`/browse/${itemType}/${itemId}`)}
                        sx={{ position: "relative", aspectRatio: "16 / 9", overflow: "hidden", borderRadius: "10px", bgcolor: "#07131e", border: "1px solid rgba(98,136,158,.30)", cursor: itemId ? "pointer" : "default", transition: "transform 160ms ease", "&:hover": { transform: itemId ? "translateY(-3px)" : "none" } }}
                      >
                        {art ? <Box component="img" src={art} alt={itemTitle} loading="lazy" decoding="async" sx={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(0deg,rgba(0,7,12,.90) 0%,rgba(0,7,12,.20) 45%,transparent 70%)" }} />
                        <Typography sx={{ position: "absolute", left: 13, right: 13, bottom: 11, fontSize: { xs: 15, md: 16.5 }, fontWeight: 850, lineHeight: 1.05, textShadow: "0 2px 10px rgba(0,0,0,.65)" }}>
                          {itemTitle}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              ) : (
                <Box sx={{ minHeight: 180, display: "grid", placeItems: "center" }}>
                  <Typography sx={{ color: "rgba(255,255,255,.64)" }}>Nessun titolo simile disponibile.</Typography>
                </Box>
              )}
            </Box>
          ) : null}
        </Box>
      </Box>

      {modalTrailerUrl ? (
        <Box
          role="dialog"
          aria-modal="true"
          aria-label="Trailer"
          onClick={() => setModalTrailerUrl(null)}
          sx={{ position: "fixed", inset: 0, zIndex: 1600, bgcolor: "rgba(0,0,0,.88)", display: "grid", placeItems: "center", p: { xs: 1.5, md: 4 }, backdropFilter: "blur(12px)" }}
        >
          <Box onClick={(event) => event.stopPropagation()} sx={{ position: "relative", width: "min(1180px,96vw)", aspectRatio: "16 / 9", bgcolor: "#000", borderRadius: "16px", overflow: "hidden", border: "1px solid rgba(255,255,255,.17)", boxShadow: "0 40px 110px rgba(0,0,0,.65)" }}>
            <TrailerPlayer videoKey={modalTrailerUrl} muted={modalMuted} playing loop={false} zoom={1} onEnded={() => setModalTrailerUrl(null)} onError={() => setModalTrailerUrl(null)} />
            <IconButton onClick={() => setModalTrailerUrl(null)} aria-label="Chiudi trailer" sx={{ position: "absolute", top: 14, right: 14, zIndex: 3, bgcolor: "rgba(0,0,0,.62)", color: "#fff", border: "1px solid rgba(255,255,255,.32)", "&:hover": { bgcolor: "rgba(0,0,0,.82)" } }}>
              <CloseIcon />
            </IconButton>
            <Box sx={{ position: "absolute", right: 14, bottom: 14, zIndex: 3 }}>
              <TrailerAudioButton muted={modalMuted} onToggle={() => setModalMuted((value) => !value)} testId="detail-modal-trailer-audio-toggle" />
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

export default Component;
