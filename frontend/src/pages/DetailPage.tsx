// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

import {
  useLazyGetAppendedVideosQuery,
  useLazyGetTVSeasonDetailsQuery,
  useLazyGetVideosByMediaTypeAndGenreIdQuery,
} from "src/store/slices/discover";
import { MEDIA_TYPE } from "src/types/Common";
import { MAIN_PATH } from "src/constant";
import { useAvailableItems } from "src/hooks/useAvailability";
import useAutomaticMediaAssets from "src/hooks/useAutomaticMediaAssets";
import useResolvedTrailer from "src/hooks/useResolvedTrailer";
import { useContinueWatching } from "src/hooks/useContinueWatching";
import { getMediaImageUrl } from "src/hooks/useCDNImage";
import TrailerPlayer from "src/components/TrailerPlayer";
import TrailerAudioButton from "src/components/TrailerAudioButton";
import VideoItemWithHover from "src/components/VideoItemWithHover";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";
const HERO_TRAILER_DELAY = 4000;
const TRAILER_LOOKUP_DELAY = 900;
const STREAM_PROFILE_TTL = 2 * 60 * 60 * 1000;
const WATCH_STREAM_CACHE_PREFIX = "watch_stream_cache:";

export async function loader() {
  return null;
}

function getUserId() {
  let userId = localStorage.getItem("netflix_user_id");
  if (!userId) {
    userId = `user_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem("netflix_user_id", userId);
  }
  return userId;
}

function firstRemote(...values: any[]) {
  for (const value of values) {
    const raw = typeof value === "string" ? value : value?.url;
    if (!raw) continue;
    const text = String(raw).trim();
    if (!text) continue;
    if (text.startsWith("data:") || text.startsWith("blob:")) return text;
    if (!/^https?:\/\//i.test(text)) continue;
    if (/^https?:\/\/image\.tmdb\.org\//i.test(text)) continue;
    return text;
  }
  return null;
}

function yearFrom(detail: any) {
  const raw = detail?.release_date || detail?.first_air_date || "";
  return raw ? String(raw).slice(0, 4) : "";
}

function runtimeText(detail: any, isTV: boolean) {
  if (isTV) return detail?.number_of_seasons ? `${detail.number_of_seasons} Stagioni` : "Serie TV";
  const minutes = Number(detail?.runtime || 0);
  if (!minutes) return "Film";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest ? `${rest}min` : ""}`.trim() : `${minutes}min`;
}

function secondsText(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  if (safe >= 3600) {
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    return `${hours}h ${minutes ? `${minutes}min` : ""}`.trim();
  }
  return `${Math.max(1, Math.ceil(safe / 60))} min`;
}

function qualityLabelFromHeight(height: number) {
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "Full HD";
  if (height >= 720) return "HD";
  if (height > 0) return `${height}p`;
  return null;
}

function qualityFromPayload(payload: any) {
  const values = [
    payload?.quality,
    payload?.quality_label,
    payload?.resolution,
    payload?.video_quality,
    payload?.stream_quality,
    payload?.stream?.quality,
    payload?.stream?.resolution,
  ];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    if (/4k|2160/i.test(text)) return "4K";
    if (/1440/i.test(text)) return "1440p";
    if (/1080|full\s*hd/i.test(text)) return "Full HD";
    if (/720|\bhd\b/i.test(text)) return "HD";
    if (/\d{3,4}p/i.test(text)) return text.match(/\d{3,4}p/i)?.[0] || text;
  }
  const height = Number(payload?.height || payload?.video_height || payload?.stream?.height || 0);
  return qualityLabelFromHeight(height);
}

function cacheResolvedStream(typeSlug: string, id: number, season: number, episode: number, payload: any) {
  if (!payload?.success || !payload?.stream) return;
  try {
    const logicalSeason = typeSlug === "tv" ? season || 1 : 0;
    const logicalEpisode = typeSlug === "tv" ? episode || 1 : 0;
    sessionStorage.setItem(
      `${WATCH_STREAM_CACHE_PREFIX}${typeSlug}:${id}:${logicalSeason}:${logicalEpisode}`,
      JSON.stringify({
        stream: payload.stream,
        type: payload.type || "hls",
        source: payload.source,
        savedAt: Date.now(),
      })
    );
  } catch {}
}

async function inspectPlaybackProfile(typeSlug: string, id: number, season?: number, episode?: number) {
  const logicalSeason = typeSlug === "tv" ? Number(season || 1) : 0;
  const logicalEpisode = typeSlug === "tv" ? Number(episode || 1) : 0;
  const suffix = typeSlug === "tv" ? `:${logicalSeason}:${logicalEpisode}` : ":0:0";
  const cacheKey = `flixit-detail-stream-profile:${typeSlug}:${id}${suffix}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (cached && Date.now() - Number(cached.ts || 0) < STREAM_PROFILE_TTL) return cached.value || {};
  } catch {}

  const path = typeSlug === "tv"
    ? `${API_URL}/api/player/tv/${id}/${logicalSeason}/${logicalEpisode}`
    : `${API_URL}/api/player/movie/${id}`;

  try {
    const response = await fetch(path, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return {};
    const payload = await response.json();
    cacheResolvedStream(typeSlug, id, logicalSeason, logicalEpisode, payload);

    // Do not fetch the HLS manifest merely to decorate Detail with a quality
    // label. That request used to compete with the actual player and sometimes
    // doubled startup traffic. The player reports the real active resolution.
    const value = {
      quality: qualityFromPayload(payload),
      audio: payload?.dolby_atmos === true ? "Dolby Atmos" : null,
      success: !!payload?.success,
    };
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), value })); } catch {}
    return value;
  } catch {
    return {};
  }
}

function episodeAbsoluteImage(episode: any, fallback: string | null, id: number) {
  return firstRemote(
    episode?.still_url,
    episode?.image_url,
    episode?.thumbnail_url,
    episode?.backdrop_path
  ) || getMediaImageUrl(id, "backdrop", fallback, "", "original") || fallback || "/placeholder.jpg";
}

export function Component() {
  const { mediaType, id } = useParams<{ mediaType: string; id: string }>();
  const navigate = useNavigate();
  const mediaId = Number(id) || 0;
  const typeSlug = mediaType === "tv" ? "tv" : "movie";
  const type = typeSlug === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;
  const isTV = typeSlug === "tv";

  const [getVideoDetail, { data: detail }] = useLazyGetAppendedVideosQuery();
  const [getSeasonDetails] = useLazyGetTVSeasonDetailsQuery();
  const [getGenrePage] = useLazyGetVideosByMediaTypeAndGenreIdQuery();

  const [trailerLookupEnabled, setTrailerLookupEnabled] = useState(false);
  const automaticAssets = useAutomaticMediaAssets(
    { ...(detail || {}), id: mediaId, type: typeSlug },
    type,
    !!mediaId
  );
  const resolvedTrailer = useResolvedTrailer(type, mediaId, trailerLookupEnabled && !!mediaId);
  const { items: continueWatchingItems } = useContinueWatching();

  const [selectedSeason, setSelectedSeason] = useState(1);
  const [availableSeasons, setAvailableSeasons] = useState<any[]>([]);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [inMyList, setInMyList] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [streamProfile, setStreamProfile] = useState<any>({});
  const [relatedPool, setRelatedPool] = useState<any[]>([]);
  const episodesRef = useRef<HTMLDivElement | null>(null);

  const progressItem = useMemo(
    () => continueWatchingItems.find((item: any) => Number(item.tmdb_id) === mediaId && item.media_type === typeSlug),
    [continueWatchingItems, mediaId, typeSlug]
  );

  const progressPercent = progressItem?.duration > 0
    ? Math.min(100, Math.max(0, (progressItem.progress / progressItem.duration) * 100))
    : 0;
  const remainingSeconds = progressItem?.duration > 0
    ? Math.max(0, progressItem.duration - progressItem.progress)
    : 0;

  useEffect(() => {
    if (!mediaId) return;
    getVideoDetail({ mediaType: type, id: mediaId });
  }, [getVideoDetail, mediaId, type]);

  useEffect(() => {
    setTrailerLookupEnabled(false);
    setShowTrailer(false);
    setTrailerPlaying(false);
    setMuted(true);
    setStreamProfile({});
    setRelatedPool([]);
    setEpisodes([]);
    setAvailableSeasons([]);
    setSelectedSeason(1);
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
    if (!mediaId) return;
    const userId = getUserId();
    fetch(`${API_URL}/api/user/list/check/${userId}/${typeSlug}/${mediaId}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => data && setInMyList(!!data.in_list))
      .catch(() => {});
  }, [mediaId, typeSlug]);

  const loadSeason = useCallback(async (seasonNumber: number) => {
    if (!isTV || !mediaId) return;
    setEpisodesLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/public/tv/${mediaId}/season/${seasonNumber}`, {
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const data = await response.json();
        setEpisodes(Array.isArray(data?.episodes) ? data.episodes : []);
      } else {
        const fallback = await getSeasonDetails({ seriesId: mediaId, seasonNumber }).unwrap();
        setEpisodes(Array.isArray(fallback?.episodes) ? fallback.episodes : []);
      }
    } catch {
      try {
        const fallback = await getSeasonDetails({ seriesId: mediaId, seasonNumber }).unwrap();
        setEpisodes(Array.isArray(fallback?.episodes) ? fallback.episodes : []);
      } catch {
        setEpisodes([]);
      }
    } finally {
      setEpisodesLoading(false);
    }
  }, [getSeasonDetails, isTV, mediaId]);

  useEffect(() => {
    if (!isTV || !mediaId) return;
    let cancelled = false;
    fetch(`${API_URL}/api/public/tv/${mediaId}/seasons`, { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled) return;
        const seasons = Array.isArray(data?.seasons)
          ? data.seasons.filter((season: any) => Number(season?.season_number || 0) > 0)
          : (detail?.seasons || []).filter((season: any) => Number(season?.season_number || 0) > 0);
        setAvailableSeasons(seasons);
        const progressSeason = Number(progressItem?.season || 0);
        const preferred = seasons.find((season: any) => Number(season.season_number) === progressSeason)
          || seasons.find((season: any) => season.vixsrc_available !== false)
          || seasons[0];
        const seasonNumber = Number(preferred?.season_number || progressSeason || 1);
        setSelectedSeason(seasonNumber);
        loadSeason(seasonNumber);
      })
      .catch(() => {
        const seasons = (detail?.seasons || []).filter((season: any) => Number(season?.season_number || 0) > 0);
        setAvailableSeasons(seasons);
        const seasonNumber = Number(progressItem?.season || seasons[0]?.season_number || 1);
        setSelectedSeason(seasonNumber);
        loadSeason(seasonNumber);
      });
    return () => { cancelled = true; };
  }, [isTV, mediaId, detail?.seasons, progressItem?.season, loadSeason]);

  useEffect(() => {
    if (!detail?.genres?.length) return;
    const primaryGenre = Number(detail.genres[0]?.id || 0);
    if (!primaryGenre) return;
    let cancelled = false;
    let timer = 0;
    let idleId: any = null;

    const loadRelated = () => {
      Promise.all([
        getGenrePage({ mediaType: type, genreId: primaryGenre, page: 1 }).unwrap().catch(() => null),
        getGenrePage({ mediaType: type, genreId: primaryGenre, page: 2 }).unwrap().catch(() => null),
      ]).then((pages) => {
        if (cancelled) return;
        const merged = pages.flatMap((page: any) => page?.results || []);
        const seen = new Set<number>();
        const filtered = merged.filter((item: any) => {
          const itemId = Number(item?.id || item?.tmdbId || 0);
          if (!itemId || itemId === mediaId || seen.has(itemId)) return false;
          seen.add(itemId);
          return Array.isArray(item?.genre_ids) ? item.genre_ids.includes(primaryGenre) : true;
        }).slice(0, 30);
        setRelatedPool(filtered);
      });
    };

    if ("requestIdleCallback" in window) {
      idleId = (window as any).requestIdleCallback(loadRelated, { timeout: 2600 });
    } else {
      timer = window.setTimeout(loadRelated, 1200);
    }

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (idleId != null && "cancelIdleCallback" in window) (window as any).cancelIdleCallback(idleId);
    };
  }, [detail?.genres, getGenrePage, mediaId, type]);

  const relatedItems = useAvailableItems(relatedPool, typeSlug);

  const title = detail?.title || detail?.name || automaticAssets?.title || "";
  const logoUrl = firstRemote(automaticAssets?.logo_path, automaticAssets?.logo, detail?.netflix_logo_url);
  const backdropUrl = firstRemote(
    automaticAssets?.detail_backdrop_path,
    automaticAssets?.hero_backdrop_path,
    automaticAssets?.backdrop_path,
    detail?.netflix_artwork_url,
    detail?.backdrop_path
  );
  const posterUrl = firstRemote(automaticAssets?.poster_path, detail?.poster_path) || backdropUrl;
  const genres = (detail?.genres || []).map((genre: any) => genre?.name).filter(Boolean);
  const director = (detail?.credits?.crew || []).find((person: any) => person?.job === "Director")?.name || "—";
  const cast = (detail?.credits?.cast || []).slice(0, 4).map((person: any) => person?.name).filter(Boolean);
  const keywordItems = detail?.keywords?.keywords || detail?.keywords?.results || [];
  const themes = keywordItems.slice(0, 3).map((item: any) => item?.name).filter(Boolean);

  const qualityBadge = streamProfile?.quality || null;
  const audioBadge = streamProfile?.audio || null;

  const warmPlayback = useCallback((season?: number, episode?: number) => {
    if (!mediaId) return;
    const targetSeason = isTV ? Number(season || progressItem?.season || selectedSeason || 1) : undefined;
    const targetEpisode = isTV ? Number(episode || progressItem?.episode || 1) : undefined;
    inspectPlaybackProfile(typeSlug, mediaId, targetSeason, targetEpisode)
      .then((value) => value && setStreamProfile(value))
      .catch(() => {});
  }, [isTV, mediaId, progressItem?.episode, progressItem?.season, selectedSeason, typeSlug]);

  const goPlay = useCallback((season?: number, episode?: number) => {
    const targetSeason = isTV ? Number(season || progressItem?.season || selectedSeason || 1) : undefined;
    const targetEpisode = isTV ? Number(episode || progressItem?.episode || 1) : undefined;
    warmPlayback(targetSeason, targetEpisode);
    const suffix = isTV ? `?s=${targetSeason}&e=${targetEpisode}` : "";
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${mediaId}${suffix}`);
  }, [isTV, navigate, mediaId, progressItem?.episode, progressItem?.season, selectedSeason, typeSlug, warmPlayback]);

  const handleToggleList = useCallback(async () => {
    const userId = getUserId();
    const next = !inMyList;
    setInMyList(next);
    try {
      const endpoint = next ? "/api/user/list/add" : "/api/user/list/remove";
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          media_id: mediaId,
          media_type: typeSlug,
          title,
          poster_path: posterUrl,
          backdrop_path: backdropUrl,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (typeof data?.in_list === "boolean") setInMyList(data.in_list);
      }
    } catch {
      setInMyList(next);
    }
  }, [backdropUrl, inMyList, mediaId, posterUrl, title, typeSlug]);

  const scrollToEpisodes = useCallback(() => {
    episodesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const episodeStatus = useCallback((episodeNumber: number) => {
    const watchedSeason = Number(progressItem?.season || 0);
    const watchedEpisode = Number(progressItem?.episode || 0);
    if (!progressItem || !watchedSeason || !watchedEpisode) {
      return { kind: episodeNumber === 1 ? "next" : "new", percent: 0 };
    }
    if (selectedSeason < watchedSeason) return { kind: "complete", percent: 100 };
    if (selectedSeason > watchedSeason) return { kind: episodeNumber === 1 ? "next" : "new", percent: 0 };
    if (episodeNumber < watchedEpisode) return { kind: "complete", percent: 100 };
    if (episodeNumber === watchedEpisode) return { kind: "progress", percent: progressPercent };
    if (episodeNumber === watchedEpisode + 1) return { kind: "next", percent: 0 };
    return { kind: "new", percent: 0 };
  }, [progressItem, progressPercent, selectedSeason]);

  if (!detail) {
    return (
      <Box sx={{ minHeight: "82vh", bgcolor: "#090909", display: "grid", placeItems: "center" }}>
        <CircularProgress sx={{ color: "#e50914" }} />
      </Box>
    );
  }

  return (
    <Box data-testid="detail-page-redesign" sx={{ bgcolor: "#090909", color: "#fff", minHeight: "100vh", overflowX: "hidden" }}>
      <Box sx={{ position: "relative", height: "clamp(610px, 47vw, 760px)", overflow: "hidden" }}>
        {backdropUrl ? (
          <Box component="img" src={backdropUrl} alt="" decoding="async" fetchPriority="high" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 24%" }} />
        ) : null}

        {showTrailer && resolvedTrailer.url ? (
          <TrailerPlayer
            key={resolvedTrailer.url}
            videoKey={resolvedTrailer.url}
            muted={muted}
            playing
            loop
            zoom={1.08}
            onPlaying={() => setTrailerPlaying(true)}
            onError={() => {
              setShowTrailer(false);
              setTrailerPlaying(false);
            }}
          />
        ) : null}

        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(0,0,0,.94) 0%, rgba(0,0,0,.72) 31%, rgba(0,0,0,.18) 63%, rgba(0,0,0,.12) 100%)" }} />
        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, #090909 0%, rgba(9,9,9,.82) 8%, transparent 35%)" }} />

        <Box sx={{ position: "absolute", left: "4vw", bottom: 96, zIndex: 5, width: "min(590px, 44vw)" }}>
          {logoUrl ? (
            <Box component="img" src={logoUrl} alt={title} decoding="async" sx={{ display: "block", width: "auto", maxWidth: "520px", maxHeight: 190, objectFit: "contain", objectPosition: "left center", mb: 2.2 }} />
          ) : null}

          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1.6} sx={{ alignItems: "center", mb: 2, color: "rgba(255,255,255,.78)", fontSize: 16 }}>
            {yearFrom(detail) ? <span>{yearFrom(detail)}</span> : null}
            <span>•</span>
            <span>{runtimeText(detail, isTV)}</span>
            {genres[0] ? <><span>•</span><span>{genres[0]}</span></> : null}
            {qualityBadge ? <><span>•</span><Box component="span" sx={{ border: "1px solid rgba(255,255,255,.45)", borderRadius: "4px", px: .8, py: .2, fontWeight: 700 }}>{qualityBadge}</Box></> : null}
            {audioBadge ? <><span>•</span><span>{audioBadge}</span></> : null}
          </Stack>

          <Typography sx={{ fontSize: 18, lineHeight: 1.5, color: "rgba(255,255,255,.9)", maxWidth: 590, textShadow: "0 2px 16px rgba(0,0,0,.75)", mb: 3 }}>
            {detail?.overview || ""}
          </Typography>

          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Button
              data-testid="detail-play"
              onClick={() => goPlay()}
              onMouseEnter={() => warmPlayback()}
              onFocus={() => warmPlayback()}
              onTouchStart={() => warmPlayback()}
              startIcon={<PlayArrowIcon sx={{ fontSize: 32 }} />}
              sx={{ bgcolor: "#fff", color: "#000", px: 3.2, py: 1.25, fontSize: 18, fontWeight: 800, borderRadius: 1, textTransform: "none", "&:hover": { bgcolor: "rgba(255,255,255,.82)" } }}
            >
              {progressItem ? "Riprendi" : "Riproduci"}
            </Button>
            <Button
              data-testid="detail-my-list"
              onClick={handleToggleList}
              startIcon={inMyList ? <CheckIcon /> : <AddIcon />}
              sx={{ bgcolor: "rgba(70,70,70,.78)", color: "#fff", px: 2.8, py: 1.25, fontSize: 17, fontWeight: 700, borderRadius: 1, textTransform: "none", "&:hover": { bgcolor: "rgba(95,95,95,.9)" } }}
            >
              La mia lista
            </Button>
            {isTV ? (
              <Button
                onClick={scrollToEpisodes}
                endIcon={<KeyboardArrowDownIcon />}
                sx={{ color: "#fff", fontSize: 16, fontWeight: 700, textTransform: "none", px: 1.2, "&:hover": { bgcolor: "rgba(255,255,255,.08)" } }}
              >
                Episodi
              </Button>
            ) : null}
          </Stack>
        </Box>

        {showTrailer && resolvedTrailer.url && trailerPlaying ? (
          <Box sx={{ position: "absolute", right: "3vw", bottom: 78, zIndex: 7 }}>
            <TrailerAudioButton muted={muted} onToggle={() => setMuted((value) => !value)} testId="detail-hero-audio-toggle" />
          </Box>
        ) : null}
      </Box>

      <Box sx={{ px: "4vw", mt: -4, position: "relative", zIndex: 8, pb: 8 }}>
        {progressItem ? (
          <Box sx={{ border: "1px solid rgba(255,255,255,.15)", bgcolor: "rgba(18,20,23,.94)", borderRadius: 2, p: 2, mb: 3.5, display: "grid", gridTemplateColumns: "280px 1fr auto", alignItems: "center", gap: 2.5, boxShadow: "0 22px 60px rgba(0,0,0,.36)" }}>
            <Box sx={{ height: 124, borderRadius: 1.5, overflow: "hidden", position: "relative", bgcolor: "#111" }}>
              {posterUrl ? <Box component="img" src={posterUrl} alt="" loading="lazy" decoding="async" sx={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
              <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", bgcolor: "rgba(0,0,0,.18)" }}>
                <Box sx={{ width: 48, height: 48, borderRadius: "50%", border: "2px solid #fff", display: "grid", placeItems: "center", bgcolor: "rgba(0,0,0,.4)" }}><PlayArrowIcon /></Box>
              </Box>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 19, fontWeight: 800, mb: .6 }}>Continua da dove hai interrotto</Typography>
              <Typography sx={{ fontSize: 17, fontWeight: 700, mb: 1.4 }}>
                {isTV ? `S${progressItem.season || 1}:E${progressItem.episode || 1}` : title}
                {isTV && progressItem.title ? ` · ${progressItem.title}` : ""}
              </Typography>
              <Box sx={{ width: "min(520px, 100%)", height: 5, bgcolor: "rgba(255,255,255,.22)", borderRadius: 999, overflow: "hidden", mb: .8 }}>
                <Box sx={{ width: `${progressPercent}%`, height: "100%", bgcolor: "#e50914" }} />
              </Box>
              <Typography sx={{ fontSize: 14, color: "rgba(255,255,255,.68)" }}>{secondsText(remainingSeconds)} rimanenti</Typography>
            </Box>
            <Button
              onClick={() => goPlay(progressItem.season, progressItem.episode)}
              onMouseEnter={() => warmPlayback(progressItem.season, progressItem.episode)}
              onFocus={() => warmPlayback(progressItem.season, progressItem.episode)}
              startIcon={<PlayArrowIcon />}
              sx={{ bgcolor: "#e50914", color: "#fff", px: 2.6, py: 1.2, fontSize: 16, fontWeight: 800, textTransform: "none", borderRadius: 1, "&:hover": { bgcolor: "#f6121d" } }}
            >
              {isTV ? "Riprendi episodio" : "Riprendi"}
            </Button>
          </Box>
        ) : null}

        {!isTV ? (
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1.25fr 1fr 1fr", gap: 0, borderTop: "1px solid rgba(255,255,255,.08)", borderBottom: "1px solid rgba(255,255,255,.08)", mb: 5 }}>
            {[
              ["Regia", director],
              ["Cast", cast.length ? cast.join("\n") : "—"],
              ["Genere", genres.length ? genres.slice(0, 3).join(", ") : "—"],
              ["Temi", themes.length ? themes.join(", ") : (genres.slice(1, 4).join(", ") || "—")],
            ].map(([label, value], index) => (
              <Box key={label} sx={{ py: 2.6, px: index ? 3 : 0, borderLeft: index ? "1px solid rgba(255,255,255,.08)" : "none", minHeight: 130 }}>
                <Typography sx={{ fontSize: 15, color: "rgba(255,255,255,.56)", mb: .7 }}>{label}</Typography>
                <Typography sx={{ fontSize: 16, lineHeight: 1.55, whiteSpace: "pre-line", color: "rgba(255,255,255,.9)" }}>{value}</Typography>
              </Box>
            ))}
          </Box>
        ) : null}

        {isTV ? (
          <Box ref={episodesRef} id="episodes" sx={{ scrollMarginTop: 90, mb: 5 }}>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1.6 }}>
              <Stack direction="row" spacing={1.8} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontSize: 27, fontWeight: 800 }}>Episodi</Typography>
                <FormControl size="small">
                  <Select
                    value={selectedSeason}
                    onChange={(event) => {
                      const season = Number(event.target.value);
                      setSelectedSeason(season);
                      loadSeason(season);
                    }}
                    sx={{ color: "#fff", bgcolor: "#1b1d20", borderRadius: 999, minWidth: 145, fontWeight: 700, ".MuiOutlinedInput-notchedOutline": { border: "none" }, ".MuiSvgIcon-root": { color: "#fff" } }}
                  >
                    {(availableSeasons.length ? availableSeasons : [{ season_number: selectedSeason }]).map((season: any) => (
                      <MenuItem key={season.season_number} value={Number(season.season_number)}>Stagione {season.season_number}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
              <Typography sx={{ color: "rgba(255,255,255,.58)", fontSize: 14 }}>{episodes.length} episodi</Typography>
            </Stack>

            {episodesLoading ? (
              <Box sx={{ minHeight: 160, display: "grid", placeItems: "center" }}><CircularProgress sx={{ color: "#e50914" }} /></Box>
            ) : (
              <Stack spacing={.8}>
                {episodes.map((episode: any, index: number) => {
                  const number = Number(episode?.episode_number || index + 1);
                  const status = episodeStatus(number);
                  const isCurrent = status.kind === "progress";
                  const isNext = status.kind === "next";
                  const image = episodeAbsoluteImage(episode, backdropUrl, mediaId);
                  const duration = Number(episode?.runtime || 0);
                  return (
                    <Box
                      key={episode?.id || `${selectedSeason}-${number}`}
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "58px 190px 235px 1fr 90px 220px 200px",
                        alignItems: "center",
                        minHeight: 94,
                        border: "1px solid rgba(255,255,255,.09)",
                        borderLeft: isCurrent ? "4px solid #e50914" : "1px solid rgba(255,255,255,.09)",
                        borderRadius: 1.5,
                        overflow: "hidden",
                        bgcolor: isCurrent ? "rgba(35,40,45,.9)" : "rgba(16,18,20,.72)",
                        transition: "background-color 180ms ease, transform 180ms ease",
                        "&:hover": { bgcolor: "rgba(41,45,50,.96)", transform: "translateY(-1px)" },
                      }}
                    >
                      <Typography sx={{ textAlign: "center", fontSize: 19, fontWeight: 800 }}>{number}</Typography>
                      <Box sx={{ height: 92, overflow: "hidden", bgcolor: "#111" }}>
                        <Box component="img" src={image} alt="" loading="lazy" decoding="async" sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </Box>
                      <Box sx={{ px: 2 }}>
                        {isNext ? <Typography sx={{ color: "#ff3340", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".06em", mb: .25 }}>Prossimo episodio</Typography> : null}
                        <Typography sx={{ fontSize: 16, fontWeight: 800 }}>{episode?.name || `Episodio ${number}`}</Typography>
                      </Box>
                      <Typography sx={{ px: 2, fontSize: 13.5, lineHeight: 1.4, color: "rgba(255,255,255,.68)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{episode?.overview || ""}</Typography>
                      <Typography sx={{ fontSize: 13.5, color: "rgba(255,255,255,.7)" }}>{duration ? `${duration} min` : ""}</Typography>
                      <Box sx={{ pr: 2 }}>
                        <Box sx={{ height: 5, bgcolor: "rgba(255,255,255,.18)", borderRadius: 999, overflow: "hidden", mb: .55 }}>
                          <Box sx={{ height: "100%", width: `${status.percent || 0}%`, bgcolor: status.percent ? "#e50914" : "transparent" }} />
                        </Box>
                        <Typography sx={{ fontSize: 12, color: "rgba(255,255,255,.6)" }}>{status.kind === "complete" ? "100% visto" : status.kind === "progress" ? `${Math.round(status.percent)}% visto` : ""}</Typography>
                      </Box>
                      <Box sx={{ pr: 2, display: "flex", justifyContent: "flex-end" }}>
                        {status.kind === "complete" ? (
                          <Box sx={{ px: 1.4, py: .75, borderRadius: 999, bgcolor: "rgba(20,107,61,.42)", color: "#baf6d0", fontSize: 13, fontWeight: 800 }}>Completato</Box>
                        ) : status.kind === "progress" ? (
                          <Button onClick={() => goPlay(selectedSeason, number)} onMouseEnter={() => warmPlayback(selectedSeason, number)} startIcon={<PlayArrowIcon />} sx={{ bgcolor: "rgba(229,9,20,.35)", color: "#fff", textTransform: "none", fontWeight: 800, borderRadius: 999, px: 1.8, "&:hover": { bgcolor: "rgba(229,9,20,.65)" } }}>Riprendi</Button>
                        ) : status.kind === "next" ? (
                          <Button onClick={() => goPlay(selectedSeason, number)} onMouseEnter={() => warmPlayback(selectedSeason, number)} startIcon={<PlayArrowIcon />} sx={{ bgcolor: "rgba(18,86,148,.52)", color: "#dbeeff", textTransform: "none", fontWeight: 800, borderRadius: 999, px: 1.8, "&:hover": { bgcolor: "rgba(18,86,148,.8)" } }}>Prossimo episodio</Button>
                        ) : (
                          <Button onClick={() => goPlay(selectedSeason, number)} onMouseEnter={() => warmPlayback(selectedSeason, number)} startIcon={<PlayArrowIcon />} sx={{ color: "#fff", textTransform: "none", fontWeight: 800, border: "1px solid rgba(255,255,255,.35)", borderRadius: 999, px: 1.7, "&:hover": { bgcolor: "rgba(255,255,255,.1)" } }}>Riproduci</Button>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Box>
        ) : null}

        <Box sx={{ mt: 3 }}>
          <Typography sx={{ fontSize: 25, fontWeight: 800, mb: 1.8 }}>Altri contenuti simili</Typography>
          <Box sx={{ display: "flex", gap: 1.4, overflowX: "auto", overflowY: "visible", pb: 5, scrollSnapType: "x proximity", "&::-webkit-scrollbar": { height: 5 }, "&::-webkit-scrollbar-thumb": { bgcolor: "rgba(255,255,255,.18)", borderRadius: 999 } }}>
            {relatedItems.slice(0, 30).map((item: any) => (
              <Box key={item.id || item.tmdbId} sx={{ flex: "0 0 clamp(235px, 18vw, 305px)", scrollSnapAlign: "start" }}>
                <VideoItemWithHover video={{ ...item, type: typeSlug, media_type: typeSlug }} mediaType={type} />
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default Component;
